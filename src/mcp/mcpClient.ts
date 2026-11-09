import { MCPClient, type MCPClientToolsets, type MCPServerMap } from '@mastra/mcp'
import { loadMcpConfig, type McpConfig, type McpServer } from './mcpStore.js'

/** One server's tools as MCPClient returns them. */
type OneToolset = MCPClientToolsets<MCPServerMap>[string]

/**
 * The agent side of MCP: turning the manager's store into tools
 * a chat turn can call.
 *
 * Lifecycle is per turn, on purpose. Each Files-mode chat turn
 * connects fresh to every enabled server (in parallel), offers
 * exactly the tools the manager has switched on, and disconnects
 * when the turn's stream ends. That is what the manager's footer
 * promises — "changes apply to the next chat turn" — and it
 * means a crashed, edited or deleted server can never leave a
 * stale client behind. The cost is one spawn + handshake per
 * server per turn; if that ever hurts, this is the one place a
 * connection cache would go.
 *
 * Failures are isolated per server: a server that won't connect
 * is reported in `failures` and the turn proceeds without its
 * tools. Nothing here writes the store — test status remains
 * the manager's own record.
 */

export interface McpTurnToolsets {
  /** Toolsets for agent.stream/generate, keyed by server key;
   * inner keys are the namespaced tool names. */
  toolsets: MCPClientToolsets<MCPServerMap>
  /** The namespaced tool names — callers must add these to the
   * turn's activeTools, or Mastra's activeTools filter drops
   * toolset tools (they merge into one dictionary). */
  toolNames: string[]
  summary: { server: string, key: string, tools: number }[]
  failures: { server: string, error: string }[]
  close: () => Promise<void>
}

/** Server name → tool-name prefix. Provider APIs require
 * [a-zA-Z0-9_-]; keep it short, stable and readable. */
export function mcpServerKey(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return key || 'server'
}

/** Unique keys for a set of servers (two servers both named
 * "github" must not merge into one toolset). */
export function assignMcpServerKeys(servers: McpServer[]): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const s of servers) {
    let key = mcpServerKey(s.name)
    if (used.has(key)) {
      let n = 2
      while (used.has(`${key}-${n}`)) n++
      key = `${key}-${n}`
    }
    used.add(key)
    out.set(s.id, key)
  }
  return out
}

/** The name a tool is offered under: server key + raw name,
 * capped at the 64 characters provider APIs allow. */
export function mcpToolName(key: string, rawName: string): string {
  const raw = rawName.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return `${key}_${raw}`.slice(0, 64)
}

/** Keep only the tools the manager has enabled, re-keyed to
 * their namespaced names. Raw toolset keys are the server's own
 * tool names (MCPClient does not prefix them), so without this
 * two servers offering "search" — or one offering "read-file" —
 * would collide with each other and with built-in tools in the
 * agent's merged tool dictionary. */
export function filterMcpToolset(
  server: McpServer,
  key: string,
  rawToolset: OneToolset,
): OneToolset {
  const enabled = new Set(server.tools.filter(t => t.enabled).map(t => t.name))
  const out: OneToolset = {}
  for (const [rawName, tool] of Object.entries(rawToolset)) {
    if (enabled.has(rawName)) out[mcpToolName(key, rawName)] = tool
  }
  return out
}

const CONNECT_TIMEOUT_MS = 10_000

/** The reach fields a server definition is built from. */
export type McpServerReach = Pick<McpServer, 'transport' | 'command' | 'args' | 'env' | 'url' | 'headers' | 'protocolVersion'>

/** Store record → MCPClient server definition. Shared with the
 * manager's connection probe, so Test exercises exactly what a
 * chat turn will connect with.
 *
 * The protocol pin: 'legacy' (the pre-2026 initialize
 * handshake) for everything, because left unpinned this
 * @mastra/mcp version probes each server with
 * `server/discover` (the 2026-07-28 revision) and waits out a
 * long probe timeout against every server that doesn't speak
 * it yet — which today is all of them, including every
 * reference server in the manager's presets. Only when the
 * Settings gate (protocolChoiceEnabled) is on does a server's
 * own stored choice apply: 'auto' leaves the definition
 * unpinned (probe), '2026' requires the new revision. */
