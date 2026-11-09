import { spawn, type ChildProcess } from 'node:child_process'
import type { McpServer } from './mcpStore.js'

/**
 * Connection test for one MCP server — a real connection, not
 * a simulation, and the SAME connection a chat turn makes:
 * every transport is probed through @mastra/mcp's MCPClient
 * with the shared server definition and the legacy-handshake
 * pin (see mcpClient.ts). One machinery, one strictness — a
 * passing Test means the chat client will connect, and a
 * failing one fails here first, in the manager, where the user
 * can fix it.
 *
 * One hand-rolled remnant, on purpose: when a stdio server
 * fails, a short raw respawn (diagnoseStdio) harvests the exit
 * code and the server's own stderr for the error message. The
 * SDK reports "transport closed"; the server itself usually
 * said why ("bad api key") — and for local servers that stderr
 * is the best error there is. The diagnostic never changes the
 * verdict, only the wording.
 */

export interface McpProbeTool { name: string, description: string }

export interface McpProbeResult {
  ok: boolean
  latencyMs: number
  error?: string
  serverName?: string
  serverVersion?: string
  tools?: McpProbeTool[]
}

type ProbeTarget = Pick<McpServer, 'transport' | 'command' | 'args' | 'env' | 'url' | 'headers' | 'protocolVersion'>

export async function probeMcpServer(
  target: ProbeTarget,
  timeoutMs = 15_000,
  opts?: { protocolChoiceEnabled?: boolean },
): Promise<McpProbeResult> {
  const started = Date.now()
  if (target.transport === 'stdio') {
    if (!target.command) {
      return { ok: false, latencyMs: 0, error: 'No command set for this server.' }
    }
  } else {
    if (!target.url) return { ok: false, latencyMs: 0, error: 'No URL set for this server.' }
    try { new URL(target.url) } catch { return { ok: false, latencyMs: 0, error: `That doesn't look like a valid URL: ${target.url}` } }
  }
  return probeViaClient(target, started, timeoutMs, opts?.protocolChoiceEnabled === true)
}

/**
 * MCPClient failures arrive as long JSON error blobs; the
 * useful sentence is the innermost cause's message. Pull that
 * out, translate the common network cases into plain words,
 * and cap the length.
 */
export function shortenMcpError(raw: string): string {
  if (/ENOENT/.test(raw)) return 'A command in this server\'s config was not found — check the command name.'
  if (/ECONNREFUSED/.test(raw)) return 'Connection refused — is a server really running at that URL?'
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/.test(raw)) return 'That host could not be found — check the URL.'
  const http = /\bHTTP (\d{3})\b|status[:\s]+(\d{3})\b|\((\d{3})\)/.exec(raw)
  const status = http ? (http[1] ?? http[2] ?? http[3]) : undefined
  // undici collapses refused/DNS/reset into a bare "fetch
  // failed" whose cause the SDK's error string doesn't carry —
  // say exactly that much, in plain words.
  if (!status && /fetch failed/i.test(raw)) {
    return 'Could not connect — no answer came back. Check the URL and that the server is running.'
  }
  let msg = raw
  const cause = /"cause":\{"message":"((?:[^"\\]|\\.)*)"/.exec(raw)
  const first = /"message":"((?:[^"\\]|\\.)*)"/.exec(raw)
  const picked = cause?.[1] ?? first?.[1]
  if (picked) {
    try { msg = JSON.parse(`"${picked}"`) as string } catch { msg = picked }
  }
  msg = msg.split('\n')[0].trim()
  if (status === '401' || status === '403') {
    return `The server refused the connection (HTTP ${status}) — check the authorization header.`
  }
  if (status) return `The server answered HTTP ${status}. ${msg}`.trim()
  return (msg || raw.split('\n')[0]).slice(0, 300)
}

