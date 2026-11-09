/**
 * Coverage: the questions the two graphs answer together, asked
 * over the `exercises` join (a flow step exercises a feature node).
 * Pure functions of the two graphs — no store, no server — so the
 * agent tool, the API and the tests all read the same answers.
 * Every result is in graph order (the order nodes/steps were added),
 * never sorted — the maps read the way they were drawn.
 */
import type { FeatureGraph } from '../features/features.js'
import { exercisesForStep, type UserFlowGraph } from './userflows.js'

/**
 * Feature nodes no step exercises — built (or planned) surface that
 * no recorded user flow ever touches. Ids, in feature-graph order.
 */
export function featuresNeverExercised(featureGraph: FeatureGraph, flowGraph: UserFlowGraph): string[] {
  const exercised = new Set(flowGraph.exercises.map(e => e.feature))
  return featureGraph.nodes.filter(n => !exercised.has(n.id)).map(n => n.id)
}

/** Steps that exercise no feature at all — flow with nothing built
 * (or nothing recorded) behind it. Ids, in flow-graph order. */
export function stepsWithoutFeatures(flowGraph: UserFlowGraph): string[] {
  return flowGraph.steps.filter(s => exercisesForStep(flowGraph, s.id).length === 0).map(s => s.id)
}

export interface BlockedFeature {
  feature: string
  /** Ids of the blocked / error steps exercising it, in flow order. */
  steps: string[]
}

/**
 * Features exercised by at least one step whose verification state
 * is blocked or error — where a broken flow touches the built app.
 * Features are ordered by their first blocked step, in flow order.
 */
export function featuresOnBlockedSteps(flowGraph: UserFlowGraph): BlockedFeature[] {
  const byFeature = new Map<string, string[]>()
  for (const step of flowGraph.steps) {
    if (step.verification.state !== 'blocked' && step.verification.state !== 'error') continue
    for (const link of exercisesForStep(flowGraph, step.id)) {
      const list = byFeature.get(link.feature) ?? []
      list.push(step.id)
      byFeature.set(link.feature, list)
    }
  }
  return [...byFeature.entries()].map(([feature, steps]) => ({ feature, steps }))
}
