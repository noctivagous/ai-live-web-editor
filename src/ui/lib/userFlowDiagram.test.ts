import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FeatureGraphItem, UserFlowGraphItem } from './api.js'
import {
  diffFlowGraphs, exercisesOfStep, flowBlockedByFeature, flowCoverage, flowDiagramEdges, flowDiagramNodes,
  journeyRollup, journeyRollups, latestBlockRecord, regionOfNodeItem, stepNeighbours,
  suggestionProvenanceLine, suggestionTargetRegion, verificationBadge, verificationColor,
} from './userFlowDiagram.js'

/**
 * The User Flow pane's pure logic: journey rollups over
 * verification states (blocked / error counted apart from merely
 * untested), the diagram adaptation (journeys as regions, steps
 * parented to them), a step's neighbours and exercises, the
 * cross-graph coverage read, and the snapshot diff that narrates
 * poll changes — all over fixture payloads in the API's shape.
 */

const FLOW: UserFlowGraphItem = {
  title: 'Test flows',
  journeys: [
    { id: 'j1', name: 'Sign in' },
    { id: 'j2', name: 'Checkout' },
  ],
  steps: [
    { id: 's1', journey: 'j1', name: 'Open sign-in page', type: 'screen', verification: { state: 'ok' } },
    {
      id: 's2', journey: 'j1', name: 'Submit credentials', type: 'action',
      verification: { state: 'blocked', block: { kind: 'missing-affordance', evidence: 'No submit button rendered', at: '2026-11-09T10:00:00.000Z', runId: 'run-1' } },
    },
    { id: 's3', journey: 'j1', name: 'Land on dashboard', type: 'outcome', verification: { state: 'untested' } },
    { id: 's4', journey: 'j2', name: 'View cart', type: 'screen', verification: { state: 'ok' } },
    {
      id: 's5', journey: 'j2', name: 'Pay', type: 'action',
      verification: { state: 'error', block: { kind: 'console-error', at: '2026-11-09T11:00:00.000Z' } },
    },
    { id: 's6', journey: 'j2', name: 'See confirmation', type: 'outcome', verification: { state: 'untested' } },
  ],
  edges: [
    { from: 's2', to: 's1', type: 'requires' },
    { from: 's4', to: 's5', type: 'navigates-to' },
    { from: 's5', to: 's6', type: 'submits' },
  ],
  exercises: [
    { step: 's1', feature: 'f1' },
    { step: 's2', feature: 'f2' },
    { step: 's5', feature: 'f3' },
  ],
}

const FEATURES: FeatureGraphItem = {
  title: 'Test features',
  nodes: [
    { id: 'f1', name: 'Auth form', kind: 'feature', status: 'done' },
    { id: 'f2', name: 'Sign-in button', kind: 'component', status: 'building' },
    { id: 'f3', name: 'Payments', kind: 'service', status: 'planned' },
    { id: 'f4', name: 'Settings page', kind: 'screen', status: 'proposed' },
  ],
  edges: [],
}

const stepsOf = (graph: UserFlowGraphItem, journeyId: string) => graph.steps.filter(s => s.journey === journeyId)

test('journey rollup: pct is the ok share, with blocked / error / untested counted apart', () => {
  assert.deepEqual(journeyRollup(stepsOf(FLOW, 'j1')), { total: 3, ok: 1, blocked: 1, error: 0, untested: 1, pct: 33 })
  assert.deepEqual(journeyRollup(stepsOf(FLOW, 'j2')), { total: 3, ok: 1, blocked: 0, error: 1, untested: 1, pct: 33 })
  assert.deepEqual(journeyRollup([]), { total: 0, ok: 0, blocked: 0, error: 0, untested: 0, pct: 0 })
})

test('journeyRollups keys every journey, including one with no steps', () => {
  const graph: UserFlowGraphItem = { ...FLOW, journeys: [...FLOW.journeys, { id: 'j3', name: 'Empty journey' }] }
  const rollups = journeyRollups(graph)
  assert.deepEqual([...rollups.keys()], ['j1', 'j2', 'j3'])
  assert.equal(rollups.get('j3')?.total, 0)
  assert.equal(rollups.get('j1')?.blocked, 1)
})

test('diagram adaptation: journeys become regions, steps are parented cards carrying type + verification', () => {
  const nodes = flowDiagramNodes(FLOW)
  const journey = nodes.find(n => n.id === 'j1')
  assert.equal(journey?.kind, 'region')
  const step = nodes.find(n => n.id === 's2')
  assert.deepEqual(
    { kind: step?.kind, status: step?.status, parent: step?.parent },
    { kind: 'action', status: 'blocked', parent: 'j1' },
  )
  assert.deepEqual(flowDiagramEdges(FLOW), FLOW.edges)
})

