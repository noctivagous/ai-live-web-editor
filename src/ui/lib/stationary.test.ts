import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupTurns } from './deck.js'
import { deriveStationary } from './stationary.js'
import type { LogItem } from './chatSession.js'

const step = (id: string, name: string, status: 'running' | 'done' | 'error' = 'done'): LogItem => ({
  role: 'tools',
  steps: [{ id, name, detail: name, status }],
})

describe('stationary derivation', () => {
  it('completed turn: last result pins as the final report, earlier segments become numbered working notes', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'make a blue theme for lumen' },
      { role: 'ai', text: 'Making it blue — first a look.' },
      step('1', 'codebase-map'),
      { role: 'ai', text: 'Got the current themes.' },
      step('2', 'grep'),
      { role: 'ai', text: 'Done — Lumen has a blue theme.' },
    ]
    const m = deriveStationary(groupTurns(log))
    assert.equal(m.live, false)
    assert.deepEqual(m.pinned, { kind: 'final', text: 'Done — Lumen has a blue theme.', reasoning: false, turnIndex: 0, key: '0:5' })
    assert.deepEqual(m.notes.map(n => [n.text, n.n, n.total]), [
      ['Making it blue — first a look.', 1, 2],
      ['Got the current themes.', 2, 2],
    ])
    assert.equal(m.intent, 'make a blue theme for lumen')
  })

  it('in-flight turn: the latest segment pins as a working note, not a final report', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'make a blue theme' },
      { role: 'ai', text: 'First a look.' },
      step('1', 'grep'),
      { role: 'ai', text: 'Now the switcher.' },
    ]
    const m = deriveStationary(groupTurns(log, { sending: true }), { sending: true })
    assert.equal(m.live, true)
    assert.equal(m.pinned?.kind, 'working')
    assert.equal(m.pinned?.text, 'Now the switcher.')
    assert.deepEqual(m.notes.map(n => n.text), ['First a look.'])
  })

  it('activity groups the current turn steps into every category column with counts', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'do it' },
      step('1', 'read-real-file'),
      step('2', 'write-real-file'),
      step('3', 'patch-dom'),
      step('4', 'run-project-check', 'error'),
      step('5', 'feature-query'),
      { role: 'ai', text: 'done' },
    ]
    const m = deriveStationary(groupTurns(log))
    const byLabel = Object.fromEntries(m.activity.map(c => [c.label, c]))
    assert.deepEqual(m.activity.map(c => c.label), ['Inspect', 'Edit files', 'Live page', 'Test', 'Tools'])
    assert.equal(byLabel['Inspect'].total, 1)
    assert.equal(byLabel['Edit files'].total, 1)
    assert.equal(byLabel['Live page'].total, 1)
    assert.equal(byLabel['Test'].errors, 1)
    assert.equal(byLabel['Tools'].total, 1)
    assert.deepEqual(m.activityTotals, { total: 5, done: 4, errors: 1, running: false })
  })

  it('previous turns flatten into earlier: intent, working notes, final report — newest turn first', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'first ask' },
      { role: 'ai', text: 'working on it' },
      step('1', 'grep'),
      { role: 'ai', text: 'first final' },
      { role: 'user', text: 'second ask' },
      { role: 'ai', text: 'second final' },
      { role: 'user', text: 'third ask' },
      { role: 'ai', text: 'third final' },
    ]
    const m = deriveStationary(groupTurns(log))
    assert.equal(m.pinned?.text, 'third final')
    assert.deepEqual(m.earlier.map(e => [e.kind, e.text]), [
      ['intent', 'second ask'],
      ['final', 'second final'],
      ['intent', 'first ask'],
      ['working', 'working on it'],
      ['final', 'first final'],
    ])
  })

  it('a terminal error pins as an error; a tool-only turn pins nothing but keeps its activity', () => {
    const errLog: LogItem[] = [
      { role: 'user', text: 'break it' },
      { role: 'ai', text: 'trying' },
      { role: 'error', text: 'Chat failed: no key' },
    ]
    const em = deriveStationary(groupTurns(errLog))
    assert.equal(em.pinned?.kind, 'error')
    assert.equal(em.pinned?.text, 'Chat failed: no key')
    assert.deepEqual(em.notes.map(n => n.text), ['trying'])

    const toolOnly: LogItem[] = [
      { role: 'user', text: 'just tools' },
      step('1', 'grep'),
    ]
    const tm = deriveStationary(groupTurns(toolOnly))
    assert.equal(tm.pinned, null)
    assert.equal(tm.activityTotals.total, 1)
  })

  it('empty log yields an empty model with all activity columns present', () => {
    const m = deriveStationary([])
    assert.equal(m.pinned, null)
    assert.equal(m.activity.length, 5)
    assert.equal(m.live, false)
  })
})
