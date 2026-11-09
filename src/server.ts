import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { currentModelId, hasAiKey, liveTarget, loadDotEnv, openaiApiKey, openaiBaseUrl, openaiModelName, playwrightPoolEnabled, publicProvider, saveAiConfig, setPlaywrightPool, uiServing } from './env.js'
import { pipeAgentChatStream } from './chatStream.js'
import { listProviderModels } from './providers.js'
import { createProject, deleteSyncFiles, EDITOR_ROOT, ensureWorkspace, getFsRoot, listProjects, listProjectFiles, readActiveId, selectProject, SELF_PROJECT_ID, validProjectId, writeImportFiles, WORKSPACE_ROOT } from './launcher.js'
import { applyPageTemplate, applySeedApp, convertTextToPage, TEMPLATE_IDS, type PageTemplateId, type TemplateId } from './setupWizard.js'
import { writeProjectConfig } from './projectConfig.js'
import { projectPathOrThrow } from './projectPath.js'
import { contextWindowForModel } from './providerPresets.js'
import { getSelfCheck, isSelfMode, isSelfWorkspace, listSnapshotsAt, revertSelfSnapshot } from './selfMode.js'
import { livePageCount, pageCommand } from './pageBridge.js'
import { markLauncherOwner } from './liveTarget.js'
import { mountPoolPage, openPoolBrowser } from './poolPage.js'
import { mountWorkflowApi } from './workflowApi.js'
import { mountProjectConfigApi } from './projectConfigApi.js'
import { mountAgentSettingsApi } from './agentSettingsApi.js'
import { mountConnectionsApi } from './connectionsApi.js'
import { mountResearchApi } from './research/researchApi.js'
import { mountPlanApi } from './plans/planApi.js'
import { mountFeatureApi } from './features/featureApi.js'
import { mountUserFlowApi } from './userflows/userflowApi.js'
import { mountMcpApi } from './mcp/mcpApi.js'
import { mountSkillsApi } from './skills/skillsApi.js'
import { mountMemoryApi } from './mastra/memoryApi.js'
import { mountCodebaseMapApi } from './codebaseMap/codebaseMapApi.js'
import { mountCatalogApi } from './catalog/catalogApi.js'
import { mountFsApi } from './fsApi.js'
import { mountJsxBundleApi } from './jsxBundleApi.js'
import { mountAppSettingsApi } from './appSettings.js'
import { buildAndPersistMap, createMapRebuilder } from './codebaseMap/mapStore.js'
import { activePublic, syncFromLegacy } from './connections.js'
import { resetSketchForProjectSwitch, sketchWriteGuard } from './sketchSession.js'
import chokidar from 'chokidar'

loadDotEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.LAUNCHER_PORT) || 4112

