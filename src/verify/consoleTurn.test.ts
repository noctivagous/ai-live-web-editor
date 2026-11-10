import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  captureConsoleCapture,
  readSinceLastChatEntries,
  readTurnConsole,
  shapeTurnConsoleDetail,
  type ConsoleCapture,
  type ConsoleChannelRead,
  type ConsoleChannels,
} from './consoleTurn.js'
import type { ConsoleEntry } from './gate.js'
import type { ProjectConsoleMarks } from './consoleWatermarks.js'

const entry = (seq: number, level: string, text: string, ts?: number): ConsoleEntry => ({ seq, level, text, ts })

/** A scripted channel: `reads` maps sinceSeq → the read result. */
function fakeChannels(script: {
  bridge?: Record<number, ConsoleChannelRead>
  pool?: Record<number, ConsoleChannelRead>
}) {
  const calls: { channel: string, sinceSeq: number, maxEntries: number }[] = []
  const channels: ConsoleChannels = {
    async read(channel, sinceSeq, maxEntries) {
      calls.push({ channel, sinceSeq, maxEntries })
      const table = (channel === 'bridge' ? script.bridge : script.pool) ?? {}
      return table[sinceSeq] ?? { entries: [], latestSeq: sinceSeq }
    },
  }
  return { channels, calls }
}

const okRead = (entries: ConsoleEntry[], latestSeq: number, instance?: string | number): ConsoleChannelRead =>
  ({ entries, latestSeq, instance })

const capture = (over: Partial<ConsoleCapture> = {}): ConsoleCapture => ({
  at: 1000,
  bridge: { seq: 10, instance: 'page-a', connected: true },
  pool: { seq: 0, connected: false },
  ...over,
})

describe('captureConsoleCapture', () => {
  it('passes both channels’ marks through untouched', async () => {
    const cap = await captureConsoleCapture(async () => ({
      bridge: { seq: 4, instance: 'a', connected: true },
      pool: { seq: 0, connected: false },
    }))
    assert.equal(cap.bridge.seq, 4)
    assert.equal(cap.bridge.connected, true)
    assert.equal(cap.pool.connected, false)
  })
})

describe('readSinceLastChatEntries', () => {
  const marks: ProjectConsoleMarks = { bridge: { seq: 6, instance: 'page-a', at: 500 } }

  it('reads the window between the stored mark and the turn start, failures only', async () => {
    const { channels, calls } = fakeChannels({
      bridge: {
        6: okRead([
          entry(7, 'error', 'between chats boom'),
          entry(8, 'log', 'just a log — not reported'),
          entry(9, 'warn', 'between chats warn'),
          entry(10, 'error', 'at the start watermark — belongs to the window edge'),
          entry(11, 'error', 'after the turn started — not this group'),
        ], 11, 'page-a'),
      },
    })
    const out = await readSinceLastChatEntries(marks, capture(), channels)
    assert.deepEqual(out.map((e) => e.text), ['between chats boom', 'between chats warn', 'at the start watermark — belongs to the window edge'])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].sinceSeq, 6)
  })

  it('first-ever turn (no marks) reads nothing', async () => {
    const { channels, calls } = fakeChannels({})
    assert.deepEqual(await readSinceLastChatEntries(undefined, capture(), channels), [])
    assert.equal(calls.length, 0)
  })

  it('a page reload between chats (new instance) reports nothing for that channel', async () => {
    const { channels, calls } = fakeChannels({})
    const out = await readSinceLastChatEntries(marks, capture({ bridge: { seq: 2, instance: 'page-b', connected: true } }), channels)
    assert.deepEqual(out, [])
    assert.equal(calls.length, 0, 'no read is even attempted — the old history is unattributable')
  })

  it('stale marks (an off period intervened) report nothing', async () => {
    const { channels, calls } = fakeChannels({})
    const out = await readSinceLastChatEntries({ ...marks, stale: true }, capture(), channels)
    assert.deepEqual(out, [])
    assert.equal(calls.length, 0)
  })

  it('a disconnected channel contributes nothing; a failed read is swallowed', async () => {
    const { channels } = fakeChannels({ bridge: { 6: { entries: [], latestSeq: 0, error: 'gone' } } })
    assert.deepEqual(await readSinceLastChatEntries(marks, capture(), channels), [])
  })
})

