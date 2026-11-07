import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SHORTCUTS, comboFromEvent, effectiveCombo, findConflict, formatCombo, matchShortcut, normalizeCombo, sanitizeOverrides,
} from './shortcuts.js'

describe('shortcuts registry', () => {
  it('every editable default combo is canonical and unique within its scope', () => {
    const seen = new Map<string, string>()
    for (const s of SHORTCUTS) {
      if (!s.editable) continue
      assert.equal(normalizeCombo(s.combo), s.combo, s.id)
      const k = `${s.scope}:${s.combo}`
      assert.ok(!seen.has(k), `duplicate ${k}`)
      seen.set(k, s.id)
    }
  })

  it('comboFromEvent orders modifiers and normalizes keys; modifier-only presses are null', () => {
    assert.equal(comboFromEvent({ key: 'S', ctrlKey: true, shiftKey: true }), 'ctrl+shift+s')
    assert.equal(comboFromEvent({ key: 'F2' }), 'f2')
    assert.equal(comboFromEvent({ key: ' ' }), 'space')
    assert.equal(comboFromEvent({ key: 'Shift', shiftKey: true }), null)
    assert.equal(comboFromEvent({ key: 'Meta', metaKey: true }), null)
  })

  it('matchShortcut compares the full combo, modifiers included', () => {
    assert.ok(matchShortcut({ key: 'F2' }, 'f2'))
    assert.ok(!matchShortcut({ key: 'F2', shiftKey: true }, 'f2'))
    assert.ok(matchShortcut({ key: 'Delete' }, 'delete'))
  })

  it('normalizeCombo canonicalizes and rejects junk', () => {
    assert.equal(normalizeCombo('Shift+Ctrl+S'), 'ctrl+shift+s')
    assert.equal(normalizeCombo('esc'), 'escape')
    assert.equal(normalizeCombo('ctrl+shift'), null)
    assert.equal(normalizeCombo('banana+s'), null)
    assert.equal(normalizeCombo(42), null)
  })

  it('effectiveCombo prefers a valid override; sanitizeOverrides drops unknown/fixed/redundant entries', () => {
    assert.equal(effectiveCombo('fileRename', { fileRename: 'f4' }), 'f4')
    assert.equal(effectiveCombo('fileRename', { fileRename: 'junk++' }), 'f2')
    assert.equal(effectiveCombo('chatSend', { chatSend: 'x' }), 'enter')
    assert.deepEqual(
      sanitizeOverrides({ fileRename: 'f4', fileDelete: 'delete', nope: 'f9', chatSend: 'x' }),
      { fileRename: 'f4' },
    )
  })

  it('findConflict detects a same-scope clash, ignores other scopes', () => {
    assert.equal(findConflict('fileDelete', 'f2', {}), 'fileRename')
    assert.equal(findConflict('fileDelete', 'f4', {}), null)
    assert.equal(findConflict('deckNext', 'f2', {}), null)
    assert.equal(findConflict('fileRename', 'delete', { fileDelete: 'f9' }), null)
    assert.equal(findConflict('fileRename', 'f9', { fileDelete: 'f9' }), 'fileDelete')
  })

  it('formatCombo renders readable labels', () => {
    assert.equal(formatCombo('f2'), 'F2')
    assert.equal(formatCombo('arrowright'), '→')
    assert.equal(formatCombo('ctrl+shift+s'), 'Ctrl ⇧ S')
    assert.equal(formatCombo('meta+s'), '⌘ S')
    assert.equal(formatCombo('delete'), 'Del')
  })
})
