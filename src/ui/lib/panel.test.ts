import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupTurns } from './deck.js'
import { derivePanel, panelTurn, tileGroup } from './panel.js'
import type { LogItem, ToolStep } from './chatSession.js'

const step = (id: string, name: string, status: ToolStep['status'] = 'done', detail = name, result?: string): ToolStep =>
  ({ id, name, status, detail, result })

const turnOf = (log: LogItem[], sending = false) => groupTurns(log, { sending }).at(-1)!
const phase = (log: LogItem[], id: string, sending = false) =>
  derivePanel(turnOf(log, sending), { sending }).phases.find(p => p.id === id)!.state

describe('tileGroup', () => {
  it('splits plan tools out of the Deck other group', () => {
    assert.equal(tileGroup(step('1', 'plan-update-task')), 'plan')
    assert.equal(tileGroup(step('2', 'grep')), 'inspect')
    assert.equal(tileGroup(step('3', 'run-project-check')), 'check')
    assert.equal(tileGroup(step('4', 'str-replace')), 'edit')
  })
})

describe('derivePanel phases', () => {
  it('the summary names the skills the turn used', () => {
    const withSkills: LogItem[] = [
      { role: 'user', text: 'lay out the page' },
      { role: 'skills', skills: [{ name: 'making-layouts', via: 'trigger' }] },
      { role: 'ai', text: 'Done.' },
    ]
    assert.equal(derivePanel(turnOf(withSkills)).summary.skills, 'making-layouts')
    const without: LogItem[] = [{ role: 'user', text: 'hi' }, { role: 'ai', text: 'hello' }]
    assert.equal(derivePanel(turnOf(without)).summary.skills, '—')
    assert.equal(derivePanel(null).summary.skills, '—')
  })

  it('reads an empty turn as idle with every phase pending', () => {
    const s = derivePanel(null)
    assert.equal(s.now, 'No task running')
    assert.equal(s.nowState, 'idle')
    assert.ok(s.phases.every(p => p.state === 'pending'))
    assert.equal(s.attention, null)
  })

  it('marks evidenced phases done and unevidenced ones skipped on a finished turn', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'fix the header' },
      { role: 'tools', steps: [step('1', 'grep', 'done', 'grep /src/App.tsx'), step('2', 'str-replace', 'done', 'str-replace /src/App.tsx'), step('3', 'run-project-check', 'done', 'run-project-check')] },
      { role: 'ai', text: 'Header fixed.\nAll checks pass.' },
    ]
    const s = derivePanel(turnOf(log))
    assert.deepEqual(s.phases.map(p => p.state), ['done', 'skipped', 'done', 'done', 'done'])
    assert.equal(s.nowState, 'done')
    assert.equal(s.now, 'Header fixed.')
    assert.equal(s.summary.task, 'fix the header')
    assert.equal(s.summary.result, 'Header fixed.')
    assert.match(s.summary.changes, /1 file/)
    assert.deepEqual(s.checks, { passed: 1, failed: 0, running: 0 })
  })

  it('shows a question-only turn honestly: no edit or verify claimed', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'what does this file do?' },
      { role: 'ai', text: 'It renders the header.' },
    ]
    assert.deepEqual(derivePanel(turnOf(log)).phases.map(p => p.state), ['done', 'skipped', 'skipped', 'skipped', 'done'])
  })

  it('puts the active phase on the running step while sending', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'fix it' },
      { role: 'tools', steps: [step('1', 'grep'), step('2', 'str-replace', 'running', 'str-replace /src/App.tsx')] },
    ]
    const s = derivePanel(turnOf(log, true), { sending: true })
    assert.equal(s.nowState, 'running')
    assert.equal(s.now, 'str-replace /src/App.tsx')
    assert.deepEqual(s.phases.map(p => p.state), ['done', 'skipped', 'active', 'pending', 'pending'])
    assert.equal(s.tiles.find(t => t.group === 'edit')!.active, true)
  })

  it('loops back: a failed check followed by more edits reads Edit active, Verify error', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'fix the test' },
      {
        role: 'tools',
        steps: [
          step('1', 'str-replace', 'done', 'str-replace /src/a.ts'),
          step('2', 'run-project-check', 'error', 'run-project-check', '1 failing'),
          step('3', 'str-replace', 'running', 'str-replace /src/a.ts'),
        ],
      },
    ]
    const s = derivePanel(turnOf(log, true), { sending: true })
    assert.equal(s.phases.find(p => p.id === 'edit')!.state, 'active')
    assert.equal(s.phases.find(p => p.id === 'verify')!.state, 'error')
    assert.deepEqual(s.checks, { passed: 0, failed: 1, running: 0 })
  })

  it('surfaces an error card as attention with its first line', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'do it' },
      { role: 'error', text: 'Chat failed: provider down\nstack…' },
    ]
    const s = derivePanel(turnOf(log))
    assert.equal(s.nowState, 'error')
    assert.equal(s.attention, 'Chat failed: provider down')
    assert.equal(s.attentionIsKeyError, false)
  })

  it('flags an API key error for the setup button', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'do it' },
      { role: 'error', text: '401 unauthorized: invalid api key' },
    ]
    assert.equal(derivePanel(turnOf(log)).attentionIsKeyError, true)
  })
})

describe('derivePanel files and tiles', () => {
  it('derives per-file state from the last step that touched the file', () => {
    const log: LogItem[] = [
      { role: 'user', text: 'edit a' },
      {
        role: 'tools',
        steps: [
          step('1', 'read-real-file', 'done', 'read-real-file /src/a.ts'),
          step('2', 'read-real-file', 'done', 'read-real-file /src/b.ts'),
          step('3', 'str-replace', 'done', 'str-replace /src/a.ts'),
        ],
      },
    ]
    const s = derivePanel(turnOf(log))
    assert.deepEqual(s.files, [
      { path: '/src/a.ts', state: 'edited' },
      { path: '/src/b.ts', state: 'read' },
    ])
    assert.equal(s.tiles.find(t => t.group === 'inspect')!.count, 2)
    assert.equal(s.tiles.find(t => t.group === 'edit')!.count, 1)
  })
})

describe('panelTurn', () => {
  it('picks the newest turn with content', () => {
    const turns = groupTurns([
      { role: 'system', text: 'welcome' },
      { role: 'user', text: 'hi' },
      { role: 'ai', text: 'hello' },
    ])
    assert.equal(panelTurn(turns)?.intent, 'hi')
    assert.equal(panelTurn([]), null)
  })
})
