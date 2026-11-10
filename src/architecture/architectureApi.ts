import type { Express } from 'express'
import { getFsRoot } from '../launcher.js'
import {
  checkArchitecture, getArchitecture, getArchitectureGuide, saveArchitecture, saveArchitectureGuide,
} from './architecture.js'
import { archPackRefactorPlan, followArchPack, getArchPack, loadArchPacks, previewArchPack } from './archPacks.js'

/**
 * Architecture HTTP API, mounted on both servers (the
 * featureApi pattern). Writes go through the store's sanitize.
 */
export function mountArchitectureApi(app: Express) {
  app.get('/api/architecture', (_req, res) => {
    res.json({
      ok: true,
      declaration: getArchitecture(),
      guide: getArchitectureGuide(),
      report: checkArchitecture(),
    })
  })

  app.post('/api/architecture', (req, res) => {
    if (!req.body?.declaration || typeof req.body.declaration !== 'object') {
      return res.status(400).json({ ok: false, error: 'Expected { declaration }.' })
    }
    const declaration = saveArchitecture(req.body.declaration)
    if (!declaration) return res.status(422).json({ ok: false, error: 'That declaration did not validate.' })
    if (typeof req.body.guide === 'string') saveArchitectureGuide(req.body.guide)
    res.json({ ok: true, declaration, report: checkArchitecture(getFsRoot(), declaration) })
  })

  app.get('/api/architecture/packs', (_req, res) => {
    res.json({ ok: true, packs: loadArchPacks() })
  })

  app.post('/api/architecture/packs/preview', (req, res) => {
    const pack = getArchPack(typeof req.body?.id === 'string' ? req.body.id : '')
    if (!pack) return res.status(404).json({ ok: false, error: 'No architecture plan pack with that id.' })
    res.json({ ok: true, preview: previewArchPack(pack) })
  })

  app.post('/api/architecture/packs/follow', (req, res) => {
    const pack = getArchPack(typeof req.body?.id === 'string' ? req.body.id : '')
    if (!pack) return res.status(404).json({ ok: false, error: 'No architecture plan pack with that id.' })
    const declaration = followArchPack(pack)
    res.json({ ok: true, declaration, report: checkArchitecture() })
  })

  app.post('/api/architecture/packs/plan', (req, res) => {
    const pack = getArchPack(typeof req.body?.id === 'string' ? req.body.id : '')
    if (!pack) return res.status(404).json({ ok: false, error: 'No architecture plan pack with that id.' })
    const plan = archPackRefactorPlan(pack)
    res.json({ ok: true, plan: { slug: plan.slug, title: plan.title, tasks: plan.tasks.length } })
  })
}
