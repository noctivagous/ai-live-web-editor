import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickPageResult } from './pageBridge.js'

describe('pickPageResult', () => {
  it('prefers a successful iframe result over a top window', () => {
    const picked = pickPageResult([
      { ok: true, frame: 'top', text: 'wrong', before: { textContent: '' } },
      { ok: true, frame: 'iframe', text: 'Inbox', before: { textContent: 'Inbox' } },
    ]) as { frame: string, before: { textContent: string } }
    assert.equal(picked.frame, 'iframe')
    assert.equal(picked.before.textContent, 'Inbox')
  })

  it('falls back to any ok result, then the first payload', () => {
    const ok = pickPageResult([
      { ok: false, error: 'Selector not found' },
      { ok: true, frame: 'top', text: 'Inbox' },
    ]) as { text: string }
    assert.equal(ok.text, 'Inbox')
    const fail = pickPageResult([{ ok: false, error: 'nope' }]) as { error: string }
    assert.equal(fail.error, 'nope')
    const empty = pickPageResult([]) as { error: string }
    assert.match(empty.error, /No live Vite page/)
  })
})
