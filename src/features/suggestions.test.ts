import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addNode, createFeatureGraph, featureGraphSummary, getFeatureGraph, getNode,
  graphRollup, parseFeatureStatus, saveFeatureGraph, setNodeStatus,
} from './features.js'
import {
  SUGGESTED_REGION_NAME, acceptSuggestion, derivedAcceptRegion, deriveSuggestions,
  dismissSuggestion, liveSuggestions, suggestionCandidates, suggestionKey, suggestedRegion,
} from './suggestions.js'
import {
  addExercises, addJourney, addStep, createUserFlowGraph, saveUserFlowGraph, setVerification,
} from '../userflows/userflows.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'suggestions-test-'))
}

const BLOCK_AT = '2026-11-09T00:00:00.000Z'

/**
 * A two-region feature graph and a checkout journey:
 *  - "Pay with card" — blocked (missing-affordance), exercises
 *    the Pay button in Shop → fix candidate with a derived region.
 *  - "Order confirmed" — untested, exercises nothing → coverage.
 *  - "Browse items" — verified ok, exercises the Pay button → no
 *    candidate.
 */
function fixture(root: string) {
  const features = createFeatureGraph('App', root)
  const shop = addNode(features, { name: 'Shop', kind: 'region' })
  const account = addNode(features, { name: 'Account', kind: 'region' })
  const payButton = addNode(features, { name: 'Pay button', kind: 'component', parent: shop.id, status: 'done' })
  const profile = addNode(features, { name: 'Profile page', kind: 'screen', parent: account.id, status: 'planned' })
  saveFeatureGraph(features, root)

  const flow = createUserFlowGraph('App', root)
  const checkout = addJourney(flow, { name: 'Checkout' })
  const pay = addStep(flow, { name: 'Pay with card', type: 'action', journey: checkout.id })!
  const confirm = addStep(flow, { name: 'Order confirmed', type: 'outcome', journey: checkout.id })!
  const browse = addStep(flow, { name: 'Browse items', type: 'screen', journey: checkout.id })!
  assert.equal(addExercises(flow, features, pay.id, payButton.id), null)
  assert.equal(addExercises(flow, features, browse.id, payButton.id), null)
  setVerification(flow, pay.id, {
    state: 'blocked',
    block: { kind: 'missing-affordance', evidence: 'No pay button rendered on the cart page', runId: 'dogfood-1', at: BLOCK_AT },
  })
  setVerification(flow, browse.id, { state: 'ok' })
  saveUserFlowGraph(flow, root)
  return { features, flow, shop, account, payButton, profile, pay, confirm, browse }
}

test('candidates are pure and mirror coverage: fix for blocked, coverage for feature-less, nothing for ok+exercised', () => {
  const root = tmpRoot()
  const { flow, pay, confirm } = fixture(root)
  const first = suggestionCandidates(flow)
  const second = suggestionCandidates(flow)
  assert.deepEqual(first.map(c => c.key), second.map(c => c.key), 'same inputs, same candidates')
  assert.deepEqual(first.map(c => [c.kind, c.stepId]), [['fix', pay.id], ['coverage', confirm.id]])
  assert.equal(first[0].blockKind, 'missing-affordance')
  assert.equal(first[0].evidence, 'No pay button rendered on the cart page')
  assert.equal(first[0].runId, 'dogfood-1')
})

