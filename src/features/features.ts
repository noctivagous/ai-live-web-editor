/**
 * Feature graphs (planning section): the durable map of a whole app.
 *
 * A plan is a route — one job, finished and gone. The feature graph
 * is the territory the routes cross: regions and their features,
 * screens, components, settings and services, joined by typed edges,
 * each node carrying a build status. Plans are generated from
 * subgraphs and write status back; the graph persists across jobs
 * and sessions, so a large app can be built in pieces without
 * re-deriving its shape every time.
 *
 * Conventions mirror the plans store on purpose: canonical state at
 * `ai-features/graph.json`, a rendered outline at
 * `ai-features/graph.md` regenerated on every save, stable node ids
 * so the agent edits in place, and status rollups COMPUTED from the
 * leaves, never stored.
 *
 * The ladder (framework convenience → applied pattern → common
 * feature) is recorded on nodes: `derivedFrom` names the layout,
 * template or pack a node derives from or realizes (master-detail →
 * a settings screen → the admin/configuration pack). Catalog tiers:
 * components bind via `component`, templates via `template`,
 * feature packs (tier 3) via `pack`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { getFsRoot } from '../launcher.js'

export type FeatureStatus =
  | 'proposed' | 'planned' | 'building' | 'done' | 'verified' | 'blocked' | 'dropped'

export type FeatureNodeKind =
  | 'region' | 'feature' | 'screen' | 'component' | 'setting' | 'data' | 'service'

/** Cross-node edges. Containment is the node's `parent` field, not an edge. */
export type FeatureEdgeType =
  | 'depends-on' | 'configures' | 'renders' | 'data-flows' | 'derived-from'

export interface FeatureParam {
  name: string
  type: 'text' | 'choice' | 'boolean' | 'color' | 'number'
  options?: string[]
  default?: string
}

export interface FeatureNode {
  id: string
  name: string
  kind: FeatureNodeKind
  status: FeatureStatus
  /** Containing region/feature node id; absent = top level. */
  parent?: string
  /** Catalog tier 1 binding: a component tag (e.g. "Button"). */
  component?: string
  /** Catalog tier 2 binding: a template id (e.g. "pricing-section"). */
  template?: string
  /** Catalog tier 3 binding: the feature pack this node arrived with. */
  pack?: string
  /** The ladder: a layout, template or pack id this node derives from / realizes. */
  derivedFrom?: string
  /** Setting nodes: the parameters this node holds (the schema). */
  params?: FeatureParam[]
  /** Current parameter values, by param name. Absent = the default rules. */
  values?: Record<string, string>
  note?: string
}

export interface FeatureEdge {
  from: string
  to: string
  type: FeatureEdgeType
}

/**
 * A pack external link that matched nothing when its pack was
 * grafted, kept on the graph (never silently dropped): when a
 * node whose name matches `match` appears later, the link wires
 * itself and leaves this list. `from` is the GRAFTED graph id of
 * the pack-side endpoint.
 */
export interface PendingLink {
  pack: string
  from: string
  type: FeatureEdgeType
  role: string
  match: string
  direction: 'out' | 'in'
}

/**
 * Update stamp: the repo commit the graph was last saved against plus
 * the save date. `commit` is null when the project is not in a git
 * repo (or git is unavailable) — then the date alone is the record.
 * Stamped on every save, so an old graph.json simply has no `sync`.
 */
export interface GraphSyncInfo {
  commit: string | null
  at: number
}

export interface FeatureGraph {
  version: 1
  title: string
  createdAt: number
  updatedAt: number
  /** Commit + date of the last save; absent on graphs saved before stamping. */
  sync?: GraphSyncInfo
  nodes: FeatureNode[]
  edges: FeatureEdge[]
  pendingLinks?: PendingLink[]
}

