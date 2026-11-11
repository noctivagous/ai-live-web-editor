/**
 * Graph + brief tools for the ALE MCP server (Muse Code
 * design §7/§8, slice 6).
 *
 * Graph work is data work against the existing stores —
 * feature graph, user-flow graph, design graph, architecture
 * declaration — so these tools wrap the same graph dispatch
 * the other engines use (opencode/graphTools.ts, behind
 * POST /api/graph/tool) and, for reads the dispatch doesn't
 * shape, the stores themselves. Validation stays the store's
 * own: a change the store would refuse is refused here with
 * the store's reason.
 *
 * The design graph is DERIVED from the project's token source
 * and the architecture graph is a declaration document, so
 * ale_graph_apply honestly covers the two graphs that take
 * change sets (features, userflow) and says what to edit
 * instead for the other two — no fake write path.
 *
 * Reconciliation speaks the facets' shared vocabulary —
 * missing / present / conflicting / extra — through the pack
 * preview functions (archPacks / designPacks), plus the
 * feature graph's own drift check against the disk.
 */
import { getArchitecture, architectureSummary } from '../architecture/architecture.js'
import { getArchPack, previewArchPack } from '../architecture/archPacks.js'
import { getDesignGraph } from '../design/designGraph.js'
import { loadDesignPacks, previewDesignPack } from '../design/designPacks.js'
import { getFeatureGraph } from '../features/features.js'
import { getFsRoot } from '../launcher.js'
import { runGraphTool } from '../opencode/graphTools.js'
import { runProjectTool } from '../opencode/projectTools.js'
import { readProjectConfig } from '../projectConfig.js'
import { getUserFlowGraph, userFlowCounts } from '../userflows/userflows.js'
import { obj, str, type AleToolDef } from './tools.js'

type Input = Record<string, any>

const GRAPHS = ['features', 'userflow', 'design', 'architecture'] as const
type GraphName = (typeof GRAPHS)[number]

