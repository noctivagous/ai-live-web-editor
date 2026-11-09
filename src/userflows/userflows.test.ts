import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addNode, createFeatureGraph, getFeatureGraph, saveFeatureGraph } from '../features/features.js'
import {
  addExercises, addFlowEdge, addJourney, addStep, createUserFlowGraph, findJourney,
  flowGraphSummary, getStep, getUserFlowGraph, parseBlockKind, parseUserFlowEdgeType,
  parseUserFlowStepType, parseVerificationState, removeExercises, removeFlowEdge,
  removeStep, renderUserFlowMarkdown, saveUserFlowGraph, setVerification, stepSummary,
  stepsInJourney, userFlowCounts,
} from './userflows.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'userflows-test-'))
}

/** A small flow graph: a Checkout journey (Cart page → Pay → Order
 * confirmed) and a Browsing journey (Home), over a tiny feature
 * graph with a Payments service and a Cart feature. */
function storeUserFlows(root: string) {
  const features = createFeatureGraph('Store app', root)
  const cart = addNode(features, { name: 'Cart', kind: 'feature', status: 'done' })
  const payments = addNode(features, { name: 'Payments', kind: 'service', status: 'done' })
  saveFeatureGraph(features, root)

  const graph = createUserFlowGraph('Store flows', root)
  const checkout = addJourney(graph, { name: 'Checkout' })
  const browsing = addJourney(graph, { name: 'Browsing' })
  const cartPage = addStep(graph, { name: 'Cart page', type: 'screen', journey: checkout.id })!
  const pay = addStep(graph, { name: 'Pay with card', type: 'action', journey: checkout.id })!
  const confirmed = addStep(graph, { name: 'Order confirmed', type: 'outcome', journey: checkout.id })!
  const home = addStep(graph, { name: 'Home page', type: 'screen', journey: browsing.id })!
  addFlowEdge(graph, { from: cartPage.id, to: pay.id, type: 'navigates-to' })
  addFlowEdge(graph, { from: pay.id, to: confirmed.id, type: 'submits' })
  saveUserFlowGraph(graph, root)
  return { features, cart, payments, graph, checkout, browsing, cartPage, pay, confirmed, home }
}

test('create → graph.json + graph.md on disk under ai-user-flows/; create is idempotent', () => {
  const root = tmpRoot()
  const graph = createUserFlowGraph('Store flows', root)
  assert.ok(fs.existsSync(path.join(root, 'ai-user-flows/graph.json')))
  assert.ok(fs.existsSync(path.join(root, 'ai-user-flows/graph.md')))
  assert.equal(createUserFlowGraph('Other title', root).title, 'Store flows')
  assert.equal(getUserFlowGraph(root)?.title, graph.title)
  assert.equal(getUserFlowGraph(tmpRoot()), null)
})

test('journeys resolve by id or exact name; steps refuse an unknown journey', () => {
  const root = tmpRoot()
  const { graph, checkout } = storeUserFlows(root)
  assert.equal(findJourney(graph, checkout.id)?.name, 'Checkout')
  assert.equal(findJourney(graph, 'Checkout')?.id, checkout.id)
  assert.equal(findJourney(graph, 'checkout'), null, 'name match is exact')
  assert.equal(findJourney(graph, 'Nope'), null)
  assert.equal(addStep(graph, { name: 'Ghost', type: 'screen', journey: 'j-missing' }), null)
  assert.equal(stepsInJourney(graph, checkout.id).length, 3)
})

test('parse helpers: step/edge types are strict, verification state falls back to untested', () => {
  assert.equal(parseUserFlowStepType('screen'), 'screen')
  assert.equal(parseUserFlowStepType('outcome'), 'outcome')
  assert.equal(parseUserFlowStepType('widget'), null)
  assert.equal(parseUserFlowEdgeType('branches-on'), 'branches-on')
  assert.equal(parseUserFlowEdgeType('exercises'), null, 'exercises is the cross-graph link, not an intra-flow edge')
  assert.equal(parseUserFlowEdgeType('depends-on'), null, 'feature edge types do not leak in')
  assert.equal(parseVerificationState('blocked'), 'blocked')
  assert.equal(parseVerificationState('nonsense'), 'untested')
  assert.equal(parseBlockKind('console-error'), 'console-error')
  assert.equal(parseBlockKind('other'), null)
})

test('intra-flow edges refuse duplicates, self-links and missing endpoints; unlink works', () => {
  const root = tmpRoot()
  const { graph, cartPage, pay } = storeUserFlows(root)
  assert.equal(addFlowEdge(graph, { from: cartPage.id, to: pay.id, type: 'navigates-to' }), false, 'duplicate')
  assert.equal(addFlowEdge(graph, { from: cartPage.id, to: cartPage.id, type: 'requires' }), false, 'self-link')
  assert.equal(addFlowEdge(graph, { from: cartPage.id, to: 's-missing', type: 'requires' }), false, 'missing endpoint')
  assert.equal(addFlowEdge(graph, { from: cartPage.id, to: pay.id, type: 'requires' }), true, 'same pair, different type is a different edge')
  assert.equal(removeFlowEdge(graph, { from: cartPage.id, to: pay.id, type: 'requires' }), true)
  assert.equal(removeFlowEdge(graph, { from: cartPage.id, to: pay.id, type: 'requires' }), false)
})

