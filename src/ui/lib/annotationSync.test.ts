import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  emptyAnnotationDigest,
  parseAnnotationDigest,
  annotationDigestsEqual,
  publishAnnotations,
  subscribeAnnotations,
  loadAnnotationDigest,
} from './annotationSync.js'

describe('annotationSync digest', () => {
  it('round-trips a digest and rejects junk', () => {
    const digest = {
      ...emptyAnnotationDigest(),
      selection: 'h1',
      annotations: [{ id: 'a1', selector: 'h1', abbr: 'h1', text: 'blue' }],
      pageNote: { present: true, len: 5, abbr: 'hello' },
    }
    const parsed = parseAnnotationDigest(JSON.parse(JSON.stringify(digest)))
    assert.deepEqual(parsed?.annotations.length, 1)
    assert.equal(parseAnnotationDigest(null), null)
    assert.equal(parseAnnotationDigest({ nope: true }), null)
  })

  it('keeps the optional React component tag and compares it', () => {
    const withComp = {
      ...emptyAnnotationDigest(),
      annotations: [{ id: 'a1', selector: 'h1', abbr: 'h1', text: 'blue', component: 'Hero' }],
    }
    const parsed = parseAnnotationDigest(JSON.parse(JSON.stringify(withComp)))
    assert.equal(parsed?.annotations[0].component, 'Hero')
    assert.equal(annotationDigestsEqual(withComp, emptyAnnotationDigest()), false)
    assert.equal(annotationDigestsEqual(withComp, { ...withComp }), true)
    const dropped = parseAnnotationDigest({ v: 1, at: 0, selection: null, annotations: [{ id: 'a1', selector: 'h1', abbr: 'h1', text: 'blue', component: 42 }], pageNote: { present: false, len: 0, abbr: '' } })
    assert.equal(dropped?.annotations[0].component, undefined)
  })

  it('notices selection, annotation, and note changes', () => {
    const a = emptyAnnotationDigest()
    assert.equal(annotationDigestsEqual(a, emptyAnnotationDigest()), true)
    assert.equal(annotationDigestsEqual(a, { ...a, selection: 'h1' }), false)
    assert.equal(
      annotationDigestsEqual(a, { ...a, annotations: [{ id: 'x', selector: 'p', abbr: 'p', text: 't' }] }),
      false,
    )
    assert.equal(
      annotationDigestsEqual(a, { ...a, pageNote: { present: true, len: 3, abbr: 'hey' } }),
      false,
    )
  })

  it('notifies every Chat instance when the embed relays a page change', async () => {
    if (typeof BroadcastChannel === 'undefined') return
    let sidebar = 0
    let overlay = 0
    const offA = subscribeAnnotations(() => { sidebar += 1 })
    const offB = subscribeAnnotations(() => { overlay += 1 })
    try {
      publishAnnotations({ ...emptyAnnotationDigest(), selection: 'h1' })
      const deadline = Date.now() + 1000
      while ((sidebar === 0 || overlay === 0) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20))
      }
      assert.equal(sidebar >= 1, true)
      assert.equal(overlay >= 1, true)
      // Late joiners read the persisted digest.
      assert.equal(loadAnnotationDigest()?.selection, 'h1')
    } finally {
      offA()
      offB()
    }
  })
})