function graphName(input: Input): GraphName | null {
  return (GRAPHS as readonly string[]).includes(input?.graph) ? (input.graph as GraphName) : null
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

async function graphRead(input: Input): Promise<unknown> {
  const graph = graphName(input)
  if (!graph) return { ok: false, error: `Pass graph as one of: ${GRAPHS.join(', ')}.` }
  switch (graph) {
    case 'features': {
      // A mode rides the agent-shaped query dispatch; no mode
      // returns the whole graph from the store.
      if (typeof input.mode === 'string' && input.mode) {
        return runGraphTool('feature-query', { mode: input.mode, id: input.id, status: input.status, text: input.text })
      }
      const g = getFeatureGraph()
      if (!g) return { ok: false, error: 'No feature graph in this project yet. Create one with ale_graph_apply (the first add-node starts it).' }
      return { ok: true, graph: 'features', title: g.title, nodes: g.nodes, edges: g.edges, pendingLinks: g.pendingLinks ?? [] }
    }
    case 'userflow': {
      return runGraphTool('userflow-query', { mode: typeof input.mode === 'string' && input.mode ? input.mode : 'overview', id: input.id, text: input.text })
    }
    case 'design': {
      const g = getDesignGraph()
      if (!g) return { ok: false, error: 'No design graph could be derived for this project (no design guide or token source found).' }
      return { ok: true, graph: 'design', design: g }
    }
    case 'architecture': {
      const decl = getArchitecture()
      if (!decl) return { ok: false, error: 'No architecture declaration in this project yet.' }
      return { ok: true, graph: 'architecture', declaration: decl, summary: architectureSummary() }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Apply a change set                                                  */
/* ------------------------------------------------------------------ */

const FEATURE_OPS: Record<string, string> = {
  'add-node': 'feature-add-node',
  'set-status': 'feature-set-status',
  'link': 'feature-link',
  'unlink': 'feature-unlink',
  'remove-node': 'feature-remove-node',
  'edit-node': 'feature-edit-node',
  'set-param': 'feature-set-param',
}

const USERFLOW_OPS: Record<string, string> = {
  'add-step': 'userflow-add-step',
  'link': 'userflow-link',
  'set-verification': 'userflow-set-verification',
}

async function graphApply(input: Input): Promise<unknown> {
  const graph = graphName(input)
  if (!graph) return { ok: false, error: `Pass graph as one of: ${GRAPHS.join(', ')}.` }
  if (graph === 'design') {
    return { ok: false, error: 'The design graph is derived from the project’s token source and design guide — it takes no change set. Edit the token source (CSS variables / tokens file) or the design guide, then read the graph again.' }
  }
  if (graph === 'architecture') {
    return { ok: false, error: 'The architecture graph is a declaration document, not a node store — it takes no change set. Reconcile an architecture plan pack with ale_graph_reconcile, or edit the declaration through the Architecture facet.' }
  }
  const changes = Array.isArray(input.changes) ? (input.changes as Input[]) : []
  if (!changes.length) return { ok: false, error: 'Pass a non-empty changes array.' }
  const ops = graph === 'features' ? FEATURE_OPS : USERFLOW_OPS
  const results: unknown[] = []
  for (const change of changes) {
    const op = typeof change?.op === 'string' ? change.op : ''
    const host = ops[op]
    if (!host) {
      results.push({ op, ok: false, error: `unknown ${graph} change op "${op}". Available: ${Object.keys(ops).join(', ')}` })
      continue
    }
    const { op: _op, ...rest } = change
    results.push({ op, ...(await runGraphTool(host, rest) as Record<string, unknown>) })
  }
  const applied = results.filter((r) => (r as Record<string, unknown>).ok === true).length
  return { ok: applied === results.length, graph, applied, total: results.length, results }
}

/* ------------------------------------------------------------------ */
/* Reconcile                                                           */
/* ------------------------------------------------------------------ */

async function graphReconcile(input: Input): Promise<unknown> {
  const target = typeof input.target === 'string' ? input.target : ''
  if (target === 'feature-drift') {
    return runGraphTool('feature-reconcile', {})
  }
  if (target === 'architecture-pack') {
    const pack = typeof input.packId === 'string' ? getArchPack(input.packId) : undefined
    if (!pack) return { ok: false, error: `Pass packId naming an architecture plan pack${typeof input.packId === 'string' ? ` — "${input.packId}" was not found` : ''}.` }
    const items = previewArchPack(pack)
    return { ok: true, target, pack: pack.id, items, counts: countStates(items.map((i) => i.state)) }
  }
  if (target === 'design-pack') {
    const packs = loadDesignPacks()
    const pack = packs.find((p) => p.id === input.packId)
    if (!pack) return { ok: false, error: `Pass packId naming a design pack${typeof input.packId === 'string' ? ` — "${input.packId}" was not found` : ''}.` }
    const preview = previewDesignPack(pack)
    return { ok: true, target, pack: pack.id, preview }
  }
  return { ok: false, error: 'Pass target as one of: feature-drift, architecture-pack, design-pack.' }
}

function countStates(states: string[]): Record<string, number> {
  const counts: Record<string, number> = { missing: 0, present: 0, conflicting: 0, extra: 0 }
  for (const s of states) counts[s] = (counts[s] ?? 0) + 1
  return counts
}

/* ------------------------------------------------------------------ */
/* Brief / context reads (§7: a session pulls context, not only        */
/* receives it in the brief)                                           */
/* ------------------------------------------------------------------ */

async function briefRead(input: Input): Promise<unknown> {
  const part = typeof input.part === 'string' ? input.part : 'brief'
  if (part === 'map') return runProjectTool('codebase-map', input.mapInput ?? {})
  if (part === 'facets') {
    const features = getFeatureGraph()
    const flows = getUserFlowGraph()
    return {
      ok: true,
      facets: {
        features: features ? { title: features.title, nodes: features.nodes.length, edges: features.edges.length } : null,
        userflow: flows ? userFlowCounts(flows) : null,
        design: getDesignGraph() ? { derived: true } : null,
        architecture: getArchitecture() ? { summary: architectureSummary() } : null,
      },
    }
  }
  // 'brief': the project's own framing, from its config + stores.
  const cfg = readProjectConfig()
  const features = getFeatureGraph()
  return {
    ok: true,
    root: getFsRoot(),
    brief: {
      format: cfg.format ?? null,
      entry: cfg.entry ?? null,
      type: cfg.type ?? null,
      architecture: getArchitecture() ? architectureSummary() : null,
      features: features ? { title: features.title, nodes: features.nodes.length, edges: features.edges.length } : null,
    },
  }
}

export const ALE_GRAPH_TOOLS: AleToolDef[] = [
  {
    name: 'ale_graph_read',
    description: 'Read one of ALE’s graphs: "features" (the feature graph — with no mode, the whole graph; modes overview/region/status/configures/prerequisites/search/pending give shaped views), "userflow" (journeys and steps; modes overview/journey/coverage/search), "design" (the design graph derived from the token source), "architecture" (the architecture declaration + summary). Read before you change: the graph is the shared picture of what this app is.',
    inputSchema: obj({
      graph: { type: 'string', enum: [...GRAPHS], description: 'Which graph to read' },
      mode: str('Query mode for features/userflow graphs'),
      id: str('Node/step id for region-style modes'),
      status: str('Status filter for features mode=status'),
      text: str('Search text for mode=search'),
    }, ['graph']),
    run: graphRead,
  },
  {
    name: 'ale_graph_apply',
    description: 'Apply a change set to the feature graph or the user-flow graph. Feature ops: add-node {name, kind, parentId?, status?, note?, component?, template?, params?}, set-status {id, status}, link {from, to, type}, unlink {from, to, type}, remove-node {id}, edit-node {id, name?}, set-param {id, name, value}. Userflow ops: add-step {journey, name, type, note?}, link {from, to, type}, set-verification {id, state}. Each change is validated by the store; the result reports every change’s outcome. Changes apply in order.',
    inputSchema: obj({
      graph: { type: 'string', enum: ['features', 'userflow'], description: 'Which graph to change' },
      changes: { type: 'array', description: 'The change set, applied in order', items: { type: 'object' } },
    }, ['graph', 'changes']),
    run: graphApply,
  },
  {
    name: 'ale_graph_reconcile',
    description: 'Reconcile a pack against the project, in the shared vocabulary — missing / present / conflicting / extra. Targets: "feature-drift" (the feature graph checked against what is on disk), "architecture-pack" {packId} (an architecture plan pack previewed against the current declaration), "design-pack" {packId} (a design pack previewed against the current design). Reconcile reports; it does not apply — applying is ale_graph_install_pack for feature packs, or the facet’s own follow path.',
    inputSchema: obj({
      target: { type: 'string', enum: ['feature-drift', 'architecture-pack', 'design-pack'], description: 'What to reconcile' },
      packId: str('Pack id for the pack targets'),
    }, ['target']),
    run: graphReconcile,
  },
  {
    name: 'ale_graph_install_pack',
    description: 'Graft a feature pack into the feature graph (ALE’s catalog packs — find ids with the catalog): adds the pack’s nodes with their build order, wires the links it can, and reports the links it left unwired (never silently dropped). Settings start at the pack’s stated defaults. This is the same graft the Add a Feature wizard performs.',
    inputSchema: obj({
      packId: str('The catalog feature pack id'),
      parentId: str('Optional graph node to graft under'),
    }, ['packId']),
    run: (input) => runGraphTool('feature-install-pack', input ?? {}),
  },
  {
    name: 'ale_brief_read',
    description: 'Pull ALE’s packaged context instead of guessing: part "brief" returns the project brief (format, start page, architecture summary, feature graph shape); part "facets" returns every facet’s summary; part "map" returns the codebase map (pass mapInput through for its options).',
    inputSchema: obj({
      part: { type: 'string', enum: ['brief', 'facets', 'map'], description: 'Which context package' },
      mapInput: { type: 'object', description: 'Options for part=map, passed to the codebase map' },
    }),
    run: briefRead,
  },
]