test('verification: a block is recorded whole, and ok / untested clear it', () => {
  const root = tmpRoot()
  const { graph, pay } = storeUserFlows(root)
  const block = { kind: 'console-error' as const, evidence: 'TypeError: pay is not a function', runId: 'run-1', at: '2026-11-09T00:00:00.000Z' }
  assert.equal(setVerification(graph, pay.id, { state: 'error', block }), true)
  assert.deepEqual(getStep(graph, pay.id)?.verification, { state: 'error', block })
  assert.equal(stepSummary(graph, getStep(graph, pay.id)!).block?.kind, 'console-error')

  assert.equal(setVerification(graph, pay.id, { state: 'ok' }), true)
  assert.deepEqual(getStep(graph, pay.id)?.verification, { state: 'ok' }, 'no stale block survives an ok')

  assert.equal(setVerification(graph, pay.id, { state: 'blocked', block }), true)
  assert.equal(setVerification(graph, pay.id, { state: 'untested' }), true)
  assert.deepEqual(getStep(graph, pay.id)?.verification, { state: 'untested' })

  assert.equal(setVerification(graph, pay.id, { state: 'blocked' }), true)
  assert.deepEqual(getStep(graph, pay.id)?.verification, { state: 'blocked' }, 'a block is optional — the state alone records')
  assert.equal(setVerification(graph, 's-missing', { state: 'ok' }), false)
})

test('exercises links validate against the feature graph and unlink cleanly', () => {
  const root = tmpRoot()
  const { graph, features, cart, pay, confirmed } = storeUserFlows(root)
  assert.equal(addExercises(graph, features, pay.id, 'f-missing'), 'No node with id f-missing in the feature graph.')
  assert.match(addExercises(graph, features, 's-missing', cart.id)!, /No step with id/)
  assert.match(addExercises(graph, null, pay.id, cart.id)!, /No feature graph/)
  assert.equal(addExercises(graph, features, pay.id, cart.id), null)
  assert.match(addExercises(graph, features, pay.id, cart.id)!, /already exists/)
  assert.deepEqual(stepSummary(graph, getStep(graph, pay.id)!).exercises, [cart.id])

  // The feature graph is untouched by the link — it lives on the flow side.
  assert.equal(getFeatureGraph(root)?.edges.length, 0)
  assert.equal(removeExercises(graph, pay.id, cart.id), true)
  assert.equal(removeExercises(graph, pay.id, cart.id), false)
  assert.equal(addExercises(graph, features, confirmed.id, cart.id), null)
})

test('removeStep takes its edges and exercises links with it', () => {
  const root = tmpRoot()
  const { graph, features, cart, pay } = storeUserFlows(root)
  assert.equal(addExercises(graph, features, pay.id, cart.id), null)
  const removed = removeStep(graph, pay.id)
  assert.equal(removed?.id, pay.id)
  assert.equal(getStep(graph, pay.id), null)
  assert.equal(graph.edges.length, 0, 'both edges touched the removed step')
  assert.equal(graph.exercises.length, 0)
  assert.equal(removeStep(graph, pay.id), null)
})

test('counts, the brief summary and the markdown view agree with the graph', () => {
  const root = tmpRoot()
  const { graph, cartPage, pay } = storeUserFlows(root)
  setVerification(graph, cartPage.id, { state: 'ok' })
  setVerification(graph, pay.id, {
    state: 'blocked',
    block: { kind: 'dead-end', evidence: 'Pay button does nothing', runId: 'run-2', at: '2026-11-09T00:00:00.000Z' },
  })
  const counts = userFlowCounts(graph)
  assert.deepEqual(
    { journeys: counts.journeys, steps: counts.steps, ok: counts.ok, blocked: counts.blocked, error: counts.error, untested: counts.untested, verifiedPct: counts.verifiedPct },
    { journeys: 2, steps: 4, ok: 1, blocked: 1, error: 0, untested: 2, verifiedPct: 25 },
  )
  assert.match(flowGraphSummary(graph), /USER FLOW "Store flows" — 2 journeys, 4 steps, 25% verified, 1 blocked/)
  const md = renderUserFlowMarkdown(graph)
  assert.match(md, /# User flow graph: Store flows/)
  assert.match(md, /## Checkout/)
  assert.match(md, /Cart page —navigates-to→ Pay with card/)
  assert.match(md, /blocked \(dead-end, run run-2/)
})

test('everything persists through save + reload, exercises included', () => {
  const root = tmpRoot()
  const { graph, features, payments, pay } = storeUserFlows(root)
  setVerification(graph, pay.id, { state: 'ok' })
  assert.equal(addExercises(graph, features, pay.id, payments.id), null)
  saveUserFlowGraph(graph, root)
  const reloaded = getUserFlowGraph(root)!
  assert.equal(reloaded.journeys.length, 2)
  assert.equal(reloaded.steps.length, 4)
  assert.equal(reloaded.edges.length, 2)
  assert.deepEqual(reloaded.exercises, [{ step: pay.id, feature: payments.id }])
  assert.equal(getStep(reloaded, pay.id)?.verification.state, 'ok')
  // The rendered outline names the feature beside its id.
  const md = fs.readFileSync(path.join(root, 'ai-user-flows/graph.md'), 'utf-8')
  assert.match(md, new RegExp(`Pay with card —exercises→ Payments \\(${payments.id}\\)`))
})