test('verification presentation: settled ok, distinct blocked / error colors, badge names the block kind', () => {
  assert.equal(verificationColor('ok'), 'var(--green)')
  assert.equal(verificationColor('blocked'), 'var(--red)')
  assert.equal(verificationColor('error'), 'var(--amber)')
  assert.notEqual(verificationColor('untested'), verificationColor('ok'))
  assert.equal(verificationBadge(FLOW.steps[1]), 'blocked · missing-affordance')
  assert.equal(verificationBadge(FLOW.steps[4]), 'error · console-error')
  assert.equal(verificationBadge(FLOW.steps[0]), null)
  assert.equal(verificationBadge(FLOW.steps[2]), null)
})

test('step neighbours: outgoing and incoming edges with direction labels', () => {
  const ofS5 = stepNeighbours(FLOW, 's5')
  assert.deepEqual(ofS5.map(n => [n.label, n.step.id, n.direction]), [
    ['navigated from', 's4', 'in'],
    ['submits', 's6', 'out'],
  ])
  const ofS1 = stepNeighbours(FLOW, 's1')
  assert.deepEqual(ofS1.map(n => [n.label, n.step.id]), [['required by', 's2']])
  assert.deepEqual(stepNeighbours(FLOW, 's3'), [])
})

test('exercises of a step resolve against the feature graph; dangling links drop', () => {
  assert.deepEqual(exercisesOfStep(FLOW, FEATURES, 's2').map(f => f.id), ['f2'])
  assert.deepEqual(exercisesOfStep(FLOW, FEATURES, 's3'), [])
  assert.deepEqual(exercisesOfStep(FLOW, null, 's2'), [])
  const dangling: UserFlowGraphItem = { ...FLOW, exercises: [{ step: 's1', feature: 'gone' }] }
  assert.deepEqual(exercisesOfStep(dangling, FEATURES, 's1'), [])
})

test('coverage reads the two graphs together', () => {
  const cov = flowCoverage(FLOW, FEATURES)
  assert.equal(cov.links, 3)
  assert.deepEqual(cov.stepsWithoutFeatures.map(s => s.id), ['s3', 's4', 's6'])
  assert.deepEqual(cov.featuresNeverExercised.map(f => f.id), ['f4'])
  assert.deepEqual(
    cov.featuresOnBlockedSteps.map(x => [x.feature.id, x.steps.map(s => s.id)]),
    [['f2', ['s2']], ['f3', ['s5']]],
  )
})

test('coverage without a feature graph still answers the flow-side questions', () => {
  const cov = flowCoverage(FLOW, null)
  assert.equal(cov.links, 3)
  assert.deepEqual(cov.stepsWithoutFeatures.map(s => s.id), ['s3', 's4', 's6'])
  assert.deepEqual(cov.featuresNeverExercised, [])
  assert.deepEqual(cov.featuresOnBlockedSteps, [])
})

test('diff: an added step narrates and flashes as added', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: [...FLOW.steps, { id: 's7', journey: 'j2', name: 'Apply coupon', type: 'action', verification: { state: 'untested' } }],
  }
  const { feed, flash } = diffFlowGraphs(FLOW, next)
  assert.deepEqual(feed, ['Step added — Apply coupon (action)'])
  assert.deepEqual(flash, { s7: 'added' })
})

test('diff: a verification change names the states and the block kind', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's3'
      ? { ...s, verification: { state: 'blocked' as const, block: { kind: 'dead-end' as const, at: '2026-11-09T12:00:00.000Z' } } }
      : s),
  }
  const { feed, flash } = diffFlowGraphs(FLOW, next)
  assert.deepEqual(feed, ['Verification — Land on dashboard: untested → blocked — dead-end'])
  assert.deepEqual(flash, { s3: 'changed' })
})

test('diff: a journey move, an edge, and an exercises link each narrate', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's6' ? { ...s, journey: 'j1' } : s),
    edges: [...FLOW.edges, { from: 's3', to: 's4', type: 'navigates-to' as const }],
    exercises: [...FLOW.exercises, { step: 's4', feature: 'f3' }],
  }
  const { feed } = diffFlowGraphs(FLOW, next, id => FEATURES.nodes.find(n => n.id === id)?.name)
  assert.ok(feed.includes('Moved — See confirmation → Sign in'))
  assert.ok(feed.includes('Edge added — Land on dashboard navigates-to View cart'))
  assert.ok(feed.includes('Exercises added — View cart exercises Payments'))
})

