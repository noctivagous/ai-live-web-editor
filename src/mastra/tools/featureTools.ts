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
  graphRollup, nodeSummary, nodesByStatus, prerequisites, saveFeatureGraph,
  searchNodes, setNodeStatus, subtree,
  FEATURE_EDGE_TYPES, FEATURE_NODE_KINDS, FEATURE_STATUSES,
} from '../../features/features.js'
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
    saveFeatureGraph(graph)
    return { ok: true, graph: graph.title, node: nodeSummary(node), totalNodes: graph.nodes.length }
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

export const featureQueryTool = createTool({
  id: 'feature-query',
  description:
    'Query the project feature graph before planning or building feature work. Modes: overview (regions + progress rollup), region (one node\'s subtree — pass id), status (nodes with a status — pass status, e.g. blocked), configures (what a setting node configures and what configures it — pass id), prerequisites (everything that must exist before a node, in build order — pass id), search (nodes by name — pass text).',
  inputSchema: z.object({
    mode: z.enum(['overview', 'region', 'status', 'configures', 'prerequisites', 'search']),
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
    }
  },
})
