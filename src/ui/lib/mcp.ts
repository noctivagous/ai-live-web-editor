/**
 * Client side of the MCP manager: types mirroring src/mcp's
 * store, the fetch wrappers for /api/mcp, and the Add-form
 * presets. The store is the server's; this file keeps none.
 */

export type McpTransport = 'stdio' | 'http' | 'sse'
export type McpServerStatus = 'untested' | 'ok' | 'error' | 'needs-auth'
export type McpProtocolChoice = 'legacy' | 'auto' | '2026'

export interface McpToolAnnotations { readOnly?: boolean, destructive?: boolean }

export interface McpToolState {
  name: string
  description: string
  enabled: boolean
  annotations?: McpToolAnnotations
  schemaHash?: string
  /** Held from chat until reviewed in the manager. */
  needsReview?: boolean
}

export interface McpToolChanges {
  at: string
  added: string[]
  removed: string[]
  changed: { name: string, what: string }[]
}

export interface McpServerOrigin { catalogId: string, version: string }

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
  protocolVersion?: McpProtocolChoice
  oauth?: boolean
  oauthClientId?: string
  oauthClientMetadataUrl?: string
  /** Set by the API when OAuth tokens exist for this server. */
  oauthSignedIn?: boolean
  enabled: boolean
  tools: McpToolState[]
  toolChanges?: McpToolChanges
  status: McpServerStatus
  lastTestAt?: string
  lastLatencyMs?: number
  lastError?: string
  serverName?: string
  serverVersion?: string
}

export interface McpSettings { chatToolsEnabled: boolean, protocolChoiceEnabled: boolean }

export interface McpConfig { version: 1, budget: number, settings: McpSettings, servers: McpServer[] }

export interface McpState { config: McpConfig, counts: { enabled: number, total: number } }

export interface McpProbeResult {
  ok: boolean
  latencyMs: number
  error?: string
  serverName?: string
  serverVersion?: string
  needsAuth?: boolean
  tools?: { name: string, description: string }[]
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
}

export const signInMcpServer = (id: string) =>
  postJson<StateReply & { authUrl: string }>('/api/mcp/servers/sign-in', { id })
export const signOutMcpServer = (id: string) =>
  postJson<StateReply>('/api/mcp/servers/sign-out', { id })

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  const data = await r.json() as T & { error?: string }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`)
  return data
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json() as T & { error?: string }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`)
  return data
}

type StateReply = { ok: boolean } & McpState

export const fetchMcpState = () => getJson<StateReply>('/api/mcp/state')
export const revealMcpServer = (id: string) =>
  postJson<{ ok: boolean, server: McpServer, json: unknown }>('/api/mcp/reveal', { id })
export const addMcpServer = (input: McpServerInput) =>
  postJson<StateReply & { serverId: string }>('/api/mcp/servers', input)
export const updateMcpServer = (id: string, patch: McpServerInput) =>
  postJson<StateReply>('/api/mcp/servers/update', { id, ...patch })
export const removeMcpServer = (id: string) =>
  postJson<StateReply>('/api/mcp/servers/remove', { id })
export const toggleMcpServer = (id: string, enabled: boolean) =>
  postJson<StateReply>('/api/mcp/servers/toggle', { id, enabled })
export const toggleMcpTool = (serverId: string, name: string, enabled: boolean) =>
  postJson<StateReply>('/api/mcp/tools/toggle', { serverId, name, enabled })
export const toggleAllMcpTools = (serverId: string, enabled: boolean) =>
  postJson<StateReply>('/api/mcp/tools/toggle-all', { serverId, enabled })
export const setMcpBudget = (budget: number) =>
  postJson<StateReply>('/api/mcp/budget', { budget })
export const trimMcpBudget = () =>
  postJson<StateReply & { disabled: { serverId: string, serverName: string, tools: string[] }[] }>('/api/mcp/trim', {})
export const testMcpServer = (id: string) =>
  postJson<StateReply & { result: McpProbeResult }>('/api/mcp/test', { id })
