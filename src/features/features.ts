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
  /** Setting nodes: the parameters this node holds. */
  params?: FeatureParam[]
  note?: string
}

export interface FeatureEdge {
  from: string
  to: string
  type: FeatureEdgeType
}

export interface FeatureGraph {
  version: 1
  title: string
  createdAt: number
  updatedAt: number
  nodes: FeatureNode[]
  edges: FeatureEdge[]
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

export function getFeatureGraph(root?: string): FeatureGraph | null {
  try {
    const raw = JSON.parse(fs.readFileSync(graphPaths(root).json, 'utf-8')) as Partial<FeatureGraph>
    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null
    return {
      version: 1,
      title: typeof raw.title === 'string' ? raw.title : 'Feature graph',
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      nodes: raw.nodes,
      edges: raw.edges,
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

/** Add an edge; false when an endpoint is missing, it self-links, or it already exists. */
export function addEdge(graph: FeatureGraph, edge: FeatureEdge): boolean {
  if (edge.from === edge.to) return false
  if (!getNode(graph, edge.from) || !getNode(graph, edge.to)) return false
  if (graph.edges.some(e => e.from === edge.from && e.to === edge.to && e.type === edge.type)) return false
  graph.edges.push(edge)
  return true
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
  const queue = [start]
  while (queue.length) {
    const node = queue.shift()!
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
}

export function nodeSummary(node: FeatureNode): NodeSummary {
  return {
    id: node.id, name: node.name, kind: node.kind, status: node.status,
    ...(node.parent ? { parent: node.parent } : {}),
    ...(node.component ? { component: node.component } : {}),
    ...(node.template ? { template: node.template } : {}),
    ...(node.pack ? { pack: node.pack } : {}),
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
  const renderNode = (node: FeatureNode, depth: number) => {
    const binds = [
      node.component ? `component: ${node.component}` : '',
      node.template ? `template: ${node.template}` : '',
      node.pack ? `pack: ${node.pack}` : '',
      node.derivedFrom ? `derived from: ${node.derivedFrom}` : '',
    ].filter(Boolean).join(' · ')
    lines.push(`${'  '.repeat(depth)}- ${STATUS_MARK[node.status]} ${node.name} — ${node.kind}, ${node.status} (${node.id})${binds ? ` [${binds}]` : ''}`)
    if (node.params?.length) {
      for (const p of node.params) {
        lines.push(`${'  '.repeat(depth + 1)}· ${p.name}: ${p.type}${p.default !== undefined ? ` = ${p.default}` : ''}`)
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
  if (regions.length) {
    lines.push('', '## Progress by region', '')
    for (const r of regions) {
      lines.push(`- ${r.node.name}: ${r.rollup.pct}% (${r.rollup.built}/${r.rollup.total})${r.rollup.blocked ? ` · ${r.rollup.blocked} blocked` : ''}`)
    }
  }
  return lines.join('\n') + '\n'
}
