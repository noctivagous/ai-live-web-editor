import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diagramAnchors, diagramCanvasLayout, diagramContentBounds, diagramEdgeMid, diagramEdgePath, diagramEdgesFor, diagramFitView, diagramGroups, diagramRegionAt, diagramZoomAt, diagramZoomStep, type DiagramNode } from './graphDiagram.js'

const n = (id: string, kind: string, parent?: string): DiagramNode => ({ id, name: id, kind, status: 'planned', ...(parent ? { parent } : {}) })

describe('diagramGroups', () => {
  it('boxes non-region nodes under their nearest region ancestor, flattening nesting', () => {
    const nodes = [n('r1', 'region'), n('f1', 'feature', 'r1'), n('s1', 'screen', 'f1'), n('r2', 'region'), n('f2', 'feature', 'r2'), n('loose', 'feature')]
    const groups = diagramGroups(nodes)
    assert.deepEqual(groups.map(g => g.region?.id ?? null), ['r1', 'r2', null])
    assert.deepEqual(groups[0].nodes.map(x => x.id), ['f1', 's1'])
    assert.deepEqual(groups[1].nodes.map(x => x.id), ['f2'])
    assert.deepEqual(groups[2].nodes.map(x => x.id), ['loose'])
  })

  it('omits the top-level box when everything is contained', () => {
    const groups = diagramGroups([n('r1', 'region'), n('f1', 'feature', 'r1')])
    assert.equal(groups.length, 1)
  })

  it('survives parent cycles and dangling parents without hanging', () => {
    const groups = diagramGroups([n('a', 'feature', 'b'), n('b', 'feature', 'a'), n('c', 'feature', 'gone')])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].region, null)
    assert.deepEqual(groups[0].nodes.map(x => x.id), ['a', 'b', 'c'])
  })
})

describe('diagram geometry', () => {
  it('edge paths are horizontal cubics bowing with distance', () => {
    assert.equal(diagramEdgePath({ x: 0, y: 10 }, { x: 200, y: 30 }), 'M 0 10 C 100 10, 100 30, 200 30')
    assert.equal(diagramEdgePath({ x: 0, y: 0 }, { x: 30, y: 0 }), 'M 0 0 C 40 0, -10 0, 30 0')
  })

  it('the label midpoint sits on the curve', () => {
    const mid = diagramEdgeMid({ x: 0, y: 0 }, { x: 200, y: 100 })
    assert.equal(mid.x, 100)
    assert.equal(mid.y, 50)
  })

  it('anchors join the facing sides of two cards', () => {
    const a = { left: 0, top: 0, width: 100, height: 40 }
    const b = { left: 300, top: 60, width: 100, height: 40 }
    assert.deepEqual(diagramAnchors(a, b), { from: { x: 100, y: 20 }, to: { x: 300, y: 80 } })
    assert.deepEqual(diagramAnchors(b, a), { from: { x: 300, y: 80 }, to: { x: 100, y: 20 } })
  })

  it('edgesFor returns edges in either direction', () => {
    const edges = [{ from: 'a', to: 'b', type: 'renders' }, { from: 'c', to: 'a', type: 'configures' }, { from: 'b', to: 'c', type: 'renders' }]
    assert.deepEqual(diagramEdgesFor(edges, 'a').map(e => e.type), ['renders', 'configures'])
    assert.deepEqual(diagramEdgesFor(edges, 'nope'), [])
  })
})

describe('diagramCanvasLayout', () => {
  it('seeds regions from the origin and grids cards under their headers', () => {
    const nodes = [n('r1', 'region'), n('a', 'feature', 'r1'), n('b', 'feature', 'r1'), n('c', 'feature', 'r1'), n('loose', 'feature')]
    const { regions, cards } = diagramCanvasLayout(diagramGroups(nodes))
    assert.deepEqual({ x: regions.r1.x, y: regions.r1.y }, { x: 32, y: 32 })
    // Cards start below the region header, inside the box.
    assert.ok(cards.a.x >= regions.r1.x && cards.a.y >= regions.r1.y + 38)
    assert.ok(cards.c.x + 164 <= regions.r1.x + regions.r1.w)
    // The top-level box follows the region on the same row.
    assert.ok(regions[''].x > regions.r1.x)
    assert.equal(regions[''].y, 32)
  })

  it('regionAt finds the containing box, smallest on overlap, null on bare canvas', () => {
    const regions = { r1: { x: 0, y: 0, w: 400, h: 300 }, r2: { x: 10, y: 10, w: 100, h: 80 }, '': { x: 500, y: 0, w: 200, h: 200 } }
    assert.equal(diagramRegionAt(regions, 50, 50), 'r2')
    assert.equal(diagramRegionAt(regions, 300, 200), 'r1')
    assert.equal(diagramRegionAt(regions, 600, 100), '')
    assert.equal(diagramRegionAt(regions, 900, 900), null)
  })
})

describe('diagram view math (the prototype formulas)', () => {
  it('zoom-at keeps the world point under the cursor fixed on screen', () => {
    const view = { x: 10, y: 20, k: 1 }
    const at = { x: 300, y: 200 }
    const world = { x: (at.x - view.x) / view.k, y: (at.y - view.y) / view.k }
    const zoomed = diagramZoomAt(view, at, 1.1)
    assert.ok(Math.abs(zoomed.k - 1.1) < 1e-9)
    // Screen position of that world point is unchanged.
    assert.ok(Math.abs(world.x * zoomed.k + zoomed.x - at.x) < 1e-9)
    assert.ok(Math.abs(world.y * zoomed.k + zoomed.y - at.y) < 1e-9)
  })

  it('zoom clamps at 0.2 and 2.5 for both wheel and steps', () => {
    assert.equal(diagramZoomAt({ x: 0, y: 0, k: 2.5 }, { x: 0, y: 0 }, 1.1).k, 2.5)
    assert.equal(diagramZoomAt({ x: 0, y: 0, k: 0.2 }, { x: 0, y: 0 }, 0.9).k, 0.2)
    assert.equal(diagramZoomStep({ x: 5, y: 6, k: 1 }, 1).k, 1.2)
    assert.deepEqual(diagramZoomStep({ x: 5, y: 6, k: 1 }, -1), { x: 5, y: 6, k: 1 / 1.2 })
  })

  it('content bounds union regions and cards; empty is the default stage', () => {
    const b = diagramContentBounds({ r: { x: 32, y: 32, w: 300, h: 120 } }, { a: { x: 40, y: 200 } })
    assert.deepEqual(b, { x: 32, y: 32, w: 300, h: 200 + 54 - 32 })
    assert.deepEqual(diagramContentBounds({}, {}), { x: 0, y: 0, w: 800, h: 600 })
  })

  it('fit view scales bounds into the viewport and centers them', () => {
    const v = diagramFitView({ x: 32, y: 32, w: 800, h: 600 }, 848, 648)
    assert.equal(v.k, 1)
    assert.equal(v.x, (848 - 800) / 2 - 32)
    assert.equal(v.y, (648 - 600) / 2 - 32)
    // A huge graph zooms out, capped at 1.15 for a small one.
    assert.ok(diagramFitView({ x: 0, y: 0, w: 8000, h: 6000 }, 848, 648).k < 0.2 + 0.001)
    assert.equal(diagramFitView({ x: 0, y: 0, w: 100, h: 80 }, 848, 648).k, 1.15)
  })
})