export const FEATURE_STATUSES: FeatureStatus[] = [
  'proposed', 'planned', 'building', 'done', 'verified', 'blocked', 'dropped',
]
export const FEATURE_NODE_KINDS: FeatureNodeKind[] = [
  'region', 'feature', 'screen', 'component', 'setting', 'data', 'service',
]
export const FEATURE_EDGE_TYPES: FeatureEdgeType[] = [
  'depends-on', 'configures', 'renders', 'data-flows', 'derived-from',
]

export function parseFeatureStatus(value: unknown): FeatureStatus {
  return FEATURE_STATUSES.includes(value as FeatureStatus) ? (value as FeatureStatus) : 'proposed'
}
export function parseFeatureNodeKind(value: unknown): FeatureNodeKind {
  return FEATURE_NODE_KINDS.includes(value as FeatureNodeKind) ? (value as FeatureNodeKind) : 'feature'
}
export function parseFeatureEdgeType(value: unknown): FeatureEdgeType | null {
  return FEATURE_EDGE_TYPES.includes(value as FeatureEdgeType) ? (value as FeatureEdgeType) : null
}

function featuresDir(root = getFsRoot()): string {
  return path.join(root, 'ai-features')
}

function graphPaths(root = getFsRoot()) {
  const dir = featuresDir(root)
  return { dir, json: path.join(dir, 'graph.json'), md: path.join(dir, 'graph.md') }
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

/* ── Store ──────────────────────────────────────────────────── */

/** HEAD of the git repo containing `root`, or null when it is not in
 * a repo (or git is unavailable). Never throws. */
export function gitHeadSync(root: string): string | null {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim()
    return /^[0-9a-f]{40}$/.test(head) ? head : null
  } catch {
    return null
  }
}

/** Commits `HEAD` is ahead of `from` (null when incomparable: no
 * repo, unknown commit, or git unavailable). Never throws. */
