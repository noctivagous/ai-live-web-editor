import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addQuestion, createPlan, getActivePlan, getPlan, parsePlanLevel,
  removeQuestion, renderPlanMarkdown, renderPlanXml, savePlan,
} from './plans.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plans-test-'))
}

test('create → files on disk (json + md + xml), active pointer set', () => {
  const root = tmpRoot()
  const doc = createPlan({ title: 'Add sharing', kind: 'feature', level: 2, goal: 'Let users share notes' }, root)
  assert.equal(doc.slug, 'add-sharing')
  assert.equal(doc.status, 'draft')
  const dir = path.join(root, 'ai-plans')
  assert.ok(fs.existsSync(path.join(dir, 'add-sharing.json')))
  assert.ok(fs.existsSync(path.join(dir, 'add-sharing.md')))
  assert.ok(fs.existsSync(path.join(dir, 'add-sharing.xml')))
  assert.equal(getActivePlan(root)?.slug, 'add-sharing')
  assert.equal(getPlan('add-sharing', root)?.goal, 'Let users share notes')
})

test('questions are id-keyed: add/remove never disturbs answers or notes (§O)', () => {
  const root = tmpRoot()
  const doc = createPlan({ title: 'P', kind: 'feature', level: 1, goal: 'g' }, root)
  const q1 = addQuestion(doc, { label: 'Who can open a link?', control: 'choice', options: ['Anyone', 'Workspace'], default: 'Anyone' })
  const q2 = addQuestion(doc, { label: 'Link expiry?', control: 'text', default: 'Never' })
  q1.answer = 'Workspace'
  q1.note = 'teams only'
  savePlan(doc, root)

  const reloaded = getPlan(doc.slug, root)!
  const q3 = addQuestion(reloaded, { label: 'Offline support?', control: 'text', default: 'Not in v1' })
  assert.equal(reloaded.questions.length, 3)
  assert.equal(removeQuestion(reloaded, q2.id), true)
  assert.equal(removeQuestion(reloaded, 'nope'), false)
  savePlan(reloaded, root)

  const after = getPlan(doc.slug, root)!
  assert.deepEqual(after.questions.map(q => q.id), [q1.id, q3.id])
  assert.equal(after.questions[0].answer, 'Workspace')
  assert.equal(after.questions[0].note, 'teams only')
})

test('markdown + xml views carry model, instance and tasks', () => {
  const root = tmpRoot()
  const doc = createPlan({ title: 'X', kind: 'install', level: 3, goal: 'Install auth' }, root)
  const q = addQuestion(doc, { label: 'Session length?', control: 'choice', options: ['1 day', '30 days'], default: '30 days' })
  q.answer = '1 day'
  q.note = 'security asked'
  doc.tasks.push({ id: 't1', text: 'Add the settings screen', status: 'doing', detail: 'wiring' })
  const md = renderPlanMarkdown(doc)
  assert.match(md, /# Plan: X/)
  assert.match(md, /Session length\?/)
  assert.match(md, /Note: security asked/)
  assert.match(md, /\[~\] Add the settings screen/)
  const xml = renderPlanXml(doc)
  assert.match(xml, /<xf:model>/)
  assert.match(xml, new RegExp(`<answer ref="${q.id}">1 day</answer>`))
  assert.match(xml, /<note ref="t1">|<note ref="/)
  assert.match(xml, /status="doing"/)
})

test('parsePlanLevel clamps to 1..3 with 1 the default', () => {
  assert.equal(parsePlanLevel(2), 2)
  assert.equal(parsePlanLevel(3), 3)
  assert.equal(parsePlanLevel(9), 1)
  assert.equal(parsePlanLevel('2'), 1)
  assert.equal(parsePlanLevel(undefined), 1)
})
