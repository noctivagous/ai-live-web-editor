/**
 * Feature packs (catalog tier 3): portable feature subgraphs that sit
 * ABOVE components (tier 1) and templates (tier 2). A pack is a small
 * feature graph in the project's own graph format (src/features):
 * nodes with local ids, containment via parent, typed edges, setting
 * nodes carrying parameter schemas, and components/templates bound
 * per node. `catalog/packs.json` is the manifest; packs carry no
 * status — a node arrives in a project graph as `proposed` when the
 * pack is grafted (install grafting is the planner's step, not this
 * module's).
 *
 * The top rung of the ladder lives here: master-detail (a base
 * layout) → master-detail used for settings (a template) → admin /
 * configuration (this tier). Pack shells record the lower rung they
 * derive from in `derivedFrom`.
 *
 * `externalLinks` declare how a pack reaches OUT of its own subgraph
 * once grafted: a pack node (usually a setting) plus the edge type
 * and a plain-language role for the host node it should connect to,
 * with a `match` hint (alternation over host node names) for the
 * grafter. `direction: 'in'` reverses the edge (host → pack).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FeatureEdgeType, FeatureNodeKind, FeatureParam } from '../features/features.js'

export interface PackNode {
  localId: string
  name: string
  kind: FeatureNodeKind
  /** Containing node, by localId. */
  parent?: string
  component?: string
  template?: string
  derivedFrom?: string
  params?: FeatureParam[]
  note?: string
}

export interface PackEdge {
  from: string
  to: string
  type: FeatureEdgeType
}

export interface PackExternalLink {
  /** Pack node (localId) the edge touches. */
  from: string
  type: FeatureEdgeType
  /** Plain language: what in the host app this connects to. */
  role: string
  /** Alternation hint over host node names, e.g. "price|checkout". */
  match: string
  /** 'out' (default): pack node → host node. 'in': host node → pack node. */
  direction?: 'out' | 'in'
}

export interface FeaturePack {
  id: string
  name: string
  description: string
  nodes: PackNode[]
  edges: PackEdge[]
  externalLinks: PackExternalLink[]
}

export interface PacksFile {
  version: number
  packs: FeaturePack[]
}

/** Tier-1 shape: what search results and the Library list show. */
export interface PackSummary {
  id: string
  name: string
  description: string
  nodes: number
  settings: number
  configures: string[]
}

const CATALOG_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'catalog',
)
const PACKS_PATH = path.join(CATALOG_DIR, 'packs.json')

let cached: PacksFile | null = null

export function loadPacks(filePath: string = PACKS_PATH): PacksFile {
  if (cached && filePath === PACKS_PATH) return cached
  let parsed: PacksFile = { version: 1, packs: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PacksFile
    if (Array.isArray(raw.packs)) parsed = { version: raw.version || 1, packs: raw.packs }
  } catch { /* no manifest: no packs */ }
  if (filePath === PACKS_PATH) cached = parsed
  return parsed
}

/** Test hook: forget the cached manifest. */
export function resetPacksCache(): void {
  cached = null
}

export function getPack(id: string, file: PacksFile = loadPacks()): FeaturePack | undefined {
  return file.packs.find(p => p.id === id)
}

function oneLiner(description: string): string {
  const first = description.split(/(?<=[.!?])\s/)[0] ?? description
  return first.length > 120 ? `${first.slice(0, 117)}…` : first
}

export function packSummary(pack: FeaturePack): PackSummary {
  return {
    id: pack.id,
    name: pack.name,
    description: oneLiner(pack.description),
    nodes: pack.nodes.length,
    settings: pack.nodes.filter(n => n.kind === 'setting').length,
    configures: pack.externalLinks.filter(l => l.type === 'configures').map(l => l.role),
  }
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

function scorePack(pack: FeaturePack, terms: string[]): number {
  // Word-based matching, not substring: with a small prose-heavy
  // corpus, substrings lie ("form" inside "configuration", "select"
  // inside "selected"). A longer word still counts at the strong and
  // node tiers via prefix ("print" finds "printing").
  const strong = words(`${pack.id} ${pack.name}`)
  const nodeText = words(pack.nodes.map(n => `${n.name} ${(n.params ?? []).map(p => p.name).join(' ')}`).join(' '))
  // The long tail of authored text: description, node notes, and the
  // roles the pack configures in the host app ("checkout totals"
  // should find the admin pack).
  const prose = words([
    pack.description,
    ...pack.nodes.map(n => n.note ?? ''),
    ...pack.externalLinks.map(l => l.role),
  ].join(' '))
  const prefixHit = (set: Set<string>, t: string) => [...set].some(w => w.length > t.length && w.startsWith(t))
  let s = 0
  for (const t of terms) {
    if (strong.has(t)) s += 6
    else if (prefixHit(strong, t)) s += 3
    if (nodeText.has(t)) s += 2
    else if (prefixHit(nodeText, t)) s += 1
    if (prose.has(t)) s += 1
  }
  return s
}

/**
 * Tier-3 search: whole features before pieces. Terms shorter than
 * 3 chars are dropped — with a four-pack corpus, "in" or "to" would
 * match everything and drown the ranking.
 */
export function searchPacks(query: string, limit = 3, file: PacksFile = loadPacks()): PackSummary[] {
  const terms = query.toLowerCase().split(/[^a-z0-9-]+/).filter(t => t.length >= 3)
  if (!terms.length) return []
  return file.packs
    .map(pack => ({ pack, score: scorePack(pack, terms) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => packSummary(r.pack))
}

/** Structural honesty for authored packs: every reference resolves. */
export function validatePack(pack: FeaturePack): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const node of pack.nodes) {
    if (ids.has(node.localId)) problems.push(`duplicate localId ${node.localId}`)
    ids.add(node.localId)
  }
  for (const node of pack.nodes) {
    if (node.parent && !ids.has(node.parent)) problems.push(`${node.localId}: parent ${node.parent} not in pack`)
  }
  for (const edge of pack.edges) {
    if (!ids.has(edge.from)) problems.push(`edge from unknown node ${edge.from}`)
    if (!ids.has(edge.to)) problems.push(`edge to unknown node ${edge.to}`)
    if (edge.from === edge.to) problems.push(`self-edge on ${edge.from}`)
  }
  for (const link of pack.externalLinks) {
    if (!ids.has(link.from)) problems.push(`external link from unknown node ${link.from}`)
    if (!link.role.trim()) problems.push(`external link on ${link.from} has no role`)
  }
  return problems
}

/** One line for the project brief: what whole features exist, by id. */
export function packSummaryLine(file: PacksFile = loadPacks()): string {
  if (!file.packs.length) return ''
  const list = file.packs.map(p => `${p.id} (${p.nodes.length} nodes)`).join(', ')
  return `Feature packs (catalog tier 3 — whole features, above templates and components): ${list}. find-component searches packs first and returns one in full by pack id; feature-install-pack grafts a pack's subgraph into the feature graph and wires its configures links — an install plan then tracks building the grafted features out.`
}