export function gitCommitsBehind(root: string, from: string | null): number | null {
  if (!from) return null
  try {
    const head = gitHeadSync(root)
    if (!head) return null
    if (head === from) return 0
    const n = execFileSync('git', ['rev-list', '--count', `${from}..HEAD`], { cwd: root, encoding: 'utf-8' }).trim()
    const parsed = Number.parseInt(n, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  } catch {
    return null
  }
}

/** Currency of a stamp against today's HEAD: 'current' (same commit),
 * 'behind' (repo moved on), 'no-repo' (stamped outside git — date
 * only), 'unstamped' (graph predates stamping), 'unknown' (cannot
 * read HEAD right now). Pure — the API resolves HEAD and count. */
export function graphCurrencyStatus(sync: GraphSyncInfo | undefined, head: string | null): 'current' | 'behind' | 'no-repo' | 'unstamped' | 'unknown' {
  if (!sync) return 'unstamped'
  if (sync.commit === null) return 'no-repo'
  if (head === null) return 'unknown'
  return head === sync.commit ? 'current' : 'behind'
}

function parseSyncInfo(raw: unknown): GraphSyncInfo | undefined {
  const s = raw as Partial<GraphSyncInfo> | null | undefined
  if (!s || typeof s !== 'object') return undefined
  if (typeof s.at !== 'number' || !Number.isFinite(s.at)) return undefined
  if (s.commit !== null && (typeof s.commit !== 'string' || !/^[0-9a-f]{40}$/.test(s.commit))) return undefined
  return { commit: s.commit, at: s.at }
}

export function getFeatureGraph(root?: string): FeatureGraph | null {
  try {
    const raw = JSON.parse(fs.readFileSync(graphPaths(root).json, 'utf-8')) as Partial<FeatureGraph>
    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null
    const sync = parseSyncInfo(raw.sync)
    return {
      version: 1,
      title: typeof raw.title === 'string' ? raw.title : 'Feature graph',
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      ...(sync ? { sync } : {}),
      nodes: raw.nodes,
      edges: raw.edges,
      ...(Array.isArray(raw.pendingLinks) ? { pendingLinks: raw.pendingLinks } : {}),
    }
  } catch {
    return null
  }
}

export function createFeatureGraph(title: string, root?: string): FeatureGraph {
  const existing = getFeatureGraph(root)
  if (existing) return existing
  const now = Date.now()
  const graph: FeatureGraph = {
    version: 1,
    title: title.trim() || 'Feature graph',
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
  }
  saveFeatureGraph(graph, root)
  return graph
}

export function saveFeatureGraph(graph: FeatureGraph, root?: string): FeatureGraph {
  graph.updatedAt = Date.now()
  graph.sync = { commit: gitHeadSync(root ?? getFsRoot()), at: graph.updatedAt }
  const p = graphPaths(root)
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(p.json, JSON.stringify(graph, null, 2), 'utf-8')
  fs.writeFileSync(p.md, renderFeatureMarkdown(graph), 'utf-8')
  return graph
}

/** Append a node with a fresh stable id; existing nodes are untouched. */
export function addNode(graph: FeatureGraph, input: Omit<FeatureNode, 'id' | 'status'> & { status?: FeatureStatus }): FeatureNode {
  const node: FeatureNode = { ...input, id: nextId('f'), status: input.status ?? 'proposed' }
  graph.nodes.push(node)
  return node
}

export function getNode(graph: FeatureGraph, id: string): FeatureNode | null {
  return graph.nodes.find(n => n.id === id) ?? null
}

export function setNodeStatus(graph: FeatureGraph, id: string, status: FeatureStatus): boolean {
  const node = getNode(graph, id)
  if (!node) return false
  node.status = status
  return true
}

/** Fill a node's values from its params' defaults, where unset. */
export function seedValues(node: FeatureNode): number {
  let seeded = 0
  for (const param of node.params ?? []) {
    if (param.default === undefined) continue
    node.values ??= {}
    if (node.values[param.name] === undefined) {
      node.values[param.name] = param.default
      seeded += 1
    }
  }
  return seeded
}

/** The values an app would read: defaults overlaid with set values. */
export function effectiveValues(node: FeatureNode): Record<string, string> {
  const out: Record<string, string> = {}
  for (const param of node.params ?? []) {
    const value = node.values?.[param.name] ?? param.default
    if (value !== undefined) out[param.name] = value
  }
  return out
}

/** Null when the value fits the param's schema, else the reason. */
export function validateParamValue(param: FeatureParam, value: string): string | null {
  switch (param.type) {
    case 'choice':
      return param.options?.includes(value)
        ? null
        : `"${value}" is not one of: ${(param.options ?? []).join(', ')}`
    case 'boolean':
      return value === 'true' || value === 'false' ? null : 'expected "true" or "false"'
    case 'number':
      return value.trim() !== '' && !Number.isNaN(Number(value)) ? null : `"${value}" is not a number`
    case 'color':
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? null : `"${value}" is not a hex color (#rgb or #rrggbb)`
    case 'text':
      return value.length <= 500 ? null : 'text values are capped at 500 characters'
  }
}

/**
 * Set one parameter value on a node, validated against its schema.
 * Returns an error string, or null on success.
 */
export function setNodeParam(graph: FeatureGraph, id: string, name: string, value: string): string | null {
  const node = getNode(graph, id)
  if (!node) return `No node with id ${id} in the feature graph.`
  const param = node.params?.find(p => p.name === name)
  if (!param) return `Node "${node.name}" has no parameter named ${name}.`
  const problem = validateParamValue(param, value)
  if (problem) return `Invalid value for ${name}: ${problem}.`
  node.values ??= {}
  node.values[name] = value
  return null
}

/** Add an edge; false when an endpoint is missing, it self-links, or it already exists. */
export function addEdge(graph: FeatureGraph, edge: FeatureEdge): boolean {
  if (edge.from === edge.to) return false
  if (!getNode(graph, edge.from) || !getNode(graph, edge.to)) return false
  if (graph.edges.some(e => e.from === edge.from && e.to === edge.to && e.type === edge.type)) return false
  graph.edges.push(edge)
  return true
}

export function removeEdge(graph: FeatureGraph, edge: FeatureEdge): boolean {
  const before = graph.edges.length
  graph.edges = graph.edges.filter(e => !(e.from === edge.from && e.to === edge.to && e.type === edge.type))
  return graph.edges.length < before
}

/* ── Editing ────────────────────────────────────────────────────
 * The graph can be reshaped after the fact, not just grown. All
 * edits are structural only — statuses and plans are untouched,
 * and refusals (missing nodes, cycles) come back as values. */

export function renameNode(graph: FeatureGraph, id: string, name: string): boolean {
  const node = getNode(graph, id)
  if (!node || !name.trim()) return false
  node.name = name.trim()
  return true
}

/**
 * Move a node under a new parent (undefined = top level). Returns
 * an error string, or null on success. Refuses anything that
 * would create a containment cycle.
 */
export function reparentNode(graph: FeatureGraph, id: string, parentId: string | undefined): string | null {
  const node = getNode(graph, id)
  if (!node) return `No node with id ${id} in the feature graph.`
  if (parentId !== undefined) {
    const parent = getNode(graph, parentId)
    if (!parent) return `No node with id ${parentId} in the feature graph.`
    if (subtree(graph, id).some(n => n.id === parentId)) {
      return `"${parent.name}" is the node itself or inside its subtree — reparenting there would create a containment cycle.`
    }
  }
  if (parentId === undefined) delete node.parent
  else node.parent = parentId
  return null
}

export interface RemoveResult { removed: FeatureNode[], lifted: number }

/**
 * Remove a node. `lift` (the safe default): its children move up
 * to the node's parent. `cascade`: the whole subtree goes. Edges
 * touching removed nodes go with them. Returns null for an
 * unknown id.
 */
export function removeNode(graph: FeatureGraph, id: string, mode: 'cascade' | 'lift'): RemoveResult | null {
  const node = getNode(graph, id)
  if (!node) return null
  const removedIds = new Set(mode === 'cascade' ? subtree(graph, id).map(n => n.id) : [id])
  const children = mode === 'lift' ? childrenOf(graph, id) : []
  for (const child of children) {
    if (node.parent) child.parent = node.parent
    else delete child.parent
  }
  const removed = graph.nodes.filter(n => removedIds.has(n.id))
  graph.nodes = graph.nodes.filter(n => !removedIds.has(n.id))
  graph.edges = graph.edges.filter(e => !removedIds.has(e.from) && !removedIds.has(e.to))
  if (graph.pendingLinks?.length) {
    graph.pendingLinks = graph.pendingLinks.filter(l => !removedIds.has(l.from))
  }
  return { removed, lifted: children.length }
}

/* ── Lint ───────────────────────────────────────────────────────
 * graph.json is a file a person can hand-edit; lint is how a bad
 * edit is found before it confuses a walk, a rollup or a plan.
 * Read-only: lint reports, the editing ops fix. */

export interface GraphProblem {
  kind: 'duplicate-id' | 'unknown-kind' | 'unknown-status' | 'dangling-parent' | 'parent-cycle'
    | 'dangling-edge' | 'duplicate-edge' | 'depends-on-cycle' | 'orphan-value' | 'invalid-value'
  message: string
  nodeId?: string
}

export function lintGraph(graph: FeatureGraph): GraphProblem[] {
  const problems: GraphProblem[] = []
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) problems.push({ kind: 'duplicate-id', message: `Duplicate node id ${node.id} ("${node.name}")`, nodeId: node.id })
    ids.add(node.id)
    if (!FEATURE_NODE_KINDS.includes(node.kind)) {
      problems.push({ kind: 'unknown-kind', message: `"${node.name}" has unknown kind "${node.kind}"`, nodeId: node.id })
    }
    if (!FEATURE_STATUSES.includes(node.status)) {
      problems.push({ kind: 'unknown-status', message: `"${node.name}" has unknown status "${node.status}"`, nodeId: node.id })
    }
    if (node.parent && !ids.has(node.parent) && !graph.nodes.some(n => n.id === node.parent)) {
      problems.push({ kind: 'dangling-parent', message: `"${node.name}" points at missing parent ${node.parent}`, nodeId: node.id })
    }
    for (const key of Object.keys(node.values ?? {})) {
      const param = node.params?.find(p => p.name === key)
      if (!param) {
        problems.push({ kind: 'orphan-value', message: `"${node.name}" holds a value for "${key}", which is not one of its parameters`, nodeId: node.id })
      } else {
        const problem = validateParamValue(param, node.values![key])
        if (problem) problems.push({ kind: 'invalid-value', message: `"${node.name}" parameter ${key}: ${problem}`, nodeId: node.id })
      }
    }
  }

  // Containment cycles: walk each node's parent chain; report each
  // distinct cycle once (keyed by its sorted member set).
  const cyclesSeen = new Set<string>()
  for (const node of graph.nodes) {
    const chain: string[] = []
    const position = new Map<string, number>()
    let current: FeatureNode | undefined = node
    while (current?.parent) {
      if (position.has(current.parent)) {
        const members = chain.slice(position.get(current.parent)!).sort()
        const key = members.join('|')
        if (!cyclesSeen.has(key)) {
          cyclesSeen.add(key)
          problems.push({
            kind: 'parent-cycle',
            message: `Containment cycle: ${members.map(m => getNode(graph, m)?.name ?? m).join(' → ')}`,
            nodeId: members[0],
          })
        }
        break
      }
      position.set(current.parent, chain.length)
      chain.push(current.parent)
      current = getNode(graph, current.parent) ?? undefined
    }
  }

  const edgeKeys = new Set<string>()
  for (const edge of graph.edges) {
    const key = `${edge.from}|${edge.type}|${edge.to}`
    if (edgeKeys.has(key)) problems.push({ kind: 'duplicate-edge', message: `Duplicate edge ${edge.from} —${edge.type}→ ${edge.to}` })
    edgeKeys.add(key)
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      problems.push({ kind: 'dangling-edge', message: `Edge ${edge.from} —${edge.type}→ ${edge.to} points at a missing node` })
    }
  }

  // depends-on cycles: three-color DFS over existing nodes.
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'open') {
      const cycle = [...trail.slice(trail.indexOf(id)), id]
      problems.push({
        kind: 'depends-on-cycle',
        message: `depends-on cycle: ${cycle.map(m => getNode(graph, m)?.name ?? m).join(' → ')}`,
        nodeId: id,
      })
      return
    }
    state.set(id, 'open')
    for (const e of graph.edges.filter(x => x.type === 'depends-on' && x.from === id && ids.has(x.to))) {
      visit(e.to, [...trail, id])
    }
    state.set(id, 'done')
  }
  for (const node of graph.nodes) visit(node.id, [])

  return problems
}

