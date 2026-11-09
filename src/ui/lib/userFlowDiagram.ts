/**
 * The user flow pane's pure logic — everything the User Flow view
 * of the graph pane computes from the two graph payloads, kept
 * out of the component so it is testable: the diagram adaptation
 * (journeys and steps in the shared diagram's { nodes, edges }
 * shape), journey rollups over verification states, the
 * verification → tone mapping, a step's neighbours, the
 * cross-graph coverage read, the latest recorded block, and the
 * snapshot diff that narrates poll changes in the pane's feed.
 *
 * The store (src/userflows) stays server-side; this module reads
 * the API payload shapes only. The coverage answers mirror
 * src/userflows/coverage.ts exactly, computed client-side because
 * the pane already holds both graphs.
 */
import type { DiagramEdge, DiagramNode } from './graphDiagram.js'
import type {
  FeatureGraphItem, FeatureNodeItem, UserFlowEdgeItem, UserFlowGraphItem, UserFlowStepItem, VerificationState,
} from './api.js'

/* ── Diagram adaptation ───────────────────────────────────────
 * Journeys become region nodes (kind 'region', the diagram's box
 * rule) and steps become cards contained by their journey; the
 * step's kind slot carries its type (screen / action / outcome)
 * and the status slot its verification state, so the shared
 * diagram renders a flow graph with no flow-specific code. */

export function flowDiagramNodes(graph: UserFlowGraphItem): DiagramNode[] {
  const journeys: DiagramNode[] = graph.journeys.map(j => ({ id: j.id, name: j.name, kind: 'region', status: 'journey' }))
  const steps: DiagramNode[] = graph.steps.map(s => ({
    id: s.id, name: s.name, kind: s.type, status: s.verification.state, parent: s.journey,
  }))
  return [...journeys, ...steps]
}

export function flowDiagramEdges(graph: UserFlowGraphItem): DiagramEdge[] {
  return graph.edges.map(e => ({ from: e.from, to: e.to, type: e.type }))
}

/* ── Rollups ──────────────────────────────────────────────────
 * A journey's rollup is about verification, not building: pct is
 * the share of steps verified ok, and blocked / error / untested
 * are counted separately — a journey can be fully mapped and
 * barely verified, and the two facts must not blur. */

export interface JourneyRollup {
  total: number
  ok: number
  blocked: number
  error: number
  untested: number
  pct: number
}

export function journeyRollup(steps: UserFlowStepItem[]): JourneyRollup {
  const count = (state: VerificationState) => steps.filter(s => s.verification.state === state).length
  const ok = count('ok')
  return {
    total: steps.length,
    ok,
    blocked: count('blocked'),
    error: count('error'),
    untested: count('untested'),
    pct: steps.length ? Math.round((ok / steps.length) * 100) : 0,
  }
}

export function journeyRollups(graph: UserFlowGraphItem): Map<string, JourneyRollup> {
  const out = new Map<string, JourneyRollup>()
  for (const j of graph.journeys) {
    out.set(j.id, journeyRollup(graph.steps.filter(s => s.journey === j.id)))
  }
  return out
}

/** The shared diagram's narrower rollup shape (its bar + %):
 * verified-ok steps stand where built features stand. */
export function diagramRollup(rollup: JourneyRollup): { pct: number, built: number, total: number } {
  return { pct: rollup.pct, built: rollup.ok, total: rollup.total }
}

/* ── Verification presentation ────────────────────────────────
 * One mapping, used by the report rows, the diagram cards (via
 * statusColor) and the inspector, so a state reads the same
 * everywhere in the pane. */

export type VerificationTone = 'ok' | 'blocked' | 'error' | 'untested'

export function verificationTone(state: VerificationState): VerificationTone {
  return state
}

export const VERIFICATION_COLOR: Record<VerificationTone, string> = {
  ok: 'var(--green)',
  blocked: 'var(--red)',
  error: 'var(--amber)',
  untested: 'var(--text-muted, #8a8a8c)',
}

export function verificationColor(state: VerificationState): string {
  return VERIFICATION_COLOR[verificationTone(state)]
}

/** The short badge a blocked / error step carries: state first,
 * the block kind when one was recorded ("blocked · dead-end"). */
export function verificationBadge(step: UserFlowStepItem): string | null {
  const { state, block } = step.verification
  if (state !== 'blocked' && state !== 'error') return null
  return block ? `${state} · ${block.kind}` : state
}

