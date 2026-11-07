/**
 * Install grafting (feature graphs, step 3): materialize a catalog
 * feature pack (tier 3) into a project's feature graph.
 *
 * The graft is a pure graph operation — no files are placed and no
 * code is written. The pack's subgraph lands with fresh stable ids
 * (its localIds are only meaningful inside the pack), every node
 * bound to the pack id and status `proposed`, internal edges
 * remapped through the id map, and the pack's declared external
 * links wired to pre-existing host nodes whose names match the
 * link's `match` alternation. A link that matches nothing is
 * reported as unwired with its role — never silently dropped —
 * AND recorded on the graph as a pending link
 * (graph.pendingLinks): when a node whose name matches appears
 * later, resolvePendingLinks wires it and clears the record, so
 * the connection is never lost between sessions. It can always
 * be wired by hand with feature-link instead.
 *
 * Refusals are values, not throws: unknown parent, and a pack that
 * is already installed (its nodes carry the pack binding). Reinstall
 * / upgrade semantics are deliberately out of scope.
 *
 * Building the grafted features OUT — placing their bound
 * components/templates and writing their screens — is the work that
 * follows, in the returned build order: an install plan's tasks.
 */
import { validatePack, type FeaturePack, type PackExternalLink } from '../catalog/packs.js'
import {
  addEdge, addNode, getNode, seedValues,
  type FeatureGraph, type FeatureNode, type PendingLink,
} from './features.js'

export interface WiredLink {
  role: string
  type: string
  /** Graph node ids, in edge direction. */
  from: string
  to: string
  fromName: string
  toName: string
}

export type GraftResult =
  | {
      ok: true
      packId: string
      added: FeatureNode[]
      internalEdges: number
      wired: WiredLink[]
      unwired: PackExternalLink[]
      /** Earlier packs' pending links this graft's nodes satisfied. */
      resolvedLinks: ResolvedLink[]
      /** Grafted nodes in depends-on order — dependencies first. */
      buildOrder: FeatureNode[]
    }
  | { ok: false, error: string }

/** External-link matches per link are capped so a broad alternation
 * ("checkout") cannot wire a setting to half the graph. */
const MAX_MATCHES_PER_LINK = 8

export function graftPack(
  graph: FeatureGraph,
  pack: FeaturePack,
  opts: { parentId?: string } = {},
): GraftResult {
  // Pending links from EARLIER grafts: this pack's fresh nodes may
  // be what they were waiting for. This pack's own new pendings are
  // excluded — they are declared against the host, never the pack
  // itself.
  const priorPending = [...(graph.pendingLinks ?? [])]
  const problems = validatePack(pack)
  if (problems.length) {
    return { ok: false, error: `Feature pack ${pack.id} is malformed: ${problems.join('; ')}` }
  }
  if (graph.nodes.some(n => n.pack === pack.id)) {
    return { ok: false, error: `Feature pack ${pack.id} is already installed in this graph — reinstall is not supported; remove its nodes first if a fresh graft is intended.` }
  }
  if (opts.parentId && !getNode(graph, opts.parentId)) {
    return { ok: false, error: `No node with id ${opts.parentId} in the feature graph.` }
  }
  const hostNodes = [...graph.nodes]

  // Materialize nodes parents-first (a pack's file order is not
  // guaranteed), remapping localId → fresh graph id.
  const idMap = new Map<string, string>()
  const added: FeatureNode[] = []
  const pending = [...pack.nodes]
  while (pending.length) {
    const before = pending.length
    for (let i = pending.length - 1; i >= 0; i--) {
      const pn = pending[i]
      if (pn.parent && !idMap.has(pn.parent)) continue
      const node = addNode(graph, {
        name: pn.name,
        kind: pn.kind,
        status: 'proposed',
        parent: pn.parent ? idMap.get(pn.parent)! : opts.parentId,
        pack: pack.id,
        ...(pn.component ? { component: pn.component } : {}),
        ...(pn.template ? { template: pn.template } : {}),
        ...(pn.derivedFrom ? { derivedFrom: pn.derivedFrom } : {}),
        ...(pn.params?.length ? { params: pn.params } : {}),
        ...(pn.note ? { note: pn.note } : {}),
      })
      if (node.params?.length) seedValues(node)
      idMap.set(pn.localId, node.id)
      added.push(node)
      pending.splice(i, 1)
    }
    if (pending.length === before) {
      return { ok: false, error: `Pack ${pack.id} has unresolvable parents (a cycle or a missing localId) — the pack file is malformed.` }
    }
  }

  // Internal edges, remapped.
  let internalEdges = 0
  for (const edge of pack.edges) {
    const from = idMap.get(edge.from)
    const to = idMap.get(edge.to)
    if (from && to && addEdge(graph, { from, to, type: edge.type })) internalEdges += 1
  }

  // External links: wire to matching pre-existing host nodes.
  const wired: WiredLink[] = []
  const unwired: PackExternalLink[] = []
  for (const link of pack.externalLinks) {
    const packNodeId = idMap.get(link.from)
    if (!packNodeId) { unwired.push(link); continue }
    let pattern: RegExp
    try {
      pattern = new RegExp(link.match, 'i')
    } catch {
      unwired.push(link)
      continue
    }
    const matches = hostNodes.filter(n => pattern.test(n.name)).slice(0, MAX_MATCHES_PER_LINK)
    if (!matches.length) {
      unwired.push(link)
      // Persist it: the link wires itself when a matching node
      // appears (resolvePendingLinks), instead of living only in
      // this one report.
      graph.pendingLinks ??= []
      const record: PendingLink = {
        pack: pack.id, from: packNodeId, type: link.type, role: link.role,
        match: link.match, direction: link.direction ?? 'out',
      }
      if (!graph.pendingLinks.some(l => l.from === record.from && l.type === record.type && l.match === record.match)) {
        graph.pendingLinks.push(record)
      }
      continue
    }
    for (const host of matches) {
      const edge = link.direction === 'in'
        ? { from: host.id, to: packNodeId, type: link.type }
        : { from: packNodeId, to: host.id, type: link.type }
      if (addEdge(graph, edge)) {
        wired.push({
          role: link.role, type: link.type,
          from: edge.from, to: edge.to,
          fromName: getNode(graph, edge.from)?.name ?? edge.from,
          toName: getNode(graph, edge.to)?.name ?? edge.to,
        })
      }
    }
  }

  // Earlier packs' pending links may match the nodes just grafted.
  const resolvedLinks = priorPending.length
    ? resolvePendingLinks(graph, added, priorPending)
    : []

  // Build order over the grafted subgraph: depends-on, deps first.
  const addedIds = new Set(added.map(n => n.id))
  const buildOrder: FeatureNode[] = []
  const seen = new Set<string>()
  const visit = (node: FeatureNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    for (const e of graph.edges.filter(x => x.type === 'depends-on' && x.from === node.id && addedIds.has(x.to))) {
      const dep = getNode(graph, e.to)
      if (dep) visit(dep)
    }
    buildOrder.push(node)
  }
  for (const node of added) visit(node)

  return { ok: true, packId: pack.id, added, internalEdges, wired, unwired, resolvedLinks, buildOrder }
}

