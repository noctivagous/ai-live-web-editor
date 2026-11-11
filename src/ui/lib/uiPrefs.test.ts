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

  it('museSandboxPosture defaults to unblocked, validates, and round-trips', () => {
    assert.equal(UI_PREFS_DEFAULTS.museSandboxPosture, 'unblocked')
    assert.equal(validateUiPrefs({}).museSandboxPosture, 'unblocked')
    assert.equal(validateUiPrefs({ museSandboxPosture: 'strict' }).museSandboxPosture, 'strict')
    assert.equal(validateUiPrefs({ museSandboxPosture: 'sandboxed' }).museSandboxPosture, 'sandboxed')
    assert.equal(validateUiPrefs({ museSandboxPosture: 'yolo' }).museSandboxPosture, 'unblocked', 'a junk stored posture falls back to the default')
    const store = fakeStore()
    saveUiPrefs({ museSandboxPosture: 'strict' }, store)
    assert.equal(loadUiPrefs(store).museSandboxPosture, 'strict')
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
    assert.equal(validateUiPrefs({}).menuLayout, 'grid')
    assert.equal(validateUiPrefs({ menuLayout: 'list' }).menuLayout, 'list')
    assert.equal(validateUiPrefs({ menuLayout: 'bogus' }).menuLayout, 'grid')
  })

  it('headerBar defaults to buttons, validates, and honors the legacy toggle', () => {
    assert.equal(validateUiPrefs({}).headerBar, 'buttons')
    assert.equal(validateUiPrefs({ headerBar: 'classic' }).headerBar, 'classic')
    assert.equal(validateUiPrefs({ headerBar: 'both' }).headerBar, 'both')
    assert.equal(validateUiPrefs({ headerBar: 'bogus' }).headerBar, 'buttons')
    // Legacy menuStrip: on meant strip + buttons; off/absent is buttons.
    assert.equal(validateUiPrefs({ menuStrip: true }).headerBar, 'both')
    assert.equal(validateUiPrefs({ menuStrip: false }).headerBar, 'buttons')
    assert.equal(validateUiPrefs({ headerBar: 'classic', menuStrip: true }).headerBar, 'classic')
  })

  it('menuDescriptions is on unless explicitly false', () => {
    assert.equal(validateUiPrefs({}).menuDescriptions, true)
    assert.equal(validateUiPrefs({ menuDescriptions: false }).menuDescriptions, false)
    assert.equal(validateUiPrefs({ menuDescriptions: 'yes' }).menuDescriptions, true)
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
  it('defaults to gray-pro-classic at 14px', () => {
    const d = validateUiPrefs({})
    assert.equal(d.uiTheme, 'gray-pro-classic')
    assert.equal(d.uiFontSize, 14)
  })

  it('keeps a valid theme and clamps the UI font size to 11–16', () => {
    assert.equal(validateUiPrefs({ uiTheme: 'dark-pro-classic' }).uiTheme, 'dark-pro-classic')
    assert.equal(validateUiPrefs({ uiTheme: 'gray-pro-classic' }).uiTheme, 'gray-pro-classic')
    assert.equal(validateUiPrefs({ uiTheme: 'vs-dark' }).uiTheme, 'gray-pro-classic')
    assert.equal(validateUiPrefs({ uiFontSize: 16 }).uiFontSize, 16)
    assert.equal(validateUiPrefs({ uiFontSize: 99 }).uiFontSize, 16)
    assert.equal(validateUiPrefs({ uiFontSize: 4 }).uiFontSize, 11)
    assert.equal(validateUiPrefs({ uiFontSize: 'big' }).uiFontSize, 14)
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
