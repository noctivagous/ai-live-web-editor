import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appendTextDelta, bootStopped, casWinner, createSendGuard, emptyChat, historyForAgent, HISTORY_TURN_CHAR_CAP, parseChat, rebaseLocalUserItems, repairCumulativeSegments, serializeChat, withStopped, STOPPED_TEXT, type ChatShared, type LogItem } from './chatSession.js'

describe('chatSession', () => {
  it('appendTextDelta: deltas extend the trailing segment; a tool step starts a fresh one', () => {
    let log: LogItem[] = [{ role: 'user', text: 'make a blue theme' }]
    log = appendTextDelta(log, 'ai', 'Making it blue — ')
    log = appendTextDelta(log, 'ai', 'first a look.')
    assert.deepEqual(log[1], { role: 'ai', text: 'Making it blue — first a look.' })
    // A tool step seals the segment…
    log = [...log, { role: 'tools', steps: [{ id: '1', name: 'grep', detail: 'grep', status: 'done' }] }]
    log = appendTextDelta(log, 'ai', 'Got the themes.')
    // …so the next segment holds ONLY its own text (this is the
    // repetition bug: it used to hold both segments).
    assert.deepEqual(log[3], { role: 'ai', text: 'Got the themes.' })
    log = appendTextDelta(log, 'ai', '')
    assert.equal(log.length, 4, 'empty delta is a no-op')
    // Reasoning segments are scoped the same way.
    log = appendTextDelta(log, 'think', 'hmm')
    assert.deepEqual(log[4], { role: 'think', text: 'hmm' })
  })

  it('repairCumulativeSegments: heals a persisted cumulative log, leaves healthy logs untouched', () => {
    const buggy: LogItem[] = [
      { role: 'user', text: 'make a blue theme for lumen' },
      { role: 'ai', text: 'Making it blue — first a look.' },
      { role: 'tools', steps: [{ id: '1', name: 'codebase-map', detail: 'map', status: 'done' }] },
      { role: 'ai', text: 'Making it blue — first a look.Got the current themes.' },
      { role: 'tools', steps: [{ id: '2', name: 'grep', detail: 'grep', status: 'done' }] },
      { role: 'ai', text: 'Making it blue — first a look.Got the current themes.Now the blue variant.' },
      { role: 'user', text: 'next turn' },
      { role: 'ai', text: 'Making it blue — first a look.' },
    ]
    const healed = repairCumulativeSegments(buggy)
    assert.deepEqual(healed.map(i => ('text' in i ? i.text : '<tools>')), [
      'make a blue theme for lumen',
      'Making it blue — first a look.',
      '<tools>',
      'Got the current themes.',
      '<tools>',
      'Now the blue variant.',
      'next turn',
      'Making it blue — first a look.', // new turn: trackers reset, no cross-turn stripping
    ])

    const healthy: LogItem[] = [
      { role: 'user', text: 'hi' },
      { role: 'ai', text: 'one' },
      { role: 'tools', steps: [] },
      { role: 'ai', text: 'two' },
    ]
    assert.equal(repairCumulativeSegments(healthy), healthy, 'healthy log passes through by identity')
  })

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

  it('caps each prior turn in the agent payload (§2 history re-check)', () => {
    const big = 'x'.repeat(8000)
    const log: LogItem[] = [
      { role: 'user', text: big },
      { role: 'ai', text: big },
      { role: 'user', text: 'short' },
    ]
    const messages = historyForAgent(log, 'now', '/App.jsx')
    // Worst case is bounded: 12 turns x cap, not 12 x the 8k storage clip.
    for (const m of messages.slice(0, -1)) assert.ok(m.content.length <= HISTORY_TURN_CHAR_CAP + 1, `turn was ${m.content.length}`)
    assert.equal(messages[2].content, 'short', 'typical turns are untouched')
    assert.equal(messages[3].content, 'now Current file: /App.jsx', 'the current ask is never clipped')
    const worst = 12 * (HISTORY_TURN_CHAR_CAP + 1)
    assert.ok(worst < 25_000, `worst-case history ${worst} chars stays ~6k tokens, was ~24k uncapped`)
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

describe('stripLegacyHint', () => {
  it('removes the retired default hint but keeps real system lines', async () => {
    const { stripLegacyHint } = await import('./chatSession.js')
    const log: LogItem[] = [
      { role: 'system', text: 'AI has real FS tools (read/write) and live-page inspect/patch/eval on the Vite app. Ask: "inspect the page" or "make this a todo app"' },
      { role: 'system', text: 'Stopped.' },
      { role: 'user', text: 'hi' },
    ]
    const stripped = stripLegacyHint(log)
    assert.equal(stripped.length, 2)
    assert.ok(stripped.every((m) => !('text' in m && m.text.startsWith('AI has real FS tools'))))
  })
})
