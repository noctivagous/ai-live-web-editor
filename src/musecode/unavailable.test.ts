import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatSseResponse } from '../chatStream.js'
import { musecodeUnavailableMessage, pipeMusecodeUnavailable } from './unavailable.js'

describe('musecodeUnavailableMessage', () => {
  it('names the missing binary when Muse Code is not on this machine', () => {
    const msg = musecodeUnavailableMessage(false)
    assert.match(msg, /not available on this machine/)
    // The install guidance rides along as text: the requirement
    // label and the product page (setup polish).
    assert.match(msg, /Requirement: Muse Code/)
    assert.match(msg, /https:\/\/dev\.meta\.ai\/products\/muse-code/)
  })
  it('names the not-ready engine when the binary is present', () => {
    const msg = musecodeUnavailableMessage(true)
    assert.match(msg, /not ready in this version of the editor yet/)
    assert.doesNotMatch(msg, /not available on this machine/)
  })
})

describe('pipeMusecodeUnavailable', () => {
  it('ends the stream with exactly one error event, in the usual event shape', async () => {
    const writes: string[] = []
    let ended = false
    const res = {
      setHeader: () => { /* no-op */ },
      write: (chunk: string) => { writes.push(chunk); return true },
      end: () => { ended = true },
    } as unknown as ChatSseResponse
    await pipeMusecodeUnavailable(res)
    assert.equal(ended, true, 'the stream ends — the turn never hangs')
    const events = writes
      .filter(w => w.startsWith('data: '))
      .map(w => JSON.parse(w.slice('data: '.length)) as { type: string, error?: string })
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'error')
    // Which of the two wordings depends on this machine's binary;
    // both are the designed plain answers.
    assert.ok(
      events[0].error === musecodeUnavailableMessage(true) || events[0].error === musecodeUnavailableMessage(false),
      `unexpected error text: ${events[0].error}`,
    )
  })
})
