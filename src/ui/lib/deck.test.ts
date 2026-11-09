import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyTool, filesFromSteps, fmtCost, fmtTokens, formatElapsed, groupTurns, packHeights, slideTurns, slideTurnsOrDefault, turnCost, turnTitle, workingSet } from './deck.js'
import type { LogItem } from './chatSession.js'

const step = (id: string, name: string, status: 'running' | 'done' | 'error' = 'done', detail = name, result?: string) =>
  ({ id, name, status, detail, result })

describe('classifyTool', () => {
  it('maps the real Mastra tool ids to groups', () => {
    assert.equal(classifyTool('grep'), 'inspect')
    assert.equal(classifyTool('read-real-file'), 'inspect')
    assert.equal(classifyTool('take-snapshot'), 'inspect')
    assert.equal(classifyTool('str-replace'), 'edit')
    assert.equal(classifyTool('write-real-file'), 'edit')
    assert.equal(classifyTool('place-template'), 'edit')
    assert.equal(classifyTool('install-catalog-component'), 'edit')
    assert.equal(classifyTool('delete-file'), 'edit')
    assert.equal(classifyTool('rename-file'), 'edit')
    assert.equal(classifyTool('make-dir'), 'edit')
    assert.equal(classifyTool('patch-dom'), 'live')
    assert.equal(classifyTool('eval-js'), 'live')
    assert.equal(classifyTool('something-new'), 'other')
  })
})

describe('groupTurns', () => {
  it('a skills record becomes a skills card on its turn (the Skills-used chip)', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'lay out the page' },
      { role: 'skills', skills: [{ name: 'making-layouts', via: 'trigger' }] },
      { role: 'ai', text: 'done' },
      { role: 'user', text: 'fix the label' },
      { role: 'ai', text: 'ok' },
    ]
    const turns = groupTurns(log)
    assert.deepEqual(turns[0].cards.map(c => c.kind), ['intent', 'skills', 'result'])
    const card = turns[0].cards[1]
    assert.ok(card.kind === 'skills')
    assert.deepEqual(card.skills, [{ name: 'making-layouts', via: 'trigger' }])
    assert.ok(turns[1].cards.every(c => c.kind !== 'skills'), 'an untriggered turn carries no chip')
  })

  it('keeps the preamble separate and starts a turn per user ask', () => {
    const log: LogItem[] = [
      { role: 'system', text: 'welcome' },
      { role: 'user', text: 'make it blue' },
      { role: 'tools', steps: [step('1', 'grep'), step('2', 'str-replace')] },
      { role: 'ai', text: 'done' },
      { role: 'user', text: 'now red' },
      { role: 'error', text: 'boom' },
    ]
    const turns = groupTurns(log)
    assert.equal(turns.length, 3)
    assert.equal(turns[0].intent, null)
    assert.equal(turns[1].intent, 'make it blue')
    assert.equal(turns[1].status, 'done')
    assert.equal(turns[2].status, 'error')
    assert.deepEqual(slideTurns(turns).map(t => t.intent), ['make it blue', 'now red'])
  })

  it('splits tool cards by consecutive group, preserving order', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'x' },
      { role: 'tools', steps: [step('1', 'grep'), step('2', 'read-real-file'), step('3', 'str-replace'), step('4', 'grep')] },
    ]
    const turn = groupTurns(log)[0]
    const groups = turn.cards.filter(c => c.kind === 'tools').map(c => (c.kind === 'tools' ? c.group : ''))
    assert.deepEqual(groups, ['inspect', 'edit', 'inspect'])
  })

  it('reports progress and the running state of the last turn while sending', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'x' },
      { role: 'tools', steps: [step('1', 'grep'), step('2', 'str-replace', 'running')] },
    ]
    const turn = groupTurns(log, { sending: true })[0]
    assert.equal(turn.status, 'running')
    assert.deepEqual(turn.progress, { done: 1, total: 2, pct: 50 })
  })

  it('collects touched files from step detail and result, deduped in order', () => {
    const steps = [
      step('1', 'read-real-file', 'done', 'read-real-file /App.jsx'),
      step('2', 'str-replace', 'done', 'str-replace /App.jsx 10→12', '/src/index.css · 200b'),
    ]
    assert.deepEqual(filesFromSteps(steps), ['/App.jsx', '/src/index.css'])
    const log: LogItem[] = [{ role: 'tools', steps }]
    assert.deepEqual(workingSet(log), ['/App.jsx', '/src/index.css'])
  })
})

describe('titles and elapsed', () => {
  it('clips long intents for slide titles', () => {
    const [turn] = groupTurns([{ role: 'user', text: 'a '.repeat(60) }])
    assert.equal(turnTitle(turn).endsWith('…'), true)
    assert.equal(turnTitle(turn).length, 64)
  })

  it('formats elapsed like the deck artifacts', () => {
    assert.equal(formatElapsed(47), '47ms')
    assert.equal(formatElapsed(156), '156ms')
    assert.equal(formatElapsed(842), '842ms')
    assert.equal(formatElapsed(1500), '1.5s')
    assert.equal(formatElapsed(65_000), '1m 05s')
    assert.equal(formatElapsed(undefined), '')
  })
})