export const testMcpConfig = (input: McpServerInput) =>
  postJson<{ ok: boolean, result: McpProbeResult }>('/api/mcp/test-config', input)
export const importMcpJson = (text: string) =>
  postJson<StateReply & { added: string[], errors: string[] }>('/api/mcp/import', { text })
export const updateMcpSettings = (patch: Partial<McpSettings>) =>
  postJson<StateReply>('/api/mcp/settings', patch)

/** Connector catalog (mirrors src/mcp/connectorCatalog.ts). */
export interface ConnectorInput {
  name: string
  description: string
  isRequired: boolean
  isSecret: boolean
  target: 'env' | 'header'
  valueTemplate?: string
  default?: string
}

export interface ConnectorEntry {
  id: string
  title: string
  description: string
  version: string
  publisher: { name: string, url?: string }
  docsUrl?: string
  server: { name: string, transport: McpTransport, command?: string, args?: string[], url?: string }
  inputs: ConnectorInput[]
}

export interface ConnectorCatalog {
  entries: ConnectorEntry[]
  /** catalogId -> installed server id. */
  installed: Record<string, string>
}

export const fetchConnectorCatalog = () =>
  getJson<{ ok: boolean } & ConnectorCatalog>('/api/mcp/catalog')
export const installConnector = (catalogId: string, values: Record<string, string>) =>
  postJson<StateReply & { serverId: string, alreadyInstalled?: boolean }>('/api/mcp/connectors/install', { catalogId, values })

/** Offered tools for one server: on and not held for review (0 when the server is off). */
export function serverEnabledTools(s: McpServer): number {
  return s.enabled ? s.tools.filter(t => t.enabled && !t.needsReview).length : 0
}

export const markMcpToolsReviewed = (id: string) =>
  postJson<StateReply>('/api/mcp/tools/reviewed', { id })

/** True when a server has tool changes awaiting review. */
export function serverNeedsReview(s: McpServer): boolean {
  return !!s.toolChanges || s.tools.some(t => t.needsReview)
}

/** The one-line "how it's reached" summary for list rows. */
export function serverReach(s: McpServer): string {
  if (s.transport === 'stdio') return [s.command, ...(s.args ?? [])].filter(Boolean).join(' ')
  return s.url ?? ''
}

/* ── Add-form presets ───────────────────────────────────────
 * One-click fills for the servers people add most. Env values
 * are left empty on purpose: the form asks, the test answers. */

export interface McpPreset {
  id: string
  label: string
  input: McpServerInput
  hint?: string
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem',
    label: 'Filesystem',
    input: { name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
    hint: 'The last argument is the folder it may touch — point it at your project.',
  },
  {
    id: 'github',
    label: 'GitHub',
    input: { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } },
    hint: 'Needs a personal access token in the env field.',
  },
  {
    id: 'chrome-devtools',
    label: 'Chrome DevTools',
    input: { name: 'chrome-devtools', transport: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
    hint: 'Drives a real Chrome for page diagnosis.',
  },
  {
    id: 'postgres',
    label: 'Postgres',
    input: { name: 'postgres', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'] },
    hint: 'The last argument is the connection string.',
  },
  {
    id: 'brave-search',
    label: 'Brave Search',
    input: { name: 'brave-search', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '' } },
    hint: 'Needs a Brave Search API key in the env field.',
  },
  {
    id: 'fetch',
    label: 'Fetch',
    input: { name: 'fetch', transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
  },
  {
    id: 'memory',
    label: 'Memory',
    input: { name: 'memory', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    input: { name: 'sqlite', transport: 'stdio', command: 'uvx', args: ['mcp-server-sqlite', '--db-path', './data.db'] },
    hint: 'The --db-path argument is the database file.',
  },
]

/** Parse "KEY=value" lines (the env/headers textareas). */
export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

export function keyValuesToText(rec?: Record<string, string>): string {
  if (!rec) return ''
  return Object.entries(rec).map(([k, v]) => `${k}=${v}`).join('\n')
}

/** Split an args line on spaces, honoring "quoted spans". */
export function splitArgs(text: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}