/* ── Neighbours ─────────────────────────────────────────────── */

export const FLOW_EDGE_LABELS: Record<UserFlowEdgeItem['type'], { out: string, into: string }> = {
  'navigates-to': { out: 'navigates to', into: 'navigated from' },
  submits: { out: 'submits', into: 'submitted from' },
  'branches-on': { out: 'branches on', into: 'branch point for' },
  requires: { out: 'requires', into: 'required by' },
}

export interface StepNeighbour {
  label: string
  step: UserFlowStepItem
  edge: UserFlowEdgeItem
  direction: 'out' | 'in'
}

/** A step's intra-flow wiring, in graph edge order — the flow
 * mirror of the feature inspector's Connections list. */
export function stepNeighbours(graph: UserFlowGraphItem, stepId: string): StepNeighbour[] {
  const byId = new Map(graph.steps.map(s => [s.id, s]))
  const out: StepNeighbour[] = []
  for (const e of graph.edges) {
    if (e.from === stepId) {
      const step = byId.get(e.to)
      if (step) out.push({ label: FLOW_EDGE_LABELS[e.type].out, step, edge: e, direction: 'out' })
    }
    if (e.to === stepId) {
      const step = byId.get(e.from)
      if (step) out.push({ label: FLOW_EDGE_LABELS[e.type].into, step, edge: e, direction: 'in' })
    }
  }
  return out
}

/** Feature nodes a step exercises, resolved against the feature
 * graph; links pointing at a since-removed feature are dropped
 * (the pane cannot render a chip for a node that is not there). */
export function exercisesOfStep(
  flow: UserFlowGraphItem, features: FeatureGraphItem | null, stepId: string,
): FeatureNodeItem[] {
  if (!features) return []
  const byId = new Map(features.nodes.map(n => [n.id, n]))
  return flow.exercises
    .filter(e => e.step === stepId)
    .map(e => byId.get(e.feature))
    .filter((n): n is FeatureNodeItem => !!n)
}

/* ── Coverage (the two graphs read together) ──────────────────
 * The client-side mirror of src/userflows/coverage.ts: same
 * questions, same graph-order results, over payload shapes. */

export interface FlowCoverage {
  /** Total exercises links, resolved or not. */
  links: number
  stepsWithoutFeatures: UserFlowStepItem[]
  featuresNeverExercised: FeatureNodeItem[]
  featuresOnBlockedSteps: { feature: FeatureNodeItem, steps: UserFlowStepItem[] }[]
}

export function flowCoverage(flow: UserFlowGraphItem, features: FeatureGraphItem | null): FlowCoverage {
  const exercisedSteps = new Set(flow.exercises.map(e => e.step))
  const stepsWithoutFeatures = flow.steps.filter(s => !exercisedSteps.has(s.id))
  if (!features) {
    return { links: flow.exercises.length, stepsWithoutFeatures, featuresNeverExercised: [], featuresOnBlockedSteps: [] }
  }
  const featureById = new Map(features.nodes.map(n => [n.id, n]))
  const exercisedFeatures = new Set(flow.exercises.map(e => e.feature))
  const featuresNeverExercised = features.nodes.filter(n => !exercisedFeatures.has(n.id))
  const byFeature = new Map<string, UserFlowStepItem[]>()
  for (const step of flow.steps) {
    if (step.verification.state !== 'blocked' && step.verification.state !== 'error') continue
    for (const link of flow.exercises) {
      if (link.step !== step.id) continue
      const list = byFeature.get(link.feature) ?? []
      list.push(step)
      byFeature.set(link.feature, list)
    }
  }
  const featuresOnBlockedSteps = [...byFeature.entries()]
    .map(([featureId, steps]) => ({ feature: featureById.get(featureId), steps }))
    .filter((x): x is { feature: FeatureNodeItem, steps: UserFlowStepItem[] } => !!x.feature)
  return { links: flow.exercises.length, stepsWithoutFeatures, featuresNeverExercised, featuresOnBlockedSteps }
}

/* ── Flow-blocked features + suggestion targets ───────────────
 * The Features view's cross-graph reads: which features a
 * blocked step implicates (the "flow blocked" badge), and where
 * an accepted suggestion would land. The accept-target rule
 * mirrors src/features/suggestions.ts derivedAcceptRegion — the
 * pane shows the target on the card before the user accepts, and
 * sends it explicitly, so the two never disagree in practice. */