/* ── Structure + rollup ─────────────────────────────────────── */

export function childrenOf(graph: FeatureGraph, parentId?: string): FeatureNode[] {
  return graph.nodes.filter(n => (n.parent ?? undefined) === (parentId ?? undefined))
}

/** A node plus every descendant (containment), breadth-first. */
export function subtree(graph: FeatureGraph, id: string): FeatureNode[] {
  const out: FeatureNode[] = []
  const start = getNode(graph, id)
  if (!start) return out
  // Visited set: a hand-edited parent cycle must not hang the walk
  // (feature-lint reports the cycle; the walk just stays finite).
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length) {
    const node = queue.shift()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    out.push(node)
    queue.push(...childrenOf(graph, node.id))
  }
  return out
}

const COUNTED = (n: FeatureNode) => n.kind !== 'region' && n.status !== 'dropped'
const BUILT = (n: FeatureNode) => n.status === 'done' || n.status === 'verified'

export interface Rollup { total: number, built: number, blocked: number, pct: number }

export function rollupOf(nodes: FeatureNode[]): Rollup {
  const counted = nodes.filter(COUNTED)
  const built = counted.filter(BUILT).length
  return {
    total: counted.length,
    built,
    blocked: counted.filter(n => n.status === 'blocked').length,
    pct: counted.length ? Math.round((built / counted.length) * 100) : 0,
  }
}

