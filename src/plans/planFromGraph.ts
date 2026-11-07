/**
 * Plan generation from the feature graph (the plan ↔ graph loop):
 * the graph is the territory, a plan is a route across it. Given a
 * region/subtree or an installed pack, produce a plan whose tasks
 * are the subgraph's unbuilt nodes in depends-on order — each task
 * tied to its graph node, so the plan store's write-back
 * (syncGraphStatuses in plans.ts) moves node statuses as tasks are
 * marked. Nodes already done/verified are skipped and reported;
 * unbuilt prerequisites OUTSIDE the selection are pulled in, since
 * a route that ignores a dependency is not a route.
 */
import {
  getFeatureGraph, getNode, prerequisites, subtree,
  type FeatureGraph, type FeatureNode,
} from '../features/features.js'
import { getPack } from '../catalog/packs.js'
import { addTask, createPlan, savePlan, type PlanDoc } from './plans.js'

export type GraphPlanResult =
  | { ok: true, plan: PlanDoc, skippedBuilt: number }
  | { ok: false, error: string }

const BUILT = (n: FeatureNode) => n.status === 'done' || n.status === 'verified'
const WORKABLE = (n: FeatureNode) => n.kind !== 'region' && n.status !== 'dropped'

/** The selection plus its unbuilt prerequisites, in build order. */
export function workListFor(graph: FeatureGraph, selected: FeatureNode[]): { work: FeatureNode[], skippedBuilt: number } {
  const wanted = new Map<string, FeatureNode>()
  let skippedBuilt = 0
  for (const node of selected) {
    if (!WORKABLE(node)) continue
    if (BUILT(node)) { skippedBuilt += 1; continue }
    wanted.set(node.id, node)
  }
  for (const node of [...wanted.values()]) {
    for (const prereq of prerequisites(graph, node.id)) {
      if (WORKABLE(prereq) && !BUILT(prereq) && !wanted.has(prereq.id)) wanted.set(prereq.id, prereq)
    }
  }
  // Topo order over depends-on within the set: dependencies first.
  const ordered: FeatureNode[] = []
  const seen = new Set<string>()
  const visit = (node: FeatureNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    for (const e of graph.edges.filter(x => x.type === 'depends-on' && x.from === node.id && wanted.has(x.to))) {
      visit(wanted.get(e.to)!)
    }
    ordered.push(node)
  }
  for (const node of wanted.values()) visit(node)
  return { work: ordered, skippedBuilt }
}

function taskDetail(node: FeatureNode): string {
  const binds = [
    node.component ? `component ${node.component}` : '',
    node.template ? `template ${node.template}` : '',
    node.pack ? `pack ${node.pack}` : '',
    node.derivedFrom ? `derived from ${node.derivedFrom}` : '',
    node.params?.length ? `${node.params.length} parameters` : '',
  ].filter(Boolean).join(' · ')
  return binds ? `${node.kind} — ${binds}` : node.kind
}

export function planFromGraph(
  selector: { nodeId?: string, packId?: string },
  root?: string,
): GraphPlanResult {
  const graph = getFeatureGraph(root)
  if (!graph) return { ok: false, error: 'No feature graph in this project yet — there is nothing to plan from.' }

  let selected: FeatureNode[]
  let title: string
  let kind: 'feature' | 'install'
  if (selector.packId) {
    selected = graph.nodes.filter(n => n.pack === selector.packId)
    if (!selected.length) {
      const pack = getPack(selector.packId)
      return {
        ok: false,
        error: pack
          ? `Feature pack ${selector.packId} is not installed in this project's graph — install it with feature-install-pack first.`
          : `No feature pack with id ${selector.packId}, and no graph nodes carry that pack binding.`,
      }
    }
    title = `Install ${getPack(selector.packId)?.name ?? selector.packId}`
    kind = 'install'
  } else if (selector.nodeId) {
    const anchor = getNode(graph, selector.nodeId)
    if (!anchor) return { ok: false, error: `No node with id ${selector.nodeId} in the feature graph.` }
    selected = subtree(graph, selector.nodeId)
    title = `Build ${anchor.name}`
    // A subtree that is exactly one pack's graft is an install;
    // a mixed region is feature work.
    const packs = new Set(selected.map(n => n.pack).filter(Boolean))
    const workable = selected.filter(WORKABLE)
    kind = packs.size === 1 && workable.length > 0 && workable.every(n => n.pack === [...packs][0])
      ? 'install'
      : 'feature'
  } else {
    return { ok: false, error: 'Pass a nodeId (a region or feature subtree) or a packId.' }
  }

  const { work, skippedBuilt } = workListFor(graph, selected)
  if (!work.length) {
    return { ok: false, error: 'Nothing left to build in that part of the graph — every selected node is done, verified, or dropped.' }
  }
  const doc = createPlan({
    title,
    kind,
    level: 2,
    goal:
      `Build out ${title.replace(/^(Build|Install) /, '')} from the feature graph: ${work.length} node${work.length === 1 ? '' : 's'} to build` +
      (skippedBuilt ? `, ${skippedBuilt} already built and skipped` : '') +
      `. Tasks are in depends-on order and each is tied to its graph node — marking a task doing/done updates the node's status (building/done).`,
  }, root)
  for (const node of work) addTask(doc, { text: node.name, detail: taskDetail(node), nodeId: node.id })
  savePlan(doc, root)
  return { ok: true, plan: doc, skippedBuilt }
}