async function probeViaClient(target: ProbeTarget, started: number, timeoutMs: number, protocolChoiceEnabled: boolean): Promise<McpProbeResult> {
  const { MCPClient } = await import('@mastra/mcp')
  const { buildMcpServerDefinition } = await import('./mcpClient.js')
  const key = 'probe'
  const client = new MCPClient({
    id: `probe-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    registerProcessHooks: false,
    timeout: timeoutMs,
    servers: { [key]: buildMcpServerDefinition(target, protocolChoiceEnabled) },
  } as never)
  try {
    const listed = await Promise.race([
      client.listToolsetsWithErrors(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the server to answer.`)), timeoutMs),
      ),
    ])
    const failure = listed.errors?.[key]
    if (typeof failure === 'string' && failure) {
      return { ok: false, latencyMs: Date.now() - started, error: await explainFailure(target, shortenMcpError(failure)) }
    }
    const rawTools = listed.toolsets?.[key] ?? {}
    const tools = Object.entries(rawTools).map(([name, tool]) => ({
      name,
      description: typeof (tool as { description?: unknown }).description === 'string'
        ? (tool as { description: string }).description
        : '',
    }))
    const info = client.getServerInfo()[key]
    return {
      ok: true,
      latencyMs: Date.now() - started,
      ...(info?.name ? { serverName: info.name } : {}),
      ...(info?.version ? { serverVersion: info.version } : {}),
      tools,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // The race's own timeout message is already plain; other
    // thrown errors go through the shortener.
    const plain = msg.startsWith('Timed out after') ? msg : shortenMcpError(msg)
    return { ok: false, latencyMs: Date.now() - started, error: await explainFailure(target, plain) }
  } finally {
    await client.disconnect().catch(() => { /* best-effort */ })
  }
}

/** For a failed stdio probe, let the server speak for itself:
 * a spawn error or an early exit replaces the SDK's wording
 * (it adds nothing); a still-running server's stderr is
 * appended to whatever the client reported. */
async function explainFailure(target: ProbeTarget, primary: string): Promise<string> {
  if (target.transport !== 'stdio' || !target.command) return primary
  const diag = await diagnoseStdio(target, 2_500)
  if (!diag) return primary
  if (diag.kind === 'spawn-error') {
    return diag.code === 'ENOENT' ? `Command not found: ${target.command}` : `Could not start ${target.command}: ${diag.message}`
  }
  const said = diag.stderr.trim() ? ` Server said: ${diag.stderr.trim().slice(-300)}` : ''
  if (diag.kind === 'exited') {
    // A clean exit with nothing said teaches nothing (the
    // server may simply have wound down) — the client's own
    // report stands. A crash, or an exit with stderr, is the
    // server explaining itself: that wording wins.
    if (diag.code === 0 && !said) return primary
    return `Server exited (code ${diag.code ?? '?'}) before answering.${said}`
  }
  return said ? `${primary}${said}` : primary
}

type StdioDiagnosis =
  | { kind: 'spawn-error', message: string, code?: string }
  | { kind: 'exited', code: number | null, stderr: string }
  | { kind: 'running', stderr: string }

/** Respawn the command briefly, capturing only what it says
 * and how it ends. This never speaks MCP; it listens. stdin
 * stays piped and OPEN — a server fed a closed stdin winds
 * down and exits 0, which would say nothing about the real
 * failure. */
function diagnoseStdio(target: ProbeTarget, windowMs: number): Promise<StdioDiagnosis | null> {
  return new Promise(resolve => {
    let child: ChildProcess
    try {
      child = spawn(target.command!, target.args ?? [], {
        env: { ...process.env, ...(target.env ?? {}) },
        stdio: ['pipe', 'ignore', 'pipe'],
      })
    } catch {
      resolve(null)
      return
    }
    let stderr = ''
    let done = false
    const finish = (d: StdioDiagnosis) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      resolve(d)
    }
    const timer = setTimeout(() => finish({ kind: 'running', stderr }), windowMs)
    child.on('error', err => {
      const e = err as NodeJS.ErrnoException
      finish({ kind: 'spawn-error', message: err.message, ...(e.code ? { code: e.code } : {}) })
    })
    child.on('exit', code => finish({ kind: 'exited', code, stderr }))
    child.stderr?.on('data', d => { stderr = (stderr + String(d)).slice(-2000) })
  })
}
