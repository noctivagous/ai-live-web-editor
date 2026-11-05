import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { ensureFsRoot, FS_ROOT } from './launcher.js'
import { getBrowser, getPage, getPoolInfo, patchDOM, inspectDOM, evalJS, captureLayoutSnapshot, renderLayoutSvg } from './browserPool.js'
import chokidar from 'chokidar'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.LAUNCHER_PORT) || 4112
app.use(cors({ origin: '*' }))
app.use((req,res,next)=>{res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"); next()})
app.use(express.json({ limit: '20mb' }))

ensureFsRoot()
getBrowser(`http://localhost:${PORT}/pool`)

function safePath(p: string) {
  const resolved = path.resolve(FS_ROOT, '.' + p)
  if (!resolved.startsWith(FS_ROOT)) throw new Error('Path traversal')
  return resolved
}

// --- FS API ---
app.get('/api/fs/health', (req, res) => {
  res.json({ ok: true, root: FS_ROOT, files: fs.existsSync(FS_ROOT) ? fs.readdirSync(FS_ROOT).slice(0, 20) : [] })
})

// --- Launcher config (presence flags only: never expose secrets) ---
app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    model: 'openai/gpt-4o-mini',
    launcherUrl: `http://localhost:${PORT}`,
    poolUrl: `http://localhost:${PORT}/pool`,
    previewStaticUrl: '/projects/',
    previewHmrUrl: 'http://localhost:5173',
  })
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
  walk(FS_ROOT)
  res.json({ files, root: FS_ROOT })
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