export const SUGGESTED_REGION_NAME = 'Suggested by dogfooding'

/** feature id → the blocked / error steps exercising it, in
 * flow order. A feature with no entry is not flow-blocked. */
export function flowBlockedByFeature(
  flow: UserFlowGraphItem, features: FeatureGraphItem | null,
): Map<string, UserFlowStepItem[]> {
  return new Map(flowCoverage(flow, features).featuresOnBlockedSteps.map(x => [x.feature.id, x.steps]))
}

/** The region containing a node (nearest region ancestor), or
 * null at top level. */
export function regionOfNodeItem(features: FeatureGraphItem, nodeId: string): FeatureNodeItem | null {
  const byId = new Map(features.nodes.map(n => [n.id, n]))
  let cur = byId.get(nodeId)
  const seen = new Set<string>()
  while (cur?.parent && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur = byId.get(cur.parent)
    if (cur?.kind === 'region') return cur
  }
  return null
}

export interface SuggestionTarget {
  /** Region id to land in, or null for top level. */
  regionId: string | null
  regionName: string
  /** True when the target came from the step's exercises (the
   * region of its first exercised feature, or top level when
   * that feature is top-level); false for the fallback. */
  derived: boolean
}

/** Where accepting this suggestion would put it: the region of
 * the first feature its source step exercises; otherwise the
 * first real region; otherwise top level. */
export function suggestionTargetRegion(
  features: FeatureGraphItem, flow: UserFlowGraphItem | null, node: FeatureNodeItem,
): SuggestionTarget {
  const regions = features.nodes.filter(n => n.kind === 'region' && n.name !== SUGGESTED_REGION_NAME)
  const stepId = node.suggestion?.stepId
  if (flow && stepId && flow.steps.some(s => s.id === stepId)) {
    for (const link of flow.exercises) {
      if (link.step !== stepId) continue
      const feature = features.nodes.find(n => n.id === link.feature)
      if (!feature) continue
      const region = regionOfNodeItem(features, feature.id)
      if (region && region.name !== SUGGESTED_REGION_NAME) {
        return { regionId: region.id, regionName: region.name, derived: true }
      }
      if (!region) return { regionId: null, regionName: 'Top level', derived: true }
    }
  }
  const first = regions[0]
  return first
    ? { regionId: first.id, regionName: first.name, derived: false }
    : { regionId: null, regionName: 'Top level', derived: false }
}

/** The one-line provenance shown on a suggestion card. */
export function suggestionProvenanceLine(node: FeatureNodeItem): string {
  const p = node.suggestion
  if (!p) return ''
  if (p.kind === 'coverage') return `From step "${p.stepName}" · exercises no feature yet`
  const parts = [`From step "${p.stepName}"`, p.state ?? 'blocked', ...(p.blockKind ? [p.blockKind] : []), ...(p.runId ? [`run ${p.runId}`] : [])]
  return parts.join(' · ')
}

/* ── Latest recorded block ────────────────────────────────────
 * The most run provenance the graph honestly carries: a block
 * records its run id and when it was recorded, an ok records
 * neither — so there is no truthful "last run" line (a later
 * all-ok run leaves no stamp), but the most recent block IS
 * derivable, labelled as what it is. */

export interface LatestBlock {
  step: UserFlowStepItem
  kind: string
  runId?: string
  at: string
}

export function latestBlockRecord(graph: UserFlowGraphItem): LatestBlock | null {
  let best: LatestBlock | null = null
  let bestAt = -Infinity
  for (const step of graph.steps) {
    const block = step.verification.block
    if (!block || (step.verification.state !== 'blocked' && step.verification.state !== 'error')) continue
    const at = Date.parse(block.at)
    if (Number.isNaN(at) || at < bestAt) continue
    bestAt = at
    best = { step, kind: block.kind, ...(block.runId ? { runId: block.runId } : {}), at: block.at }
  }
  return best
}

/* ── Snapshot diff → feed narration + flash ───────────────────
 * Mirrors the feature pane's diffGraphs: what changed between
 * two polls, in words for the feed, with the touched steps
 * marked to flash. */