describe('readTurnConsole', () => {
  it('no channel connected at start → no probes at all, nothing readable', async () => {
    const { channels, calls } = fakeChannels({})
    const out = await readTurnConsole(
      capture({ bridge: { seq: 0, connected: false }, pool: { seq: 0, connected: false } }),
      channels,
      { graceMs: 0 },
    )
    assert.deepEqual(out, { entries: [], latest: {}, readable: false, reloaded: false })
    assert.equal(calls.length, 0, 'a quiet turn with no page must cost no end-of-turn probes')
  })

  it('same instance: entries after the start watermark, latest = observed end position', async () => {
    const { channels } = fakeChannels({
      bridge: {
        10: okRead([], 14, 'page-a'),
        // the epoch plan re-reads from the start seq when the instance matches
        14: okRead([], 14, 'page-a'),
      },
    })
    // probe answers at sinceSeq=10 (maxEntries 1) with latestSeq 14;
    // the full read then goes from plan.sinceSeq — here the fake
    // serves the full window under sinceSeq 10 as well.
    const out = await readTurnConsole(capture(), channels, { graceMs: 0 })
    assert.equal(out.readable, true)
    assert.equal(out.reloaded, false)
    assert.deepEqual(out.latest.bridge, { seq: 14, instance: 'page-a' })
  })

  it('collects this-turn entries of every level (expectations match on log lines too)', async () => {
    const full = [
      entry(11, 'log', 'PROBE-1 ran'),
      entry(12, 'error', 'boom'),
      entry(13, 'info', 'fyi'),
    ]
    const { channels } = fakeChannels({
      bridge: {
        10: okRead(full, 13, 'page-a'),
      },
    })
    const out = await readTurnConsole(capture(), channels, { graceMs: 0 })
    assert.deepEqual(out.entries.map((e) => e.seq), [11, 12, 13])
  })

  it('a reload during the turn reads the new page from its load and flags it', async () => {
    const { channels } = fakeChannels({
      bridge: {
        // probe (sinceSeq = start seq) already answers with the NEW instance
        10: okRead([], 3, 'page-b'),
        0: okRead([entry(1, 'error', 'new page load error'), entry(2, 'pageerror', 'crash')], 3, 'page-b'),
      },
    })
    const out = await readTurnConsole(capture(), channels, { graceMs: 0 })
    assert.equal(out.reloaded, true)
    assert.deepEqual(out.entries.map((e) => e.text), ['new page load error', 'crash'])
    assert.deepEqual(out.latest.bridge, { seq: 3, instance: 'page-b' })
  })

  it('a failed end read keeps the start position as latest and stays unreadable', async () => {
    const { channels } = fakeChannels({
      bridge: { 10: { entries: [], latestSeq: 0, error: 'page gone' } },
    })
    const out = await readTurnConsole(capture(), channels, { graceMs: 0 })
    assert.equal(out.readable, false)
    assert.deepEqual(out.entries, [])
    assert.deepEqual(out.latest.bridge, { seq: 10, instance: 'page-a' })
  })

  it('the grace settle runs only when asked and a channel is connected', async () => {
    let slept = 0
    const { channels } = fakeChannels({ bridge: { 10: okRead([], 10, 'page-a') } })
    await readTurnConsole(capture(), channels, { graceMs: 450, sleep: async (ms) => { slept = ms } })
    assert.equal(slept, 450)
    slept = 0
    await readTurnConsole(capture({ bridge: { seq: 0, connected: false } }), channels, { graceMs: 450, sleep: async (ms) => { slept = ms } })
    assert.equal(slept, 0, 'no page → no grace wait either')
  })

  it('pool channel participates when it was the connected one at start', async () => {
    const { channels, calls } = fakeChannels({
      pool: { 4: okRead([entry(5, 'error', 'pool boom')], 5, 7) },
    })
    const cap = capture({ bridge: { seq: 0, connected: false }, pool: { seq: 4, instance: 7, connected: true } })
    const out = await readTurnConsole(cap, channels, { graceMs: 0 })
    assert.deepEqual(out.entries.map((e) => e.text), ['pool boom'])
    assert.deepEqual(out.latest.pool, { seq: 5, instance: 7 })
    assert.ok(calls.every((c) => c.channel === 'pool'), 'bridge was never connected → never probed')
  })
})

