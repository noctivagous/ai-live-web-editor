import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSettingsExport, chatSessionKeys, parseSettingsImport } from './settingsData.js'
import { UI_PREFS_DEFAULTS } from './uiPrefs.js'

describe('settingsData', () => {
  it('export carries validated prefs and the project config, no secrets by construction', () => {
    const out = buildSettingsExport({ ...UI_PREFS_DEFAULTS, editorFontSize: 99 }, { type: 'web-app', planLevel: 2 }, new Date('2026-11-06T00:00:00Z'))
    assert.equal(out.app, 'ai-live-editor-settings')
    assert.equal(out.prefs.editorFontSize, 20)
    assert.deepEqual(out.project, { type: 'web-app', planLevel: 2 })
    assert.equal(out.exportedAt, '2026-11-06T00:00:00.000Z')
    assert.ok(!JSON.stringify(out).includes('apiKey'))
  })

  it('import round-trips an export and filters unknown project keys', () => {
    const text = JSON.stringify(buildSettingsExport({ ...UI_PREFS_DEFAULTS, chatView: 'panel' }, { type: 'game', evil: 'x' } as never))
    const parsed = parseSettingsImport(text)
    assert.equal(parsed.prefs.chatView, 'panel')
    assert.deepEqual(parsed.project, { type: 'game' })
  })

  it('import rejects non-exports with readable errors', () => {
    assert.throws(() => parseSettingsImport('{oops'), /not valid JSON/)
    assert.throws(() => parseSettingsImport('{"app":"other"}'), /not an AI Live Editor settings export/)
    assert.throws(() => parseSettingsImport('{"app":"ai-live-editor-settings"}'), /no device settings/)
  })

  it('chatSessionKeys matches only chat session entries', () => {
    assert.deepEqual(
      chatSessionKeys(['ai-live-editor.chat.default', 'ai-live-editor.uiPrefs', 'ai-live-editor.chat.lumen', 'other']),
      ['ai-live-editor.chat.default', 'ai-live-editor.chat.lumen'],
    )
  })
})