export function diffFlowGraphs(
  prev: UserFlowGraphItem,
  next: UserFlowGraphItem,
  featureName?: (id: string) => string | undefined,
): { feed: string[], flash: Record<string, 'added' | 'changed'> } {
  const feed: string[] = []
  const flash: Record<string, 'added' | 'changed'> = {}
  const prevSteps = new Map(prev.steps.map(s => [s.id, s]))
  const nextSteps = new Map(next.steps.map(s => [s.id, s]))
  const prevJourneys = new Map(prev.journeys.map(j => [j.id, j]))
  const nextJourneys = new Map(next.journeys.map(j => [j.id, j]))
  const stepName = (id: string) => nextSteps.get(id)?.name ?? prevSteps.get(id)?.name ?? id
  const journeyName = (id: string) => nextJourneys.get(id)?.name ?? prevJourneys.get(id)?.name ?? id

  for (const j of next.journeys) {
    if (!prevJourneys.has(j.id)) feed.push(`Journey added — ${j.name}`)
  }
  for (const j of prev.journeys) {
    if (!nextJourneys.has(j.id)) feed.push(`Journey removed — ${j.name}`)
  }
  for (const s of next.steps) {
    const p = prevSteps.get(s.id)
    if (!p) { flash[s.id] = 'added'; feed.push(`Step added — ${s.name} (${s.type})`) }
    else if (p.verification.state !== s.verification.state) {
      flash[s.id] = 'changed'
      const block = s.verification.block
      const detail = block && (s.verification.state === 'blocked' || s.verification.state === 'error') ? ` — ${block.kind}` : ''
      feed.push(`Verification — ${s.name}: ${p.verification.state} → ${s.verification.state}${detail}`)
    }
    else if (
      (s.verification.state === 'blocked' || s.verification.state === 'error') &&
      (p.verification.block?.kind !== s.verification.block?.kind || p.verification.block?.runId !== s.verification.block?.runId)
    ) {
      // Same state, new block: a re-run re-blocked the step (a
      // different kind, or a fresh run's record). The state alone
      // did not change, but the pane must still say so — otherwise
      // a second dogfood run looks like it never touched the step.
      flash[s.id] = 'changed'
      const block = s.verification.block
      const kind = block ? ` — ${block.kind}` : ''
      const run = block?.runId ? ` (run ${block.runId})` : ''
      feed.push(`Verification — ${s.name}: still ${s.verification.state}${kind}${run}`)
    }
    else if (p.name !== s.name) { flash[s.id] = 'changed'; feed.push(`Renamed — ${p.name} → ${s.name}`) }
    else if (p.type !== s.type) { flash[s.id] = 'changed'; feed.push(`Retyped — ${s.name}: ${p.type} → ${s.type}`) }
    else if (p.journey !== s.journey) { flash[s.id] = 'changed'; feed.push(`Moved — ${s.name} → ${journeyName(s.journey)}`) }
  }
  for (const p of prev.steps) {
    if (!nextSteps.has(p.id)) feed.push(`Step removed — ${p.name}`)
  }
  const edgeKey = (e: UserFlowEdgeItem) => `${e.from}|${e.to}|${e.type}`
  const prevEdges = new Map(prev.edges.map(e => [edgeKey(e), e]))
  const nextEdges = new Map(next.edges.map(e => [edgeKey(e), e]))
  for (const [k, e] of nextEdges) if (!prevEdges.has(k)) feed.push(`Edge added — ${stepName(e.from)} ${e.type} ${stepName(e.to)}`)
  for (const [k, e] of prevEdges) if (!nextEdges.has(k)) feed.push(`Edge removed — ${stepName(e.from)} ${e.type} ${stepName(e.to)}`)
  const exKey = (e: { step: string, feature: string }) => `${e.step}|${e.feature}`
  const prevEx = new Map(prev.exercises.map(e => [exKey(e), e]))
  const nextEx = new Map(next.exercises.map(e => [exKey(e), e]))
  const fname = (id: string) => featureName?.(id) ?? id
  for (const [k, e] of nextEx) if (!prevEx.has(k)) feed.push(`Exercises added — ${stepName(e.step)} exercises ${fname(e.feature)}`)
  for (const [k, e] of prevEx) if (!nextEx.has(k)) feed.push(`Exercises removed — ${stepName(e.step)} exercises ${fname(e.feature)}`)
  return { feed, flash }
}