describe('slideTurnsOrDefault', () => {
  it('keeps real slides untouched', () => {
    const turns = groupTurns([{ role: 'user', text: 'hi' }])
    assert.deepEqual(slideTurnsOrDefault(turns, 'welcome'), slideTurns(turns))
  })

  it('builds a default slide when the chat is empty', () => {
    const turns = groupTurns([{ role: 'system', text: 'welcome' }])
    assert.equal(slideTurns(turns).length, 0)
    const slides = slideTurnsOrDefault(turns, 'welcome')
    assert.equal(slides.length, 1)
    assert.equal(slides[0].cards.length, 1)
    assert.equal(slides[0].cards[0].kind, 'system')
    if (slides[0].cards[0].kind === 'system') {
      assert.equal(slides[0].cards[0].text, 'welcome')
    }
  })
})

describe('packHeights', () => {
  it('fits everything in one slide when it fits', () => {
    assert.deepEqual(packHeights([100, 120, 80], 400), [[0, 1, 2]])
  })

  it('starts a new slide as soon as an item overflows', () => {
    assert.deepEqual(packHeights([200, 150, 150], 400), [[0, 1], [2]])
  })

  it('keeps an oversize single item on its own slide', () => {
    assert.deepEqual(packHeights([500, 100], 400), [[0], [1]])
  })

  it('handles empties and zero capacity', () => {
    assert.deepEqual(packHeights([], 400), [])
    assert.deepEqual(packHeights([100], 0), [[0]])
  })
})

describe('turn usage', () => {
  it('maps run-project-check to the Test group', () => {
    assert.equal(classifyTool('run-project-check'), 'check')
  })
  it('attaches ai usage to the turn and skips empty result cards', () => {
    const turns = groupTurns([
      { role: 'user', text: 'hi' },
      { role: 'ai', text: '', usage: { input: 100, output: 20, total: 120 } },
    ])
    assert.equal(turns.length, 1)
    assert.deepEqual(turns[0].usage, { input: 100, output: 20, total: 120 })
    assert.ok(!turns[0].cards.some(c => c.kind === 'result'))
  })
  it('keeps result cards for ai text with usage', () => {
    const turns = groupTurns([
      { role: 'user', text: 'hi' },
      { role: 'ai', text: 'done', usage: { input: 1, output: 2, total: 3 } },
    ])
    assert.deepEqual(turns[0].usage, { input: 1, output: 2, total: 3 })
    assert.equal(turns[0].cards.filter(c => c.kind === 'result').length, 1)
  })
  it('leaves usage null when the provider reported nothing', () => {
    const turns = groupTurns([{ role: 'user', text: 'hi' }, { role: 'ai', text: 'done' }])
    assert.equal(turns[0].usage, null)
  })
})

describe('fmtTokens and turnCost', () => {
  it('compacts counts and guards junk', () => {
    assert.equal(fmtTokens(950), '950')
    assert.equal(fmtTokens(2400), '2.4k')
    assert.equal(fmtTokens(12400), '12k')
    assert.equal(fmtTokens(NaN), '—')
  })
  it('prices a turn from per-1M rates, null when unpriced', () => {
    assert.equal(turnCost(null, { input: 3, output: 15 }), null)
    assert.equal(turnCost({ input: 1_000_000, output: 0, total: 1_000_000 }, { input: 3, output: 15 }), 3)
    assert.equal(turnCost({ input: 1, output: 1, total: 2 }, undefined), null)
  })
  it('prices cached input at the cache-read rate and cache writes at the premium', () => {
    const price = { input: 3, output: 15 }
    const near = (actual: number | null, expected: number) =>
      assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
    // Fully cached input: 3 * 0.1.
    near(turnCost({ input: 1_000_000, output: 0, total: 1_000_000, cachedInput: 1_000_000 }, price), 0.3)
    // Half cached: 1.5 fresh + 0.15 cached.
    near(turnCost({ input: 1_000_000, output: 0, total: 1_000_000, cachedInput: 500_000 }, price), 1.65)
    // Fully cache-written input: 3 * 1.25.
    near(turnCost({ input: 1_000_000, output: 0, total: 1_000_000, cacheWriteInput: 1_000_000 }, price), 3.75)
    // Junk splits never push the fresh count negative (10 cached reads bill, writes clamp away).
    near(turnCost({ input: 10, output: 0, total: 10, cachedInput: 999, cacheWriteInput: 999 }, price), 0.000003)
  })
  it('formats small costs with more precision', () => {
    assert.equal(fmtCost(0.004), '$0.0040')
    assert.equal(fmtCost(1.5), '$1.50')
  })
})
