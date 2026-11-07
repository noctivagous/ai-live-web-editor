import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FACET_IDS, formatRoute, parseRoute } from './layoutRoute.js'

describe('layoutRoute', () => {
  it('bare and unknown hashes land on the workbench (the standing default)', () => {
    assert.deepEqual(parseRoute(''), { kind: 'workbench' })
    assert.deepEqual(parseRoute('#'), { kind: 'workbench' })
    assert.deepEqual(parseRoute('#/'), { kind: 'workbench' })
    assert.deepEqual(parseRoute('#/workbench'), { kind: 'workbench' })
    assert.deepEqual(parseRoute('#/nonsense'), { kind: 'workbench' })
  })

  it('facet routes parse, and a bare facets route lands on Features', () => {
    for (const f of FACET_IDS) {
      assert.deepEqual(parseRoute(`#/facets/${f}`), { kind: 'facets', facet: f })
    }
    assert.deepEqual(parseRoute('#/facets'), { kind: 'facets', facet: 'features' })
    assert.deepEqual(parseRoute('#/facets/bogus'), { kind: 'facets', facet: 'features' })
    assert.deepEqual(parseRoute('#/facets/styles/'), { kind: 'facets', facet: 'styles' })
  })

  it('format and parse round-trip', () => {
    assert.equal(formatRoute({ kind: 'workbench' }), '#/workbench')
    for (const f of FACET_IDS) {
      const layout = { kind: 'facets', facet: f } as const
      assert.equal(formatRoute(layout), `#/facets/${f}`)
      assert.deepEqual(parseRoute(formatRoute(layout)), layout)
    }
    assert.deepEqual(parseRoute(formatRoute({ kind: 'workbench' })), { kind: 'workbench' })
  })
})
