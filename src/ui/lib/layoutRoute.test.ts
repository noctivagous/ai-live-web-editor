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

  it('graph report and diagram routes parse under the features facet', () => {
    assert.deepEqual(parseRoute('#/facets/features/graph/report'), { kind: 'facets', facet: 'features', view: 'graph-report' })
    assert.deepEqual(parseRoute('#/facets/features/graph/diagram'), { kind: 'facets', facet: 'features', view: 'graph-diagram' })
    // A bare /graph lands on the report — the current viewer.
    assert.deepEqual(parseRoute('#/facets/features/graph'), { kind: 'facets', facet: 'features', view: 'graph-report' })
  })

  it('graph routes format and round-trip', () => {
    assert.equal(formatRoute({ kind: 'facets', facet: 'features', view: 'graph-report' }), '#/facets/features/graph/report')
    assert.equal(formatRoute({ kind: 'facets', facet: 'features', view: 'graph-diagram' }), '#/facets/features/graph/diagram')
    assert.deepEqual(parseRoute('#/facets/features/graph/diagram'), { kind: 'facets', facet: 'features', view: 'graph-diagram' })
  })

  it('graph views outside the features facet are ignored', () => {
    assert.deepEqual(parseRoute('#/facets/styles/graph/report'), { kind: 'facets', facet: 'styles' })
    assert.deepEqual(parseRoute('#/facets/features/graph/bogus'), { kind: 'facets', facet: 'features' })
  })

  it('a settings modal query parses on any layout and round-trips', () => {
    assert.deepEqual(
      parseRoute('#/facets/features/graph/report?globalModal=settings&tab=providers'),
      { kind: 'facets', facet: 'features', view: 'graph-report', modal: { name: 'settings', tab: 'providers' } },
    )
    assert.deepEqual(
      parseRoute('#/workbench?globalModal=settings&tab=themes'),
      { kind: 'workbench', modal: { name: 'settings', tab: 'themes' } },
    )
    assert.equal(
      formatRoute({ kind: 'workbench', modal: { name: 'settings', tab: 'providers' } }),
      '#/workbench?globalModal=settings&tab=providers',
    )
  })

  it('unknown modal queries are ignored, keeping the route', () => {
    assert.deepEqual(parseRoute('#/workbench?globalModal=bogus&tab=x'), { kind: 'workbench' })
    assert.deepEqual(parseRoute('#/facets/features?tab=providers'), { kind: 'facets', facet: 'features' })
  })

  it('a file file query parses on any layout and round-trips', () => {
    assert.deepEqual(parseRoute('#/workbench?file=%2Fxyz.txt'), { kind: 'workbench', file: '/xyz.txt' })
    assert.deepEqual(
      parseRoute('#/facets/features/graph/report?file=%2Fnotes.md&globalModal=settings&tab=providers'),
      { kind: 'facets', facet: 'features', view: 'graph-report', file: '/notes.md', modal: { name: 'settings', tab: 'providers' } },
    )
    assert.equal(formatRoute({ kind: 'workbench', file: '/xyz.txt' }), '#/workbench?file=%2Fxyz.txt')
  })

  it('an empty file is ignored', () => {
    assert.deepEqual(parseRoute('#/workbench?file='), { kind: 'workbench' })
  })
})
