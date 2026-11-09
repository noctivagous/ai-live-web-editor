/**
 * Dogfood suggestions: the reflection from the user flow graph
 * into the feature graph. A dogfood run records how each flow
 * step actually behaved; derivation turns that record into
 * *suggested* feature nodes the user reviews — accept one and it
 * becomes a normal planned node in a real region; dismiss one
 * and the dismissal is remembered on the feature graph, so the
 * same suggestion is never offered again.
 *
 * Derivation is deterministic system logic over the two graphs —
 * never agent text. The candidates mirror the coverage module's
 * questions (src/userflows/coverage.ts):
 *  (a) every step currently blocked or in error → a fix
 *      suggestion, keyed by step + block kind;
 *  (b) every step with no exercises link (and not already
 *      covered by (a)) → a coverage suggestion, keyed by step.
 * One suggestion per qualifying step. Derivation is idempotent
 * and self-cleaning: a candidate that already has a live
 * suggestion is left alone; a live suggestion whose step no
 * longer qualifies (it verified ok, or now blocks with a
 * different kind) is withdrawn. An ACCEPTED node is a normal
 * node — derivation never touches it again.
 *
 * Names are mechanical, from the step and its block:
 *  fix:      `Fix <step name> (<block kind>)` — the state when
 *            no block was recorded: `Fix <step name> (blocked)`.
 *  coverage: `Add feature for <step name>`.
 * The detail (evidence, run) rides in the node's provenance and
 * note, not in the name.
 */
import {
  addNode, getNode, removeNode,
  type DismissedSuggestion, type FeatureGraph, type FeatureNode, type SuggestionProvenance,
} from './features.js'
import {
  exercisesForStep, getStep,
  type UserFlowGraph, type UserFlowStep,
} from '../userflows/userflows.js'

export const SUGGESTED_REGION_NAME = 'Suggested by dogfooding'

/* ── Identity ─────────────────────────────────────────────────
 * The key is the suggestion's durable identity — dedupe,
 * withdrawal and dismissal memory all key off it. */

export function suggestionKey(kind: 'fix' | 'coverage', stepId: string, blockKind?: string): string {
  return kind === 'fix' ? `fix:${stepId}:${blockKind ?? ''}` : `coverage:${stepId}`
}

export function keyOfProvenance(p: SuggestionProvenance): string {
  return suggestionKey(p.kind, p.stepId, p.blockKind)
}

/** Live suggestions: unreviewed nodes derivation created. A node
 * the user (or an agent) set to 'suggested' by hand, with no
 * provenance, is not derivation's to manage. */
export function liveSuggestions(graph: FeatureGraph): FeatureNode[] {
  return graph.nodes.filter(n => n.status === 'suggested' && n.suggestion)
}

export function suggestedRegion(graph: FeatureGraph): FeatureNode | null {
  return graph.nodes.find(n => n.kind === 'region' && n.name === SUGGESTED_REGION_NAME) ?? null
}

function findOrCreateSuggestedRegion(graph: FeatureGraph): FeatureNode {
  return suggestedRegion(graph) ?? addNode(graph, { name: SUGGESTED_REGION_NAME, kind: 'region' })
}

/** The region containing a node: its nearest region ancestor,
 * or null when it sits at top level (or under no region). */
export function regionOfNode(graph: FeatureGraph, nodeId: string): FeatureNode | null {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  let cur = byId.get(nodeId)
  const seen = new Set<string>()
  while (cur?.parent && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur = byId.get(cur.parent)
    if (cur?.kind === 'region') return cur
  }
  return null
}

/** Regions a suggestion may be accepted into: every region
 * except the Suggested region itself, in graph order. */
export function realRegions(graph: FeatureGraph): FeatureNode[] {
  const suggested = suggestedRegion(graph)
  return graph.nodes.filter(n => n.kind === 'region' && n.id !== suggested?.id)
}

/* ── Candidates ─────────────────────────────────────────────── */

export interface SuggestionCandidate {
  key: string
  kind: 'fix' | 'coverage'
  stepId: string
  stepName: string
  state?: 'blocked' | 'error'
  blockKind?: string
  evidence?: string
  runId?: string
}

/** What the flow graph currently asks for, in flow-graph order.
 * Pure — the same inputs always yield the same candidates. */
