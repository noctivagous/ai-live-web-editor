/**
 * Codebase map API (TASKS-token-efficiency §1): the UI/agent-visible
 * surface for the map and the opt-in Adopt action.
 * GET  /api/codebase-map           -> { map, formatted }
 * POST /api/codebase-map/adopt     -> write .ai-live/components.json
 * POST /api/codebase-map/install   -> { tag } copy-own catalog install
 * Mounted on both servers like the other project APIs.
 */
import type { Express } from 'express'
import { getFsRoot } from '../launcher.js'
import { formatCodebaseMap } from './codebaseMap.js'
import { adoptRegistry, buildAndPersistMap, installCatalogComponent } from './mapStore.js'

export function mountCodebaseMapApi(app: Express) {
  app.get('/api/codebase-map', (_req, res) => {
    const map = buildAndPersistMap(getFsRoot())
    res.json({ ok: true, map, formatted: formatCodebaseMap(map) })
  })

  app.post('/api/codebase-map/adopt', (_req, res) => {
    const result = adoptRegistry(getFsRoot())
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error })
    return res.json(result)
  })

  app.post('/api/codebase-map/install', (req, res) => {
    const tag = typeof req.body?.tag === 'string' ? req.body.tag : ''
    if (!tag) return res.status(400).json({ ok: false, error: 'tag required' })
    const result = installCatalogComponent(tag, getFsRoot())
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error, tag })
    return res.json(result)
  })
}
