import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { annotateUnavailableReason, digestToAnnotateMenu } from './previewAnnotate.js'
import { emptyAnnotationDigest } from './annotationSync.js'
import type { PluginEnsureInfo } from './api.js'

function ensure(state: PluginEnsureInfo['state'], extra: Partial<PluginEnsureInfo> = {}): PluginEnsureInfo {
  return { state, ...extra }
}

describe('annotateUnavailableReason', () => {
  it('names the dead server before any plugin state', () => {
    assert.match(annotateUnavailableReason(ensure('registered'), 'down'), /not connected/)
    assert.match(annotateUnavailableReason(ensure('cannot'), 'down'), /not connected/)
    assert.match(annotateUnavailableReason(null, 'down'), /:5173/)
  })

  it('points at the config and the notice when ensure could not add the plugin', () => {
    const reason = annotateUnavailableReason(ensure('cannot', { configFile: 'vite.config.ts' }), 'up')
    assert.match(reason, /not in this project's vite config \(vite\.config\.ts\)/)
    assert.match(reason, /notice above the preview/)
  })

  it('points at re-enabling when the user declined the plugin', () => {
    assert.match(annotateUnavailableReason(ensure('missing-declined'), 'up'), /off for this project/)
  })

  it('says there is no live page for a non-Vite project', () => {
    assert.match(annotateUnavailableReason(ensure('not-vite'), 'up'), /no live Vite page/)
  })

  it('falls back to a still-loading explanation when the plugin should be there', () => {
    for (const state of ['registered', 'added', 'standalone'] as const) {
      assert.match(annotateUnavailableReason(ensure(state), 'up'), /did not answer/)
    }
    assert.match(annotateUnavailableReason(null, 'unknown'), /did not answer/)
  })
})

describe('digestToAnnotateMenu', () => {
  it('maps digest items to menu rows and counts them', () => {
    const digest = {
      ...emptyAnnotationDigest(),
      annotations: [
        { id: 'a1', selector: 'h1', abbr: 'h1', text: 'make it blue' },
        { id: 'a2', selector: '', abbr: '▦ Card', text: 'Place Card (~320×200) at (10, 20)' },
      ],
      pageNote: { present: true, len: 42, abbr: 'overall it feels cramped' },
    }
    const menu = digestToAnnotateMenu(digest)
    assert.equal(menu.count, 2)
    assert.deepEqual(menu.anns[0], { selector: 'h1', text: 'make it blue', id: 'a1' })
    assert.deepEqual(menu.anns[1], { selector: '', text: 'Place Card (~320×200) at (10, 20)', id: 'a2' })
    assert.equal(menu.pageNotePresent, true)
    assert.equal(menu.pageNoteAbbr, 'overall it feels cramped')
  })

  it('handles the empty digest', () => {
    const menu = digestToAnnotateMenu(emptyAnnotationDigest())
    assert.equal(menu.count, 0)
    assert.deepEqual(menu.anns, [])
    assert.equal(menu.pageNotePresent, false)
    assert.equal(menu.pageNoteAbbr, '')
  })
})