describe('shapeTurnConsoleDetail', () => {
  it('splits this-turn entries into errors and warnings; info/log are not findings', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [entry(1, 'error', 'e1'), entry(2, 'pageerror', 'e2'), entry(3, 'warn', 'w1'), entry(4, 'log', 'l1'), entry(5, 'info', 'i1')],
      sinceEntries: [],
      expectations: [],
      notes: [],
    })!
    assert.equal(detail.errorTotal, 2)
    assert.deepEqual(detail.errors.map((e) => e.text), ['e1', 'e2'])
    assert.equal(detail.warningTotal, 1)
    assert.deepEqual(detail.warnings.map((e) => e.text), ['w1'])
  })

  it('since-last-chat entries ride in their own group, never in the error totals', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [],
      sinceEntries: [entry(1, 'error', 'old boom')],
      expectations: [],
      notes: [],
    })!
    assert.equal(detail.errorTotal, 0)
    assert.equal(detail.sinceLastChatTotal, 1)
    assert.equal(detail.sinceLastChat[0].text, 'old boom')
  })

  it('caps lists at 20 but keeps full totals', () => {
    const many = Array.from({ length: 25 }, (_, i) => entry(i + 1, 'error', `e${i}`))
    const detail = shapeTurnConsoleDetail({ turnEntries: many, sinceEntries: [], expectations: [], notes: [] })!
    assert.equal(detail.errors.length, 20)
    assert.equal(detail.errorTotal, 25)
  })

  it('truncates long entry text', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [entry(1, 'error', 'x'.repeat(500))],
      sinceEntries: [], expectations: [], notes: [],
    })!
    assert.ok(detail.errors[0].text.length <= 300)
    assert.ok(detail.errors[0].text.endsWith('…'))
  })

  it('slice C: editor-attributed entries never count as findings — they tally as editorCount', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [
        { seq: 1, level: 'error', text: 'overlay exploded', src: 'editor' },
        { seq: 2, level: 'pageerror', text: 'chat crashed', src: 'editor' },
        { seq: 3, level: 'warn', text: 'overlay grumble', src: 'editor' },
        { seq: 4, level: 'error', text: 'app boom' },
      ],
      sinceEntries: [],
      expectations: [],
      notes: [],
    })!
    assert.equal(detail.errorTotal, 1)
    assert.deepEqual(detail.errors.map((e) => e.text), ['app boom'])
    assert.equal(detail.warningTotal, 0)
    assert.equal(detail.editorCount, 3, 'all three editor entries are tallied, none rendered as findings')
  })

  it('slice C: a turn whose only output was editor noise yields a detail with editorCount and no findings', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [{ seq: 1, level: 'error', text: 'overlay exploded', src: 'editor' }],
      sinceEntries: [],
      expectations: [],
      notes: [],
    })!
    assert.equal(detail.errorTotal, 0)
    assert.equal(detail.warningTotal, 0)
    assert.equal(detail.editorCount, 1)
    // Paired with the consoleView test: this detail renders nothing.
  })

  it('slice C: agent-probe entries are excluded from counts and the since-last-chat group', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [
        { seq: 1, level: 'error', text: 'PROBE-ERR exploded', src: 'agent-probe' },
        { seq: 2, level: 'error', text: 'app boom' },
      ],
      sinceEntries: [
        { seq: 1, level: 'error', text: 'PROBE-ERR earlier', src: 'agent-probe' },
        { seq: 2, level: 'error', text: 'overlay earlier', src: 'editor' },
        { seq: 3, level: 'error', text: 'real old boom' },
      ],
      expectations: [{ text: 'PROBE-ERR', matched: true, matchedText: 'PROBE-ERR exploded' }],
      notes: [],
    })!
    assert.equal(detail.errorTotal, 1, 'the probe at error level is an expectation result, not an app error')
    assert.equal(detail.sinceLastChatTotal, 1)
    assert.deepEqual(detail.sinceLastChat.map((e) => e.text), ['real old boom'])
    assert.equal(detail.editorCount, 0, 'editorCount counts this-turn entries only')
  })

  it('slice C: identical repeats dedupe into one entry with a count; totals count distinct entries', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [
        entry(1, 'warn', 'same warning'),
        entry(2, 'warn', 'same warning'),
        entry(3, 'warn', 'same warning'),
        entry(4, 'error', 'boom'),
        entry(5, 'error', 'boom'),
      ],
      sinceEntries: [entry(1, 'error', 'old'), entry(2, 'error', 'old')],
      expectations: [],
      notes: [],
    })!
    assert.equal(detail.warningTotal, 1)
    assert.equal(detail.warnings[0].count, 3)
    assert.equal(detail.errorTotal, 1)
    assert.equal(detail.errors[0].count, 2)
    assert.equal(detail.sinceLastChatTotal, 1)
    assert.equal(detail.sinceLastChat[0].count, 2)
  })

  it('slice C: the cap applies after dedupe, not before', () => {
    const turnEntries: ConsoleEntry[] = []
    // 30 raw entries collapsing to 21 distinct: 20 singles + one line ×10.
    for (let i = 0; i < 20; i++) turnEntries.push(entry(i + 1, 'error', `distinct ${i}`))
    for (let i = 0; i < 10; i++) turnEntries.push(entry(21 + i, 'error', 'the repeater'))
    const detail = shapeTurnConsoleDetail({ turnEntries, sinceEntries: [], expectations: [], notes: [] })!
    assert.equal(detail.errorTotal, 21, 'totals count distinct entries after dedupe')
    assert.equal(detail.errors.length, 20, 'the 20-entry cap applies to the deduped list')
    const repeater = detail.errors.find((e) => e.text === 'the repeater')
    assert.equal(repeater?.count, undefined, 'the repeater is the 21st distinct entry — past the cap, not crowding it')
  })

  it('expectations and notes pass through; empty everything → null', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [], sinceEntries: [],
      expectations: [{ text: 'P1', matched: false }],
      notes: ['probe left in src/a.ts'],
    })!
    assert.deepEqual(detail.expectations, [{ text: 'P1', matched: false }])
    assert.deepEqual(detail.notes, ['probe left in src/a.ts'])
    assert.equal(shapeTurnConsoleDetail({ turnEntries: [], sinceEntries: [], expectations: [], notes: [] }), null)
    // A turn whose only console output was logs has nothing to report.
    assert.equal(shapeTurnConsoleDetail({
      turnEntries: [entry(1, 'log', 'hello')], sinceEntries: [], expectations: [], notes: [],
    }), null)
  })
})