test('derivation creates one suggestion per qualifying step, in the Suggested region, with provenance', () => {
  const root = tmpRoot()
  const { features, flow, pay, confirm } = fixture(root)
  const result = deriveSuggestions(features, flow)
  assert.equal(result.created.length, 2)
  assert.equal(result.withdrawn.length, 0)
  assert.equal(result.skippedDismissed, 0)
  assert.equal(result.alreadyLive, 0)

  const region = suggestedRegion(features)
  assert.ok(region, 'the Suggested by dogfooding region was created')
  assert.equal(region!.name, SUGGESTED_REGION_NAME)

  const fix = result.created.find(n => n.suggestion?.stepId === pay.id)!
  assert.equal(fix.name, 'Fix Pay with card (missing-affordance)')
  assert.equal(fix.status, 'suggested')
  assert.equal(fix.kind, 'feature')
  assert.equal(fix.parent, region!.id)
  assert.equal(fix.suggestion?.source, 'dogfood')
  assert.equal(fix.suggestion?.kind, 'fix')
  assert.equal(fix.suggestion?.stepName, 'Pay with card')
  assert.equal(fix.suggestion?.state, 'blocked')
  assert.equal(fix.suggestion?.blockKind, 'missing-affordance')
  assert.equal(fix.suggestion?.evidence, 'No pay button rendered on the cart page')
  assert.equal(fix.suggestion?.runId, 'dogfood-1')
  assert.match(fix.note ?? '', /Suggested by dogfooding/)

  const coverage = result.created.find(n => n.suggestion?.stepId === confirm.id)!
  assert.equal(coverage.name, 'Add feature for Order confirmed')
  assert.equal(coverage.suggestion?.kind, 'coverage')
  assert.equal(coverage.parent, region!.id)
})

test('derivation is idempotent — a second run creates nothing and reports the live ones', () => {
  const root = tmpRoot()
  const { features, flow } = fixture(root)
  deriveSuggestions(features, flow)
  const again = deriveSuggestions(features, flow)
  assert.equal(again.created.length, 0)
  assert.equal(again.withdrawn.length, 0)
  assert.equal(again.alreadyLive, 2)
  assert.equal(liveSuggestions(features).length, 2)
})

test('a step that verifies ok withdraws its fix suggestion; a changed block kind withdraws and re-derives', () => {
  const root = tmpRoot()
  const { features, flow, pay } = fixture(root)
  deriveSuggestions(features, flow)

  setVerification(flow, pay.id, { state: 'ok' })
  const afterOk = deriveSuggestions(features, flow)
  assert.deepEqual(afterOk.withdrawn.map(n => n.name), ['Fix Pay with card (missing-affordance)'])
  assert.equal(afterOk.created.length, 0)
  assert.equal(liveSuggestions(features).length, 1, 'the coverage suggestion is untouched')

  setVerification(flow, pay.id, {
    state: 'blocked',
    block: { kind: 'dead-end', evidence: 'Checkout goes nowhere', runId: 'dogfood-2', at: BLOCK_AT },
  })
  const reblocked = deriveSuggestions(features, flow)
  assert.deepEqual(reblocked.created.map(n => n.name), ['Fix Pay with card (dead-end)'])
})

test('an accepted suggestion is never withdrawn and never re-derived while its step stays blocked', () => {
  const root = tmpRoot()
  const { features, flow, pay, shop } = fixture(root)
  const { created } = deriveSuggestions(features, flow)
  const fix = created.find(n => n.suggestion?.stepId === pay.id)!
  assert.equal(acceptSuggestion(features, flow, fix.id, undefined), null)
  assert.equal(getNode(features, fix.id)?.status, 'planned')
  assert.equal(getNode(features, fix.id)?.parent, shop.id)

  const again = deriveSuggestions(features, flow)
  assert.equal(again.withdrawn.length, 0, 'accepted nodes are normal nodes — derivation leaves them alone')
  assert.equal(again.created.filter(n => n.suggestion?.stepId === pay.id).length, 0, 'no duplicate suggestion for the tracked step + kind')
  assert.equal(again.alreadyLive, 2, 'the accepted fix and the live coverage suggestion both count as tracked')

  setVerification(flow, pay.id, { state: 'ok' })
  const afterOk = deriveSuggestions(features, flow)
  assert.equal(afterOk.withdrawn.length, 0)
  assert.ok(getNode(features, fix.id), 'still there after the step verified ok')
})

