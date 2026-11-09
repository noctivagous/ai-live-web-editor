/**
 * User flow graphs: the second graph of the Features Facet, beside
 * the feature graph (src/features/features.ts). The feature graph is
 * the app as built; the user flow graph is the app as used —
 * journeys (regions) made of steps a person takes, each step typed
 * screen / action / outcome and carrying a verification record: was
 * this step actually driven, and what blocked it when it was?
 *
 * Conventions mirror the feature store on purpose: canonical state
 * at `ai-user-flows/graph.json`, a rendered outline at
 * `ai-user-flows/graph.md` regenerated on every save, stable ids,
 * counts COMPUTED from the steps, never stored.
 *
 * The two graphs stay separate stores. The join is the `exercises`
 * link kept here: a step exercises a feature node, by id, in the
 * feature graph. Writing one validates the feature node exists
 * (the feature graph is read, never written, from here); reading
 * the join is the coverage module's job (./coverage.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../launcher.js'
import { getFeatureGraph, gitHeadSync, type GraphSyncInfo } from '../features/features.js'

export type UserFlowStepType = 'screen' | 'action' | 'outcome'

/** Edges between steps of the flow graph itself. The cross-graph
 * link to a feature node is NOT one of these — it is `exercises`,
 * stored separately (its far endpoint lives in another graph). */
export type UserFlowEdgeType = 'navigates-to' | 'submits' | 'branches-on' | 'requires'

export type VerificationState = 'untested' | 'ok' | 'blocked' | 'error'

export type BlockKind = 'unreachable' | 'missing-affordance' | 'console-error' | 'dead-end' | 'state-blocked'

/**
 * Why a step could not be driven, as recorded by a dogfood run:
 * what kind of block, the evidence seen (the console error text,
 * the affordance that was missing), which run saw it, and when
 * (an ISO timestamp — set by whoever records the block).
 */
export interface StepBlock {
  kind: BlockKind
  evidence: string
  runId: string
  at: string
}

export interface StepVerification {
  state: VerificationState
  /** Present only while the state is blocked / error and a block
   * was described; cleared when the step verifies ok or resets. */
  block?: StepBlock
}

export interface UserFlowJourney {
  id: string
  name: string
  note?: string
}

export interface UserFlowStep {
  id: string
  name: string
  type: UserFlowStepType
  /** Containing journey id. Containment is this field, not an edge. */
  journey: string
  note?: string
  verification: StepVerification
}

export interface UserFlowEdge {
  from: string
  to: string
  type: UserFlowEdgeType
}

/** A step exercises a feature: `step` is a step id here, `feature`
 * is a node id in the feature graph. */
export interface ExercisesLink {
  step: string
  feature: string
}

export interface UserFlowGraph {
  version: 1
  title: string
  createdAt: number
  updatedAt: number
  /** Commit + date of the last save, as on the feature graph. */
  sync?: GraphSyncInfo
  journeys: UserFlowJourney[]
  steps: UserFlowStep[]
  edges: UserFlowEdge[]
  exercises: ExercisesLink[]
}

export const USERFLOW_STEP_TYPES: UserFlowStepType[] = ['screen', 'action', 'outcome']
export const USERFLOW_EDGE_TYPES: UserFlowEdgeType[] = ['navigates-to', 'submits', 'branches-on', 'requires']
export const VERIFICATION_STATES: VerificationState[] = ['untested', 'ok', 'blocked', 'error']
export const BLOCK_KINDS: BlockKind[] = ['unreachable', 'missing-affordance', 'console-error', 'dead-end', 'state-blocked']

/** The link type the agent/API use for a cross-graph link. */
export const EXERCISES = 'exercises' as const

export function parseUserFlowStepType(value: unknown): UserFlowStepType | null {
  return USERFLOW_STEP_TYPES.includes(value as UserFlowStepType) ? (value as UserFlowStepType) : null
}
export function parseUserFlowEdgeType(value: unknown): UserFlowEdgeType | null {
  return USERFLOW_EDGE_TYPES.includes(value as UserFlowEdgeType) ? (value as UserFlowEdgeType) : null
}
export function parseVerificationState(value: unknown): VerificationState {
  return VERIFICATION_STATES.includes(value as VerificationState) ? (value as VerificationState) : 'untested'
}
export function parseBlockKind(value: unknown): BlockKind | null {
  return BLOCK_KINDS.includes(value as BlockKind) ? (value as BlockKind) : null
}

