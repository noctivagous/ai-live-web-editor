import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { setFsRoot } from '../launcher.js'
import { getPlan } from '../plans/plans.js'
import { aleToolByName } from './registry.js'

const tool = (name: string) => {
  const t = aleToolByName(name)
  assert.ok(t, name)
  return t
}

describe('ALE plan tools (slice 7)', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-plans-'))
    setFsRoot(root)
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('create → read → update step → attach criteria → ready, all against the store', async () => {
    const created = await tool('ale_plan_create').run({ goal: 'Ship the thing', kind: 'feature', level: 2, steps: ['First', 'Second'] }) as any
    assert.equal(created.ok, true)
    const slug = created.plan.slug

    const read = await tool('ale_plan_read').run({ slug }) as any
    assert.equal(read.plan.tasks.length, 2)
    assert.equal(read.plan.status, 'draft')

    const taskId = read.plan.tasks[0].id
    const updated = await tool('ale_plan_update_step').run({ slug, taskId, status: 'done' }) as any
    assert.equal(updated.task.status, 'done')
    assert.equal(updated.plan.tasksDone, 1)

    const attached = await tool('ale_plan_attach_criteria').run({ slug, criteria: ['the gate is clean'] }) as any
    assert.deepEqual(attached.plan.criteria, ['the gate is clean'])

    const ready = await tool('ale_plan_ready').run({ slug }) as any
    assert.equal(ready.plan.status, 'approved')

    // The store itself holds it all — the tools are a surface, not a copy.
    const stored = getPlan(slug, root)
    assert.equal(stored?.status, 'approved')
    assert.deepEqual(stored?.criteria, ['the gate is clean'])
  })

  it('list names the plans and the active one', async () => {
    await tool('ale_plan_create').run({ goal: 'Alpha plan' })
    const list = await tool('ale_plan_list').run({}) as any
    assert.equal(list.plans.length, 1)
    assert.equal(list.active, list.plans[0].slug)
  })

  it('import stamps provenance and maps steps/questions/criteria', async () => {
    const imported = await tool('ale_plan_import').run({
      source: 'muse-grill', goal: 'Settle the API shape', steps: ['Decide routes'],
      questions: ['REST or RPC?'], criteria: ['routes documented'], sessionId: 'sess-123',
    }) as any
    assert.equal(imported.ok, true)
    assert.equal(imported.plan.provenance.source, 'muse-grill')
    assert.equal(imported.plan.provenance.sessionId, 'sess-123')
    const stored = getPlan(imported.plan.slug, root)
    assert.equal(stored?.tasks.length, 1)
    assert.equal(stored?.questions.length, 1)
    assert.deepEqual(stored?.criteria, ['routes documented'])
  })

  it('import refuses an unstamped source', async () => {
    const r = await tool('ale_plan_import').run({ source: 'somewhere', goal: 'X' }) as any
    assert.equal(r.ok, false)
    assert.match(r.error, /source/)
  })

  it('updating a missing task is an error value with directions', async () => {
    const created = await tool('ale_plan_create').run({ goal: 'Beta plan' }) as any
    const r = await tool('ale_plan_update_step').run({ slug: created.plan.slug, taskId: 'nope', status: 'done' }) as any
    assert.equal(r.ok, false)
    assert.match(r.error, /No task with id/)
  })
})