test('dismissal is remembered: the same key never respawns, a different block kind may', () => {
  const root = tmpRoot()
  const { features, flow, pay, confirm } = fixture(root)
  const { created } = deriveSuggestions(features, flow)
  const coverage = created.find(n => n.suggestion?.stepId === confirm.id)!
  const fix = created.find(n => n.suggestion?.stepId === pay.id)!

  const record = dismissSuggestion(features, coverage.id)
  assert.ok(record)
  assert.equal(record!.key, suggestionKey('coverage', confirm.id))
  assert.equal(record!.name, 'Add feature for Order confirmed')
  assert.equal(getNode(features, coverage.id), null, 'the node is removed')
  assert.equal(dismissSuggestion(features, fix.id)?.key, suggestionKey('fix', pay.id, 'missing-affordance'))

  // The record persists with the graph file.
  saveFeatureGraph(features, root)
  const reloaded = getFeatureGraph(root)!
  assert.equal(reloaded.dismissedSuggestions?.length, 2)

  const again = deriveSuggestions(reloaded, flow)
  assert.equal(again.created.length, 0)
  assert.equal(again.skippedDismissed, 2, 'both dismissed keys are skipped')
  assert.equal(liveSuggestions(reloaded).length, 0)

  // Same step, different kind: a new key, a new suggestion.
  setVerification(flow, pay.id, {
    state: 'error',
    block: { kind: 'console-error', evidence: 'TypeError: pay is not a function', runId: 'dogfood-3', at: BLOCK_AT },
  })
  const newKind = deriveSuggestions(reloaded, flow)
  assert.deepEqual(newKind.created.map(n => n.name), ['Fix Pay with card (console-error)'])
  assert.equal(newKind.skippedDismissed, 1, 'only the coverage key is still skipped')
})

test('accept targeting: derived region, explicit region, top level, and refusals', () => {
  const root = tmpRoot()
  const { features, flow, pay, confirm, shop, account } = fixture(root)
  const { created } = deriveSuggestions(features, flow)
  const fix = created.find(n => n.suggestion?.stepId === pay.id)!
  const coverage = created.find(n => n.suggestion?.stepId === confirm.id)!

  // Derived: the fix's step exercises the Pay button, which lives in Shop.
  assert.equal(derivedAcceptRegion(features, flow, fix)?.id, shop.id)
  // Not derivable (the coverage step exercises nothing): first real region.
  assert.equal(derivedAcceptRegion(features, flow, coverage)?.id, shop.id)

  // Explicit choice wins.
  assert.equal(acceptSuggestion(features, flow, coverage.id, account.id), null)
  assert.equal(getNode(features, coverage.id)?.parent, account.id)
  assert.equal(getNode(features, coverage.id)?.status, 'planned')
  assert.ok(getNode(features, coverage.id)?.suggestion, 'provenance stays on the node after acceptance')

  // Explicit top level.
  assert.equal(acceptSuggestion(features, flow, fix.id, null), null)
  assert.equal(getNode(features, fix.id)?.parent, undefined)

  // Refusals: not a suggestion any more; the Suggested region as target; unknown node.
  assert.match(acceptSuggestion(features, flow, fix.id, undefined) ?? '', /not a live dogfood suggestion/)
  const second = deriveSuggestions(features, flow)
  assert.equal(second.created.length, 0, 'accepted nodes suppress re-derivation')
  assert.match(acceptSuggestion(features, flow, 'f-missing', undefined) ?? '', /No node with id/)
})

test('accept refuses the Suggested region itself as the target', () => {
  const root = tmpRoot()
  const { features, flow } = fixture(root)
  const { created } = deriveSuggestions(features, flow)
  const region = suggestedRegion(features)!
  assert.match(acceptSuggestion(features, flow, created[0].id, region.id) ?? '', /Suggested by dogfooding region itself/)
  assert.equal(getNode(features, created[0].id)?.status, 'suggested', 'the refusal changed nothing')
})

