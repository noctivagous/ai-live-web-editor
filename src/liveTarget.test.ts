import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { agentLayoutSnapshotResult } from './liveTarget.js'

describe('agentLayoutSnapshotResult', () => {
  const full = {
    via: 'vite-page',
    schemaVersion: 1,
    elementCount: 2,
    viewport: { width: 1280, height: 800 },
    elements: [{ selector: 'div.card' }, { selector: 'p' }],
    analysis: { overlaps: [{ a: 'div.card' }] },
    elapsedMs: 12,
    fallback: false,
    snapshot: {
      page: { url: 'http://localhost:5173/', title: 'App', viewport: { width: 1280, height: 800 } },
      elements: [{ selector: 'div.card' }, { selector: 'p' }],
      analysis: { overlaps: [{ a: 'div.card' }] },
      computedStyleWhitelist: ['display'],
    },
  }

  it('drops the duplicated full snapshot, keeps summary + elements + analysis', () => {
    const out = agentLayoutSnapshotResult(full) as Record<string, unknown>
    assert.equal('snapshot' in out, false)
    assert.equal(out.via, 'vite-page')
    assert.deepEqual(out.viewport, { width: 1280, height: 800 })
    assert.equal(out.elementCount, 2)
    assert.deepEqual(out.elements, full.elements)
    assert.deepEqual(out.analysis, full.analysis)
    assert.equal(out.elapsedMs, 12)
  })

  it('halves the serialized size of a representative result', () => {
    const before = JSON.stringify(full).length
    const after = JSON.stringify(agentLayoutSnapshotResult(full)).length
    assert.ok(after < before * 0.75, `expected a real cut, got ${before} -> ${after}`)
  })

  it('does not mutate the input (internal callers still need the full object)', () => {
    agentLayoutSnapshotResult(full)
    assert.ok('snapshot' in full)
  })

  it('passes errors and snapshot-less results through unchanged', () => {
    const err = { error: 'pool is off' }
    assert.equal(agentLayoutSnapshotResult(err), err)
    const plain = { via: 'playwright', elements: [] }
    assert.equal(agentLayoutSnapshotResult(plain), plain)
    assert.equal(agentLayoutSnapshotResult(null), null)
    assert.equal(agentLayoutSnapshotResult('nope'), 'nope')
  })
})
