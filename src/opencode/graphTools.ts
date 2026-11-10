/**
 * Feature-graph and userflow tools as plain host functions
 * (re-platform slice 4).
 *
 * Wave 3: the thirteen feature-graph tools and five userflow
 * tools, served to the OpenCode plugin through their own dispatch
 * endpoint, POST /api/graph/tool (registered in both server.ts
 * and apiApp.ts). They do NOT ride /api/page/tool — that dispatch
 * is for page/verify reads against the live page, while these are
 * store writes/reads against the project's two graph stores — and
 * they do NOT reuse the stores' REST surfaces (/api/features,
 * /api/userflows): those endpoints serve the editor UI with their
 * own result shapes, not the agent tools' shaped results, so
 * reusing them would change what the agent sees.
 *
 * Each function below is the Mastra tool's execute body
 * (src/mastra/tools/featureTools.ts, userflowTools.ts) with the
 * wrapper removed — the SAME store modules (features/features.ts,
 * features/buildNode.ts, features/reconcile.ts, features/graft.ts,
 * userflows/userflows.ts, userflows/coverage.ts,
 * features/suggestions.ts), resolving against the active fs root
 * exactly as the Mastra bodies do (the stores default to
 * getFsRoot()), so results match the Mastra path's exactly. The
 * Mastra tools themselves are untouched.
 *
 * Known stance (slices 1–3 carry it): NO per-turn gating on the
 * opencode path — all graph tools are simply available to
 * OpenCode's default build agent.
 */
import path from 'node:path'
import { withDispatchDebugLog } from '../chatDebug.js'
import {
  addEdge, addNode, configuresFor, createFeatureGraph, getFeatureGraph, getNode,
  graphRollup, lintGraph, nodeSummary, nodesByStatus, prerequisites, removeEdge,
  removeNode, renameNode, reparentNode, saveFeatureGraph, searchNodes,
  setNodeParam, setNodeStatus, subtree,
} from '../features/features.js'
import { buildNode, writeNodeConfig } from '../features/buildNode.js'
import { reconcileGraph } from '../features/reconcile.js'
import { graftPack, resolvePendingLinks, uninstallPack } from '../features/graft.js'
import { deriveSuggestions, liveSuggestions } from '../features/suggestions.js'
import { getPack } from '../catalog/packs.js'
import {
  addExercises, addFlowEdge, addJourney, addStep, createUserFlowGraph, findJourney,
  getStep, getUserFlowGraph, saveUserFlowGraph, searchSteps, setVerification,
  stepSummary, stepsInJourney, userFlowCounts,
  type UserFlowEdgeType,
} from '../userflows/userflows.js'
import { featuresNeverExercised, featuresOnBlockedSteps, stepsWithoutFeatures } from '../userflows/coverage.js'
import { getFsRoot } from '../launcher.js'

type Input = Record<string, any>

function noFeatureGraph() {
  return { ok: false, error: 'No feature graph in this project yet. Start one by adding its first node with feature-add-node.' }
}

function noUserFlowGraph() {
  return { ok: false, error: 'No user flow graph in this project yet. Start one by adding its first step with userflow-add-step.' }
}

/* ------------------------------------------------------------------ */
/* Feature graph tools (src/mastra/tools/featureTools.ts)              */
/* ------------------------------------------------------------------ */

