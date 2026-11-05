import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyTool, filesFromSteps, formatElapsed, groupTurns, slideTurns, turnTitle, workingSet } from './deck.js'
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
    assert.equal(classifyTool('patch-dom'), 'live')
    assert.equal(classifyTool('eval-js'), 'live')
    assert.equal(classifyTool('something-new'), 'other')
  })
})

describe('groupTurns', () => {
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