export type UninstallResult =
  | { ok: true, packId: string, removed: FeatureNode[], lifted: number }
  | { ok: false, error: string }

/**
 * Remove a pack from the graph: every node the pack brought goes,
 * with the edges touching them. Host nodes that were parented
 * under a pack node are NOT removed — they are lifted to the
 * nearest surviving ancestor (or top level), because they are the
 * project's own work that merely lived under the pack's shell.
 *
 * Graph-only: files a build-out already placed (components,
 * templates, src/config values) stay in the project. Uninstall
 * retracts the map, not the territory already built.
 */
export function uninstallPack(graph: FeatureGraph, packId: string): UninstallResult {
  const removed = graph.nodes.filter(n => n.pack === packId)
  if (!removed.length) return { ok: false, error: `Feature pack ${packId} is not installed in this graph.` }
  const removedIds = new Set(removed.map(n => n.id))

  // Lift surviving children BEFORE the nodes go: walk each
  // survivor's parent chain past the removed stretch.
  let lifted = 0
  for (const node of graph.nodes) {
    if (removedIds.has(node.id) || !node.parent || !removedIds.has(node.parent)) continue
    let ancestor: string | undefined = node.parent
    while (ancestor && removedIds.has(ancestor)) {
      ancestor = getNode(graph, ancestor)?.parent
    }
    if (ancestor) node.parent = ancestor
    else delete node.parent
    lifted += 1
  }

  graph.nodes = graph.nodes.filter(n => !removedIds.has(n.id))
  graph.edges = graph.edges.filter(e => !removedIds.has(e.from) && !removedIds.has(e.to))
  if (graph.pendingLinks?.length) {
    graph.pendingLinks = graph.pendingLinks.filter(l => l.pack !== packId)
  }
  return { ok: true, packId, removed, lifted }
}

export interface ResolvedLink extends WiredLink { pack: string }

/**
 * The resurfacing half of pending links: given nodes that just
 * appeared (added, renamed, or grafted), wire every pending link
 * whose match now fits one of them, and clear those records.
 * A pending link whose pack-side node has been removed is stale
 * and is dropped silently — its endpoint is gone for good.
 */
export function resolvePendingLinks(
  graph: FeatureGraph,
  candidates: FeatureNode[],
  onlyLinks?: PendingLink[],
): ResolvedLink[] {
  if (!graph.pendingLinks?.length || !candidates.length) return []
  const resolved: ResolvedLink[] = []
  const remaining: PendingLink[] = []
  for (const link of graph.pendingLinks) {
    if (onlyLinks && !onlyLinks.includes(link)) { remaining.push(link); continue }
    const fromNode = getNode(graph, link.from)
    if (!fromNode) continue // stale — drop
    let pattern: RegExp
    try {
      pattern = new RegExp(link.match, 'i')
    } catch {
      remaining.push(link)
      continue
    }
    let wiredAny = false
    for (const candidate of candidates) {
      if (candidate.id === link.from) continue
      if (!pattern.test(candidate.name)) continue
      const edge = link.direction === 'in'
        ? { from: candidate.id, to: link.from, type: link.type }
        : { from: link.from, to: candidate.id, type: link.type }
      if (addEdge(graph, edge)) {
        wiredAny = true
        resolved.push({
          pack: link.pack, role: link.role, type: link.type,
          from: edge.from, to: edge.to,
          fromName: getNode(graph, edge.from)?.name ?? edge.from,
          toName: getNode(graph, edge.to)?.name ?? edge.to,
        })
      }
    }
    if (!wiredAny) remaining.push(link)
  }
  graph.pendingLinks = remaining
  return resolved
}