test('diff: identical snapshots narrate nothing', () => {
  const { feed, flash } = diffFlowGraphs(FLOW, FLOW)
  assert.deepEqual(feed, [])
  assert.deepEqual(flash, {})
})

test('diff: a step driven ok narrates the transition', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's3' ? { ...s, verification: { state: 'ok' as const } } : s),
  }
  const { feed, flash } = diffFlowGraphs(FLOW, next)
  assert.deepEqual(feed, ['Verification — Land on dashboard: untested → ok'])
  assert.deepEqual(flash, { s3: 'changed' })
})

test('diff: a step that was ok and now blocks names the kind', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's1'
      ? { ...s, verification: { state: 'blocked' as const, block: { kind: 'unreachable' as const, evidence: 'Route 404s', runId: 'dogfood-2', at: '2026-11-09T13:00:00.000Z' } } }
      : s),
  }
  const { feed, flash } = diffFlowGraphs(FLOW, next)
  assert.deepEqual(feed, ['Verification — Open sign-in page: ok → blocked — unreachable'])
  assert.deepEqual(flash, { s1: 'changed' })
})

test('diff: a blocked step clearing to ok narrates the clearing (its block is gone with the state)', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's2' ? { ...s, verification: { state: 'ok' as const } } : s),
  }
  const { feed, flash } = diffFlowGraphs(FLOW, next)
  assert.deepEqual(feed, ['Verification — Submit credentials: blocked → ok'])
  assert.deepEqual(flash, { s2: 'changed' })
})

test('diff: a re-run that re-blocks a step with a new kind narrates even though the state held', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's2'
      ? { ...s, verification: { state: 'blocked' as const, block: { kind: 'dead-end' as const, evidence: 'Form submits nowhere', runId: 'dogfood-2', at: '2026-11-09T13:05:00.000Z' } } }
      : s),
  }
  const { feed, flash } = diffFlowGraphs(FLOW, next)
  assert.deepEqual(feed, ['Verification — Submit credentials: still blocked — dead-end (run dogfood-2)'])
  assert.deepEqual(flash, { s2: 'changed' })
})

test('diff: a re-block with the same kind and run (evidence reworded) stays silent', () => {
  const next: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's2'
      ? { ...s, verification: { state: 'blocked' as const, block: { kind: 'missing-affordance' as const, evidence: 'Still no submit button', runId: 'run-1', at: '2026-11-09T10:00:00.000Z' } } }
      : s),
  }
  const { feed, flash } = diffFlowGraphs(FLOW, next)
  assert.deepEqual(feed, [])
  assert.deepEqual(flash, {})
})

test('latest block: the newest recorded block wins, with its run stamp', () => {
  const latest = latestBlockRecord(FLOW)
  // s5's error block (11:00) is newer than s2's blocked record (10:00).
  assert.equal(latest?.step.id, 's5')
  assert.equal(latest?.kind, 'console-error')
  assert.equal(latest?.runId, undefined)
  assert.equal(latest?.at, '2026-11-09T11:00:00.000Z')
  const withRun: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => s.id === 's5'
      ? { ...s, verification: { state: 'error' as const, block: { kind: 'console-error' as const, runId: 'dogfood-9', at: '2026-11-09T11:00:00.000Z' } } }
      : s),
  }
  assert.equal(latestBlockRecord(withRun)?.runId, 'dogfood-9')
})

test('latest block: no blocks recorded, no line — ok and untested steps carry no stamp', () => {
  const calm: UserFlowGraphItem = {
    ...FLOW,
    steps: FLOW.steps.map(s => ({ ...s, verification: { state: 'ok' as const } })),
  }
  assert.equal(latestBlockRecord(calm), null)
  assert.equal(latestBlockRecord({ ...FLOW, steps: [] }), null)
})

test('flow blocked: features exercised by blocked / error steps map to those steps, in flow order', () => {
  const blocked = flowBlockedByFeature(FLOW, FEATURES)
  assert.deepEqual([...blocked.keys()], ['f2', 'f3'], 'f2 via the blocked step, f3 via the error step')
  assert.deepEqual(blocked.get('f2')?.map(s => s.id), ['s2'])
  assert.deepEqual(blocked.get('f3')?.map(s => s.id), ['s5'])
  assert.equal(blocked.has('f1'), false, 'an ok step never flow-blocks its feature')
  assert.equal(blocked.has('f4'), false)
  assert.deepEqual([...flowBlockedByFeature(FLOW, null).keys()], [], 'no feature graph, no badges')
  const calm: UserFlowGraphItem = { ...FLOW, steps: FLOW.steps.map(s => ({ ...s, verification: { state: 'ok' as const } })) }
  assert.equal(flowBlockedByFeature(calm, FEATURES).size, 0, 'when the steps drive clean, the badges clear')
})

