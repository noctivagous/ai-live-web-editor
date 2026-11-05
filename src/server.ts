import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { currentModelId, hasAiKey, loadDotEnv, openaiApiKey, openaiBaseUrl, openaiModelName, playwrightPoolEnabled, saveAiConfig, setPlaywrightPool } from './env.js'
import { mapMastraChunk } from './chatStream.js'
import { listProviderModels } from './providers.js'
import { createProject, ensureWorkspace, getFsRoot, listProjects, readActiveId, selectProject, WORKSPACE_ROOT } from './launcher.js'
import { livePageCount, pageCommand } from './pageBridge.js'
import { markLauncherOwner } from './liveTarget.js'
import chokidar from 'chokidar'

loadDotEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.LAUNCHER_PORT) || 4112

function publicConfig() {
  const hasKey = hasAiKey()
  return {
    ok: true,
    hasApiKey: hasKey,
    hasOpenAiKey: hasKey,
    model: currentModelId(),
    modelName: openaiModelName(),
    baseUrl: openaiBaseUrl(),
    launcherUrl: `http://localhost:${PORT}`,
    previewStaticUrl: '/projects/',
    previewHmrUrl: 'http://localhost:5173',
    workspace: WORKSPACE_ROOT,
    activeProject: readActiveId(),
    fsRoot: getFsRoot(),
    playwrightPool: playwrightPoolEnabled(),
  }
}
app.use(cors({ origin: '*' }))
app.use((req,res,next)=>{res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"); next()})
app.use(express.json({ limit: '20mb' }))

ensureWorkspace()
markLauncherOwner()

function safePath(p: string) {
  const root = getFsRoot()
  const resolved = path.resolve(root, '.' + p)
  if (!resolved.startsWith(root)) throw new Error('Path traversal')
  return resolved
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
    const project = selectProject(id)
    res.json({ ok: true, active: project.id, root: project.root, projects: listProjects() })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.post('/api/projects/create', (req, res) => {
  try {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const project = createProject(id)
    res.json({ ok: true, active: project.id, root: project.root, projects: listProjects() })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

// --- Launcher config (presence flags only: never expose secrets) ---
app.get('/api/config', (req, res) => {
  res.json(publicConfig())
})

app.post('/api/config/key', (req, res) => {
  try {
    const body = req.body || {}
    saveAiConfig({
      key: typeof body.key === 'string' ? body.key : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
    })
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
  function walk(dir: string, base = '') {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.chrome-data') || entry.name === 'node_modules' || entry.name === '.vite' || entry.name === 'dist') continue
        const full = path.join(dir, entry.name)
        const rel = path.join(base, entry.name)
        if (entry.isDirectory()) walk(full, rel)
        else files.push('/' + rel.replace(/\\/g, '/'))
      }
    } catch {}
  }
  const root = getFsRoot()
  walk(root)
  res.json({ files, root })
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
  res.json(await pageCommand('inspect', req.body || {}))
})
app.post('/api/page/patch', async (req, res) => {
  res.json(await pageCommand('patch', req.body || {}))
})
app.post('/api/page/eval', async (req, res) => {
  res.json(await pageCommand('eval', req.body || {}))
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
    const { messages } = req.body
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const result = await agent.generate(messages, { maxSteps: 12 })
    res.json({ ok: true, text: result.text, toolCalls: result.toolCalls })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/api/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const send = (obj: unknown) => { res.write(`data: ${JSON.stringify(obj)}\n\n`) }
  try {
    const { messages } = req.body
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const result = await agent.stream(messages, { maxSteps: 12 })
    for await (const chunk of result.fullStream) {
      if (req.aborted) break
      const mapped = mapMastraChunk(chunk)
      if (mapped) send(mapped)
    }
    send({ type: 'done' })
    res.end()
  } catch (e: any) {
    console.error(e)
    try { send({ type: 'error', error: e.message }) } catch { /* closed */ }
    res.end()
  }
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
    const summary = summarizeAnnotations(notes)
    const pageUrl = typeof url === 'string' ? url : ''
    const prompt = buildLiveEditPrompt({ annotations: notes, summary, pageNotes: String(pageNotes || ''), pageUrl })
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const result = await agent.generate([{ role: 'user', content: prompt }], { maxSteps: 12 })
    res.json({
      ok: true,
      text: result.text,
      toolCalls: result.toolCalls,
      annotationCount: notes.length,
      prioritizedIds: summary.prioritizedIds,
    })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// --- Annotation overlay script (injected into preview iframe / extension pages) ---
app.get('/live-edit/overlay.js', (req, res) => {
  res.type('application/javascript')
  res.sendFile(path.join(__dirname, 'live-edit', 'overlay.js'))
})

// --- Serve UI ---
const uiDist = path.join(__dirname, 'ui-dist')
app.get('/chat-embed', (req, res) => {
  const embed = path.join(uiDist, 'chat-embed.html')
  if (fs.existsSync(embed)) res.sendFile(embed)
  else res.status(404).send('chat-embed not built — run npm run ui:build')
})
if (fs.existsSync(uiDist)) {
  app.use(express.static(uiDist))
}
app.use('/projects', (req, res, next) => {
  express.static(getFsRoot())(req, res, next)
})

// Fallback to UI index
app.get('*', (req, res) => {
  const index = path.join(uiDist, 'index.html')
  if (fs.existsSync(index)) res.sendFile(index)
  else res.send(`<html><body style="font-family:system-ui;padding:24px"><h1>AI Live Editor Launcher running</h1><p>API at /api/fs/health</p><p>FS root: ${getFsRoot()}</p><p>Vite for the active project starts with this process on localhost:5173</p><p>UI not built yet - run npm run ui:build</p></body></html>`)
})

// watcher for HMR-like logs
const watcher = chokidar.watch(WORKSPACE_ROOT, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true })
watcher.on('change', p => console.log('[fs] changed', path.relative(WORKSPACE_ROOT, p)))

const server = app.listen(PORT, () => {
  console.log(`[launcher] running at http://localhost:${PORT}`)
  console.log(`[launcher] FS root: ${getFsRoot()}`)
  console.log(`[launcher] Health: http://localhost:${PORT}/api/fs/health`)
  console.log(`[launcher] Projects: http://localhost:${PORT}/projects/`)
  console.log(`[launcher] Playwright pool: ${playwrightPoolEnabled() ? 'on (lazy)' : 'off — npm run dev:pool to enable'}`)
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
