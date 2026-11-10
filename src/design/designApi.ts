import type { Express } from 'express'
import { getFsRoot } from '../launcher.js'
import { getDesignGuide, saveDesignGuide } from './designGuide.js'
import { deriveDesignGraph, designReport, getDesignGraph, saveDesignGraph } from './designGraph.js'
import { setDesignToken } from './designTokens.js'
import { applyDesignPack, getDesignPack, loadDesignPacks, previewDesignPack } from './designPacks.js'
import { mapDesignImport, type ImportFile } from './designImport.js'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Design guide HTTP API, mounted on both servers (the featureApi
 * pattern). Writes go through the store's sanitize, so the API,
 * the facet form, and the agent tools can never diverge.
 */
export function mountDesignApi(app: Express) {
  app.get('/api/design/guide', (_req, res) => {
    res.json({ ok: true, guide: getDesignGuide() })
  })

  app.get('/api/design/graph', (_req, res) => {
    const graph = getDesignGraph()
    res.json({ ok: true, graph, report: graph ? designReport(getFsRoot(), graph) : null })
  })

  app.post('/api/design/derive', (_req, res) => {
    const graph = saveDesignGraph(deriveDesignGraph())
    res.json({ ok: true, graph, report: designReport(getFsRoot(), graph) })
  })

  app.post('/api/design/token', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    const value = typeof req.body?.value === 'string' ? req.body.value : ''
    const result = setDesignToken(name, value)
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error })
    const graph = saveDesignGraph(deriveDesignGraph())
    res.json({ ok: true, ...result, graph, report: designReport(getFsRoot(), graph) })
  })

  app.get('/api/design/packs', (_req, res) => {
    res.json({ ok: true, packs: loadDesignPacks() })
  })

  app.post('/api/design/packs/preview', (req, res) => {
    const pack = getDesignPack(typeof req.body?.id === 'string' ? req.body.id : '')
    if (!pack) return res.status(404).json({ ok: false, error: 'No design pack with that id.' })
    res.json({ ok: true, preview: previewDesignPack(pack) })
  })

  app.post('/api/design/packs/apply', (req, res) => {
    const pack = getDesignPack(typeof req.body?.id === 'string' ? req.body.id : '')
    if (!pack) return res.status(404).json({ ok: false, error: 'No design pack with that id.' })
    const applied = applyDesignPack(pack)
    const graph = saveDesignGraph(deriveDesignGraph())
    res.json({ ok: true, ...applied, graph, report: designReport(getFsRoot(), graph) })
  })

  app.post('/api/design/import', (req, res) => {
    const files = (Array.isArray(req.body?.files) ? req.body.files : [])
      .filter((f: ImportFile) => f && typeof f.path === 'string' && typeof f.content === 'string') as ImportFile[]
    if (!files.length) return res.status(400).json({ ok: false, error: 'Expected { files: [{ path, content }] }.' })
    const mapping = mapDesignImport(files)
    if (req.body?.apply === true && !mapping.isPack) {
      const root = getFsRoot()
      if (mapping.guide) saveDesignGuide(mapping.guide, root)
      // The mapped token source lands at the path the guide
      // points at, so the token source (§3.4) is real, not a
      // pointer at a staging copy.
      const tokenFile = mapping.guide?.tokens?.file
      const tokenRes = tokenFile ? mapping.resources.find(r => r.path === tokenFile) : undefined
      if (tokenFile && tokenRes) {
        const dest = path.join(root, tokenFile)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, tokenRes.content, 'utf-8')
      }
      for (const r of mapping.resources) {
        const dest = path.join(root, 'ai-design', 'resources', r.path)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, r.content, 'utf-8')
      }
      const graph = saveDesignGraph(deriveDesignGraph())
      return res.json({ ok: true, mapping, applied: true, graph, report: designReport(root, graph) })
    }
    res.json({ ok: true, mapping, applied: false })
  })

  app.post('/api/design/guide', (req, res) => {
    if (!req.body?.guide || typeof req.body.guide !== 'object') {
      return res.status(400).json({ ok: false, error: 'Expected { guide }.' })
    }
    const guide = saveDesignGuide(req.body.guide)
    res.json({ ok: true, guide })
  })
}
