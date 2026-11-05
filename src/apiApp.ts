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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function publicConfig(publicUrl: string) {
  const hasKey = hasAiKey()
  const provider = publicProvider()
  return {
    ok: true,
    hasApiKey: hasKey,
    hasOpenAiKey: hasKey,
    model: openaiModelName(),
    modelName: openaiModelName(),
    modelId: currentModelId(),
    providerId: provider?.id || null,
    providerName: provider?.name || null,
    baseUrl: openaiBaseUrl(),
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
    function walk(dir: string, base = '') {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.chrome-data') || entry.name === 'node_modules' || entry.name === '.vite' || entry.name === 'dist') continue
          const full = path.join(dir, entry.name)
          const rel = path.join(base, entry.name)
          if (entry.isDirectory()) walk(full, rel)
          else files.push('/' + rel.replace(/\\/g, '/'))
        }
      } catch { /* ignore unreadable */ }
    }
    walk(root)
    res.json({ files, root })
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
    await pipeAgentChatStream(req.body?.messages, res, req)
  })

  app.post('/api/live-edit/submit', async (req, res) => {
    try {
      const { annotations, pageNotes, url: pageUrl } = req.body || {}
      const notes = Array.isArray(annotations) ? annotations : []
      if (!notes.length && !pageNotes) {
        return res.status(400).json({ ok: false, error: 'No annotations or page notes submitted' })
      }
      const { summarizeAnnotations, buildLiveEditPrompt } = await import('./live-edit/annotationAnalysis.js')
      const summary = summarizeAnnotations(notes)
      const resolvedUrl = typeof pageUrl === 'string' ? pageUrl : ''
      const prompt = buildLiveEditPrompt({ annotations: notes, summary, pageNotes: String(pageNotes || ''), pageUrl: resolvedUrl })
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

  app.get('/live-edit/overlay.js', (_req, res) => {
    res.type('application/javascript')
    res.sendFile(path.join(__dirname, 'live-edit', 'overlay.js'))
  })

  return app
}