async function featureAddNode(input: Input) {
  const { name, kind, parentId, status, component, template, pack, derivedFrom, params, note } = input ?? {}
  const graph = getFeatureGraph() ?? createFeatureGraph(path.basename(getFsRoot()))
  if (parentId && !getNode(graph, parentId)) {
    return { ok: false, error: `No node with id ${parentId} in the feature graph.` }
  }
  const node = addNode(graph, {
    name, kind, status,
    ...(parentId ? { parent: parentId } : {}),
    ...(component ? { component } : {}),
    ...(template ? { template } : {}),
    ...(pack ? { pack } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
    ...(params?.length ? { params } : {}),
    ...(note ? { note } : {}),
  })
  // A new node can be exactly what a pending pack link was
  // waiting for — wire it now and say so.
  const resolvedLinks = resolvePendingLinks(graph, [node])
  saveFeatureGraph(graph)
  return {
    ok: true, graph: graph.title, node: nodeSummary(node), totalNodes: graph.nodes.length,
    ...(resolvedLinks.length ? { resolvedLinks } : {}),
  }
}

async function featureSetStatus(input: Input) {
  const { id, status } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  if (!setNodeStatus(graph, id, status)) return { ok: false, error: `No node with id ${id} in the feature graph.` }
  saveFeatureGraph(graph)
  const { overall } = graphRollup(graph)
  return { ok: true, node: nodeSummary(getNode(graph, id)!), overall }
}

async function featureLink(input: Input) {
  const { from, to, type } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  if (!getNode(graph, from)) return { ok: false, error: `No node with id ${from} in the feature graph.` }
  if (!getNode(graph, to)) return { ok: false, error: `No node with id ${to} in the feature graph.` }
  if (!addEdge(graph, { from, to, type })) {
    return { ok: false, error: from === to ? 'A node cannot link to itself.' : 'That edge already exists.' }
  }
  saveFeatureGraph(graph)
  return { ok: true, edge: { from, to, type }, totalEdges: graph.edges.length }
}

async function featureInstallPack(input: Input) {
  const { packId, parentId } = input ?? {}
  const pack = getPack(packId)
  if (!pack) return { ok: false, error: `No feature pack with id ${packId}. Search with find-component to see the packs.` }
  const graph = getFeatureGraph() ?? createFeatureGraph(path.basename(getFsRoot()))
  const result = graftPack(graph, pack, { parentId })
  if (result.ok === false) return { ok: false, error: result.error }
  saveFeatureGraph(graph)
  return {
    ok: true,
    pack: pack.id,
    added: result.added.map(nodeSummary),
    internalEdges: result.internalEdges,
    wired: result.wired,
    unwired: result.unwired.map(l => ({ role: l.role, type: l.type, match: l.match })),
    pendingLinks: graph.pendingLinks ?? [],
    ...(result.resolvedLinks.length ? { resolvedLinks: result.resolvedLinks } : {}),
    buildOrder: result.buildOrder.map(n => n.id),
    totalNodes: graph.nodes.length,
  }
}

async function featureQuery(input: Input) {
  const { mode, id, status, text } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  switch (mode) {
    case 'overview': {
      const { overall, regions } = graphRollup(graph)
      return {
        ok: true, title: graph.title, overall,
        regions: regions.map(r => ({ ...nodeSummary(r.node), rollup: r.rollup })),
      }
    }
    case 'region': {
      if (!id || !getNode(graph, id)) return { ok: false, error: `No node with id ${id ?? ''} in the feature graph.` }
      return { ok: true, nodes: subtree(graph, id).map(nodeSummary) }
    }
    case 'status': {
      if (!status) return { ok: false, error: 'Pass a status for mode status.' }
      return { ok: true, nodes: nodesByStatus(graph, status).map(nodeSummary) }
    }
    case 'configures': {
      if (!id || !getNode(graph, id)) return { ok: false, error: `No node with id ${id ?? ''} in the feature graph.` }
      const { configures, configuredBy } = configuresFor(graph, id)
      return { ok: true, configures: configures.map(nodeSummary), configuredBy: configuredBy.map(nodeSummary) }
    }
    case 'prerequisites': {
      if (!id || !getNode(graph, id)) return { ok: false, error: `No node with id ${id ?? ''} in the feature graph.` }
      return { ok: true, prerequisites: prerequisites(graph, id).map(nodeSummary) }
    }
    case 'search': {
      if (!text) return { ok: false, error: 'Pass text for mode search.' }
      return { ok: true, nodes: searchNodes(graph, text).map(nodeSummary) }
    }
    case 'pending': {
      return {
        ok: true,
        pendingLinks: (graph.pendingLinks ?? []).map(l => ({
          ...l, fromName: getNode(graph, l.from)?.name ?? l.from,
        })),
      }
    }
  }
}

async function featureSetParam(input: Input) {
  const { id, name, value } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  const problem = setNodeParam(graph, id, name, value)
  if (problem) return { ok: false, error: problem }
  saveFeatureGraph(graph)
  const node = getNode(graph, id)!
  const configFile = writeNodeConfig(node, getFsRoot())
  return { ok: true, node: nodeSummary(node), ...(configFile ? { configFile } : {}) }
}

async function featureBuildNode(input: Input) {
  const { id } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  const result = buildNode(graph, id, getFsRoot())
  if (result.ok === false) return result
  saveFeatureGraph(graph)
  return result
}

async function featureEditNode(input: Input) {
  const { id, name, parentId } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  const node = getNode(graph, id)
  if (!node) return { ok: false, error: `No node with id ${id} in the feature graph.` }
  if (name === undefined && parentId === undefined) {
    return { ok: false, error: 'Nothing to change — pass name and/or parentId.' }
  }
  if (name !== undefined && !renameNode(graph, id, name)) {
    return { ok: false, error: 'Rename refused: a name is required.' }
  }
  if (parentId !== undefined) {
    const problem = reparentNode(graph, id, parentId ?? undefined)
    if (problem) return { ok: false, error: problem }
  }
  // A rename can make this node the one a pending link waits for.
  const resolvedLinks = name !== undefined ? resolvePendingLinks(graph, [node]) : []
  saveFeatureGraph(graph)
  return {
    ok: true, node: nodeSummary(getNode(graph, id)!),
    ...(resolvedLinks.length ? { resolvedLinks } : {}),
  }
}

async function featureRemoveNode(input: Input) {
  const { id, mode } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  const result = removeNode(graph, id, mode ?? 'lift')
  if (!result) return { ok: false, error: `No node with id ${id} in the feature graph.` }
  saveFeatureGraph(graph)
  return {
    ok: true,
    removed: result.removed.map(nodeSummary),
    lifted: result.lifted,
    totalNodes: graph.nodes.length,
  }
}

async function featureUnlink(input: Input) {
  const { from, to, type } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  if (!removeEdge(graph, { from, to, type })) {
    return { ok: false, error: `No ${type} edge from ${from} to ${to} in the graph.` }
  }
  saveFeatureGraph(graph)
  return { ok: true, totalEdges: graph.edges.length }
}

async function featureLint() {
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  const problems = lintGraph(graph)
  return { ok: problems.length === 0, problems, totalNodes: graph.nodes.length, totalEdges: graph.edges.length }
}

async function featureUninstallPack(input: Input) {
  const { packId } = input ?? {}
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  const result = uninstallPack(graph, packId)
  if (result.ok === false) return { ok: false, error: result.error }
  saveFeatureGraph(graph)
  return {
    ok: true, pack: result.packId,
    removed: result.removed.map(nodeSummary),
    lifted: result.lifted,
    totalNodes: graph.nodes.length,
  }
}

async function featureReconcile() {
  const graph = getFeatureGraph()
  if (!graph) return noFeatureGraph()
  const { drift, checked } = reconcileGraph(graph, getFsRoot())
  return { ok: drift.length === 0, drift, checked }
}

/* ------------------------------------------------------------------ */
/* User flow tools (src/mastra/tools/userflowTools.ts)                 */
/* ------------------------------------------------------------------ */

async function userflowAddStep(input: Input) {
  const { journey, name, type, note } = input ?? {}
  const graph = getUserFlowGraph() ?? createUserFlowGraph(path.basename(getFsRoot()))
  const found = findJourney(graph, journey)
  const owner = found ?? addJourney(graph, { name: journey })
  const step = addStep(graph, {
    name, type, journey: owner.id,
    ...(note ? { note } : {}),
  })!
  saveUserFlowGraph(graph)
  return {
    ok: true, graph: graph.title,
    journey: { id: owner.id, name: owner.name, ...(found ? {} : { created: true }) },
    step: stepSummary(graph, step),
    totalSteps: graph.steps.length,
  }
}

async function userflowSetVerification(input: Input) {
  const { id, state, blockKind, evidence, runId } = input ?? {}
  const graph = getUserFlowGraph()
  if (!graph) return noUserFlowGraph()
  const kept = setVerification(graph, id, {
    state,
    ...(blockKind
      ? { block: { kind: blockKind, evidence: evidence ?? '', runId: runId ?? '', at: new Date().toISOString() } }
      : {}),
  })
  if (!kept) return { ok: false, error: `No step with id ${id} in the user flow graph.` }
  saveUserFlowGraph(graph)
  return { ok: true, step: stepSummary(graph, getStep(graph, id)!), counts: userFlowCounts(graph) }
}

async function userflowLink(input: Input) {
  const { from, to, type } = input ?? {}
  const graph = getUserFlowGraph()
  if (!graph) return noUserFlowGraph()
  if (type === 'exercises') {
    const problem = addExercises(graph, getFeatureGraph(), from, to)
    if (problem) return { ok: false, error: problem }
    saveUserFlowGraph(graph)
    return { ok: true, edge: { from, to, type }, totalExercises: graph.exercises.length }
  }
  if (!getStep(graph, from)) return { ok: false, error: `No step with id ${from} in the user flow graph.` }
  if (!getStep(graph, to)) return { ok: false, error: `No step with id ${to} in the user flow graph.` }
  if (!addFlowEdge(graph, { from, to, type: type as UserFlowEdgeType })) {
    return { ok: false, error: from === to ? 'A step cannot link to itself.' : 'That edge already exists.' }
  }
  saveUserFlowGraph(graph)
  return { ok: true, edge: { from, to, type }, totalEdges: graph.edges.length }
}

async function userflowDeriveSuggestions() {
  const graph = getUserFlowGraph()
  if (!graph) return noUserFlowGraph()
  const features = getFeatureGraph()
  if (!features) return { ok: false, error: 'No feature graph in this project yet — suggestions are feature nodes, so there is nowhere for them to land.' }
  const result = deriveSuggestions(features, graph)
  saveFeatureGraph(features)
  return {
    ok: true,
    created: result.created.length,
    withdrawn: result.withdrawn.length,
    skippedDismissed: result.skippedDismissed,
    alreadyLive: result.alreadyLive,
    createdNames: result.created.map(n => n.name),
    withdrawnNames: result.withdrawn.map(n => n.name),
    live: liveSuggestions(features).length,
  }
}

async function userflowQuery(input: Input) {
  const { mode, id, text } = input ?? {}
  const graph = getUserFlowGraph()
  if (!graph) return noUserFlowGraph()
  switch (mode) {
    case 'overview': {
      return {
        ok: true, title: graph.title, counts: userFlowCounts(graph),
        journeys: graph.journeys.map(j => {
          const steps = stepsInJourney(graph, j.id)
          return {
            id: j.id, name: j.name, steps: steps.length,
            ok: steps.filter(s => s.verification.state === 'ok').length,
            blocked: steps.filter(s => s.verification.state === 'blocked' || s.verification.state === 'error').length,
          }
        }),
      }
    }
    case 'journey': {
      const journey = id ? findJourney(graph, id) : null
      if (!journey) return { ok: false, error: `No journey "${id ?? ''}" in the user flow graph.` }
      const steps = stepsInJourney(graph, journey.id)
      const ids = new Set(steps.map(s => s.id))
      return {
        ok: true,
        journey: { id: journey.id, name: journey.name },
        steps: steps.map(s => stepSummary(graph, s)),
        edges: graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)),
      }
    }
    case 'coverage': {
      const features = getFeatureGraph()
      if (!features) return { ok: false, error: 'No feature graph in this project yet — coverage reads the two graphs together.' }
      const named = (fid: string) => {
        const node = getNode(features, fid)
        return { id: fid, name: node?.name ?? fid }
      }
      return {
        ok: true,
        neverExercised: featuresNeverExercised(features, graph).map(named),
        stepsWithoutFeatures: stepsWithoutFeatures(graph)
          .map(sid => stepSummary(graph, getStep(graph, sid)!)),
        blockedFeatures: featuresOnBlockedSteps(graph).map(b => ({
          feature: named(b.feature),
          steps: b.steps.map(sid => {
            const step = getStep(graph, sid)!
            return { id: step.id, name: step.name, state: step.verification.state }
          }),
        })),
      }
    }
    case 'search': {
      if (!text) return { ok: false, error: 'Pass text for mode search.' }
      return { ok: true, steps: searchSteps(graph, text).map(s => stepSummary(graph, s)) }
    }
  }
}