export function graphRollup(graph: FeatureGraph): { overall: Rollup, regions: Array<{ node: FeatureNode, rollup: Rollup }> } {
  return {
    overall: rollupOf(graph.nodes),
    regions: childrenOf(graph)
      .filter(n => n.kind === 'region')
      .map(node => ({ node, rollup: rollupOf(subtree(graph, node.id)) })),
  }
}

/* ── Queries (the feature-query tool's modes) ───────────────── */

export interface NodeSummary {
  id: string, name: string, kind: FeatureNodeKind, status: FeatureStatus,
  parent?: string, component?: string, template?: string, pack?: string,
  /** Setting nodes only: the schema with the current effective value. */
  params?: Array<{ name: string, type: FeatureParam['type'], value?: string, options?: string[] }>,
}

export function nodeSummary(node: FeatureNode): NodeSummary {
  return {
    id: node.id, name: node.name, kind: node.kind, status: node.status,
    ...(node.parent ? { parent: node.parent } : {}),
    ...(node.component ? { component: node.component } : {}),
    ...(node.template ? { template: node.template } : {}),
    ...(node.pack ? { pack: node.pack } : {}),
    ...(node.params?.length ? {
      params: node.params.map(p => ({
        name: p.name, type: p.type,
        ...((node.values?.[p.name] ?? p.default) !== undefined ? { value: node.values?.[p.name] ?? p.default } : {}),
        ...(p.options ? { options: p.options } : {}),
      })),
    } : {}),
  }
}

