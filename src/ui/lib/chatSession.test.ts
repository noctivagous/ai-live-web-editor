import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { historyForAgent, parseChat, serializeChat, emptyChat, withStopped, STOPPED_TEXT, type LogItem } from './chatSession.js'

describe('chatSession', () => {
  it('round-trips a log and drops other projects', () => {
    const state = emptyChat('lumen')
    state.log = [
      { role: 'system', text: 'hi' },
      { role: 'user', text: 'make the h1 blue' },
      { role: 'ai', text: 'done' },
    ]
    const parsed = parseChat(JSON.parse(serializeChat(state)), 'lumen')
    assert.equal(parsed?.log.length, 3)
    assert.equal(parseChat(JSON.parse(serializeChat(state)), 'demo'), null)
  })

  it('builds agent history from prior user/ai turns plus the new prompt', () => {
    const log: LogItem[] = [
      { role: 'system', text: 'sys' },
      { role: 'user', text: 'hello' },
      { role: 'ai', text: 'hi' },
      { role: 'tools', steps: [{ id: '1', name: 'grep', detail: 'grep', status: 'done' }] },
    ]
    const messages = historyForAgent(log, 'again', '/App.jsx')
    assert.deepEqual(messages, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'again Current file: /App.jsx' },
    ])
  })

  it('marks running tools stopped and appends a single Stopped line', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'edit' },
      { role: 'tools', steps: [
        { id: '1', name: 'grep', detail: 'grep', status: 'done' },
        { id: '2', name: 'str-replace', detail: 'str-replace', status: 'running' },
      ] },
    ]
    const once = withStopped(log)
    const tools = once[1]
    assert.equal(tools.role, 'tools')
    if (tools.role === 'tools') {
      assert.equal(tools.steps[1].status, 'error')
      assert.equal(tools.steps[1].result, 'stopped')
    }
    const sys = once[once.length - 1]
    if (sys.role === 'system') assert.equal(sys.text, STOPPED_TEXT)
    else assert.fail('expected Stopped system line')
    assert.equal(withStopped(once).length, once.length)
  })
})
