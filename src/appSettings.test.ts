import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSettingsStore } from './appSettings.js'
import { UI_PREFS_DEFAULTS } from './ui/lib/uiPrefs.js'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-settings-'))
  return createSettingsStore(path.join(dir, 'test.db'))
}

describe('appSettings store', () => {
  it('starts empty, then round-trips uiPrefs with validation', () => {
    const s = tmpStore()
    assert.deepEqual(s.get(), { uiPrefs: null, editorTheme: null, setupDone: null })
    const merged = s.save({ uiPrefs: { uiTheme: 'nope', uiFontSize: 999 } })
    assert.equal(merged.uiPrefs?.uiTheme, UI_PREFS_DEFAULTS.uiTheme)
    assert.equal(merged.uiPrefs?.uiFontSize, 16)
    assert.deepEqual(s.get().uiPrefs, merged.uiPrefs)
  })

  it('merges partial uiPrefs over stored values', () => {
    const s = tmpStore()
    s.save({ uiPrefs: { uiTheme: 'dark-pro-classic' } })
    const merged = s.save({ uiPrefs: { fileSort: 'modified' } })
    assert.equal(merged.uiPrefs?.uiTheme, 'dark-pro-classic')
    assert.equal(merged.uiPrefs?.fileSort, 'modified')
  })

  it('stores editorTheme and setupDone with type checks', () => {
    const s = tmpStore()
    const merged = s.save({ editorTheme: 'vs-dark', setupDone: true })
    assert.equal(merged.editorTheme, 'vs-dark')
    assert.equal(merged.setupDone, true)
    // Junk is ignored, never stored.
    const again = s.save({ editorTheme: 42, setupDone: 'yes' })
    assert.equal(again.editorTheme, 'vs-dark')
    assert.equal(again.setupDone, true)
  })
})
