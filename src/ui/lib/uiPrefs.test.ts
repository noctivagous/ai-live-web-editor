import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadUiPrefs, replaceUiPrefs, saveUiPrefs, validateUiPrefs, UI_PREFS_DEFAULTS } from './uiPrefs.js'

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

  it('preview mode defaults to follow, keeps an explicit marked', () => {
    assert.equal(UI_PREFS_DEFAULTS.filePreviewMode, 'follow')
    assert.equal(validateUiPrefs({}).filePreviewMode, 'follow')
    assert.equal(validateUiPrefs({ filePreviewMode: 'marked' }).filePreviewMode, 'marked')
    assert.equal(validateUiPrefs({ filePreviewMode: 'bogus' }).filePreviewMode, 'follow')
    const store = fakeStore()
    saveUiPrefs({ filePreviewMode: 'marked' }, store)
    assert.equal(loadUiPrefs(store).filePreviewMode, 'marked')
  })
})

describe('uiPrefs editor fields + replace', () => {
  it('validates editor options with clamps and current-behavior defaults', () => {
    const p = validateUiPrefs({ editorFontSize: 99, editorTabSize: 3, editorWordWrap: false, editorMinimap: true, editorLineNumbers: false })
    assert.equal(p.editorFontSize, 20)
    assert.equal(p.editorTabSize, 4)
    assert.equal(p.editorWordWrap, false)
    assert.equal(p.editorMinimap, true)
    assert.equal(p.editorLineNumbers, false)
    const d = validateUiPrefs({})
    assert.equal(d.editorFontSize, 13)
    assert.equal(d.editorWordWrap, true)
    assert.equal(d.editorMinimap, false)
  })

  it('replaceUiPrefs writes a whole validated record', () => {
    const store = fakeStore()
    saveUiPrefs({ chatView: 'panel' }, store)
    const next = replaceUiPrefs({ fileSort: 'modified', editorFontSize: 16 }, store)
    // A whole-record replace falls back to the DEFAULT chat view:
    // Stationary (the default changed from the scrolling chat by
    // the user's direction when the Stationary view landed).
    assert.equal(next.chatView, 'stationary')
    assert.equal(next.fileSort, 'modified')
    assert.equal(next.editorFontSize, 16)
    assert.deepEqual(loadUiPrefs(store), next)
  })
})

describe('uiPrefs theme fields', () => {
  it('defaults to dark-2020s at the default font size', () => {
    const d = validateUiPrefs({})
    assert.equal(d.uiTheme, 'dark-2020s')
    assert.equal(d.uiFontSize, 13)
  })

  it('keeps a valid theme and clamps the UI font size to 11–16', () => {
    assert.equal(validateUiPrefs({ uiTheme: 'dark-pro-classic' }).uiTheme, 'dark-pro-classic')
    assert.equal(validateUiPrefs({ uiTheme: 'gray-pro-classic' }).uiTheme, 'gray-pro-classic')
    assert.equal(validateUiPrefs({ uiTheme: 'vs-dark' }).uiTheme, 'dark-2020s')
    assert.equal(validateUiPrefs({ uiFontSize: 16 }).uiFontSize, 16)
    assert.equal(validateUiPrefs({ uiFontSize: 99 }).uiFontSize, 16)
    assert.equal(validateUiPrefs({ uiFontSize: 4 }).uiFontSize, 11)
    assert.equal(validateUiPrefs({ uiFontSize: 'big' }).uiFontSize, 13)
  })

  it('round-trips theme fields through the store', () => {
    const store = fakeStore()
    saveUiPrefs({ uiTheme: 'gray-pro-classic', uiFontSize: 15 }, store)
    const p = loadUiPrefs(store)
    assert.equal(p.uiTheme, 'gray-pro-classic')
    assert.equal(p.uiFontSize, 15)
  })
})

describe('uiPrefs shortcut overrides', () => {
  it('keeps valid overrides and drops unknown, fixed, and default-equal entries', () => {
    const p = validateUiPrefs({ shortcutOverrides: { fileRename: 'F4', deckNext: 'arrowright', nope: 'f9', chatSend: 'x', fileDelete: 'junk++' } })
    assert.deepEqual(p.shortcutOverrides, { fileRename: 'f4' })
    assert.deepEqual(validateUiPrefs({}).shortcutOverrides, {})
    assert.deepEqual(validateUiPrefs({ shortcutOverrides: 'nope' }).shortcutOverrides, {})
  })
})
