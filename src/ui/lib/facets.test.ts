import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FACETS, FACET_BLURBS, FACET_IDS, FACET_TITLES, facetById, isFacetId, projectFacets, sectionsForFacet } from './facets.js'

describe('facet registry', () => {
  it('order is Overview (the home) first, then the facets in design order', () => {
    assert.deepEqual(FACET_IDS, ['overview', 'features', 'architecture', 'graphic-design', 'tech-stack', 'configuration', 'delivery'])
    assert.equal(FACETS[0].home, true)
    assert.deepEqual(projectFacets().map(f => f.id), ['features', 'architecture', 'graphic-design', 'tech-stack', 'configuration', 'delivery'])
  })

  it('every facet is complete: title, blurb, unique sections', () => {
    for (const f of FACETS) {
      assert.equal(FACET_TITLES[f.id], f.title)
      assert.equal(FACET_BLURBS[f.id], f.blurb)
      assert.ok(f.title.length > 0 && f.blurb.length > 0, `${f.id} is incomplete`)
      const ids = new Set<string>()
      for (const s of f.sections) {
        assert.ok(!ids.has(s.id), `${f.id} repeats section ${s.id}`)
        ids.add(s.id)
        assert.ok(s.title.length > 0, `${f.id}/${s.id} has no title`)
      }
    }
  })

  it('there is no styles facet — the rename is clean, with no alias', () => {
    assert.equal(isFacetId('styles'), false)
    assert.equal(isFacetId('graphic-design'), true)
    assert.equal(facetById('graphic-design').title, 'Graphic Design')
  })

  it('delivery sections are the design §13 sections as §13.8 amends them — git, tests, ci, deployment — plus actions and wizards', () => {
    assert.deepEqual(
      sectionsForFacet('delivery').map(s => s.id),
      ['git', 'tests', 'ci', 'deployment', 'actions', 'wizards'],
    )
    assert.equal(facetById('delivery').title, 'Delivery')
  })

  it('graphic design sections are the design §3.1 areas, plus actions and wizards', () => {
    assert.deepEqual(
      sectionsForFacet('graphic-design').map(s => s.id),
      ['guide', 'tokens', 'typography', 'layout', 'icons', 'gui-guide', 'graph', 'packs', 'actions', 'wizards'],
    )
  })
})
