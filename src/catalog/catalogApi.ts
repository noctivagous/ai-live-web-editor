/**
 * Catalog API (TASKS-token-efficiency §3): the Library panel's
 * surface. Tiered like the agent tool — listing/search return
 * tier-1 summaries; a full entry comes back only for an exact tag.
 * GET  /api/catalog?q=&includeAppkit=  -> { packs: summaries, components: summaries, templates }
 * GET  /api/catalog/component?tag=     -> { component: full entry }
 * GET  /api/catalog/pack?id=           -> { pack: full feature pack (tier 3) }
 * POST /api/catalog/install            -> { tag } copy-own install (same as §1)
 * POST /api/catalog/place-template     -> { id } one-write template placement
 * Mounted on both servers like the other project APIs.
 */
import type { Express } from 'express'
import { getFsRoot } from '../launcher.js'
import { entryEnabled, entrySummary, getComponent, loadCatalog, searchSummaries } from './catalog.js'
import { loadTemplates, placeTemplate } from './templates.js'
import { getPack, loadPacks, packSummary, searchPacks } from './packs.js'
import { installCatalogComponent } from '../codebaseMap/mapStore.js'
import { loadDesignPacks } from '../design/designPacks.js'
import { loadArchPacks } from '../architecture/archPacks.js'

export function mountCatalogApi(app: Express) {
  app.get('/api/catalog', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const includeAppkit = req.query.includeAppkit === '1' || req.query.includeAppkit === 'true'
    const catalog = loadCatalog()
    const components = q
      ? searchSummaries(q, 24, catalog, { includeAppkit })
      : catalog.components.filter(e => entryEnabled(e, includeAppkit)).map(entrySummary)
    const packsFile = loadPacks()
    const packs = q ? searchPacks(q, 24, packsFile) : packsFile.packs.map(packSummary)
    // The Library holds all catalog kinds (§12 decision 4);
    // facets show their own kind filtered from this same list.
    const designPacks = loadDesignPacks().map(p => ({ id: p.id, kind: p.kind, name: p.name, version: p.version, description: p.description, contents: p.contents }))
    const archPacks = loadArchPacks().map(p => ({ id: p.id, kind: p.kind, name: p.name, version: p.version, description: p.description, contents: p.contents }))
    res.json({ ok: true, packs, components, templates: loadTemplates().templates, designPacks, archPacks })
  })

  app.get('/api/catalog/pack', (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : ''
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    const pack = getPack(id)
    if (!pack) return res.status(404).json({ ok: false, error: `No feature pack with id ${id}` })
    return res.json({ ok: true, pack })
  })

  app.get('/api/catalog/component', (req, res) => {
    const tag = typeof req.query.tag === 'string' ? req.query.tag : ''
    if (!tag) return res.status(400).json({ ok: false, error: 'tag required' })
    const entry = getComponent(tag)
    if (!entry) return res.status(404).json({ ok: false, error: `No catalog component tagged ${tag}` })
    return res.json({ ok: true, component: entry })
  })

  app.post('/api/catalog/install', (req, res) => {
    const tag = typeof req.body?.tag === 'string' ? req.body.tag : ''
    if (!tag) return res.status(400).json({ ok: false, error: 'tag required' })
    const result = installCatalogComponent(tag, getFsRoot())
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error, tag })
    return res.json(result)
  })

  app.post('/api/catalog/place-template', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    const result = placeTemplate(id, getFsRoot())
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error, id })
    return res.json(result)
  })
}