export function suggestionCandidates(flowGraph: UserFlowGraph): SuggestionCandidate[] {
  const out: SuggestionCandidate[] = []
  for (const step of flowGraph.steps) {
    const state = step.verification.state
    if (state === 'blocked' || state === 'error') {
      const block = step.verification.block
      out.push({
        key: suggestionKey('fix', step.id, block?.kind),
        kind: 'fix',
        stepId: step.id,
        stepName: step.name,
        state,
        ...(block?.kind ? { blockKind: block.kind } : {}),
        ...(block?.evidence ? { evidence: block.evidence } : {}),
        ...(block?.runId ? { runId: block.runId } : {}),
      })
    } else if (exercisesForStep(flowGraph, step.id).length === 0) {
      out.push({
        key: suggestionKey('coverage', step.id),
        kind: 'coverage',
        stepId: step.id,
        stepName: step.name,
      })
    }
  }
  return out
}

/** The mechanical name for a candidate — see the module header. */
export function suggestionName(candidate: SuggestionCandidate): string {
  if (candidate.kind === 'coverage') return `Add feature for ${candidate.stepName}`
  return `Fix ${candidate.stepName} (${candidate.blockKind ?? candidate.state ?? 'blocked'})`
}

/** The human-readable provenance line, stored as the node's note
 * (and shown on its card): where it came from, in one sentence. */
export function suggestionNote(candidate: SuggestionCandidate): string {
  if (candidate.kind === 'coverage') {
    return `Suggested by dogfooding: the flow step "${candidate.stepName}" exercises no feature yet.`
  }
  const parts = [
    `Suggested by dogfooding: the flow step "${candidate.stepName}" is ${candidate.state}`,
    candidate.blockKind ? `(${candidate.blockKind})` : '',
    candidate.runId ? `in run ${candidate.runId}` : '',
  ].filter(Boolean)
  return parts.join(' ') + (candidate.evidence ? `. Evidence: ${candidate.evidence}` : '.')
}

/* ── Derivation ─────────────────────────────────────────────── */

export interface DeriveResult {
  created: FeatureNode[]
  withdrawn: FeatureNode[]
  /** Candidates skipped because their key was dismissed before. */
  skippedDismissed: number
  /** Candidates already tracked — by a live suggestion, or by
   * the accepted node that suggestion became. */
  alreadyLive: number
}

/**
 * Run derivation over the two graphs, mutating the feature graph
 * in place (the caller saves). Idempotent: running it twice in a
 * row creates nothing the second time.
 */
export function deriveSuggestions(
  featureGraph: FeatureGraph,
  flowGraph: UserFlowGraph,
  at: string = new Date().toISOString(),
): DeriveResult {
  const candidates = suggestionCandidates(flowGraph)
  const candidateKeys = new Set(candidates.map(c => c.key))
  const dismissedKeys = new Set((featureGraph.dismissedSuggestions ?? []).map(d => d.key))
  const live = liveSuggestions(featureGraph)
  const liveByKey = new Map(live.map(n => [keyOfProvenance(n.suggestion!), n]))
  // Keys already tracked by a node derivation created earlier —
  // including ACCEPTED ones. Accepting a fix does not unblock the
  // step (the work is only planned), so without this the next
  // derivation would pile a duplicate suggestion on top of the
  // planned node that already tracks the step + kind.
  const trackedKeys = new Set(
    featureGraph.nodes.filter(n => n.suggestion).map(n => keyOfProvenance(n.suggestion!)),
  )

  // Withdraw live suggestions whose step no longer qualifies —
  // it verified ok, its block kind changed (the new kind derives
  // its own suggestion below), or the step left the flow graph.
  const withdrawn: FeatureNode[] = []
  for (const node of live) {
    if (!candidateKeys.has(keyOfProvenance(node.suggestion!))) {
      removeNode(featureGraph, node.id, 'cascade')
      withdrawn.push(node)
    }
  }

  const created: FeatureNode[] = []
  let skippedDismissed = 0
  let alreadyLive = 0
  for (const candidate of candidates) {
    if (dismissedKeys.has(candidate.key)) { skippedDismissed += 1; continue }
    if (liveByKey.has(candidate.key) || trackedKeys.has(candidate.key)) { alreadyLive += 1; continue }
    // The region is created lazily, at the first real suggestion —
    // a run with nothing to suggest leaves no empty region behind.
    const region = findOrCreateSuggestedRegion(featureGraph)
    created.push(addNode(featureGraph, {
      name: suggestionName(candidate),
      kind: 'feature',
      status: 'suggested',
      parent: region.id,
      note: suggestionNote(candidate),
      suggestion: {
        source: 'dogfood',
        kind: candidate.kind,
        stepId: candidate.stepId,
        stepName: candidate.stepName,
        ...(candidate.state ? { state: candidate.state } : {}),
        ...(candidate.blockKind ? { blockKind: candidate.blockKind } : {}),
        ...(candidate.evidence ? { evidence: candidate.evidence } : {}),
        ...(candidate.runId ? { runId: candidate.runId } : {}),
        at,
      },
    }))
  }
  return { created, withdrawn, skippedDismissed, alreadyLive }
}