export function nodesByStatus(graph: FeatureGraph, status: FeatureStatus): FeatureNode[] {
  return graph.nodes.filter(n => n.status === status)
}

export function searchNodes(graph: FeatureGraph, text: string): FeatureNode[] {
  const q = text.toLowerCase()
  return graph.nodes.filter(n => n.name.toLowerCase().includes(q))
}

/** What a node configures (outgoing) and what configures it (incoming). */
export function configuresFor(graph: FeatureGraph, id: string): { configures: FeatureNode[], configuredBy: FeatureNode[] } {
  const targets = new Set(graph.edges.filter(e => e.type === 'configures' && e.from === id).map(e => e.to))
  const sources = new Set(graph.edges.filter(e => e.type === 'configures' && e.to === id).map(e => e.from))
  return {
    configures: graph.nodes.filter(n => targets.has(n.id)),
    configuredBy: graph.nodes.filter(n => sources.has(n.id)),
  }
}

/**
 * Everything that must exist before a node, via transitive
 * depends-on — ordered so dependencies come before dependents
 * (the order a generated plan should work them in).
 */
export function prerequisites(graph: FeatureGraph, id: string): FeatureNode[] {
  const ordered: FeatureNode[] = []
  const seen = new Set<string>()
  const visit = (nodeId: string) => {
    for (const e of graph.edges.filter(x => x.type === 'depends-on' && x.from === nodeId)) {
      if (seen.has(e.to)) continue
      seen.add(e.to)
      visit(e.to)
      const dep = getNode(graph, e.to)
      if (dep) ordered.push(dep)
    }
  }
  visit(id)
  return ordered
}

