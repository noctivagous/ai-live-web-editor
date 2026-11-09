import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The MCP server registry — the data behind the header's MCP
 * manager. Editor-global (like provider connections, not like a
 * project's feature graph): the same servers are available in
 * every project. Persisted as JSON at .ai-live/mcp.json next to
 * the other editor state; AI_LIVE_MCP_PATH overrides the path
 * (tests use it).
 *
 * This module is the store only: connection testing lives in
 * mcpProbe.ts, HTTP in mcpApi.ts, and the agent-side client that
 * will one day expose these tools to chat turns is a later slice
 * of the MCP build — it will read this same store, so the
 * manager and the agent can never diverge.
 */

export type McpTransport = 'stdio' | 'http' | 'sse'
export type McpServerStatus = 'untested' | 'ok' | 'error' | 'needs-auth'

/** A server's own declarations about a tool, from its MCP
 * annotations (readOnlyHint / destructiveHint) at test time. */
export interface McpToolAnnotations {
  readOnly?: boolean
  destructive?: boolean
}

export interface McpToolState {
  name: string
  description: string
  enabled: boolean
  annotations?: McpToolAnnotations
  /** Probe fingerprint of the tool's input schema. */
  schemaHash?: string
  /** Held from chat until the user reviews it in the manager:
   * set when a tool arrives marked destructive, or when its
   * description, schema or annotations change under a name
   * the user already approved. Approval keyed to a name is
   * not approval of changed contents. */
  needsReview?: boolean
}

/** What a re-test found different from the stored snapshot.
 * Kept on the server until the user marks it reviewed. */
export interface McpToolChanges {
  at: string
  added: string[]
  removed: string[]
  changed: { name: string, what: string }[]
}

/** Which protocol revision a server should speak, when the
 * Settings gate (settings.protocolChoiceEnabled) reveals the
 * per-server choice. Absent = 'legacy', the classic initialize
 * handshake every current server speaks. 'auto' lets the
 * client probe for the newest revision (slow against legacy
 * servers); '2026' requires the 2026-07-28 revision. */
export type McpProtocolChoice = 'legacy' | 'auto' | '2026'

/** Where a server came from, when it was installed rather
 * than typed in by hand: the connector catalog entry it was
 * materialised from, and that entry's version at install
 * time. Provenance is bookkeeping, never a trust claim. */
export interface McpServerOrigin {
  catalogId: string
  version: string
}

export interface McpServer {
  id: string
  name: string
  origin?: McpServerOrigin
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  /** Only stored when it isn't 'legacy' (the default). */
  protocolVersion?: McpProtocolChoice
  /** This remote server signs in with OAuth (set when a test
   * finds it needs sign-in, or when a sign-in starts). Once
   * set, probes and chat turns attach the OAuth provider. */
  oauth?: boolean
  /** Pre-registered OAuth client id for this server, when the
   * authorization server issued one. Not a secret. */
  oauthClientId?: string
  /** Client ID Metadata Document URL (SEP-991) — used as the
   * client identity instead of a pre-registered id. */
  oauthClientMetadataUrl?: string
  enabled: boolean
  /** Tools from the last successful test; toggles persist here. */
  tools: McpToolState[]
  /** The diff the last re-test found, until it is reviewed. */
  toolChanges?: McpToolChanges
  status: McpServerStatus
  lastTestAt?: string
  lastLatencyMs?: number
  lastError?: string
  serverName?: string
  serverVersion?: string
}

/** Editor-global MCP switches — the citizens of Settings →
 * MCP. They live in the MCP config (not the device prefs)
 * because everything that reads them (probe, chat client)
 * already loads this file. */
export interface McpSettings {
  /** Master switch: chat turns may connect to MCP servers
   * and use their tools. The manager works either way. */
  chatToolsEnabled: boolean
  /** Gate for the per-server protocol choice: while off, the
   * choice doesn't exist anywhere and every connection uses
   * the legacy handshake. */
  protocolChoiceEnabled: boolean
}

export const DEFAULT_MCP_SETTINGS: McpSettings = { chatToolsEnabled: true, protocolChoiceEnabled: false }

export interface McpConfig {
  version: 1
  /** Recommended maximum enabled tools across all servers. */
  budget: number
  settings: McpSettings
  servers: McpServer[]
}

export interface McpServerInput {
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  protocolVersion?: McpProtocolChoice
  oauthClientId?: string
  oauthClientMetadataUrl?: string
  enabled?: boolean
  origin?: McpServerOrigin
}

export const DEFAULT_MCP_BUDGET = 40
export const SECRET_MASK = '••••••••'

export function mcpConfigPath(): string {
  if (process.env.AI_LIVE_MCP_PATH) return process.env.AI_LIVE_MCP_PATH
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  return path.join(root, '.ai-live', 'mcp.json')
}

export function emptyMcpConfig(): McpConfig {
  return { version: 1, budget: DEFAULT_MCP_BUDGET, settings: { ...DEFAULT_MCP_SETTINGS }, servers: [] }
}

function cleanProtocolChoice(v: unknown): McpProtocolChoice | undefined {
  return v === 'auto' || v === '2026' ? v : undefined
}

function cleanSettings(raw: unknown): McpSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    chatToolsEnabled: r.chatToolsEnabled !== false,
    protocolChoiceEnabled: r.protocolChoiceEnabled === true,
  }
}

