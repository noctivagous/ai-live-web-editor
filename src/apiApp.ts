import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { currentModelId, hasAiKey, liveTarget, openaiApiKey, openaiBaseUrl, openaiModelName, playwrightPoolEnabled, publicProvider, saveAiConfig, setPlaywrightPool } from './env.js'
import { pipeAgentChatStream } from './chatStream.js'
import { listProviderModels } from './providers.js'
import { getFsRoot } from './launcher.js'
import { mountPageBridge } from './pageBridge.js'
import { mountPoolPage } from './poolPage.js'
import { mountWorkflowApi } from './workflowApi.js'
import { mountProjectConfigApi } from './projectConfigApi.js'
import { mountAgentSettingsApi } from './agentSettingsApi.js'
import { mountConnectionsApi } from './connectionsApi.js'
import { mountResearchApi } from './research/researchApi.js'
import { mountPlanApi } from './plans/planApi.js'
import { mountCodebaseMapApi } from './codebaseMap/codebaseMapApi.js'
import { mountCatalogApi } from './catalog/catalogApi.js'
import { mountFsApi } from './fsApi.js'
import { activePublic, syncFromLegacy } from './connections.js'
import { activeToolsForMode } from './agentTools.js'
import { getSketchMode, parseSketchMode, setSketchMode, sketchWriteGuard, withSketchPreamble } from './sketchSession.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function publicConfig(publicUrl: string) {
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
    baseUrl: active?.baseUrl ?? openaiBaseUrl(),
    launcherUrl: publicUrl,
    previewStaticUrl: '/',
    previewHmrUrl: publicUrl,
    playwrightPool: playwrightPoolEnabled(),
    liveTarget: liveTarget(),
  }
}

function safePath(p: string) {
  const root = getFsRoot()
  const resolved = path.resolve(root, '.' + p)
  if (!resolved.startsWith(root)) throw new Error('Path traversal')
  return resolved
}

export function createApiApp(opts: { publicUrl?: () => string } = {}) {
  const app = express()
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    next()
  })
  app.use(express.json({ limit: '20mb' }))
  const url = () => opts.publicUrl?.() || ''
  mountPageBridge(app)
  mountPoolPage(app)
  mountWorkflowApi(app)
  mountProjectConfigApi(app)
  mountAgentSettingsApi(app)
  mountConnectionsApi(app)
mountResearchApi(app)
mountPlanApi(app)
  mountCodebaseMapApi(app)
  mountCatalogApi(app)
  mountFsApi(app)

  app.get('/api/fs/health', (_req, res) => {
    const root = getFsRoot()
    res.json({ ok: true, root, files: fs.existsSync(root) ? fs.readdirSync(root).slice(0, 20) : [] })
  })

  app.get('/api/config', (_req, res) => {
    res.json(publicConfig(url()))
  })

  app.post('/api/config/key', (req, res) => {
    try {
      const body = req.body || {}
      saveAiConfig({
        key: typeof body.key === 'string' ? body.key : undefined,
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
      })
      syncFromLegacy()
      res.json({ ...publicConfig(url()), saved: true })
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
        const { openPoolBrowser } = await import('./poolPage.js')
        void openPoolBrowser().catch((e) => console.error('[browser]', e))
      }
      res.json({ ...publicConfig(url()), saved: true })
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

  app.get('/api/fs/list', (_req, res) => {
    const root = getFsRoot()
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
            try { mtimes[asPath] = fs.statSync(full).mtimeMs } catch { /* raced */ }
          }
        }
      } catch { /* ignore unreadable */ }
    }
    walk(root)
    res.json({ files, dirs, mtimes, root })
  })

  app.get('/api/fs/read', (req, res) => {
    try {
      const p = req.query.path as string
      if (!p) return res.status(400).json({ error: 'path required' })
      const full = safePath(p)
      if (!fs.existsSync(full)) return res.json({ error: 'Not found', path: p })
      res.json({ path: p, content: fs.readFileSync(full, 'utf-8') })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
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

  app.post('/api/fs/write', (req, res) => {
    try {
      const blocked = sketchWriteGuard()
      if (blocked) return res.status(409).json({ ok: false, ...blocked })
      const { path: p, content } = req.body
      if (!p) return res.status(400).json({ error: 'path required' })
      const full = safePath(p)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content, 'utf-8')
      res.json({ ok: true, path: p, bytes: String(content).length })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  app.post('/api/chat', async (req, res) => {
    try {
      const { messages, workflow } = req.body
      const parsed = parseSketchMode(workflow)
      if (parsed) setSketchMode(parsed)
      const { mastra } = await import('./mastra/index.js')
      const agent = mastra.getAgent('editorAgent')
      const { projectBrief } = await import('./projectConfig.js')
      const result = await agent.generate([{ role: 'system', content: projectBrief() }, ...(Array.isArray(messages) ? messages : [])], {
        maxSteps: 12,
        activeTools: activeToolsForMode(getSketchMode()),
      })
      res.json({ ok: true, text: result.text, toolCalls: result.toolCalls })
    } catch (e: any) {
      console.error(e)
      const { describeUpstreamError } = await import('./chatStream.js')
      res.status(500).json({ ok: false, error: describeUpstreamError(e) })
    }
  })

  app.post('/api/chat/stream', async (req, res) => {
    await pipeAgentChatStream(req.body?.messages, res, req, req.body?.workflow)
  })

  app.post('/api/live-edit/submit', async (req, res) => {
    try {
      const { annotations, pageNotes, url: pageUrl } = req.body || {}
      const notes = Array.isArray(annotations) ? annotations : []
      if (!notes.length && !pageNotes) {
        return res.status(400).json({ ok: false, error: 'No annotations or page notes submitted' })
      }
      const { summarizeAnnotations, buildLiveEditPrompt } = await import('./live-edit/annotationAnalysis.js')
      const { resolveAnnotationSelectors } = await import('./mastra/tools/resolveSourceTool.js')
      const summary = summarizeAnnotations(notes)
      const resolvedUrl = typeof pageUrl === 'string' ? pageUrl : ''
      const resolutions = resolveAnnotationSelectors(notes)
      const mode = getSketchMode()
      const prompt = buildLiveEditPrompt({ annotations: notes, summary, pageNotes: String(pageNotes || ''), pageUrl: resolvedUrl, resolutions, mode })
      const { projectBrief } = await import('./projectConfig.js')
      const { mastra } = await import('./mastra/index.js')
      const agent = mastra.getAgent('editorAgent')
      const briefed = `${projectBrief()}\n\n${prompt}`
      const messages = mode === 'sketch'
        ? withSketchPreamble([{ role: 'user', content: briefed }])
        : [{ role: 'user', content: briefed }]
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
      const { describeUpstreamError } = await import('./chatStream.js')
      res.status(500).json({ ok: false, error: describeUpstreamError(e) })
    }
  })

  app.get('/live-edit/overlay.js', (_req, res) => {
    res.type('application/javascript')
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(path.join(__dirname, 'live-edit', 'overlay.js'))
  })

  return app
}