/** One-line brief summary, present only when a graph exists. */
export function featureGraphSummary(graph: FeatureGraph): string {
  const { overall, regions } = graphRollup(graph)
  const regionText = regions.map(r => `${r.node.name} ${r.rollup.pct}%`).join(' · ')
  return (
    `FEATURE GRAPH "${graph.title}" — ${overall.total} features, ${overall.pct}% built` +
    (overall.blocked ? `, ${overall.blocked} blocked` : '') +
    (regionText ? ` (${regionText})` : '') +
    (graph.pendingLinks?.length
      ? `. ${graph.pendingLinks.length} pack link${graph.pendingLinks.length === 1 ? '' : 's'} still pending — they wire themselves when a node matching their name appears (feature-query mode "pending" lists them)`
      : '') +
    `. Full record at ai-features/graph.md. Query it with feature-query before planning feature work; ` +
    `as work lands, update node status with feature-set-status, and grow the graph with feature-add-node / feature-link ` +
    `when the app's shape changes — edit it in place, never restart it.`
  )
}

/* ── Rendered view ──────────────────────────────────────────── */

const STATUS_MARK: Record<FeatureStatus, string> = {
  proposed: '○', planned: '◔', building: '◑', done: '●', verified: '✓', blocked: '✕', dropped: '—',
}

export function renderFeatureMarkdown(graph: FeatureGraph): string {
  const { overall, regions } = graphRollup(graph)
  const lines: string[] = [
    `# Feature graph: ${graph.title}`,
    '',
    `${overall.total} features · ${overall.pct}% built (${overall.built}/${overall.total})` +
      (overall.blocked ? ` · ${overall.blocked} blocked` : ''),
    '',
  ]
  const rendered = new Set<string>()
  const renderNode = (node: FeatureNode, depth: number) => {
    if (rendered.has(node.id)) return // parent cycle guard, as in subtree()
    rendered.add(node.id)
    const binds = [
      node.component ? `component: ${node.component}` : '',
      node.template ? `template: ${node.template}` : '',
      node.pack ? `pack: ${node.pack}` : '',
      node.derivedFrom ? `derived from: ${node.derivedFrom}` : '',
    ].filter(Boolean).join(' · ')
    lines.push(`${'  '.repeat(depth)}- ${STATUS_MARK[node.status]} ${node.name} — ${node.kind}, ${node.status} (${node.id})${binds ? ` [${binds}]` : ''}`)
    if (node.params?.length) {
      for (const p of node.params) {
        const value = node.values?.[p.name] ?? p.default
        lines.push(`${'  '.repeat(depth + 1)}· ${p.name}: ${p.type}${value !== undefined ? ` = ${value}` : ''}`)
      }
    }
    if (node.note) lines.push(`${'  '.repeat(depth + 1)}_${node.note}_`)
    for (const child of childrenOf(graph, node.id)) renderNode(child, depth + 1)
  }
  for (const top of childrenOf(graph)) renderNode(top, 0)
  if (graph.edges.length) {
    lines.push('', '## Edges', '')
    const name = (id: string) => getNode(graph, id)?.name ?? id
    for (const e of graph.edges) lines.push(`- ${name(e.from)} —${e.type}→ ${name(e.to)}`)
  }
  if (graph.pendingLinks?.length) {
    lines.push('', '## Pending links (wire themselves when a matching node appears)', '')
    const name = (id: string) => getNode(graph, id)?.name ?? id
    for (const l of graph.pendingLinks) {
      lines.push(l.direction === 'in'
        ? `- ? —${l.type}→ ${name(l.from)} · ${l.role} (pack ${l.pack}, waiting for a node matching "${l.match}")`
        : `- ${name(l.from)} —${l.type}→ ? · ${l.role} (pack ${l.pack}, waiting for a node matching "${l.match}")`)
    }
  }
  if (regions.length) {
    lines.push('', '## Progress by region', '')
    for (const r of regions) {
      lines.push(`- ${r.node.name}: ${r.rollup.pct}% (${r.rollup.built}/${r.rollup.total})${r.rollup.blocked ? ` · ${r.rollup.blocked} blocked` : ''}`)
    }
  }
  return lines.join('\n') + '\n'
}