/** Apply a Settings → MCP patch (only the two known switches). */
export function updateMcpSettings(cfg: McpConfig, patch: Partial<McpSettings>): void {
  if (typeof patch.chatToolsEnabled === 'boolean') cfg.settings.chatToolsEnabled = patch.chatToolsEnabled
  if (typeof patch.protocolChoiceEnabled === 'boolean') cfg.settings.protocolChoiceEnabled = patch.protocolChoiceEnabled
}

function parseTransport(v: unknown): McpTransport {
  return v === 'sse' ? 'sse' : v === 'http' ? 'http' : 'stdio'
}

function cleanRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
  }
  return Object.keys(out).length ? out : undefined
}

function cleanServer(raw: unknown): McpServer | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name) return null
  const tools: McpToolState[] = Array.isArray(r.tools)
    ? r.tools.flatMap(t => {
        if (!t || typeof t !== 'object') return []
        const tt = t as Record<string, unknown>
        if (typeof tt.name !== 'string') return []
        const ann = ((): McpToolAnnotations | undefined => {
          if (!tt.annotations || typeof tt.annotations !== 'object') return undefined
          const a = tt.annotations as Record<string, unknown>
          const out: McpToolAnnotations = {
            ...(typeof a.readOnly === 'boolean' ? { readOnly: a.readOnly } : {}),
            ...(typeof a.destructive === 'boolean' ? { destructive: a.destructive } : {}),
          }
          return Object.keys(out).length ? out : undefined
        })()
        return [{
          name: tt.name,
          description: typeof tt.description === 'string' ? tt.description : '',
          enabled: tt.enabled !== false,
          ...(ann ? { annotations: ann } : {}),
          ...(typeof tt.schemaHash === 'string' && tt.schemaHash ? { schemaHash: tt.schemaHash } : {}),
          ...(tt.needsReview === true ? { needsReview: true } : {}),
        }]
      })
    : []
  const toolChanges = ((): McpToolChanges | undefined => {
    if (!r.toolChanges || typeof r.toolChanges !== 'object') return undefined
    const c = r.toolChanges as Record<string, unknown>
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') as string[] : [])
    const changed = Array.isArray(c.changed)
      ? c.changed.flatMap(x => {
          if (!x || typeof x !== 'object') return []
          const cc = x as Record<string, unknown>
          return typeof cc.name === 'string' && typeof cc.what === 'string' ? [{ name: cc.name, what: cc.what }] : []
        })
      : []
    const added = strs(c.added)
    const removed = strs(c.removed)
    if (!added.length && !removed.length && !changed.length) return undefined
    return { at: typeof c.at === 'string' ? c.at : '', added, removed, changed }
  })()
  const origin = ((): McpServerOrigin | undefined => {
    if (!r.origin || typeof r.origin !== 'object') return undefined
    const o = r.origin as Record<string, unknown>
    return typeof o.catalogId === 'string' && o.catalogId && typeof o.version === 'string' && o.version
      ? { catalogId: o.catalogId, version: o.version }
      : undefined
  })()
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newMcpServerId(),
    name,
    ...(origin ? { origin } : {}),
    transport: parseTransport(r.transport),
    ...(typeof r.command === 'string' && r.command ? { command: r.command } : {}),
    ...(Array.isArray(r.args) ? { args: r.args.filter(a => typeof a === 'string') as string[] } : {}),
    ...(cleanRecord(r.env) ? { env: cleanRecord(r.env) } : {}),
    ...(typeof r.url === 'string' && r.url ? { url: r.url } : {}),
    ...(cleanRecord(r.headers) ? { headers: cleanRecord(r.headers) } : {}),
    ...(cleanProtocolChoice(r.protocolVersion) ? { protocolVersion: cleanProtocolChoice(r.protocolVersion) } : {}),
    ...(r.oauth === true ? { oauth: true } : {}),
    ...(typeof r.oauthClientId === 'string' && r.oauthClientId ? { oauthClientId: r.oauthClientId } : {}),
    ...(typeof r.oauthClientMetadataUrl === 'string' && r.oauthClientMetadataUrl ? { oauthClientMetadataUrl: r.oauthClientMetadataUrl } : {}),
    enabled: r.enabled !== false,
    tools,
    ...(toolChanges ? { toolChanges } : {}),
    status: r.status === 'ok' || r.status === 'error' || r.status === 'needs-auth' ? r.status : 'untested',
    ...(typeof r.lastTestAt === 'string' ? { lastTestAt: r.lastTestAt } : {}),
    ...(typeof r.lastLatencyMs === 'number' ? { lastLatencyMs: r.lastLatencyMs } : {}),
    ...(typeof r.lastError === 'string' ? { lastError: r.lastError } : {}),
    ...(typeof r.serverName === 'string' ? { serverName: r.serverName } : {}),
    ...(typeof r.serverVersion === 'string' ? { serverVersion: r.serverVersion } : {}),
  }
}

