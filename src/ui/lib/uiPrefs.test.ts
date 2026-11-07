import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadUiPrefs, saveUiPrefs, validateUiPrefs, UI_PREFS_DEFAULTS } from './uiPrefs.js'

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
    data,
  }
}

describe('uiPrefs', () => {
  it('defaults when nothing is stored', () => {
    assert.deepEqual(loadUiPrefs(fakeStore()), UI_PREFS_DEFAULTS)
    assert.deepEqual(loadUiPrefs(null), UI_PREFS_DEFAULTS)
  })

  it('round-trips a patch and merges with stored values', () => {
    const store = fakeStore()
    saveUiPrefs({ chatView: 'panel' }, store)
    assert.equal(loadUiPrefs(store).chatView, 'panel')
    saveUiPrefs({ fileShowHidden: true }, store)
    const prefs = loadUiPrefs(store)
    assert.equal(prefs.chatView, 'panel')
    assert.equal(prefs.fileShowHidden, true)
    assert.equal(prefs.fileSort, 'name')
  })

  it('invalid stored values fall back per field, never throw', () => {
    assert.deepEqual(validateUiPrefs({ chatView: 'deck', fileSort: 'size', fileShowHidden: 'yes' }), UI_PREFS_DEFAULTS)
    assert.deepEqual(loadUiPrefs(fakeStore({ 'ai-live-editor.uiPrefs': '{not json' })), UI_PREFS_DEFAULTS)
    const partial = validateUiPrefs({ chatView: 'panel', fileSort: 'bogus' })
    assert.equal(partial.chatView, 'panel')
    assert.equal(partial.fileSort, 'name')
  })
})