// --- Browser pool API (replaces MCP screenshot tax) ---
app.post('/api/browser/open', async (req, res) => {
  try {
    const { url } = req.body
    const page = await getPage(url)
    res.json({ ok: true, url: page.url() })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/browser/patch', async (req, res) => {
  try {
    const { selector, html, url } = req.body
    const result = await patchDOM(selector || 'body', html, url)
    res.json(result) // includes rect + elapsedMs, no screenshot
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/browser/inspect', async (req, res) => {
  try {
    const { selector, url } = req.body
    const result = await inspectDOM(selector || 'body', url)
    res.json(result)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/browser/eval', async (req, res) => {
  try {
    const { code, url } = req.body
    const result = await evalJS(code, url)
    res.json(result)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// --- Layout analysis (rectangle-based, no screenshots) ---
app.post('/api/layout/snapshot', async (req, res) => {
  try {
    const { url, ...params } = req.body || {}
    const result = await captureLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout', ...params }, url)
    res.json(result)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/layout/svg', async (req, res) => {
  try {
    const { url, scale, showLabels, showDimensions, showOverlaps, showGaps, showClipping, ...params } = req.body || {}
    if (showOverlaps) (params as any).includeOverlapAnalysis = true
    if (showGaps) (params as any).includeGapAnalysis = true
    if (showClipping) (params as any).includeClippingAnalysis = true
    const snapshot = await captureLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout', ...params }, url)
    const svg = renderLayoutSvg(snapshot as any, {
      scale: scale ?? 1,
      showLabels: showLabels ?? true,
      showDimensions: showDimensions ?? false,
      showOverlaps: showOverlaps ?? false,
      showGaps: showGaps ?? false,
      showClipping: showClipping ?? false,
    } as any)
    res.json({ ...snapshot, svg, svgLength: svg.length })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// --- Mastra chat proxy (so UI doesn't need separate Mastra server) ---
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const result = await agent.generate(messages)
    res.json({ ok: true, text: result.text, toolCalls: result.toolCalls })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ ok: false, error: e.message })
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
    const { getPage, captureLayoutSnapshot, summarizeLayoutSnapshot } = await import('./browserPool.js')
    const { installAnnotationOverlay, importAnnotationsToPage } = await import('./live-edit/annotationOverlay.js')
    // The agent works in the pool page: import the user's notes there.
    const page = await getPage(typeof url === 'string' && url ? url : undefined)
    const pageUrl = page.url()
    await installAnnotationOverlay(page).catch(() => {})
    if (notes.length) await importAnnotationsToPage(page, notes).catch(() => {})
    const before = await captureLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout' }).catch(() => null)
    const summary = summarizeAnnotations(notes)
    const prompt = buildLiveEditPrompt({ annotations: notes, summary, pageNotes: String(pageNotes || ''), pageUrl })
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const result = await agent.generate([{ role: 'user', content: prompt }])
    const after = await captureLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout' }).catch(() => null)
    res.json({
      ok: true,
      text: result.text,
      toolCalls: result.toolCalls,
      annotationCount: notes.length,
      prioritizedIds: summary.prioritizedIds,
      before: before ? summarizeLayoutSnapshot(before as any) : null,
      after: after ? summarizeLayoutSnapshot(after as any) : null,
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
if (fs.existsSync(uiDist)) {
  app.use(express.static(uiDist))
}
app.use('/projects', express.static(FS_ROOT))

// --- Editor presence: web UI heartbeats here so /pool knows if anyone is watching ---
const uiPresence: Record<string, number> = {}
app.post('/api/ui/heartbeat', (req, res) => {
  const client = typeof req.body?.client === 'string' ? req.body.client.slice(0, 32) : 'web'
  uiPresence[client] = Date.now()
  res.json({ ok: true })
})

// --- Pool landing page: what this browser window is for ---
app.get('/pool', (req, res) => {
  const info = getPoolInfo()
  let fileCount = 0
  try { fileCount = fs.readdirSync(FS_ROOT).length } catch {}
  const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const webSeen = uiPresence['web']
  const webAgoSec = webSeen ? Math.round((Date.now() - webSeen) / 1000) : null
  const editorOpen = webAgoSec !== null && webAgoSec < 30
  const presence = editorOpen
    ? `<div style="background:#1a4d1a;border:1px solid #2a5a2a;border-radius:8px;padding:12px 16px;margin:16px 0">✅ Editor open in your browser (seen ${webAgoSec}s ago). This window stays the agent's.</div>`
    : `<div style="background:#4d3a1a;border:1px solid #5a4a2a;border-radius:8px;padding:12px 16px;margin:16px 0">⚠️ No editor open in your browser yet.<br/>To use the editor, open <a style="color:#8ab4f8;font-size:18px" href="/">http://localhost:${PORT}</a> in your own Chrome — this window is the agent's, not yours.</div>`
  const activity = info.activity.length
    ? info.activity.map(a => `<li><b>${esc(a.kind)}</b> ${esc(a.summary)} <span style="color:#888">${esc(a.at)}</span></li>`).join('')
    : '<li style="color:#888">No agent activity yet</li>'
  res.send(`<html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="5"/><title>AI Live Editor — Browser Pool</title></head><body style="font-family:system-ui;background:#0f0f0f;color:#eee;padding:32px;max-width:640px;margin:0 auto">
<h1>🤖 AI Live Editor — Browser Pool</h1>
${presence}
<p>This window is <b>not for manual browsing</b>. It is the browser the AI agent drives: it loads your project, keeps your logins (profile in <code>${esc(info.userDataDir)}</code>), and the agent patches + inspects its DOM in milliseconds instead of screenshots.</p>
<ul>
<li>Executable: <code>${esc(info.executable)}</code></li>
<li>FS root: <code>${esc(FS_ROOT)}</code> (${fileCount} top-level entries)</li>
<li>Open pages: ${info.pages}</li>
</ul>
<h2>Recent agent activity (refreshes every 5s)</h2>
<ul>${activity}</ul>
<p style="color:#888;font-size:13px">Editor UI: <a style="color:#8ab4f8" href="/">localhost:${PORT}</a> · Project preview: <a style="color:#8ab4f8" href="/projects/">/projects/</a> · Health: <a style="color:#8ab4f8" href="/api/fs/health">/api/fs/health</a></p>
<p style="color:#888;font-size:13px">API calls may navigate this tab elsewhere — this page is for orientation at launch.</p>
</body></html>`)
})

// Fallback to UI index
app.get('*', (req, res) => {
  const index = path.join(uiDist, 'index.html')
  if (fs.existsSync(index)) res.sendFile(index)
  else res.send(`<html><body style="font-family:system-ui;padding:24px"><h1>AI Live Editor Launcher running</h1><p>API at /api/fs/health</p><p>FS root: ${FS_ROOT}</p><p>Run <code>npm run projects:dev</code> to start Vite at localhost:5173</p><p>UI not built yet - create src/ui-dist/index.html or run frontend separately</p></body></html>`)
})

// watcher for HMR-like logs
const watcher = chokidar.watch(FS_ROOT, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true })
watcher.on('change', p => console.log('[fs] changed', path.relative(FS_ROOT, p)))

const server = app.listen(PORT, () => {
  console.log(`[launcher] running at http://localhost:${PORT}`)
  console.log(`[launcher] FS root: ${FS_ROOT}`)
  console.log(`[launcher] Health: http://localhost:${PORT}/api/fs/health`)
  console.log(`[launcher] Projects: http://localhost:${PORT}/projects/`)
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
