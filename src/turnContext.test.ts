import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getFsRoot, setFsRoot } from './launcher.js'
import { buildTurnContext, latestUserText } from './turnContext.js'

/**
 * The shared turn-context stack (chat-surface centralisation): every
 * chat surface — stream, both /api/chat copies — builds its per-turn
 * context through buildTurnContext, so the same prompt gets the same
 * agent on any surface. Before this, the apiApp copy sent the brief
 * only and server.ts's copy had no codebase map.
 */
describe('latestUserText', () => {
  it('returns the newest string user message', () => {
    assert.equal(latestUserText([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]), 'second')
  })

  it('skips non-string content and non-arrays', () => {
    assert.equal(latestUserText([{ role: 'user', content: [{ type: 'text', text: 'x' }] }]), '')
    assert.equal(latestUserText(undefined), '')
    assert.equal(latestUserText([{ role: 'assistant', content: 'hi' }]), '')
  })
})

describe('buildTurnContext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-context-'))
  const savedRoot = getFsRoot()
  before(() => { setFsRoot(dir) })
  after(() => { setFsRoot(savedRoot); fs.rmSync(dir, { recursive: true, force: true }) })

  it('always leads with the project brief', async () => {
    const parts = await buildTurnContext('hello', { mode: 'files' })
    assert.match(parts[0], /Project type:/)
  })

  it('adds nothing else for an untriggered Files turn on a small project', async () => {
    const parts = await buildTurnContext('fix the button label', { mode: 'files' })
    assert.equal(parts.length, 1)
  })

  it('loads a skill body when the turn triggers it (Files mode)', async () => {
    const parts = await buildTurnContext('add a state machine for the checkout flow', { mode: 'files' })
    assert.ok(parts.length >= 2, 'expected the state-machines skill to load')
    assert.match(parts.slice(1).join('\n'), /state/i)
  })

  it('never injects map or skills outside Files mode', async () => {
    const parts = await buildTurnContext('add a state machine for the checkout flow', { mode: 'sketch' })
    assert.equal(parts.length, 1)
  })

  it('reports the skills a turn used through onSkillsUsed (the chat chip)', async () => {
    const seen: { name: string, via: string }[][] = []
    await buildTurnContext('add a state machine for the checkout flow', {
      mode: 'files',
      onSkillsUsed: used => { seen.push(used) },
    })
    assert.deepEqual(seen, [[{ name: 'state-machines', via: 'trigger' }]])
    const quiet: unknown[] = []
    await buildTurnContext('fix the button label', {
      mode: 'files',
      onSkillsUsed: used => { quiet.push(used) },
    })
    assert.deepEqual(quiet, [], 'an untriggered turn reports nothing')
  })
})