test('a step exercising a top-level feature derives top level as the accept target', () => {
  const root = tmpRoot()
  const features = createFeatureGraph('App', root)
  addNode(features, { name: 'Shop', kind: 'region' })
  const lone = addNode(features, { name: 'Lone widget', kind: 'component', status: 'done' })
  const flow = createUserFlowGraph('App', root)
  const journey = addJourney(flow, { name: 'Main' })
  const step = addStep(flow, { name: 'Use the widget', type: 'action', journey: journey.id })!
  assert.equal(addExercises(flow, features, step.id, lone.id), null)
  setVerification(flow, step.id, {
    state: 'blocked',
    block: { kind: 'unreachable', evidence: 'Widget never mounts', runId: 'dogfood-1', at: BLOCK_AT },
  })
  const { created } = deriveSuggestions(features, flow)
  assert.equal(created.length, 1)
  assert.equal(derivedAcceptRegion(features, flow, created[0]), null, 'the exercised feature is top-level, so the suggestion lands top-level too')
  assert.equal(acceptSuggestion(features, flow, created[0].id, undefined), null)
  assert.equal(getNode(features, created[0].id)?.parent, undefined)
})

test('rollup exclusion: live suggestions count toward nothing, region or graph; accepted ones count as planned', () => {
  const root = tmpRoot()
  const { features, flow, shop } = fixture(root)
  const before = graphRollup(features)
  assert.equal(before.overall.total, 2, 'Pay button (done) + Profile page (planned)')
  assert.equal(before.overall.built, 1)
  assert.equal(before.overall.pct, 50)

  deriveSuggestions(features, flow)
  const during = graphRollup(features)
  assert.equal(during.overall.total, 2, 'suggestions enter neither the total…')
  assert.equal(during.overall.built, 1)
  assert.equal(during.overall.pct, 50, '…nor the percentage')
  const shopRollup = during.regions.find(r => r.node.id === shop.id)!.rollup
  assert.equal(shopRollup.total, 1)
  const suggestedRollup = during.regions.find(r => r.node.name === SUGGESTED_REGION_NAME)!.rollup
  assert.equal(suggestedRollup.total, 0, 'the Suggested region itself contributes 0')
  assert.equal(suggestedRollup.pct, 0)

  const fix = liveSuggestions(features).find(n => n.suggestion?.kind === 'fix')!
  assert.equal(acceptSuggestion(features, flow, fix.id, undefined), null)
  const after = graphRollup(features)
  assert.equal(after.overall.total, 3, 'once accepted, the node counts like any planned node')
  assert.equal(after.overall.built, 1)
  assert.equal(after.overall.pct, 33)
})

test('the brief summary names live suggestions awaiting review, and only then', () => {
  const root = tmpRoot()
  const { features, flow } = fixture(root)
  assert.doesNotMatch(featureGraphSummary(features), /suggested by dogfooding/)
  deriveSuggestions(features, flow)
  assert.match(featureGraphSummary(features), /2 suggested by dogfooding awaiting review/)
  for (const node of liveSuggestions(features)) dismissSuggestion(features, node.id)
  assert.doesNotMatch(featureGraphSummary(features), /suggested by dogfooding/)
})

test('backwards compatibility: a graph saved before suggestions loads and behaves as before', () => {
  const root = tmpRoot()
  fs.mkdirSync(path.join(root, 'ai-features'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ai-features/graph.json'), JSON.stringify({
    version: 1, title: 'Old app', createdAt: 1, updatedAt: 1,
    nodes: [
      { id: 'fold1', name: 'Old region', kind: 'region', status: 'proposed' },
      { id: 'fold2', name: 'Old feature', kind: 'feature', status: 'done', parent: 'fold1' },
    ],
    edges: [],
  }))
  const graph = getFeatureGraph(root)
  assert.ok(graph)
  assert.equal(graph!.dismissedSuggestions, undefined, 'no dismissal record on an old graph')
  assert.equal(graphRollup(graph!).overall.pct, 100)
  assert.equal(parseFeatureStatus('suggested'), 'suggested', 'the new status parses')
  assert.equal(parseFeatureStatus('nonsense'), 'proposed', 'unknown statuses still fall back as before')
  // Derivation works against the old graph too.
  const { flow } = fixture(tmpRoot())
  const reloadedFlow = flow
  const result = deriveSuggestions(graph!, reloadedFlow)
  assert.equal(result.created.length, 2)
  assert.equal(setNodeStatus(graph!, 'fold2', 'suggested'), true)
})
