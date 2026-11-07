import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyTurn,
  lastUserText,
  routeChatTurn,
  withContextBeforeLastUser,
  withSystemPreamble,
} from './workflowRoute.js'

describe('workflowRoute', () => {
  it('reads the last user text and strips Current file', () => {
    assert.equal(lastUserText([{ role: 'user', content: 'hello Current file: /App.jsx' }]), 'hello')
    assert.equal(lastUserText([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'add a test Current file: /x.ts' },
    ]), 'add a test')
  })

  it('classifies page, files, mixed, unknown', () => {
    assert.equal(classifyTurn('make the h1 blue'), 'page')
    assert.equal(classifyTurn('inspect the heading on the page'), 'page')
    assert.equal(classifyTurn('add a test for applyStrReplace in fsEdit.test.ts'), 'files')
    assert.equal(classifyTurn('scaffold a new file for the provider list'), 'files')
    assert.equal(classifyTurn('change the heading in App.jsx'), 'mixed')
    assert.equal(classifyTurn('fix it'), 'unknown')
  })

  it('auto-switches sketch to Files only for files-only turns', () => {
    const files = routeChatTurn('sketch', [{ role: 'user', content: 'add a unit test for grep' }])
    assert.equal(files.switched, true)
    assert.equal(files.mode, 'files')
    assert.equal(files.intent, 'files')
    assert.match(files.reason, /Files/)

    const page = routeChatTurn('sketch', [{ role: 'user', content: 'patch the h1 on the page' }])
    assert.equal(page.switched, false)
    assert.equal(page.mode, 'sketch')
    assert.equal(page.intent, 'page')

    const mixed = routeChatTurn('sketch', [{ role: 'user', content: 'make the h1 blue and edit App.jsx' }])
    assert.equal(mixed.switched, false)
    assert.equal(mixed.mode, 'sketch')
    assert.equal(mixed.intent, 'mixed')

    const stay = routeChatTurn('files', [{ role: 'user', content: 'make the h1 blue' }])
    assert.equal(stay.switched, false)
    assert.equal(stay.mode, 'files')
  })

  it('wraps a system preamble', () => {
    const out = withSystemPreamble('routed', [{ role: 'user', content: 'x' }]) as { role: string, content: string }[]
    assert.equal(out[0].content, 'routed')
    assert.equal(out[1].content, 'x')
  })

  it('inserts turn context before the newest user message, history untouched ahead of it', () => {
    const history = [
      { role: 'user', content: 'first ask' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second ask' },
    ]
    const out = withContextBeforeLastUser(['brief', 'map'], history) as { role: string, content: string }[]
    assert.deepEqual(out.map((m) => m.content), ['first ask', 'done', 'brief', 'map', 'second ask'])
    assert.deepEqual(out.slice(2, 4).map((m) => m.role), ['system', 'system'])
    // The input array is not mutated.
    assert.equal(history.length, 3)
  })

  it('prepends when there is no user message, and no-ops on empty context', () => {
    const noUser = [{ role: 'assistant', content: 'hi' }]
    const out = withContextBeforeLastUser(['brief'], noUser) as { role: string, content: string }[]
    assert.deepEqual(out.map((m) => m.content), ['brief', 'hi'])
    const msgs = [{ role: 'user', content: 'x' }]
    assert.equal(withContextBeforeLastUser([], msgs), msgs)
    assert.equal(withContextBeforeLastUser(['', ''], msgs), msgs)
  })
})
