/**
 * Feature graph tools: the chat agent's handle on the project's
 * feature graph (src/features/features.ts). The graph is the durable
 * map of the whole app — the agent grows it while planning, queries
 * it before building, and updates node status as work lands, the
 * same edit-in-place discipline as the plan tools.
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  addEdge, addNode, configuresFor, createFeatureGraph, getFeatureGraph, getNode,
  graphRollup, lintGraph, nodeSummary, nodesByStatus, prerequisites, removeEdge, removeNode,
  renameNode, reparentNode, saveFeatureGraph,
  searchNodes, setNodeParam, setNodeStatus, subtree,
  FEATURE_EDGE_TYPES, FEATURE_NODE_KINDS, FEATURE_STATUSES,
} from '../../features/features.js'
import { buildNode, writeNodeConfig } from '../../features/buildNode.js'
import { reconcileGraph } from '../../features/reconcile.js'
import { graftPack, resolvePendingLinks, uninstallPack } from '../../features/graft.js'
import { getPack } from '../../catalog/packs.js'
import { getFsRoot } from '../../launcher.js'
import path from 'node:path'

function noGraph() {
  return { ok: false, error: 'No feature graph in this project yet. Start one by adding its first node with feature-add-node.' }
}

export const featureAddNodeTool = createTool({
  id: 'feature-add-node',
  description:
    'Add ONE node to the project feature graph, in place (starts the graph when none exists). Regions group features; a node\'s parent is its region or containing feature. Bind premade work instead of describing it from scratch: component = a catalog tag, template = a template id, pack = a feature pack id, derivedFrom = the layout/template/pack the node derives from (the ladder: master-detail → settings screen → admin pack). Setting nodes carry params (the parameters they hold). Every other node stays exactly as it is — never rebuild the graph to add a node.',
  inputSchema: z.object({
    name: z.string().describe('Node name, e.g. "Checkout flow", "Currency", "Storefront"'),
    kind: z.enum(FEATURE_NODE_KINDS).describe('region | feature | screen | component | setting | data | service'),
    parentId: z.string().optional().describe('Containing node id (a region for top features); omit for top level'),
    status: z.enum(FEATURE_STATUSES).optional().describe('Default proposed'),
    component: z.string().optional().describe('Catalog component tag this node is built from'),
    template: z.string().optional().describe('Catalog template id this node is built from'),
    pack: z.string().optional().describe('Feature pack id this node arrived with'),
    derivedFrom: z.string().optional().describe('Layout, template or pack id this node derives from / realizes'),
    params: z.array(z.object({
      name: z.string(),
      type: z.enum(['text', 'choice', 'boolean', 'color', 'number']),
      options: z.array(z.string()).optional(),
      default: z.string().optional(),
    })).optional().describe('Parameters, for setting nodes'),
    note: z.string().optional(),
  }),
  execute: async ({ name, kind, parentId, status, component, template, pack, derivedFrom, params, note }) => {
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
  },
})

export const featureSetStatusTool = createTool({
  id: 'feature-set-status',
  description:
    'Set one feature graph node\'s build status as work lands (proposed → planned → building → done → verified; blocked when something stops it, dropped when the user cuts it). Region progress is computed from the leaves, so only leaf/feature statuses need setting — never compute or store a region percentage yourself.',
  inputSchema: z.object({
    id: z.string().describe('The node id'),
    status: z.enum(FEATURE_STATUSES),
  }),
  execute: async ({ id, status }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    if (!setNodeStatus(graph, id, status)) return { ok: false, error: `No node with id ${id} in the feature graph.` }
    saveFeatureGraph(graph)
    const { overall } = graphRollup(graph)
    return { ok: true, node: nodeSummary(getNode(graph, id)!), overall }
  },
})

export const featureLinkTool = createTool({
  id: 'feature-link',
  description:
    'Link two feature graph nodes with a typed edge. depends-on: the source needs the target built first. configures: a setting/parameter node affects the target (this is how a settings window links to what it changes in the app). renders: a feature produces a screen. data-flows: data moves source → target. derived-from: the ladder — the source derives from / realizes a layout, template or pack node. Containment is NOT an edge: set parentId on feature-add-node instead.',
  inputSchema: z.object({
    from: z.string().describe('Source node id'),
    to: z.string().describe('Target node id'),
    type: z.enum(FEATURE_EDGE_TYPES),
  }),
  execute: async ({ from, to, type }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    if (!getNode(graph, from)) return { ok: false, error: `No node with id ${from} in the feature graph.` }
    if (!getNode(graph, to)) return { ok: false, error: `No node with id ${to} in the feature graph.` }
    if (!addEdge(graph, { from, to, type })) {
      return { ok: false, error: from === to ? 'A node cannot link to itself.' : 'That edge already exists.' }
    }
    saveFeatureGraph(graph)
    return { ok: true, edge: { from, to, type }, totalEdges: graph.edges.length }
  },
})

export const featureInstallPackTool = createTool({
  id: 'feature-install-pack',
  description:
    'Install a catalog feature pack (tier 3) into the project feature graph: the pack\'s subgraph is grafted in with fresh ids, every node bound to the pack and status proposed, its internal edges remapped, and its declared configures links wired to existing graph nodes whose names match. Links that match nothing come back as unwired with their role AND are recorded on the graph as pending links: they wire themselves when a node with a matching name is added or renamed later (the add/edit results report resolvedLinks when that happens); until then they can also be wired by hand with feature-link. Say which ones were left pending. Refuses a pack that is already installed. The graft is graph-only: afterwards, build the grafted features out in the returned build order (an install plan tracks this well) — feature-build-node places each node\'s bindings and parameter values; update node statuses as work lands.',
  inputSchema: z.object({
    packId: z.string().describe('The pack id from find-component, e.g. "admin-configuration"'),
    parentId: z.string().optional().describe('Attach the pack\'s root nodes under this graph node (e.g. a region); omit for top level'),
  }),
  execute: async ({ packId, parentId }) => {
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
  },
})

export const featureQueryTool = createTool({
  id: 'feature-query',
  description:
    'Query the project feature graph before planning or building feature work. Modes: overview (regions + progress rollup), region (one node\'s subtree — pass id), status (nodes with a status — pass status, e.g. blocked), configures (what a setting node configures and what configures it — pass id), prerequisites (everything that must exist before a node, in build order — pass id), search (nodes by name — pass text), pending (pack links still waiting for a node whose name matches — they wire themselves when one appears).',
  inputSchema: z.object({
    mode: z.enum(['overview', 'region', 'status', 'configures', 'prerequisites', 'search', 'pending']),
    id: z.string().optional().describe('Node id, for region / configures / prerequisites'),
    status: z.enum(FEATURE_STATUSES).optional().describe('For mode status'),
    text: z.string().optional().describe('For mode search'),
  }),
  execute: async ({ mode, id, status, text }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
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
  },
})

export const featureSetParamTool = createTool({
  id: 'feature-set-param',
  description:
    'Set one parameter value on a graph node, validated against the node\'s parameter schema (a choice must be one of its options, a boolean "true"/"false", a number numeric, a color a hex color). The value is stored on the node AND the node\'s effective values are rewritten to src/config/<node>.json — the file the built app reads — so the graph and the app never disagree about a setting. See a node\'s schema and current values with feature-query.',
  inputSchema: z.object({
    id: z.string().describe('Node id from feature-query or feature-add-node'),
    name: z.string().describe('Parameter name from the node\'s parameter schema'),
    value: z.string().describe('The new value, as a string (numbers and booleans included)'),
  }),
  execute: async ({ id, name, value }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    const problem = setNodeParam(graph, id, name, value)
    if (problem) return { ok: false, error: problem }
    saveFeatureGraph(graph)
    const node = getNode(graph, id)!
    const configFile = writeNodeConfig(node, getFsRoot())
    return { ok: true, node: nodeSummary(node), ...(configFile ? { configFile } : {}) }
  },
})

export const featureBuildNodeTool = createTool({
  id: 'feature-build-node',
  description:
    'Start building one graph node: place its bindings into the project — a component binding is copy-installed from the catalog, a template binding is placed (both never replace an existing file; a repeat build reports "already") — seed its parameter values from defaults, write its effective values to src/config/<node>.json for the app to read, and move the node to building. Returns a per-binding report; a binding that cannot be placed reports an error for that binding only. After this, write the node\'s own code with the ordinary file tools, then mark it done with feature-set-status.',
  inputSchema: z.object({
    id: z.string().describe('Node id from feature-query or feature-add-node'),
  }),
  execute: async ({ id }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    const result = buildNode(graph, id, getFsRoot())
    if (result.ok === false) return result
    saveFeatureGraph(graph)
    return result
  },
})

export const featureEditNodeTool = createTool({
  id: 'feature-edit-node',
  description:
    'Rename a graph node and/or move it: pass name to rename, parentId to reparent — or parentId: null to lift the node to the top level. Reparenting refuses anything that would create a containment cycle (the target is the node itself or inside its subtree). Only what you pass changes; use feature-query first when unsure of the shape.',
  inputSchema: z.object({
    id: z.string().describe('Node id from feature-query or feature-add-node'),
    name: z.string().optional().describe('New name; omit to keep the current one'),
    parentId: z.string().nullable().optional().describe('New parent id; null = top level; omit = unchanged'),
  }),
  execute: async ({ id, name, parentId }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
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
  },
})

export const featureRemoveNodeTool = createTool({
  id: 'feature-remove-node',
  description:
    'Remove a node from the graph. mode "lift" (default): the node goes, its children move up to its parent, edges touching it are removed. mode "cascade": the node AND its whole subtree go. To remove a whole installed pack cleanly, prefer feature-uninstall-pack. Removal is structural only — files the nodes were built into stay in the project.',
  inputSchema: z.object({
    id: z.string().describe('Node id from feature-query or feature-add-node'),
    mode: z.enum(['lift', 'cascade']).optional().describe('Default lift'),
  }),
  execute: async ({ id, mode }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    const result = removeNode(graph, id, mode ?? 'lift')
    if (!result) return { ok: false, error: `No node with id ${id} in the feature graph.` }
    saveFeatureGraph(graph)
    return {
      ok: true,
      removed: result.removed.map(nodeSummary),
      lifted: result.lifted,
      totalNodes: graph.nodes.length,
    }
  },
})

export const featureUnlinkTool = createTool({
  id: 'feature-unlink',
  description:
    'Remove ONE typed edge between two graph nodes (the inverse of feature-link) — e.g. a configures link that no longer holds, or a depends-on that was wrong. Reports when no such edge exists.',
  inputSchema: z.object({
    from: z.string().describe('Edge source node id'),
    to: z.string().describe('Edge target node id'),
    type: z.enum(FEATURE_EDGE_TYPES).describe('depends-on | configures | renders | data-flows | derived-from'),
  }),
  execute: async ({ from, to, type }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    if (!removeEdge(graph, { from, to, type })) {
      return { ok: false, error: `No ${type} edge from ${from} to ${to} in the graph.` }
    }
    saveFeatureGraph(graph)
    return { ok: true, totalEdges: graph.edges.length }
  },
})

export const featureLintTool = createTool({
  id: 'feature-lint',
  description:
    'Check the feature graph for structural damage — the kind a hand edit to graph.json can cause: duplicate ids, parents or edge endpoints that no longer exist, containment cycles, depends-on cycles, unknown kinds/statuses, and parameter values that no longer fit their schema. Read-only: it reports problems with the nodes involved; fix them with feature-edit-node / feature-remove-node / feature-unlink / feature-set-param. Run it after any manual graph edit, or when a query result looks wrong.',
  inputSchema: z.object({}),
  execute: async () => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    const problems = lintGraph(graph)
    return { ok: problems.length === 0, problems, totalNodes: graph.nodes.length, totalEdges: graph.edges.length }
  },
})

export const featureUninstallPackTool = createTool({
  id: 'feature-uninstall-pack',
  description:
    'Remove an installed feature pack from the graph: every node the pack brought goes, with its edges. Host nodes parented under a pack node are kept and lifted to the nearest surviving ancestor. Graph-only — files a build-out already placed (components, templates, src/config values) stay in the project; uninstall retracts the map, not what was built from it.',
  inputSchema: z.object({
    packId: z.string().describe('The pack id, e.g. "admin-configuration" — installed packs show in feature-query overview via node pack bindings'),
  }),
  execute: async ({ packId }) => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    const result = uninstallPack(graph, packId)
    if (result.ok === false) return { ok: false, error: result.error }
    saveFeatureGraph(graph)
    return {
      ok: true, pack: result.packId,
      removed: result.removed.map(nodeSummary),
      lifted: result.lifted,
      totalNodes: graph.nodes.length,
    }
  },
})

export const featureReconcileTool = createTool({
  id: 'feature-reconcile',
  description:
    'Reconcile the feature graph (as-intended) against the project on disk (as-built): for every node marked done or verified, check that what it claims actually exists — a component binding\'s installed file (or a same-named component in the codebase map), a template binding\'s placed file, a parameterized node\'s src/config values file. Missing pieces come back as drift items with the node involved. Read-only: fix drift by re-placing with feature-build-node, correcting the status with feature-set-status, or restoring the file. Run it after deletions, renames, or when a "done" feature seems absent from the app.',
  inputSchema: z.object({}),
  execute: async () => {
    const graph = getFeatureGraph()
    if (!graph) return noGraph()
    const { drift, checked } = reconcileGraph(graph, getFsRoot())
    return { ok: drift.length === 0, drift, checked }
  },
})