function userflowsDir(root = getFsRoot()): string {
  return path.join(root, 'ai-user-flows')
}

function graphPaths(root = getFsRoot()) {
  const dir = userflowsDir(root)
  return { dir, json: path.join(dir, 'graph.json'), md: path.join(dir, 'graph.md') }
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

/* ── Store ──────────────────────────────────────────────────── */

export function getUserFlowGraph(root?: string): UserFlowGraph | null {
  try {
    const raw = JSON.parse(fs.readFileSync(graphPaths(root).json, 'utf-8')) as Partial<UserFlowGraph>
    if (!raw || !Array.isArray(raw.journeys) || !Array.isArray(raw.steps) || !Array.isArray(raw.edges)) return null
    return {
      version: 1,
      title: typeof raw.title === 'string' ? raw.title : 'User flow graph',
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      ...(raw.sync ? { sync: raw.sync } : {}),
      journeys: raw.journeys,
      steps: raw.steps,
      edges: raw.edges,
      exercises: Array.isArray(raw.exercises) ? raw.exercises : [],
    }
  } catch {
    return null
  }
}

export function createUserFlowGraph(title: string, root?: string): UserFlowGraph {
  const existing = getUserFlowGraph(root)
  if (existing) return existing
  const now = Date.now()
  const graph: UserFlowGraph = {
    version: 1,
    title: title.trim() || 'User flow graph',
    createdAt: now,
    updatedAt: now,
    journeys: [],
    steps: [],
    edges: [],
    exercises: [],
  }
  saveUserFlowGraph(graph, root)
  return graph
}

export function saveUserFlowGraph(graph: UserFlowGraph, root?: string): UserFlowGraph {
  graph.updatedAt = Date.now()
  graph.sync = { commit: gitHeadSync(root ?? getFsRoot()), at: graph.updatedAt }
  const p = graphPaths(root)
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(p.json, JSON.stringify(graph, null, 2), 'utf-8')
  fs.writeFileSync(p.md, renderUserFlowMarkdown(graph, featureNames(root)), 'utf-8')
  return graph
}

/** Feature id → name, for the rendered outline's exercises list.
 * Read-only and best-effort: no feature graph, no names (ids show).
 * The feature store never imports this module, so the read cannot
 * cycle; it stays defensive anyway — the outline must never fail. */
function featureNames(root?: string): Map<string, string> | undefined {
  try {
    const features = getFeatureGraph(root)
    if (!features) return undefined
    return new Map(features.nodes.map(n => [n.id, n.name]))
  } catch {
    return undefined
  }
}

/* ── Journeys + steps ───────────────────────────────────────── */

export function addJourney(graph: UserFlowGraph, input: { name: string, note?: string }): UserFlowJourney {
  const journey: UserFlowJourney = {
    id: nextId('j'),
    name: input.name.trim(),
    ...(input.note ? { note: input.note } : {}),
  }
  graph.journeys.push(journey)
  return journey
}

export function getJourney(graph: UserFlowGraph, id: string): UserFlowJourney | null {
  return graph.journeys.find(j => j.id === id) ?? null
}

/** Resolve a journey by id first, then by exact name — the form the
 * agent has in hand when it says "the Checkout journey". */
export function findJourney(graph: UserFlowGraph, idOrName: string): UserFlowJourney | null {
  return getJourney(graph, idOrName) ?? graph.journeys.find(j => j.name === idOrName) ?? null
}

export function getStep(graph: UserFlowGraph, id: string): UserFlowStep | null {
  return graph.steps.find(s => s.id === id) ?? null
}

export function stepsInJourney(graph: UserFlowGraph, journeyId: string): UserFlowStep[] {
  return graph.steps.filter(s => s.journey === journeyId)
}

/**
 * Append a step to a journey. Returns null when the journey does
 * not exist — creating the journey is the caller's explicit act
 * (addJourney), never a side effect of a mistyped id.
 */
export function addStep(
  graph: UserFlowGraph,
  input: { name: string, type: UserFlowStepType, journey: string, note?: string },
): UserFlowStep | null {
  if (!getJourney(graph, input.journey)) return null
  const step: UserFlowStep = {
    id: nextId('s'),
    name: input.name,
    type: input.type,
    journey: input.journey,
    ...(input.note ? { note: input.note } : {}),
    verification: { state: 'untested' },
  }
  graph.steps.push(step)
  return step
}

/**
 * Remove a step: its intra-flow edges and its exercises links go
 * with it (the feature remove rule: edges touching a removed node
 * are removed). Returns the removed step, or null for an unknown id.
 */
export function removeStep(graph: UserFlowGraph, id: string): UserFlowStep | null {
  const step = getStep(graph, id)
  if (!step) return null
  graph.steps = graph.steps.filter(s => s.id !== id)
  graph.edges = graph.edges.filter(e => e.from !== id && e.to !== id)
  graph.exercises = graph.exercises.filter(e => e.step !== id)
  return step
}

/* ── Intra-flow edges ───────────────────────────────────────── */

/** Add an edge; false when an endpoint is missing, it self-links, or it already exists. */
export function addFlowEdge(graph: UserFlowGraph, edge: UserFlowEdge): boolean {
  if (edge.from === edge.to) return false
  if (!getStep(graph, edge.from) || !getStep(graph, edge.to)) return false
  if (graph.edges.some(e => e.from === edge.from && e.to === edge.to && e.type === edge.type)) return false
  graph.edges.push(edge)
  return true
}

export function removeFlowEdge(graph: UserFlowGraph, edge: UserFlowEdge): boolean {
  const before = graph.edges.length
  graph.edges = graph.edges.filter(e => !(e.from === edge.from && e.to === edge.to && e.type === edge.type))
  return graph.edges.length < before
}

/* ── Verification ───────────────────────────────────────────── */

/**
 * Record a step's verification. A `block` is kept only while the
 * state is blocked / error — verifying ok (or resetting to
 * untested) clears any recorded block, so a stale block can never
 * outlive the state it described. Returns false for an unknown step.
 */
export function setVerification(graph: UserFlowGraph, stepId: string, verification: StepVerification): boolean {
  const step = getStep(graph, stepId)
  if (!step) return false
  const keepBlock = (verification.state === 'blocked' || verification.state === 'error') && verification.block
  step.verification = keepBlock
    ? { state: verification.state, block: verification.block }
    : { state: verification.state }
  return true
}

export function stepsByVerification(graph: UserFlowGraph, state: VerificationState): UserFlowStep[] {
  return graph.steps.filter(s => s.verification.state === state)
}

export function searchSteps(graph: UserFlowGraph, text: string): UserFlowStep[] {
  const q = text.toLowerCase()
  return graph.steps.filter(s => s.name.toLowerCase().includes(q))
}

/* ── Exercises links (the cross-graph join) ─────────────────── */

/**
 * Link a step to the feature it exercises. The feature graph is
 * passed in (read) so the link can be validated: returns an error
 * string, or null on success — the feature store's
 * error-string-or-null idiom (setNodeParam, reparentNode).
 */
export function addExercises(
  graph: UserFlowGraph,
  featureGraph: { nodes: Array<{ id: string }> } | null,
  stepId: string,
  featureId: string,
): string | null {
  if (!getStep(graph, stepId)) return `No step with id ${stepId} in the user flow graph.`
  if (!featureGraph) return 'No feature graph in this project yet — an exercises link needs a feature node to point at.'
  if (!featureGraph.nodes.some(n => n.id === featureId)) {
    return `No node with id ${featureId} in the feature graph.`
  }
  if (graph.exercises.some(e => e.step === stepId && e.feature === featureId)) {
    return 'That exercises link already exists.'
  }
  graph.exercises.push({ step: stepId, feature: featureId })
  return null
}

export function removeExercises(graph: UserFlowGraph, stepId: string, featureId: string): boolean {
  const before = graph.exercises.length
  graph.exercises = graph.exercises.filter(e => !(e.step === stepId && e.feature === featureId))
  return graph.exercises.length < before
}

export function exercisesForStep(graph: UserFlowGraph, stepId: string): ExercisesLink[] {
  return graph.exercises.filter(e => e.step === stepId)
}

export function exercisesForFeature(graph: UserFlowGraph, featureId: string): ExercisesLink[] {
  return graph.exercises.filter(e => e.feature === featureId)
}

/* ── Counts + summaries ─────────────────────────────────────── */

export interface UserFlowCounts {
  journeys: number
  steps: number
  ok: number
  blocked: number
  error: number
  untested: number
  /** Share of steps verified ok, 0 when there are no steps. */
  verifiedPct: number
}

export function userFlowCounts(graph: UserFlowGraph): UserFlowCounts {
  const ok = graph.steps.filter(s => s.verification.state === 'ok').length
  return {
    journeys: graph.journeys.length,
    steps: graph.steps.length,
    ok,
    blocked: graph.steps.filter(s => s.verification.state === 'blocked').length,
    error: graph.steps.filter(s => s.verification.state === 'error').length,
    untested: graph.steps.filter(s => s.verification.state === 'untested').length,
    verifiedPct: graph.steps.length ? Math.round((ok / graph.steps.length) * 100) : 0,
  }
}

export interface StepSummary {
  id: string, name: string, type: UserFlowStepType, journey: string,
  verification: VerificationState,
  block?: StepBlock,
  /** Feature node ids this step exercises. */
  exercises: string[],
}

export function stepSummary(graph: UserFlowGraph, step: UserFlowStep): StepSummary {
  return {
    id: step.id, name: step.name, type: step.type, journey: step.journey,
    verification: step.verification.state,
    ...(step.verification.block ? { block: step.verification.block } : {}),
    exercises: exercisesForStep(graph, step.id).map(e => e.feature),
  }
}

/** One-line brief summary, present only when a graph exists. */
export function flowGraphSummary(graph: UserFlowGraph): string {
  const counts = userFlowCounts(graph)
  const journeyText = graph.journeys
    .map(j => `${j.name} (${stepsInJourney(graph, j.id).length})`)
    .join(' · ')
  return (
    `USER FLOW "${graph.title}" — ${counts.journeys} journeys, ${counts.steps} steps, ${counts.verifiedPct}% verified` +
    (counts.blocked ? `, ${counts.blocked} blocked` : '') +
    (counts.error ? `, ${counts.error} in error` : '') +
    (journeyText ? ` (${journeyText})` : '') +
    `. Full record at ai-user-flows/graph.md. Query it with userflow-query before planning user-facing changes; ` +
    `keep verification states current with userflow-set-verification as steps are driven, and grow the graph with ` +
    `userflow-add-step / userflow-link when the app's flows change — edit it in place, never restart it.`
  )
}

/* ── Rendered view ──────────────────────────────────────────── */

const STATE_MARK: Record<VerificationState, string> = {
  untested: '○', ok: '✓', blocked: '✕', error: '⚠',
}

export function renderUserFlowMarkdown(graph: UserFlowGraph, featureNames?: Map<string, string>): string {
  const counts = userFlowCounts(graph)
  const lines: string[] = [
    `# User flow graph: ${graph.title}`,
    '',
    `${counts.steps} steps across ${counts.journeys} journeys · ${counts.verifiedPct}% verified (${counts.ok}/${counts.steps})` +
      (counts.blocked ? ` · ${counts.blocked} blocked` : '') +
      (counts.error ? ` · ${counts.error} in error` : ''),
    '',
  ]
  for (const journey of graph.journeys) {
    lines.push(`## ${journey.name}`, '')
    if (journey.note) lines.push(`_${journey.note}_`, '')
    const steps = stepsInJourney(graph, journey.id)
    if (!steps.length) lines.push('- (no steps yet)')
    for (const step of steps) {
      lines.push(`- ${STATE_MARK[step.verification.state]} ${step.name} — ${step.type}, ${step.verification.state} (${step.id})`)
      if (step.note) lines.push(`  _${step.note}_`)
      const block = step.verification.block
      if (block) lines.push(`  blocked (${block.kind}, run ${block.runId}, ${block.at}): ${block.evidence}`)
    }
    lines.push('')
  }
  if (graph.edges.length) {
    lines.push('## Edges', '')
    const name = (id: string) => getStep(graph, id)?.name ?? id
    for (const e of graph.edges) lines.push(`- ${name(e.from)} —${e.type}→ ${name(e.to)}`)
    lines.push('')
  }
  if (graph.exercises.length) {
    lines.push('## Exercises (flow step → feature)', '')
    const stepName = (id: string) => getStep(graph, id)?.name ?? id
    for (const e of graph.exercises) {
      const feature = featureNames?.get(e.feature)
      lines.push(`- ${stepName(e.step)} —exercises→ ${feature ? `${feature} (${e.feature})` : e.feature}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
