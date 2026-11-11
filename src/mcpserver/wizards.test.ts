import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { setFsRoot } from '../launcher.js'
import { getFeatureGraph } from '../features/features.js'
import { aleToolByName } from './registry.js'
import {
  completeWizard, onWizardOpen, openWizardCompletion, pendingWizardCount, registerWizard, resetWizardCompletions,
  wizardRegistration, type WizardHeads,
} from './wizards.js'

const tool = (name: string) => {
  const t = aleToolByName(name)
  assert.ok(t, name)
  return t
}

describe('the two-headed registry (slice 8)', () => {
  it('a single-headed wizard cannot register', () => {
    assert.throws(
      () => registerWizard({ id: 'bad-one-head', title: 'Bad', facet: 'features', heads: { ui: { component: 'X', note: '' } } as unknown as WizardHeads }),
      /BOTH heads/,
    )
    assert.equal(wizardRegistration('bad-one-head'), undefined)
  })

  it('add-feature is ready with both heads; the other fifteen are declared stubs', () => {
    const list = tool('ale_list_wizards')
    return list.run({}).then((r) => {
      const wizards = (r as any).wizards as Array<{ id: string; ready: boolean }>
      assert.equal(wizards.length, 16)
      assert.equal(wizards.find((w) => w.id === 'add-feature')?.ready, true)
      assert.equal(wizards.filter((w) => !w.ready).length, 15)
    })
  })

  it('a stub refuses plain on both heads', async () => {
    const opened = await tool('ale_open_wizard').run({ wizardId: 'new-project' }) as any
    assert.equal(opened.ok, false)
    assert.match(opened.error, /not built yet/)
    const ran = await tool('ale_run_wizard').run({ wizardId: 'new-project', input: {} }) as any
    assert.equal(ran.ok, false)
  })
})

describe('WizardCompletion (slice 8)', () => {
  afterEach(() => resetWizardCompletions())

  it('completion resolves the pending call with the outcome', async () => {
    const { completionId, promise } = openWizardCompletion('add-feature', {})
    assert.equal(pendingWizardCount(), 1)
    assert.equal(completeWizard(completionId, { status: 'completed', wizardId: 'add-feature', action: 'quick-add' }), true)
    const outcome = await promise
    assert.equal(outcome.status, 'completed')
    assert.equal(outcome.action, 'quick-add')
    assert.equal(pendingWizardCount(), 0)
    // A second report is dropped, never a double resolution.
    assert.equal(completeWizard(completionId, { status: 'cancelled', wizardId: 'add-feature' }), false)
  })

  it('a timeout resolves as a cancellation — never a hang', async () => {
    const { promise } = openWizardCompletion('add-feature', {}, 25)
    const outcome = await promise
    assert.equal(outcome.status, 'cancelled')
    assert.equal(outcome.reason, 'timeout')
  })

  it('open replays pending opens to late subscribers', async () => {
    const { completionId, promise } = openWizardCompletion('add-feature', { packId: 'x' })
    const seen: string[] = []
    const off = onWizardOpen((o) => { seen.push(o.wizardId) })
    assert.deepEqual(seen, ['add-feature'])
    off()
    completeWizard(completionId, { status: 'cancelled', wizardId: 'add-feature' })
    assert.equal((await promise).status, 'cancelled')
  })
})

describe('ale_run_wizard — Add a Feature headless (slice 8)', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-wiz-'))
    setFsRoot(root)
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('validation refuses an unknown pack before any effect', async () => {
    const r = await tool('ale_run_wizard').run({ wizardId: 'add-feature', input: { packId: 'no-such-pack' } }) as any
    assert.equal(r.ok, false)
    assert.match(r.error, /No feature pack with id/)
    assert.equal(getFeatureGraph(root), null)
  })

  it('a real pack grafts through the headless head, stamped as headless with its input', async () => {
    const { loadPacks } = await import('../catalog/packs.js')
    const pack = loadPacks().packs[0]
    assert.ok(pack, 'the catalog ships at least one pack')
    const r = await tool('ale_run_wizard').run({ wizardId: 'add-feature', input: { packId: pack.id } }) as any
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300))
    assert.equal(r.via, 'headless')
    assert.equal(r.head, 'headless')
    assert.deepEqual(r.input, { packId: pack.id })
    const graph = getFeatureGraph(root)
    assert.ok(graph && graph.nodes.length > 0, 'the graft landed in the store')
  })
})
