import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FeatureGraph } from '../features/features.js'
import type { UserFlowGraph, UserFlowStep } from './userflows.js'
import { featuresNeverExercised, featuresOnBlockedSteps, stepsWithoutFeatures } from './coverage.js'

function featureGraph(ids: string[]): FeatureGraph {
  return {
    version: 1, title: 'App', createdAt: 0, updatedAt: 0,
    nodes: ids.map(id => ({ id, name: id, kind: 'feature' as const, status: 'done' as const })),
    edges: [],
  }
}

function step(id: string, state: UserFlowStep['verification']['state'] = 'untested'): UserFlowStep {
  return { id, name: id, type: 'screen', journey: 'j1', verification: { state } }
}

function userFlowGraph(steps: UserFlowStep[], exercises: Array<{ step: string, feature: string }>): UserFlowGraph {
  return {
    version: 1, title: 'Flows', createdAt: 0, updatedAt: 0,
    journeys: [{ id: 'j1', name: 'Journey' }],
    steps, edges: [], exercises,
  }
}

test('empty graphs: nothing is covered, nothing is missing, nothing is blocked', () => {
  const features = featureGraph([])
  const userflows = userFlowGraph([], [])
  assert.deepEqual(featuresNeverExercised(features, userflows), [])
  assert.deepEqual(stepsWithoutFeatures(userflows), [])
  assert.deepEqual(featuresOnBlockedSteps(userflows), [])
})

test('no exercises links at all: every feature is unexercised, every step bare', () => {
  const features = featureGraph(['f-cart', 'f-pay'])
  const userflows = userFlowGraph([step('s1'), step('s2')], [])
  assert.deepEqual(featuresNeverExercised(features, userflows), ['f-cart', 'f-pay'], 'feature-graph order')
  assert.deepEqual(stepsWithoutFeatures(userflows), ['s1', 's2'], 'flow-graph order')
})

test('the join reads both ways, and only blocked / error steps implicate a feature', () => {
  const features = featureGraph(['f-cart', 'f-pay', 'f-admin'])
  const userflows = userFlowGraph(
    [step('s-cart', 'ok'), step('s-pay', 'blocked'), step('s-help')],
    [
      { step: 's-cart', feature: 'f-cart' },
      { step: 's-pay', feature: 'f-cart' },
      { step: 's-pay', feature: 'f-pay' },
    ],
  )
  assert.deepEqual(featuresNeverExercised(features, userflows), ['f-admin'])
  assert.deepEqual(stepsWithoutFeatures(userflows), ['s-help'])
  assert.deepEqual(featuresOnBlockedSteps(userflows), [
    { feature: 'f-cart', steps: ['s-pay'] },
    { feature: 'f-pay', steps: ['s-pay'] },
  ], 'the ok step exercising f-cart does not implicate it — the blocked one does')
})

test('error counts like blocked; a feature on two bad steps lists both, in flow order', () => {
  const userflows = userFlowGraph(
    [step('s1', 'error'), step('s2', 'ok'), step('s3', 'blocked')],
    [
      { step: 's1', feature: 'f-x' },
      { step: 's2', feature: 'f-x' },
      { step: 's3', feature: 'f-x' },
      { step: 's3', feature: 'f-y' },
    ],
  )
  assert.deepEqual(featuresOnBlockedSteps(userflows), [
    { feature: 'f-x', steps: ['s1', 's3'] },
    { feature: 'f-y', steps: ['s3'] },
  ])
})