const FEATURES_WITH_REGIONS: FeatureGraphItem = {
  title: 'Test features',
  nodes: [
    { id: 'r1', name: 'Storefront', kind: 'region', status: 'proposed' },
    { id: 'r2', name: 'Account', kind: 'region', status: 'proposed' },
    { id: 'rs', name: 'Suggested by dogfooding', kind: 'region', status: 'proposed' },
    { id: 'f1', name: 'Auth form', kind: 'feature', status: 'done', parent: 'r2' },
    { id: 'f5', name: 'Pay button', kind: 'component', status: 'done', parent: 'r1' },
    { id: 'f6', name: 'Lone widget', kind: 'component', status: 'done' },
    {
      id: 'sg1', name: 'Fix Submit credentials (missing-affordance)', kind: 'feature', status: 'suggested', parent: 'rs',
      suggestion: { source: 'dogfood', kind: 'fix', stepId: 's2', stepName: 'Submit credentials', state: 'blocked', blockKind: 'missing-affordance', runId: 'run-1', at: '2026-11-09T10:00:00.000Z' },
    },
    {
      id: 'sg2', name: 'Add feature for See confirmation', kind: 'feature', status: 'suggested', parent: 'rs',
      suggestion: { source: 'dogfood', kind: 'coverage', stepId: 's6', stepName: 'See confirmation', at: '2026-11-09T10:00:00.000Z' },
    },
  ],
  edges: [],
}

test('suggestion target: derived from the first exercised feature\'s region', () => {
  // s2 exercises f2; in FEATURES_WITH_REGIONS f2 is absent, so use
  // a flow whose blocked step exercises f5 (in Storefront).
  const flow: UserFlowGraphItem = {
    ...FLOW,
    exercises: [{ step: 's2', feature: 'f5' }, { step: 's6', feature: 'f1' }],
  }
  const fix = FEATURES_WITH_REGIONS.nodes.find(n => n.id === 'sg1')!
  assert.deepEqual(suggestionTargetRegion(FEATURES_WITH_REGIONS, flow, fix),
    { regionId: 'r1', regionName: 'Storefront', derived: true })
  // The coverage step s6 exercises f1 in Account in this flow.
  const coverage = FEATURES_WITH_REGIONS.nodes.find(n => n.id === 'sg2')!
  assert.deepEqual(suggestionTargetRegion(FEATURES_WITH_REGIONS, flow, coverage),
    { regionId: 'r2', regionName: 'Account', derived: true })
})

test('suggestion target: top-level exercised feature derives top level; no exercises falls back to the first real region', () => {
  const flow: UserFlowGraphItem = { ...FLOW, exercises: [{ step: 's2', feature: 'f6' }] }
  const fix = FEATURES_WITH_REGIONS.nodes.find(n => n.id === 'sg1')!
  assert.deepEqual(suggestionTargetRegion(FEATURES_WITH_REGIONS, flow, fix),
    { regionId: null, regionName: 'Top level', derived: true })
  const coverage = FEATURES_WITH_REGIONS.nodes.find(n => n.id === 'sg2')!
  assert.deepEqual(suggestionTargetRegion(FEATURES_WITH_REGIONS, flow, coverage),
    { regionId: 'r1', regionName: 'Storefront', derived: false },
    'the fallback is the first real region — never the Suggested region')
  assert.equal(regionOfNodeItem(FEATURES_WITH_REGIONS, 'f5')?.id, 'r1')
  assert.equal(regionOfNodeItem(FEATURES_WITH_REGIONS, 'f6'), null)
})

test('suggestion provenance line names the step, the block, and the run', () => {
  const fix = FEATURES_WITH_REGIONS.nodes.find(n => n.id === 'sg1')!
  assert.equal(suggestionProvenanceLine(fix), 'From step "Submit credentials" · blocked · missing-affordance · run run-1')
  const coverage = FEATURES_WITH_REGIONS.nodes.find(n => n.id === 'sg2')!
  assert.equal(suggestionProvenanceLine(coverage), 'From step "See confirmation" · exercises no feature yet')
})
