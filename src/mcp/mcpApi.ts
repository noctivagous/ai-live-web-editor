import type { Express } from 'express'
import {
  addMcpServer, applyMcpTestResult, countMcpTools, getMcpServer, loadMcpConfig,
  markMcpToolsReviewed, maskMcpConfig, mcpServerToJson, parseMcpServersJson, removeMcpServer,
  saveMcpConfig, trimMcpToBudget, updateMcpServer, updateMcpSettings,
  type McpConfig, type McpServerInput,
} from './mcpStore.js'
import { probeMcpServer } from './mcpProbe.js'
import { buildConnectorInstall, CONNECTOR_CATALOG, findConnector } from './connectorCatalog.js'
import { cancelMcpSignIn, onMcpSignInSettled, startMcpSignIn } from './mcpAuth.js'
import { clearOAuthData, hasOAuthTokens } from './mcpOAuth.js'

/**
 * MCP manager HTTP API, mounted on both servers (the featureApi
 * pattern). Reads serve the config with secret VALUES masked;
 * one explicit reveal call returns a single server whole (the
 * detail pane's Reveal button and copy-as-JSON use it). Writes
 * go through mcpStore, the same store the future agent-side MCP
 * client will read.
 */
export function mountMcpApi(app: Express) {
  const state = (cfg: McpConfig) => {
    const config = maskMcpConfig(cfg)
    // Signed-in is derived from the OAuth store (existence
    // only — token values never enter a response).
    for (const s of config.servers) {
      if (s.transport !== 'stdio' && hasOAuthTokens(s.id)) (s as { oauthSignedIn?: boolean }).oauthSignedIn = true
    }
    return { ok: true as const, config, counts: countMcpTools(cfg) }
  }

  // When a sign-in completes, test the server right away so
  // its stored state (tools, status) reflects the new tokens;
  // the manager picks it up on its next state read or poll.
  onMcpSignInSettled((serverId, ok) => {
    if (!ok) return
    void (async () => {
      const cfg = loadMcpConfig()
      const server = getMcpServer(cfg, serverId)
      if (!server) return
      const result = await probeMcpServer(server, 15_000, { protocolChoiceEnabled: cfg.settings?.protocolChoiceEnabled === true })
      const fresh = loadMcpConfig()
      const target = getMcpServer(fresh, serverId)
      if (!target) return
      applyMcpTestResult(target, result)
      saveMcpConfig(fresh)
    })().catch(() => { /* the next manual test will tell the story */ })
  })

  app.get('/api/mcp/state', (_req, res) => {
    res.json(state(loadMcpConfig()))
  })

  /** The bundled connector catalog, with which entries are
   * already installed (matched by provenance). */
  app.get('/api/mcp/catalog', (_req, res) => {
    const cfg = loadMcpConfig()
    const installed: Record<string, string> = {}
    for (const s of cfg.servers) if (s.origin) installed[s.origin.catalogId] = s.id
    res.json({ ok: true, entries: CONNECTOR_CATALOG, installed })
  })

  /** Install a catalog entry: prompt values in, a plain server
   * in the store out. Installing twice is a no-op that returns
   * the existing server — provenance is the dedupe key. */
  app.post('/api/mcp/connectors/install', (req, res) => {
    const entry = findConnector(typeof req.body?.catalogId === 'string' ? req.body.catalogId : '')
    if (!entry) return res.status(404).json({ ok: false, error: 'No such connector in the catalog' })
    const cfg = loadMcpConfig()
    const existing = cfg.servers.find(s => s.origin?.catalogId === entry.id)
    if (existing) return res.json({ ...state(cfg), serverId: existing.id, alreadyInstalled: true })
    const values = (req.body?.values && typeof req.body.values === 'object' ? req.body.values : {}) as Record<string, string>
    const built = buildConnectorInstall(entry, values)
    if (built.ok === false) return res.status(400).json({ ok: false, error: built.error })
    const server = addMcpServer(cfg, built.input)
    saveMcpConfig(cfg)
    res.json({ ...state(cfg), serverId: server.id })
  })

  app.post('/api/mcp/reveal', (req, res) => {
    const cfg = loadMcpConfig()
    const server = getMcpServer(cfg, typeof req.body?.id === 'string' ? req.body.id : '')
    if (!server) return res.status(404).json({ ok: false, error: 'No such server' })
    res.json({ ok: true, server, json: { mcpServers: { [server.name]: mcpServerToJson(server) } } })
  })

  app.post('/api/mcp/servers', (req, res) => {
    const input = readServerInput(req.body)
    if (!input) return res.status(400).json({ ok: false, error: 'A server needs a name and a command (stdio) or URL' })
    const cfg = loadMcpConfig()
    const server = addMcpServer(cfg, input)
    saveMcpConfig(cfg)
    res.json({ ...state(cfg), serverId: server.id })
  })

  app.post('/api/mcp/servers/update', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const cfg = loadMcpConfig()
    const before = getMcpServer(cfg, id)
    const identityBefore = JSON.stringify([before?.oauthClientId, before?.oauthClientMetadataUrl])
    const patch = readServerPatch(req.body)
    const server = updateMcpServer(cfg, id, patch)
    if (!server) return res.status(404).json({ ok: false, error: 'No such server' })
    // Tokens belong to the client identity that minted them;
    // a new identity starts signed out.
    if (JSON.stringify([server.oauthClientId, server.oauthClientMetadataUrl]) !== identityBefore) {
      clearOAuthData(id)
    }
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  /** Begin the browser sign-in flow for a remote server. The
   * flow runs in the background (5-minute window); when it
   * settles, the server is auto-tested (see the settle hook
   * above). Returns the authorization URL to open. */
  app.post('/api/mcp/servers/sign-in', async (req, res) => {
    const cfg = loadMcpConfig()
    const server = getMcpServer(cfg, typeof req.body?.id === 'string' ? req.body.id : '')
    if (!server) return res.status(404).json({ ok: false, error: 'No such server' })
    if (server.transport === 'stdio') return res.status(400).json({ ok: false, error: 'Only remote servers sign in.' })
    try {
      const { authUrl } = await startMcpSignIn(server)
      server.oauth = true
      saveMcpConfig(cfg)
      res.json({ ...state(cfg), authUrl })
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  /** Forget a server's OAuth tokens and stop any pending
   * sign-in. The server returns to the needs-auth state. */
  app.post('/api/mcp/servers/sign-out', async (req, res) => {
    const cfg = loadMcpConfig()
    const server = getMcpServer(cfg, typeof req.body?.id === 'string' ? req.body.id : '')
    if (!server) return res.status(404).json({ ok: false, error: 'No such server' })
    await cancelMcpSignIn(server.id)
    clearOAuthData(server.id)
    if (server.oauth) {
      server.oauth = false
      server.status = 'needs-auth'
      delete server.lastError
    }
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  app.post('/api/mcp/servers/remove', (req, res) => {
    const cfg = loadMcpConfig()
    if (!removeMcpServer(cfg, typeof req.body?.id === 'string' ? req.body.id : '')) {
      return res.status(404).json({ ok: false, error: 'No such server' })
    }
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  app.post('/api/mcp/servers/toggle', (req, res) => {
    const cfg = loadMcpConfig()
    const server = getMcpServer(cfg, typeof req.body?.id === 'string' ? req.body.id : '')
    if (!server) return res.status(404).json({ ok: false, error: 'No such server' })
    server.enabled = req.body?.enabled === true
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  app.post('/api/mcp/tools/toggle', (req, res) => {
    const cfg = loadMcpConfig()
    const server = getMcpServer(cfg, typeof req.body?.serverId === 'string' ? req.body.serverId : '')
    const tool = server?.tools.find(t => t.name === req.body?.name)
    if (!server || !tool) return res.status(404).json({ ok: false, error: 'No such server or tool' })
    tool.enabled = req.body?.enabled === true
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  app.post('/api/mcp/tools/toggle-all', (req, res) => {
    const cfg = loadMcpConfig()
    const server = getMcpServer(cfg, typeof req.body?.serverId === 'string' ? req.body.serverId : '')
    if (!server) return res.status(404).json({ ok: false, error: 'No such server' })
    for (const t of server.tools) t.enabled = req.body?.enabled === true
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  /** The user reviewed a server's tool changes: release the
   * held tools and clear the pending diff. */
  app.post('/api/mcp/tools/reviewed', (req, res) => {
    const cfg = loadMcpConfig()
    if (!markMcpToolsReviewed(cfg, typeof req.body?.id === 'string' ? req.body.id : '')) {
      return res.status(404).json({ ok: false, error: 'No such server' })
    }
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  app.post('/api/mcp/budget', (req, res) => {
    const budget = typeof req.body?.budget === 'number' ? Math.floor(req.body.budget) : NaN
    if (!Number.isFinite(budget) || budget < 1 || budget > 1000) {
      return res.status(400).json({ ok: false, error: 'Budget must be between 1 and 1000' })
    }
    const cfg = loadMcpConfig()
    cfg.budget = budget
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  app.post('/api/mcp/trim', (_req, res) => {
    const cfg = loadMcpConfig()
    const disabled = trimMcpToBudget(cfg)
    saveMcpConfig(cfg)
    res.json({ ...state(cfg), disabled })
  })

  app.post('/api/mcp/test', async (req, res) => {
    const cfg = loadMcpConfig()
    const server = getMcpServer(cfg, typeof req.body?.id === 'string' ? req.body.id : '')
    if (!server) return res.status(404).json({ ok: false, error: 'No such server' })
    const result = await probeMcpServer(server, 15_000, { protocolChoiceEnabled: cfg.settings.protocolChoiceEnabled })
    // Re-read before writing: a probe can take seconds, and
    // other manager actions (an install, an edit) may have
    // saved meanwhile. Applying the result to the pre-probe
    // snapshot and saving that would silently undo them —
    // every other endpoint mutates synchronously between load
    // and save, so this await is the only wide window.
    const fresh = loadMcpConfig()
    const target = getMcpServer(fresh, server.id)
    if (!target) return res.json({ ...state(fresh), result }) // removed mid-test: keep the removal, still report the probe
    applyMcpTestResult(target, result)
    saveMcpConfig(fresh)
    res.json({ ...state(fresh), result })
  })

  app.post('/api/mcp/test-config', async (req, res) => {
    const input = readServerInput(req.body)
    if (!input) return res.status(400).json({ ok: false, error: 'A server needs a name and a command (stdio) or URL' })
    const cfg = loadMcpConfig()
    const result = await probeMcpServer(input, 15_000, { protocolChoiceEnabled: cfg.settings.protocolChoiceEnabled })
    res.json({ ok: true, result })
  })

  app.post('/api/mcp/settings', (req, res) => {
    const cfg = loadMcpConfig()
    updateMcpSettings(cfg, {
      ...(typeof req.body?.chatToolsEnabled === 'boolean' ? { chatToolsEnabled: req.body.chatToolsEnabled } : {}),
      ...(typeof req.body?.protocolChoiceEnabled === 'boolean' ? { protocolChoiceEnabled: req.body.protocolChoiceEnabled } : {}),
    })
    saveMcpConfig(cfg)
    res.json(state(cfg))
  })

  app.post('/api/mcp/import', (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    const { inputs, errors } = parseMcpServersJson(text)
    const cfg = loadMcpConfig()
    const added: string[] = []
    for (const input of inputs) {
      addMcpServer(cfg, input)
      added.push(input.name)
    }
    saveMcpConfig(cfg)
    res.json({ ...state(cfg), added, errors })
  })
}

function readServerInput(body: unknown): McpServerInput | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return null
  const transport = b.transport === 'sse' ? 'sse' : b.transport === 'http' ? 'http' : 'stdio'
  const command = typeof b.command === 'string' ? b.command.trim() : ''
  const url = typeof b.url === 'string' ? b.url.trim() : ''
  if (transport === 'stdio' && !command) return null
  if (transport !== 'stdio' && !url) return null
  return {
    name,
    transport,
    ...(command ? { command } : {}),
    ...(Array.isArray(b.args) ? { args: b.args.filter(a => typeof a === 'string') as string[] } : {}),
    ...(isStringRecord(b.env) ? { env: b.env } : {}),
    ...(url ? { url } : {}),
    ...(isStringRecord(b.headers) ? { headers: b.headers } : {}),
    ...(b.protocolVersion === 'legacy' || b.protocolVersion === 'auto' || b.protocolVersion === '2026'
      ? { protocolVersion: b.protocolVersion }
      : {}),
    ...(typeof b.oauthClientId === 'string' ? { oauthClientId: b.oauthClientId.trim() } : {}),
    ...(typeof b.oauthClientMetadataUrl === 'string' ? { oauthClientMetadataUrl: b.oauthClientMetadataUrl.trim() } : {}),
    ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
  }
}

function readServerPatch(body: unknown): Partial<McpServerInput> {
  const input = readServerInput(body)
  if (input) return input
  // A toggle-only patch (enabled) or a rename may omit the
  // transport fields; accept the parts that are present.
  if (!body || typeof body !== 'object') return {}
  const b = body as Record<string, unknown>
  const patch: Partial<McpServerInput> = {}
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim()
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
  return patch
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string')
}
