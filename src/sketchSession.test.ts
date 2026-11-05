import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acceptState,
  appendPatchState,
  discardState,
  emptySketchState,
  parseSketchMode,
  recordLiveSketchPatch,
  resetSketchStateForTests,
  setModeState,
  setSketchMode,
  sketchWriteGuard,
  undoLastState,
  withSketchPreamble,
  getSketchState,
  type SketchPatch,
} from './sketchSession.js'

function patch(id: string): SketchPatch {
  return { id, selector: 'h1', op: 'text', before: { textContent: 'A' }, after: { text: 'B' }, ok: true }
}

describe('sketchSession', () => {
  it('parses mode', () => {
    assert.equal(parseSketchMode('sketch'), 'sketch')
    assert.equal(parseSketchMode('files'), 'files')
    assert.equal(parseSketchMode('nope'), null)
  })

  it('undoes last patch fail-closed on empty', () => {
    const empty = emptySketchState()
    const none = undoLastState(empty)
    assert.equal(none.undone, null)
    const one = appendPatchState(setModeState(empty, 'sketch'), patch('1'))
    const two = appendPatchState(one, patch('2'))
    const undone = undoLastState(two)
    assert.equal(undone.undone?.id, '2')
    assert.deepEqual(undone.state.patches.map((p) => p.id), ['1'])
  })

  it('discards in reverse and accept keeps the log', () => {
    let s = setModeState(emptySketchState(), 'sketch')
    s = appendPatchState(s, patch('1'))
    s = appendPatchState(s, patch('2'))
    const gone = discardState(s)
    assert.deepEqual(gone.undone.map((p) => p.id), ['2', '1'])
    assert.equal(gone.state.patches.length, 0)
    const kept = acceptState(s)
    assert.equal(kept.accepted, true)
    assert.equal(kept.patches.length, 2)
  })

  it('preamble only wraps messages', () => {
    const out = withSketchPreamble([{ role: 'user', content: 'blue' }]) as { role: string, content: string }[]
    assert.equal(out[0].role, 'system')
    assert.match(out[0].content, /Live sketch/)
    assert.equal(out[1].content, 'blue')
  })

  it('blocks writes only in sketch mode', () => {
    resetSketchStateForTests()
    assert.equal(sketchWriteGuard(), null)
    setSketchMode('sketch')
    assert.match(sketchWriteGuard()?.error || '', /Live sketch/)
    setSketchMode('files')
    assert.equal(sketchWriteGuard(), null)
    resetSketchStateForTests()
  })

  it('records live patches only in sketch mode and skips restore', () => {
    resetSketchStateForTests()
    recordLiveSketchPatch({ selector: 'h1', op: 'text', text: 'X' }, { ok: true, op: 'text', before: { textContent: 'Inbox' } })
    assert.equal(getSketchState().patches.length, 0)
    setSketchMode('sketch')
    recordLiveSketchPatch({ selector: 'h1', op: 'text', text: 'X' }, { ok: true, op: 'text', before: { textContent: 'Inbox' } })
    assert.equal(getSketchState().patches.length, 1)
    assert.equal(getSketchState().patches[0].before.textContent, 'Inbox')
    recordLiveSketchPatch({ selector: 'h1', op: 'restore' }, { ok: true, op: 'restore' })
    assert.equal(getSketchState().patches.length, 1)
    recordLiveSketchPatch(
      { selector: '#main', op: 'insert', html: '<button id="go">Go</button>', position: 'append' },
      { ok: true, op: 'insert', before: { parentSelector: '#main', childIndex: 0, outerHTML: '<button id="go">Go</button>' } },
    )
    assert.equal(getSketchState().patches[1].op, 'insert')
    assert.match(getSketchState().patches[1].detail || '', /insert/)
    resetSketchStateForTests()
  })
})