export function loadMcpConfig(): McpConfig {
  try {
    const raw = fs.readFileSync(mcpConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const servers = Array.isArray(parsed.servers)
      ? parsed.servers.flatMap(s => { const c = cleanServer(s); return c ? [c] : [] })
      : []
    const budget = typeof parsed.budget === 'number' && parsed.budget > 0 ? Math.floor(parsed.budget) : DEFAULT_MCP_BUDGET
    return { version: 1, budget, settings: cleanSettings(parsed.settings), servers }
  } catch {
    return emptyMcpConfig()
  }
}

export function saveMcpConfig(cfg: McpConfig): void {
  const file = mcpConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

export function newMcpServerId(): string {
  return `srv-${crypto.randomBytes(4).toString('hex')}`
}

export function getMcpServer(cfg: McpConfig, id: string): McpServer | undefined {
  return cfg.servers.find(s => s.id === id)
}

/** Enabled tools = what chat is actually offered: tools
 * switched on inside servers switched on, minus any held for
 * review (a held tool keeps its toggle but does not run). */
export function countMcpTools(cfg: McpConfig): { enabled: number, total: number } {
  let enabled = 0
  let total = 0
  for (const s of cfg.servers) {
    total += s.tools.length
    if (s.enabled) enabled += s.tools.filter(t => t.enabled && !t.needsReview).length
  }
  return { enabled, total }
}

export function mcpOverBudget(cfg: McpConfig): boolean {
  return countMcpTools(cfg).enabled > cfg.budget
}

/** Servers with at least one enabled tool, most first — the
 * "Review largest" order and the trim order share it. */
export function serversByEnabledTools(cfg: McpConfig): McpServer[] {
  return cfg.servers
    .filter(s => s.enabled)
    .map(s => ({ s, n: s.tools.filter(t => t.enabled && !t.needsReview).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map(x => x.s)
}

/**
 * Trim to budget: turn tools off, largest servers first, taking
 * from the END of each server's tool list (servers list their
 * core tools first; the tail is the long tail). Mutates cfg;
 * returns what was turned off, per server, in the order taken.
 */
export function trimMcpToBudget(cfg: McpConfig): { serverId: string, serverName: string, tools: string[] }[] {
  let excess = countMcpTools(cfg).enabled - cfg.budget
  const taken: { serverId: string, serverName: string, tools: string[] }[] = []
  if (excess <= 0) return taken
  for (const server of serversByEnabledTools(cfg)) {
    if (excess <= 0) break
    const off: string[] = []
    for (let i = server.tools.length - 1; i >= 0 && excess > 0; i--) {
      const tool = server.tools[i]
      // Only offered tools count against the budget, so only
      // they are trim candidates — a held tool is already out.
      if (tool.enabled && !tool.needsReview) {
        tool.enabled = false
        off.push(tool.name)
        excess--
      }
    }
    if (off.length) taken.push({ serverId: server.id, serverName: server.name, tools: off })
  }
  return taken
}

/** A copy with env/header VALUES masked — what the state
 * endpoint serves. Reveal is a separate, explicit call. */
export function maskMcpConfig(cfg: McpConfig): McpConfig {
  const maskRec = (rec?: Record<string, string>) =>
    rec ? Object.fromEntries(Object.entries(rec).map(([k]) => [k, SECRET_MASK])) : undefined
  return {
    ...cfg,
    servers: cfg.servers.map(s => ({
      ...s,
      ...(s.env ? { env: maskRec(s.env) } : {}),
      ...(s.headers ? { headers: maskRec(s.headers) } : {}),
    })),
  }
}

export function addMcpServer(cfg: McpConfig, input: McpServerInput): McpServer {
  const server = cleanServer({ ...input, id: newMcpServerId(), tools: [], status: 'untested' })
  if (!server) throw new Error('name required')
  cfg.servers.push(server)
  return server
}

/** Merge a patch into a server. Env/headers replace wholesale
 * when present in the patch. Changing how a server is reached
 * (command/args/env/url/headers/protocol) resets it to
 * untested — the old test no longer describes it — but keeps
 * the tool toggles. */
export function updateMcpServer(cfg: McpConfig, id: string, patch: Partial<McpServerInput>): McpServer | null {
  const server = getMcpServer(cfg, id)
  if (!server) return null
  const reachBefore = JSON.stringify([server.command, server.args, server.env, server.url, server.headers, server.protocolVersion, server.oauthClientId, server.oauthClientMetadataUrl])
  if (typeof patch.name === 'string' && patch.name.trim()) server.name = patch.name.trim()
  if (patch.transport) server.transport = patch.transport
  if ('command' in patch) server.command = patch.command || undefined
  if ('args' in patch) server.args = patch.args
  // A masked value in a patch means "unchanged" — the manager
  // masks secrets in its state reads, and an edit round-trip
  // must never overwrite a real secret with the mask.
  const unmask = (next: Record<string, string> | undefined, prev: Record<string, string> | undefined) => {
    if (!next) return next
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(next)) {
      if (v === SECRET_MASK) { if (prev?.[k] !== undefined) out[k] = prev[k] }
      else out[k] = v
    }
    return Object.keys(out).length ? out : undefined
  }
  if ('env' in patch) server.env = unmask(patch.env, server.env)
  if ('url' in patch) server.url = patch.url || undefined
  if ('headers' in patch) server.headers = unmask(patch.headers, server.headers)
  if ('protocolVersion' in patch) server.protocolVersion = cleanProtocolChoice(patch.protocolVersion)
  if ('oauthClientId' in patch) server.oauthClientId = patch.oauthClientId || undefined
  if ('oauthClientMetadataUrl' in patch) server.oauthClientMetadataUrl = patch.oauthClientMetadataUrl || undefined
  if (typeof patch.enabled === 'boolean') server.enabled = patch.enabled
  const reachAfter = JSON.stringify([server.command, server.args, server.env, server.url, server.headers, server.protocolVersion, server.oauthClientId, server.oauthClientMetadataUrl])
  if (reachBefore !== reachAfter) {
    server.status = 'untested'
    delete server.lastError
    delete server.lastLatencyMs
  }
  return server
}

export function removeMcpServer(cfg: McpConfig, id: string): boolean {
  const before = cfg.servers.length
  cfg.servers = cfg.servers.filter(s => s.id !== id)
  return cfg.servers.length !== before
}

/** Fold a probe result into a server: status + test metadata,
 * and the tool list — toggles survive by tool name, tools the
 * server no longer offers drop out, new tools arrive ON (the
 * budget alert exists to surface exactly that consequence).
 *
 * The snapshot diff: a successful re-test is compared against
 * the stored list before it replaces it. Added, removed and
 * changed tools are recorded on the server (toolChanges) until
 * reviewed. A tool whose description, schema or annotations
 * changed under an approved name is held from chat
 * (needsReview), as is a tool that arrives marked destructive
 * — approval keyed to a name is not approval of whatever the
 * name points at today. The first successful test is the
 * baseline: it records no diff, but the destructive hold
 * applies from day one. */
export function applyMcpTestResult(
  server: McpServer,
  result: {
    ok: boolean, latencyMs: number, error?: string, serverName?: string, serverVersion?: string,
    needsAuth?: boolean,
    tools?: { name: string, description: string, annotations?: McpToolAnnotations, schemaHash?: string }[],
  },
): void {
  server.lastTestAt = new Date().toISOString()
  server.lastLatencyMs = result.latencyMs
  if (result.needsAuth) {
    // Not an error: the server answered and asked for sign-in.
    // The tool list from any earlier success stays as it was,
    // and from here on the server is wired for OAuth.
    server.status = 'needs-auth'
    server.oauth = true
    delete server.lastError
    return
  }
  if (!result.ok) {
    server.status = 'error'
    server.lastError = result.error ?? 'Test failed'
    return
  }
  server.status = 'ok'
  delete server.lastError
  if (result.serverName) server.serverName = result.serverName
  if (result.serverVersion) server.serverVersion = result.serverVersion
  const prev = new Map(server.tools.map(t => [t.name, t]))
  const firstTest = server.tools.length === 0
  const added: string[] = []
  const changed: { name: string, what: string }[] = []
  const next: McpToolState[] = []
  for (const t of result.tools ?? []) {
    const ann = t.annotations
    const old = prev.get(t.name)
    if (!old) {
      added.push(t.name)
      next.push({
        name: t.name,
        description: t.description ?? '',
        enabled: true,
        ...(ann ? { annotations: ann } : {}),
        ...(t.schemaHash ? { schemaHash: t.schemaHash } : {}),
        ...(ann?.destructive ? { needsReview: true } : {}),
      })
      continue
    }
    const whats: string[] = []
    if (old.description !== (t.description ?? '')) whats.push('description changed')
    if (old.schemaHash && t.schemaHash && old.schemaHash !== t.schemaHash) whats.push('schema changed')
    if (old.annotations?.destructive !== true && ann?.destructive === true) whats.push('now marked destructive')
    if (whats.length) changed.push({ name: t.name, what: whats.join(', ') })
    next.push({
      name: t.name,
      description: t.description ?? '',
      enabled: old.enabled,
      ...(ann ? { annotations: ann } : {}),
      ...(t.schemaHash ? { schemaHash: t.schemaHash } : {}),
      ...((old.needsReview || whats.length) ? { needsReview: true } : {}),
    })
  }
  const nextNames = new Set(next.map(t => t.name))
  const removed = [...prev.keys()].filter(n => !nextNames.has(n))
  server.tools = next
  if (!firstTest && (added.length || removed.length || changed.length)) {
    server.toolChanges = { at: server.lastTestAt, added, removed, changed }
  } else {
    delete server.toolChanges
  }
}

/** The user has seen the diff: release every held tool and
 * clear the pending changes. Returns false for no such server. */
export function markMcpToolsReviewed(cfg: McpConfig, id: string): boolean {
  const server = getMcpServer(cfg, id)
  if (!server) return false
  for (const t of server.tools) delete t.needsReview
  delete server.toolChanges
  return true
}

/**
 * Parse the standard mcpServers JSON shape (the one Claude
 * Desktop / VS Code / Cursor share) into server inputs. Accepts
 * the full { "mcpServers": {…} } object, a bare name→config map,
 * or a single server config. Bad entries are reported, not
 * silently dropped.
 */
export function parseMcpServersJson(text: string): { inputs: McpServerInput[], errors: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { inputs: [], errors: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { inputs: [], errors: ['Expected a JSON object with an "mcpServers" map'] }
  }
  const root = parsed as Record<string, unknown>
  const map = (root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers))
    ? root.mcpServers as Record<string, unknown>
    : ('command' in root || 'url' in root)
      ? { server: root }
      : root
  const inputs: McpServerInput[] = []
  const errors: string[] = []
  for (const [name, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`"${name}": not a server object`)
      continue
    }
    const r = raw as Record<string, unknown>
    const env = cleanRecord(r.env)
    const headers = cleanRecord(r.headers)
    if (typeof r.command === 'string' && r.command) {
      inputs.push({
        name,
        transport: 'stdio',
        command: r.command,
        ...(Array.isArray(r.args) ? { args: r.args.filter(a => typeof a === 'string') as string[] } : {}),
        ...(env ? { env } : {}),
        enabled: r.disabled !== true,
      })
    } else if (typeof r.url === 'string' && r.url) {
      const t = typeof r.type === 'string' ? r.type : ''
      inputs.push({
        name,
        transport: t === 'sse' ? 'sse' : 'http',
        url: r.url,
        ...(headers ? { headers } : {}),
        enabled: r.disabled !== true,
      })
    } else {
      errors.push(`"${name}": needs a "command" (stdio) or a "url"`)
    }
  }
  if (!inputs.length && !errors.length) errors.push('No servers found in that JSON')
  return { inputs, errors }
}

/** One server back out in the standard shape (for copy-as-JSON). */
export function mcpServerToJson(server: McpServer): Record<string, unknown> {
  if (server.transport === 'stdio') {
    return {
      command: server.command ?? '',
      ...(server.args?.length ? { args: server.args } : {}),
      ...(server.env ? { env: server.env } : {}),
      ...(server.enabled ? {} : { disabled: true }),
    }
  }
  return {
    type: server.transport === 'sse' ? 'sse' : 'streamable-http',
    url: server.url ?? '',
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.enabled ? {} : { disabled: true }),
  }
}
