import type { Express } from 'express'
import { getFsRoot } from '../launcher.js'
import { addCrossLink, getCrossLinks, removeCrossLink, resolveCrossLinks, type CrossLinkKind } from './crossLinks.js'
import { runFacetCriteria, type FacetCriteriaId } from './facetCriteria.js'

const KINDS: CrossLinkKind[] = ['uses-component', 'requires-package', 'needs-config', 'follows-rule', 'styled-by']
const CRITERIA_FACETS: FacetCriteriaId[] = ['architecture', 'graphic-design', 'configuration', 'tech-stack', 'delivery']

/** Cross-facet links + per-facet criteria API (§8), mounted on
 * both servers. */
export function mountCrossLinksApi(app: Express) {
  app.get('/api/cross-links', (_req, res) => {
    res.json({ ok: true, links: resolveCrossLinks() })
  })

  app.post('/api/cross-links', (req, res) => {
    const kind = KINDS.find(k => k === req.body?.kind)
    const from = typeof req.body?.from === 'string' ? req.body.from : ''
    const to = typeof req.body?.to === 'string' ? req.body.to : ''
    if (!kind || !from || !to) return res.status(400).json({ ok: false, error: 'Expected { kind, from, to } with a known kind.' })
    const file = addCrossLink({ kind, from, to, ...(typeof req.body?.note === 'string' ? { note: req.body.note } : {}) })
    res.json({ ok: true, links: resolveCrossLinks(getFsRoot(), file) })
  })

  app.post('/api/cross-links/remove', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    if (!id) return res.status(400).json({ ok: false, error: 'Expected { id }.' })
    const file = removeCrossLink(id)
    res.json({ ok: true, links: resolveCrossLinks(getFsRoot(), file) })
  })

  app.get('/api/facet-criteria/:facet', (req, res) => {
    const facet = CRITERIA_FACETS.find(f => f === req.params.facet)
    if (!facet) return res.status(404).json({ ok: false, error: 'No criteria set for that facet.' })
    res.json({ ok: true, run: runFacetCriteria(facet) })
  })
}
