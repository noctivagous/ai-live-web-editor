import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bootStopped, casWinner, createSendGuard, emptyChat, historyForAgent, parseChat, rebaseLocalUserItems, serializeChat, withStopped, STOPPED_TEXT, type ChatShared, type LogItem } from './chatSession.js'

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

describe('revision ordering', () => {
  const at = (rev: number, log: LogItem[]): ChatShared => ({
    v: 1 as const, projectId: 'lumen', log, sending: false, workingLabel: '', updatedAt: 0, rev,
  })

  it('round-trips rev through serialize/parse, defaulting old states to 0', () => {
    const parsed = parseChat(JSON.parse(serializeChat(at(7, []))), 'lumen')
    assert.equal(parsed?.rev, 7)
    const legacy = parseChat({ v: 1, projectId: 'lumen', log: [] }, 'lumen')
    assert.equal(legacy?.rev, 0)
  })

  it('casWinner keeps the newer stored state and accepts newer writes', () => {
    const stored = at(5, [{ role: 'user', text: 'fresh' }])
    const stale = at(3, [{ role: 'user', text: 'stale' }])
    assert.equal(casWinner(stored, stale), stored)
    const incoming = at(6, [])
    assert.equal(casWinner(stored, incoming), incoming)
    assert.equal(casWinner(null, stale), stale)
  })

  it('bootStopped unlocks a persisted mid-turn state exactly once', () => {
    const stuck: ChatShared = {
      ...at(4, [{ role: 'user', text: 'edit' }]),
      sending: true,
    }
    const booted = bootStopped(stuck)
    assert.equal(booted.sending, false)
    assert.equal(booted.rev, 4)
    const tail = booted.log[booted.log.length - 1]
    assert.equal(tail.role, 'system')
    assert.equal(bootStopped(booted), booted)
    assert.equal(bootStopped(at(1, [])).sending, false)
  })

  it('rebaseLocalUserItems keeps a missing user message, never duplicates', () => {
    const winner: LogItem[] = [{ role: 'user', text: 'a' }, { role: 'ai', text: 'b' }]
    const local: LogItem[] = [{ role: 'user', text: 'a' }, { role: 'user', text: 'fresh send' }]
    const merged = rebaseLocalUserItems(local, winner)
    assert.deepEqual(merged.map((m) => (m as { text: string }).text), ['a', 'b', 'fresh send'])
    assert.equal(rebaseLocalUserItems(winner, winner), winner)
  })
})

describe('send guard', () => {
  it('blocks a second concurrent send and re-arms after release', () => {
    const g = createSendGuard()
    assert.equal(g.tryStart(), true)
    assert.equal(g.tryStart(), false)
    g.release()
    assert.equal(g.tryStart(), true)
  })
})

describe('usage persistence', () => {
  it('round-trips per-turn usage through serialize/parse', () => {
    const state = {
      v: 1 as const,
      projectId: 'lumen',
      log: [
        { role: 'user', text: 'hi' },
        { role: 'ai', text: '', usage: { input: 100, output: 20, total: 120 } },
      ] as LogItem[],
      sending: false,
      workingLabel: '',
      updatedAt: 1,
      rev: 7,
    }
    const parsed = parseChat(JSON.parse(serializeChat(state)), 'lumen')
    assert.deepEqual(parsed?.log[1], { role: 'ai', text: '', usage: { input: 100, output: 20, total: 120 } })
  })
})