/* ── Accept / dismiss ───────────────────────────────────────── */

/**
 * The region a suggestion lands in when accepted without an
 * explicit choice: when its source step exercises at least one
 * feature, the region containing the FIRST exercised feature;
 * otherwise the first real region; otherwise null (top level).
 * Pure — the pane mirrors this to show the target before asking.
 */
export function derivedAcceptRegion(
  featureGraph: FeatureGraph,
  flowGraph: UserFlowGraph | null,
  node: FeatureNode,
): FeatureNode | null {
  const stepId = node.suggestion?.stepId
  if (flowGraph && stepId && getStep(flowGraph, stepId)) {
    for (const link of exercisesForStep(flowGraph, stepId)) {
      const feature = getNode(featureGraph, link.feature)
      if (!feature) continue
      const region = regionOfNode(featureGraph, feature.id)
      if (region && region.id !== suggestedRegion(featureGraph)?.id) return region
      if (!region) return null // the exercised feature is top-level: stay top-level
    }
  }
  return realRegions(featureGraph)[0] ?? null
}

/**
 * Accept a suggestion: it becomes a normal 'planned' node in the
 * target region. `regionId` — a region id to land in, null for
 * top level, undefined to derive the target (derivedAcceptRegion).
 * Provenance stays on the node. Returns an error string, or null.
 */
export function acceptSuggestion(
  featureGraph: FeatureGraph,
  flowGraph: UserFlowGraph | null,
  nodeId: string,
  regionId?: string | null,
): string | null {
  const node = getNode(featureGraph, nodeId)
  if (!node) return `No node with id ${nodeId} in the feature graph.`
  if (node.status !== 'suggested' || !node.suggestion) {
    return `"${node.name}" is not a live dogfood suggestion.`
  }
  let target: FeatureNode | null
  if (regionId === undefined) {
    target = derivedAcceptRegion(featureGraph, flowGraph, node)
  } else if (regionId === null) {
    target = null
  } else {
    const region = getNode(featureGraph, regionId)
    if (!region || region.kind !== 'region') return `No region with id ${regionId} in the feature graph.`
    if (region.id === suggestedRegion(featureGraph)?.id) {
      return 'A suggestion cannot be accepted into the Suggested by dogfooding region itself.'
    }
    target = region
  }
  node.status = 'planned'
  if (target) node.parent = target.id
  else delete node.parent
  return null
}

/**
 * Dismiss a suggestion: the node is removed and the dismissal is
 * recorded on the graph under the suggestion's key, so later
 * derivations skip it permanently. Returns the record, or null
 * when the node is not a live suggestion.
 */
export function dismissSuggestion(
  featureGraph: FeatureGraph,
  nodeId: string,
  at: string = new Date().toISOString(),
): DismissedSuggestion | null {
  const node = getNode(featureGraph, nodeId)
  if (!node || node.status !== 'suggested' || !node.suggestion) return null
  const p = node.suggestion
  const record: DismissedSuggestion = {
    key: keyOfProvenance(p),
    kind: p.kind,
    stepId: p.stepId,
    stepName: p.stepName,
    ...(p.blockKind ? { blockKind: p.blockKind } : {}),
    name: node.name,
    at,
  }
  featureGraph.dismissedSuggestions ??= []
  if (!featureGraph.dismissedSuggestions.some(d => d.key === record.key)) {
    featureGraph.dismissedSuggestions.push(record)
  }
  removeNode(featureGraph, nodeId, 'cascade')
  return record
}

/** Steps (from a flow graph) whose exercises touch a feature —
 * exported for the API/tool summaries that name what changed. */
export function sourceStep(flowGraph: UserFlowGraph | null, node: FeatureNode): UserFlowStep | null {
  if (!flowGraph || !node.suggestion) return null
  return getStep(flowGraph, node.suggestion.stepId)
}