/** The wave-3 dispatch tools by their (Mastra-identical) names. */
export const GRAPH_TOOL_HANDLERS: Record<string, (input: Input) => Promise<unknown>> = {
  'feature-add-node': featureAddNode,
  'feature-set-status': featureSetStatus,
  'feature-link': featureLink,
  'feature-install-pack': featureInstallPack,
  'feature-query': featureQuery,
  'feature-set-param': featureSetParam,
  'feature-build-node': featureBuildNode,
  'feature-edit-node': featureEditNode,
  'feature-remove-node': featureRemoveNode,
  'feature-unlink': featureUnlink,
  'feature-lint': featureLint,
  'feature-uninstall-pack': featureUninstallPack,
  'feature-reconcile': featureReconcile,
  'userflow-add-step': userflowAddStep,
  'userflow-set-verification': userflowSetVerification,
  'userflow-link': userflowLink,
  'userflow-derive-suggestions': userflowDeriveSuggestions,
  'userflow-query': userflowQuery,
}

export const GRAPH_TOOL_NAMES = Object.keys(GRAPH_TOOL_HANDLERS)

/** Run one wave-3 tool by name; unknown names are an error value,
 * never a throw (the dispatch endpoint's contract). */
async function runGraphToolImpl(name: string, input: Input): Promise<unknown> {
  const handler = GRAPH_TOOL_HANDLERS[name]
  if (!handler) {
    return { ok: false, error: `unknown graph tool "${name}". Available: ${GRAPH_TOOL_NAMES.join(', ')}` }
  }
  return handler(input ?? {})
}

/** The exported dispatch: the impl above, plus its per-tool debug
 * record when chat debug is on (slice 9 — chatDebug.ts). */
export async function runGraphTool(name: string, input: Input): Promise<unknown> {
  return withDispatchDebugLog(name, input, () => runGraphToolImpl(name, input))
}