function publicConfig() {
  const active = activePublic()
  const hasKey = active ? active.hasKey : hasAiKey()
  const provider = publicProvider()
  const modelName = active?.model || openaiModelName()
  return {
    ok: true,
    hasApiKey: hasKey,
    hasOpenAiKey: hasKey,
    model: modelName,
    modelName,
    modelId: `openai/${modelName}`,
    providerId: active?.providerId || provider?.id || null,
    providerName: active?.providerName || provider?.name || null,
    contextWindow: active?.contextWindow ?? contextWindowForModel(modelName),
    baseUrl: active?.baseUrl ?? openaiBaseUrl(),
    launcherUrl: `http://localhost:${PORT}`,
    previewStaticUrl: '/projects/',
    previewHmrUrl: 'http://localhost:5173',
    workspace: WORKSPACE_ROOT,
    activeProject: readActiveId(),
    fsRoot: getFsRoot(),
    playwrightPool: playwrightPoolEnabled(),
    liveTarget: liveTarget(),
  }
}
app.use(cors({ origin: '*' }))
app.use((req,res,next)=>{res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src *; frame-ancestors 'self' http://localhost:5173 http://127.0.0.1:5173"); next()})
app.use(express.json({ limit: '20mb' }))
mountPoolPage(app)
mountWorkflowApi(app)
mountProjectConfigApi(app)
mountAgentSettingsApi(app)
mountConnectionsApi(app)
mountResearchApi(app)
mountPlanApi(app)
mountFeatureApi(app)
mountUserFlowApi(app)
mountMcpApi(app)
mountSkillsApi(app)
mountMemoryApi(app)
mountCodebaseMapApi(app)
mountCatalogApi(app)
mountFsApi(app)
mountJsxBundleApi(app)

ensureWorkspace()
try { buildAndPersistMap() } catch { /* map is generated lazily by the tool too */ }
markLauncherOwner()

// Self mode (phase-11-06 §L): boot straight into the editor-as-
// workspace. The UI serving half is mounted further down, where
// the built bundle is normally served.
if (isSelfMode()) {
  try {
    selectProject(SELF_PROJECT_ID)
    console.log('[self] SELF MODE — workspace is the editor repo; src/ui is served from source (no ui:build)')
    console.log('[self] recovery page: /self-recovery')
  } catch (e) {
    console.error('[self] could not select the self workspace:', e)
  }
}

function safePath(p: string) {
  return projectPathOrThrow(getFsRoot(), p)
}

// --- FS API ---
app.get('/api/fs/health', (req, res) => {
  const root = getFsRoot()
  res.json({ ok: true, root, files: fs.existsSync(root) ? fs.readdirSync(root).slice(0, 20) : [] })
})

app.get('/api/projects', (_req, res) => {
  res.json({
    ok: true,
    workspace: WORKSPACE_ROOT,
    active: readActiveId(),
    projects: listProjects(),
  })
})

app.post('/api/projects/select', (req, res) => {
  try {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    resetSketchForProjectSwitch()
    const project = selectProject(id)
    res.json({ ok: true, active: project.id, root: project.root, setup: project.setup, projects: listProjects() })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.post('/api/projects/create', (req, res) => {
  try {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const project = createProject(id)
    res.json({ ok: true, active: project.id, root: project.root, projects: listProjects(), ...(project.installError ? { installError: project.installError } : {}) })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

/* Folder import (Step 10): client enumerated a user-picked directory via
 * showDirectoryPicker and uploads it in small batches. First batch creates
 * an empty dir (no seed files — unlike /create); the final batch runs
 * npm install when a package.json arrived and selects the project. */
app.post('/api/projects/import', (req, res) => {
  try {
    const body = req.body || {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const files = Array.isArray(body.files) ? body.files : []
    const done = body.done === true
    const first = body.first === true
    const overwrite = body.overwrite === true
    if (!validProjectId(name)) throw new Error('Project name: letters, numbers, dash, underscore')
    const SKIP = new Set(['node_modules', 'dist', '.vite', '.chrome-data'])
    if (SKIP.has(name) || name.startsWith('.')) throw new Error('Reserved name')
    const dest = path.join(WORKSPACE_ROOT, name)
    if (first) {
      if (fs.existsSync(dest)) {
        if (!overwrite) throw new Error(`Project "${name}" already exists`)
        fs.rmSync(dest, { recursive: true, force: true })
      }
      fs.mkdirSync(dest, { recursive: true })
    } else if (!fs.existsSync(dest)) {
      throw new Error(`Unknown import target: ${name}`)
    }
    const { received, writeErrors } = writeImportFiles(dest, files)
    if (!done) return res.json({ ok: true, received, writeErrors })
    let installed = false
    let installError: string | undefined
    if (fs.existsSync(path.join(dest, 'package.json'))) {
      try {
        execSync('npm install', { cwd: dest, stdio: 'inherit' })
        installed = true
      } catch (e: any) {
        installError = e.message || 'npm install failed'
      }
    }
    resetSketchForProjectSwitch()
    const project = selectProject(name)
    res.json({ ok: true, active: project.id, root: project.root, setup: project.setup, projects: listProjects(), received, installed, installError, writeErrors })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

/* Setup wizard (Open slice C): apply a starting template to the
 * ACTIVE project, or turn one of its text files into a page. Page
 * templates and conversions designate their page as the start page;
 * every path re-selects the project afterwards so Vite restarts and
 * the preview session reseeds from the new state. */
app.post('/api/projects/apply-template', (req, res) => {
  try {
    const rawTemplate = typeof req.body?.template === 'string' ? req.body.template : ''
    if (!TEMPLATE_IDS.includes(rawTemplate as TemplateId)) throw new Error('Unknown template')
    const template = rawTemplate as TemplateId
    const root = getFsRoot()
    let installed = false
    let installError: string | undefined
    if (template === 'seed-app') {
      applySeedApp(root)
      try {
        execSync('npm install', { cwd: root, stdio: 'inherit' })
        installed = true
      } catch (e: any) {
        installError = e.message || 'npm install failed'
      }
    } else {
      applyPageTemplate(root, template as PageTemplateId)
      writeProjectConfig({ entry: 'index.html' }, root)
    }
    resetSketchForProjectSwitch()
    const project = selectProject(readActiveId())
    res.json({ ok: true, active: project.id, setup: project.setup, projects: listProjects(), installed, installError })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.post('/api/projects/convert', (req, res) => {
  try {
    const p = typeof req.body?.path === 'string' ? req.body.path : ''
    const root = getFsRoot()
    const { created } = convertTextToPage(root, p)
    writeProjectConfig({ entry: created.replace(/^\//, '') }, root)
    resetSketchForProjectSwitch()
    const project = selectProject(readActiveId())
    res.json({ ok: true, created, active: project.id, setup: project.setup, projects: listProjects() })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

/* Folder sync (Open-folder): stateless diff endpoint. The browser client
 * keeps the baseline; it sends the paths it believes exist (known) and the
 * last sync time (since). The server reports what changed and what is gone —
 * no server-side session state. */
app.post('/api/projects/sync/changes', (req, res) => {
  try {
    const body = req.body || {}
    const since = typeof body.since === 'number' && body.since > 0 ? body.since : 0
    const known = Array.isArray(body.known)
      ? body.known.filter((p: unknown): p is string => typeof p === 'string')
      : []
    const root = getFsRoot()
    const entries = listProjectFiles(root)
    const now = Date.now()
    const MAX = 3000
    const changed = entries.filter(e => e.mtimeMs > since).slice(0, MAX)
    const present = new Set(entries.map(e => e.path))
    const deleted = known.filter(p => !present.has(p)).slice(0, MAX)
    res.json({ ok: true, now, changed, deleted, truncated: entries.length > MAX })
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }) }
})

/* Folder sync (Open-folder): apply the browser's disk diff. Same safePath
 * discipline as the import writer; never runs npm install or reselects the
 * project. Honors the sketch write guard like /api/fs/write. */
app.post('/api/projects/sync', (req, res) => {
  try {
    const blocked = sketchWriteGuard()
    if (blocked) return res.status(409).json({ ok: false, ...blocked })
    const body = req.body || {}
    const files = Array.isArray(body.files) ? body.files : []
    const deletes = Array.isArray(body.deletes) ? body.deletes : []
    const dest = getFsRoot()
    const { received, writeErrors } = writeImportFiles(dest, files)
    const { deleted, deleteErrors } = deleteSyncFiles(dest, deletes)
    res.json({ ok: true, received, writeErrors, deleted, deleteErrors })
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }) }
})

const projectSse = new Set<express.Response>()
function pushProjectList() {
  const payload = `data: ${JSON.stringify({ ok: true, active: readActiveId(), projects: listProjects() })}\n\n`
  for (const res of projectSse) {
    try { res.write(payload) } catch { /* closed */ }
  }
}

app.get('/api/projects/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  projectSse.add(res)
  res.write(`data: ${JSON.stringify({ ok: true, active: readActiveId(), projects: listProjects() })}\n\n`)
  const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* closed */ } }, 15000)
  req.on('close', () => {
    clearInterval(ping)
    projectSse.delete(res)
  })
})

// --- Launcher config (presence flags only: never expose secrets) ---
app.get('/api/config', (req, res) => {
  res.json(publicConfig())
})

mountAppSettingsApi(app)

app.post('/api/config/key', (req, res) => {
  try {
    const body = req.body || {}
    saveAiConfig({
      key: typeof body.key === 'string' ? body.key : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
    })
    syncFromLegacy()
    res.json({ ...publicConfig(), saved: true })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.post('/api/config/pool', async (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled)
    setPlaywrightPool(enabled)
    if (!enabled) {
      const { closePool } = await import('./browserPool.js')
      await closePool()
    } else {
      void openPoolBrowser().catch(async (e) => {
        console.error('[browser]', e)
        const { logServerError } = await import('./serverLog.js')
        logServerError({ kind: 'pool', route: 'POST /api/config/pool', message: e instanceof Error ? e.message : String(e) })
      })
    }
    res.json({ ...publicConfig(), saved: true })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.post('/api/config/models', async (req, res) => {
  try {
    const body = req.body || {}
    const key = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : openaiApiKey()
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : openaiBaseUrl()
    const listed = await listProviderModels(key, baseUrl)
    res.json(listed)
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message, models: [] as string[] })
  }
})

app.get('/api/fs/list', (req, res) => {
  const files: string[] = []
  const dirs: string[] = []
  const mtimes: Record<string, number> = {}
  function walk(dir: string, base = '') {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.chrome-data') || entry.name === 'node_modules' || entry.name === '.vite' || entry.name === 'dist') continue
        const full = path.join(dir, entry.name)
        const rel = path.join(base, entry.name)
        const asPath = '/' + rel.replace(/\\/g, '/')
        if (entry.isDirectory()) { dirs.push(asPath); walk(full, rel) }
        else {
          files.push(asPath)
          try { mtimes[asPath] = fs.statSync(full).mtimeMs } catch {}
        }
      }
    } catch {}
  }
  const root = getFsRoot()
  walk(root)
  res.json({ files, dirs, mtimes, root })
})

app.get('/api/fs/read', (req, res) => {
  try {
    const p = req.query.path as string
    if (!p) return res.status(400).json({ error: 'path required' })
    const full = safePath(p)
    if (!fs.existsSync(full)) return res.json({ error: 'Not found', path: p })
    const content = fs.readFileSync(full, 'utf-8')
    res.json({ path: p, content })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/fs/write', async (req, res) => {
  try {
    const blocked = sketchWriteGuard()
    if (blocked) return res.status(409).json({ ok: false, ...blocked })
    const { path: p, content } = req.body
    if (!p) return res.status(400).json({ error: 'path required' })
    const full = safePath(p)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
    res.json({ ok: true, path: p, bytes: content.length })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.get('/api/page/status', async (_req, res) => {
  if (livePageCount() > 0) return res.json({ ok: true, clients: livePageCount(), via: 'local' })
  try {
    const r = await fetch('http://localhost:5173/api/page/status')
    res.status(r.status).json(await r.json())
  } catch (e: any) {
    res.status(503).json({ ok: false, error: 'Vite :5173 not reachable', detail: e.message })
  }
})
app.post('/api/page/inspect', async (req, res) => {
  const { livePageOp } = await import('./liveTarget.js')
  res.json(await livePageOp('inspect', req.body || {}))
})
app.post('/api/page/patch', async (req, res) => {
  const { livePageOp } = await import('./liveTarget.js')
  res.json(await livePageOp('patch', req.body || {}))
})
app.post('/api/page/eval', async (req, res) => {
  const { livePageOp } = await import('./liveTarget.js')
  res.json(await livePageOp('eval', req.body || {}))
})
app.post('/api/page/snapshot', async (req, res) => {
  const { livePageOp } = await import('./liveTarget.js')
  res.json(await livePageOp('snapshot', req.body || {}))
})

app.post('/api/browser/open', async (req, res) => {
  const { runPoolOp } = await import('./liveTarget.js')
  res.json(await runPoolOp('open', { url: String(req.body?.url || '') }))
})
app.post('/api/browser/inspect', async (req, res) => {
  const { runPoolOp } = await import('./liveTarget.js')
  res.json(await runPoolOp('inspect', req.body || {}))
})
app.post('/api/browser/patch', async (req, res) => {
  const { runPoolOp } = await import('./liveTarget.js')
  res.json(await runPoolOp('patch', req.body || {}))
})
app.post('/api/browser/eval', async (req, res) => {
  const { runPoolOp } = await import('./liveTarget.js')
  res.json(await runPoolOp('eval', req.body || {}))
})
app.post('/api/layout/snapshot', async (req, res) => {
  try {
    const { liveLayoutSnapshot } = await import('./liveTarget.js')
    const { url, ...params } = req.body || {}
    res.json(await liveLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout', ...params }, url))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})
app.post('/api/layout/svg', async (req, res) => {
  try {
    const { liveLayoutSvg } = await import('./liveTarget.js')
    const { url, scale, showLabels, showDimensions, showOverlaps, showGaps, showClipping, ...params } = req.body || {}
    if (showOverlaps) params.includeOverlapAnalysis = true
    if (showGaps) params.includeGapAnalysis = true
    if (showClipping) params.includeClippingAnalysis = true
    res.json(await liveLayoutSvg(
      { maxTotal: 300, computedStylePreset: 'layout', ...params },
      url,
      { scale, showLabels, showDimensions, showOverlaps, showGaps, showClipping },
    ))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// --- Mastra chat proxy (so UI doesn't need separate Mastra server) ---
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, workflow } = req.body
    const { parseSketchMode, setSketchMode, getSketchMode } = await import('./sketchSession.js')
    const parsed = parseSketchMode(workflow)
    if (parsed) setSketchMode(parsed)
    const { activeToolsForMode, fileToolsForTurn } = await import('./agentTools.js')
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const msgs = Array.isArray(messages) ? messages : []
    const { buildTurnContext, latestUserText } = await import('./turnContext.js')
    const userText = latestUserText(msgs)
    const { withContextBeforeLastUser } = await import('./workflowRoute.js')
    const mode = getSketchMode()
    let tools = activeToolsForMode(mode)
    if (mode === 'files') {
      const { getActivePlan } = await import('./plans/plans.js')
      const { getFeatureGraph } = await import('./features/features.js')
      const { getUserFlowGraph } = await import('./userflows/userflows.js')
      const { getSearchBackend } = await import('./searchSession.js')
      tools = fileToolsForTurn({
        userText,
        hasActivePlan: Boolean(getActivePlan()),
        hasFeatureGraph: Boolean(getFeatureGraph()),
        hasUserFlowGraph: Boolean(getUserFlowGraph()),
        searchAvailable: getSearchBackend() !== 'off',
      })
    }
    // The shared turn-context stack (brief + map + skills), identical
    // to the streamed route — see turnContext.ts.
    const briefed = withContextBeforeLastUser(await buildTurnContext(userText, { mode }), msgs)
    // Same thread memory as the streamed route (chatMemory.ts).
    const { prepareMemoryTurn } = await import('./mastra/chatMemory.js')
    const prepared = await prepareMemoryTurn(briefed)
    // MCP tools for this turn — the same rule as the streamed
    // route: Files mode only, the enabled servers' enabled
    // tools, connected for this turn and closed when it ends.
    let mcpTurn: import('./mcp/mcpClient.js').McpTurnToolsets | null = null
    if (mode === 'files') {
      try {
        const { getMcpToolsetsForTurn } = await import('./mcp/mcpClient.js')
        mcpTurn = await getMcpToolsetsForTurn()
        if (mcpTurn.toolNames.length) tools = [...tools, ...mcpTurn.toolNames]
      } catch { mcpTurn = null }
    }
    const result = await agent.generate(prepared.payload as never, {
      maxSteps: 12,
      activeTools: tools,
      memory: prepared.memory,
      ...(mcpTurn?.toolNames.length ? { toolsets: mcpTurn.toolsets } : {}),
    }).finally(async () => { await mcpTurn?.close().catch(() => { /* best-effort */ }) })
    res.json({ ok: true, text: result.text, toolCalls: result.toolCalls })
  } catch (e: any) {
    console.error(e)
    const { logServerError } = await import('./serverLog.js')
    logServerError({ kind: 'chat-error', route: 'POST /api/chat', status: 500, message: e.message })
    const { describeUpstreamError } = await import('./chatStream.js')
    res.status(500).json({ ok: false, error: describeUpstreamError(e) })
  }
})

app.post('/api/chat/stream', async (req, res) => {
  await pipeAgentChatStream(req.body?.messages, res, req, req.body?.workflow, { mcp: true })
})

// --- Live-edit submit: page annotations -> agent applies -> files + live DOM ---
app.post('/api/live-edit/submit', async (req, res) => {
  try {
    const { annotations, pageNotes, url } = req.body || {}
    const notes = Array.isArray(annotations) ? annotations : []
    if (!notes.length && !pageNotes) {
      return res.status(400).json({ ok: false, error: 'No annotations or page notes submitted' })
    }
    const { summarizeAnnotations, buildLiveEditPrompt } = await import('./live-edit/annotationAnalysis.js')
    const { resolveAnnotationSelectors } = await import('./mastra/tools/resolveSourceTool.js')
    const summary = summarizeAnnotations(notes)
    const pageUrl = typeof url === 'string' ? url : ''
    const resolutions = resolveAnnotationSelectors(notes)
    const { getSketchMode, withSketchPreamble } = await import('./sketchSession.js')
    const mode = getSketchMode()
    const prompt = buildLiveEditPrompt({ annotations: notes, summary, pageNotes: String(pageNotes || ''), pageUrl, resolutions, mode })
    const { projectBrief } = await import('./projectConfig.js')
    const { activeToolsForMode } = await import('./agentTools.js')
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    // The brief arrives as its own system context message (the shared
    // insertion helper), not glued onto the prompt — the prompt stays
    // a clean user turn, as on every other surface.
    const { withContextBeforeLastUser } = await import('./workflowRoute.js')
    const briefedMessages = withContextBeforeLastUser([projectBrief()], [{ role: 'user', content: prompt }])
    const messages = mode === 'sketch'
      ? withSketchPreamble(briefedMessages)
      : briefedMessages
    const result = await agent.generate(messages as any, {
      maxSteps: 12,
      activeTools: activeToolsForMode(mode),
    })
    res.json({
      ok: true,
      text: result.text,
      toolCalls: result.toolCalls,
      annotationCount: notes.length,
      prioritizedIds: summary.prioritizedIds,
    })
  } catch (e: any) {
    console.error(e)
    const { logServerError } = await import('./serverLog.js')
    logServerError({ kind: 'chat-error', route: 'POST /api/live-edit/submit', status: 500, message: e.message })
    const { describeUpstreamError } = await import('./chatStream.js')
    res.status(500).json({ ok: false, error: describeUpstreamError(e) })
  }
})

// --- Annotation overlay script (injected into preview iframe / extension pages) ---
app.get('/live-edit/overlay.js', (req, res) => {
  res.type('application/javascript')
  res.setHeader('Cache-Control', 'no-store')
  res.sendFile(path.join(__dirname, 'live-edit', 'overlay.js'))
})

// --- Serve UI ---
const uiDist = path.join(__dirname, 'ui-dist')
if (isSelfMode()) {
  // Self mode (§L): the recovery surface is registered BEFORE the
  // Vite middlewares — it must stay reachable even when the UI
  // source is broken, and it is plain server-rendered HTML, never
  // a file inside the agent's write scope.
  app.get('/api/self/status', (_req, res) => {
    res.json({
      selfMode: true,
      selfWorkspace: isSelfWorkspace(),
      fsRoot: getFsRoot(),
      check: getSelfCheck(),
      snapshots: listSnapshotsAt(EDITOR_ROOT),
    })
  })
  app.post('/api/self/revert', async (req, res) => {
    const hash = typeof req.body?.hash === 'string' ? req.body.hash : ''
    const result = await revertSelfSnapshot(hash)
    if (!result.ok) return res.status(400).json(result)
    res.json(result)
  })
  app.get('/self-recovery', (_req, res) => {
    const check = getSelfCheck()
    const snapshots = listSnapshotsAt(EDITOR_ROOT)
    const rows = snapshots.map(s => `
      <li>
        <code>${s.hash.slice(0, 10)}</code> — ${new Date(s.at).toLocaleString()} — ${s.label}
        <button onclick="revertTo('${s.hash}')">Revert src/ui to this snapshot</button>
      </li>`).join('')
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>AI Live Editor — self recovery</title></head>
<body style="font-family:system-ui;padding:24px;max-width:720px">
<h1>Self recovery</h1>
<p>Self mode is on. Workspace: <code>${getFsRoot()}</code> (editor itself: ${isSelfWorkspace()}).</p>
<p>Last self-check: ${check ? (check.running ? 'running…' : `tsc ${check.tscOk ? 'ok' : 'FAILED'} · tests ${check.testsOk ? 'ok' : 'FAILED'} — ${new Date(check.at).toLocaleString()}`) : 'none yet'}</p>
${check?.tail ? `<pre style="white-space:pre-wrap;background:#111;color:#eee;padding:12px">${check.tail.replace(/</g, '&lt;')}</pre>` : ''}
<h2>Turn snapshots</h2>
<p>Reverting restores tracked files under <code>src/ui</code> from the snapshot and removes files created inside it since. Nothing outside <code>src/ui</code> is touched.</p>
<ul>${rows || '<li>No snapshots yet — one is taken before each chat turn.</li>'}</ul>
<p><a href="/">← Back to the editor</a></p>
<script>
async function revertTo(hash) {
  if (!confirm('Revert src/ui to snapshot ' + hash.slice(0, 10) + '?')) return
  const r = await fetch('/api/self/revert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash }) })
  const body = await r.json()
  alert(r.ok ? 'Reverted. Removed: ' + (body.removed.join(', ') || 'none') : 'Failed: ' + body.error)
  location.reload()
}
</script>
</body></html>`)
  })
}
if (uiServing() === 'source') {
  // The UI itself: src/ui served from source through Vite dev
  // middleware (HMR) — the default, so editing the editor needs no
  // ui:build in the loop. Self mode has run this way since §L; the
  // serving choice is now independent of it (AI_LIVE_UI=build serves
  // the static bundle). Inline config, equivalent to vite.config.ts
  // minus its build-only parts and its dev proxy (API routes are
  // this server's own, above).
  const { createServer: createViteServer } = await import('vite')
  const reactPlugin = (await import('@vitejs/plugin-react')).default
  const vite = await createViteServer({
    root: path.join(EDITOR_ROOT, 'src/ui'),
    plugins: [reactPlugin()],
    appType: 'spa',
    server: { middlewareMode: true },
  })
  // The project-page overlay iframes /chat-embed on this origin:
  // serve the real embed entry, not the SPA index.
  app.get('/chat-embed', async (_req, res, next) => {
    try {
      const raw = fs.readFileSync(path.join(EDITOR_ROOT, 'src/ui/chat-embed.html'), 'utf-8')
      res.type('html').send(await vite.transformIndexHtml('/chat-embed.html', raw))
    } catch (e) { next(e) }
  })
  app.use(vite.middlewares)
} else {
  app.get('/chat-embed', (req, res) => {
    const embed = path.join(uiDist, 'chat-embed.html')
    if (fs.existsSync(embed)) res.sendFile(embed)
    else res.status(404).send('chat-embed not built — run npm run ui:build')
  })
  if (fs.existsSync(uiDist)) {
    app.use(express.static(uiDist))
  }
}
app.use('/projects', (req, res, next) => {
  express.static(getFsRoot())(req, res, next)
})

// Fallback to UI index (in source mode the Vite middlewares above
// answer first; this remains for the built bundle).
app.get('*', (req, res) => {
  const index = path.join(uiDist, 'index.html')
  if (fs.existsSync(index)) res.sendFile(index)
  else res.send(`<html><body style="font-family:system-ui;padding:24px"><h1>AI Live Editor Launcher running</h1><p>API at /api/fs/health</p><p>FS root: ${getFsRoot()}</p><p>Vite for the active project starts with this process on localhost:5173</p><p>UI not built yet - run npm run ui:build</p></body></html>`)
})

// watcher: log file edits + refresh the 4112 project list when folders appear/disappear
const watcher = chokidar.watch(WORKSPACE_ROOT, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true })
watcher.on('change', p => console.log('[fs] changed', path.relative(WORKSPACE_ROOT, p)))
// Codebase map (§1): keep the active project's .ai-live/map.json fresh.
const mapRebuilder = createMapRebuilder(() => getFsRoot())
const scheduleMapRebuild = (p: string) => { if (p.startsWith(getFsRoot())) mapRebuilder.schedule(p) }
let projectPushTimer: ReturnType<typeof setTimeout> | undefined
function scheduleProjectPush() {
  if (projectPushTimer) clearTimeout(projectPushTimer)
  projectPushTimer = setTimeout(() => {
    pushProjectList()
    console.log('[workspace] projects', listProjects().map(p => p.id).join(', ') || '(none)')
  }, 400)
}
watcher.on('addDir', scheduleProjectPush)
watcher.on('change', scheduleMapRebuild)
watcher.on('unlinkDir', scheduleProjectPush)
watcher.on('add', (p) => { scheduleMapRebuild(p); if (path.basename(p) === 'package.json') scheduleProjectPush() })
watcher.on('unlink', (p) => { scheduleMapRebuild(p); if (path.basename(p) === 'package.json') scheduleProjectPush() })

const server = app.listen(PORT, () => {
  console.log(`[launcher] running at http://localhost:${PORT}`)
  console.log(`[launcher] FS root: ${getFsRoot()}`)
  console.log(`[launcher] Health: http://localhost:${PORT}/api/fs/health`)
  console.log(`[launcher] Projects: http://localhost:${PORT}/projects/`)
  console.log(`[launcher] Playwright pool: ${playwrightPoolEnabled() ? 'on' : 'off'} · live target: ${liveTarget()}${liveTarget() === 'pool' ? ' (no Vite bridge)' : ''}`)
  if (playwrightPoolEnabled()) {
    void openPoolBrowser().catch(async (e) => {
      console.error('[browser]', e)
      const { logServerError } = await import('./serverLog.js')
      logServerError({ kind: 'pool', route: 'boot', message: e instanceof Error ? e.message : String(e) })
    })
  }
})

server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[launcher] port ${PORT} is already in use (EADDRINUSE). Another launcher instance is likely still running.`)
    let holders = ''
    try {
      holders = execSync(`lsof -i :${PORT} -sTCP:LISTEN -t 2>/dev/null`, { encoding: 'utf-8' }).trim()
    } catch {}
    if (holders) {
      const pid = holders.split(/\s+/)[0]
      console.error(`[launcher] holder PID: ${pid}`)
      console.error(`[launcher] to fix, run:`)
      console.error(`[launcher]   lsof -i :${PORT} -sTCP:LISTEN  # confirm the holder`)
      console.error(`[launcher]   kill ${pid}  # stop the stale instance (use the PID lsof shows now)`)
      console.error(`[launcher]   npm run dev  # restart`)
    } else {
      console.error(`[launcher] to fix, run:`)
      console.error(`[launcher]   lsof -i :${PORT} -sTCP:LISTEN  # find the holder PID`)
      console.error(`[launcher]   kill <PID>  # stop the stale instance`)
      console.error(`[launcher]   npm run dev  # restart`)
    }
    process.exit(1)
  }
  throw err
})
