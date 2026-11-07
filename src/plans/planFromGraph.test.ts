import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addEdge, addNode, createFeatureGraph, getFeatureGraph, saveFeatureGraph } from '../features/features.js'
import { graftPack } from '../features/graft.js'
import { getPack } from '../catalog/packs.js'
import { getActivePlan, getPlan, savePlan } from './plans.js'
import { planFromGraph, workListFor, type GraphPlanResult } from './planFromGraph.js'

/** Narrow a generation result to its success variant or fail the test. */
function mustOk(result: GraphPlanResult): Extract<GraphPlanResult, { ok: true }> {
  if (result.ok === false) throw new Error(`generation refused: ${result.error}`)
  return result
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-graph-test-'))
}

/** Engine region: Cart done, Payments building, Checkout proposed and
 * depending on both — plus Tax rules in a Shared region, which
 * Checkout also depends on (the cross-region prerequisite). */
function storeGraph(root: string) {
  const graph = createFeatureGraph('Store app', root)
  const engine = addNode(graph, { name: 'Engine', kind: 'region' })
  const shared = addNode(graph, { name: 'Shared', kind: 'region' })
  const cart = addNode(graph, { name: 'Cart', kind: 'feature', parent: engine.id, status: 'done' })
  const payments = addNode(graph, { name: 'Payments', kind: 'service', parent: engine.id, status: 'building' })
  const checkout = addNode(graph, { name: 'Checkout', kind: 'screen', parent: engine.id })
  const tax = addNode(graph, { name: 'Tax rules', kind: 'feature', parent: shared.id })
  addEdge(graph, { from: checkout.id, to: payments.id, type: 'depends-on' })
  addEdge(graph, { from: checkout.id, to: cart.id, type: 'depends-on' })
  addEdge(graph, { from: checkout.id, to: tax.id, type: 'depends-on' })
  saveFeatureGraph(graph, root)
  return { graph, engine, cart, payments, checkout, tax }
}

test('work list: built nodes skipped, cross-region prerequisites pulled in, depends-on order', () => {
  const root = tmpRoot()
  const { graph, engine, payments, checkout, tax } = storeGraph(root)
  const selected = graph.nodes.filter(n => n.parent === engine.id || n.id === engine.id)
  const { work, skippedBuilt } = workListFor(graph, selected)
  assert.equal(skippedBuilt, 1, 'Cart is done')
  assert.deepEqual(work.map(n => n.id).sort(), [payments.id, checkout.id, tax.id].sort())
  const order = work.map(n => n.id)
  assert.ok(order.indexOf(payments.id) < order.indexOf(checkout.id))
  assert.ok(order.indexOf(tax.id) < order.indexOf(checkout.id), 'the Shared prerequisite is in the route, before its dependent')
})

test('planFromGraph makes an active feature plan whose tasks carry node ids', () => {
  const root = tmpRoot()
  const { engine } = storeGraph(root)
  const result = mustOk(planFromGraph({ nodeId: engine.id }, root))
  assert.equal(result.plan.kind, 'feature')
  assert.equal(result.plan.title, 'Build Engine')
  assert.equal(result.skippedBuilt, 1)
  assert.equal(result.plan.tasks.length, 3)
  assert.ok(result.plan.tasks.every(t => t.nodeId), 'every task is tied to a graph node')
  assert.equal(getActivePlan(root)?.slug, result.plan.slug, 'the generated plan is the active one')
  assert.equal(getPlan(result.plan.slug, root)?.tasks.length, 3, 'persisted')
})

test('write-back: marking tasks moves graph nodes (doing → building, done → done), never backwards', () => {
  const root = tmpRoot()
  const { engine, payments } = storeGraph(root)
  const result = mustOk(planFromGraph({ nodeId: engine.id }, root))
  const doc = result.plan
  const task = doc.tasks.find(t => t.nodeId === payments.id)!
  const statusOf = () => getFeatureGraph(root)?.nodes.find(n => n.id === payments.id)?.status

  task.status = 'doing'
  savePlan(doc, root)
  assert.equal(statusOf(), 'building')
  task.status = 'done'
  savePlan(doc, root)
  assert.equal(statusOf(), 'done')
  task.status = 'todo'
  savePlan(doc, root)
  assert.equal(statusOf(), 'done', 'write-back promotes only — a reopened task does not demote the node')
})

test('a grafted pack plans as an install, dependencies first', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  assert.equal(graftPack(graph, getPack('auth')!).ok, true)
  saveFeatureGraph(graph, root)
  const result = mustOk(planFromGraph({ packId: 'auth' }, root))
  assert.equal(result.plan.kind, 'install')
  assert.equal(result.plan.title, 'Install Auth')
  const texts = result.plan.tasks.map(t => t.text)
  assert.ok(texts.indexOf('Session service') < texts.indexOf('Sign-in screen'))
  assert.equal(result.skippedBuilt, 0)
})

test('error values: no graph, unknown node, uninstalled pack, nothing left to build', () => {
  const empty = tmpRoot()
  const noGraph = planFromGraph({ nodeId: 'f-x' }, empty)
  assert.equal(noGraph.ok, false)
  if (noGraph.ok === false) assert.match(noGraph.error, /No feature graph/)

  const root = tmpRoot()
  const { cart } = storeGraph(root)
  const unknownNode = planFromGraph({ nodeId: 'f-missing' }, root)
  assert.equal(unknownNode.ok, false)
  const uninstalled = planFromGraph({ packId: 'settings' }, root)
  assert.equal(uninstalled.ok, false)
  if (uninstalled.ok === false) assert.match(uninstalled.error, /not installed/)
  const unknownPack = planFromGraph({ packId: 'no-such-pack' }, root)
  assert.equal(unknownPack.ok, false)
  const allBuilt = planFromGraph({ nodeId: cart.id }, root)
  assert.equal(allBuilt.ok, false)
  if (allBuilt.ok === false) assert.match(allBuilt.error, /Nothing left to build/)
})