export function buildMcpServerDefinition(server: McpServerReach, protocolChoiceEnabled = false): Record<string, unknown> {
  const choice = protocolChoiceEnabled ? server.protocolVersion : undefined
  const base = choice === 'auto'
    ? {}
    : choice === '2026'
      ? { protocolVersion: '2026-07-28' as const }
      : { protocolVersion: 'legacy' as const }
  if (server.transport === 'stdio') {
    return {
      ...base,
      command: server.command ?? '',
      ...(server.args?.length ? { args: server.args } : {}),
      ...(server.env ? { env: server.env } : {}),
    }
  }
  return {
    ...base,
    url: new URL(server.url ?? ''),
    ...(server.headers ? { requestInit: { headers: server.headers } } : {}),
  }
}

async function connectServer(
  server: McpServer,
  key: string,
  turnId: string,
  protocolChoiceEnabled: boolean,
): Promise<{ toolset: OneToolset, client: MCPClient } | { error: string, client: MCPClient }> {
  const client = new MCPClient({
    id: `turn-${turnId}-${key}`,
    registerProcessHooks: false,
    timeout: 30_000,
    servers: { [key]: buildMcpServerDefinition(server, protocolChoiceEnabled) },
  } as never)
  try {
    const listed = await Promise.race([
      client.listToolsetsWithErrors(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${CONNECT_TIMEOUT_MS / 1000}s connecting`)), CONNECT_TIMEOUT_MS),
      ),
    ])
    const failure = listed.errors?.[key]
    if (typeof failure === 'string' && failure) return { error: failure, client }
    const raw = listed.toolsets?.[key] ?? {}
    return { toolset: filterMcpToolset(server, key, raw), client }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), client }
  }
}

/**
 * Connect every usable server in the config and collect its
 * enabled tools as agent toolsets. Usable = the server is on
 * and at least one of its known tools is on (a server that was
 * never tested has no known tools — the manager's Test is what
 * discovers them).
 */
export async function getMcpToolsetsForTurn(cfg: McpConfig = loadMcpConfig()): Promise<McpTurnToolsets> {
  // The Settings master switch: MCP off for chat means no
  // connections at all — not even attempts that would fail.
  if (cfg.settings?.chatToolsEnabled === false) {
    return { toolsets: {}, toolNames: [], summary: [], failures: [], close: async () => { /* nothing connected */ } }
  }
  const protocolChoiceEnabled = cfg.settings?.protocolChoiceEnabled === true
  const candidates = cfg.servers.filter(s => s.enabled && s.tools.some(t => t.enabled))
  const keys = assignMcpServerKeys(candidates)
  const turnId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  const clients: MCPClient[] = []
  const toolsets: MCPClientToolsets<MCPServerMap> = {}
  const toolNames: string[] = []
  const summary: McpTurnToolsets['summary'] = []
  const failures: McpTurnToolsets['failures'] = []

  const results = await Promise.all(candidates.map(s => connectServer(s, keys.get(s.id)!, turnId, protocolChoiceEnabled)))
  results.forEach((r, i) => {
    const server = candidates[i]
    const key = keys.get(server.id)!
    clients.push(r.client)
    if ('error' in r) {
      failures.push({ server: server.name, error: r.error })
    } else if (Object.keys(r.toolset).length) {
      toolsets[key] = r.toolset
      toolNames.push(...Object.keys(r.toolset))
      summary.push({ server: server.name, key, tools: Object.keys(r.toolset).length })
    }
  })

  let closed = false
  return {
    toolsets,
    toolNames,
    summary,
    failures,
    close: async () => {
      if (closed) return
      closed = true
      await Promise.allSettled(clients.map(c => c.disconnect()))
    },
  }
}
