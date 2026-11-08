import type { Express } from 'express'
import {
  addEdge, addNode, createFeatureGraph, getFeatureGraph, getNode, graphRollup,
  lintGraph, nodeSummary,
  parseFeatureEdgeType, parseFeatureNodeKind, parseFeatureStatus, removeEdge, removeNode,
  renameNode, reparentNode, saveFeatureGraph,
  setNodeParam, setNodeStatus,
} from './features.js'
import { buildNode, writeNodeConfig } from './buildNode.js'
import { graftPack, resolvePendingLinks, uninstallPack } from './graft.js'
import { reconcileGraph } from './reconcile.js'
import { getPack } from '../catalog/packs.js'
import { getFsRoot } from '../launcher.js'

/**
 * Feature graph HTTP API, mounted on both servers (the planApi
 * pattern). Reads return the canonical graph + computed rollup;
 * writes go through the same store functions the agent tools use,
 * so the API and the agent can never diverge.
 */
export function mountFeatureApi(app: Express) {
  app.get('/api/features', (_req, res) => {
    const graph = getFeatureGraph()
    res.json({ ok: true, graph, rollup: graph ? graphRollup(graph) : null })
  })

  app.post('/api/features/nodes', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) return res.status(400).json({ ok: false, error: 'name required' })
    const graph = getFeatureGraph() ?? createFeatureGraph(
      typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title : name,
    )
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : undefined
    if (parentId && !getNode(graph, parentId)) {
      return res.status(400).json({ ok: false, error: `No node with id ${parentId}` })
    }
    const node = addNode(graph, {
      name,
      kind: parseFeatureNodeKind(req.body?.kind),
      status: parseFeatureStatus(req.body?.status),
      ...(parentId ? { parent: parentId } : {}),
      ...(typeof req.body?.component === 'string' ? { component: req.body.component } : {}),
      ...(typeof req.body?.template === 'string' ? { template: req.body.template } : {}),
      ...(typeof req.body?.pack === 'string' ? { pack: req.body.pack } : {}),
      ...(typeof req.body?.derivedFrom === 'string' ? { derivedFrom: req.body.derivedFrom } : {}),
      ...(typeof req.body?.note === 'string' ? { note: req.body.note } : {}),
    })
    const resolvedLinks = resolvePendingLinks(graph, [node])
    saveFeatureGraph(graph)
    res.json({ ok: true, node, totalNodes: graph.nodes.length, ...(resolvedLinks.length ? { resolvedLinks } : {}) })
  })

  app.post('/api/features/status', (req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    if (!setNodeStatus(graph, id, parseFeatureStatus(req.body?.status))) {
      return res.status(404).json({ ok: false, error: `No node with id ${id}` })
    }
    saveFeatureGraph(graph)
    res.json({ ok: true, node: getNode(graph, id), rollup: graphRollup(graph).overall })
  })

  app.post('/api/features/param', (req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    if (!id || !name || typeof req.body?.value !== 'string') {
      return res.status(400).json({ ok: false, error: 'Expected { id, name, value }.' })
    }
    const problem = setNodeParam(graph, id, name, req.body.value)
    if (problem) return res.status(422).json({ ok: false, error: problem })
    saveFeatureGraph(graph)
    const configFile = writeNodeConfig(getNode(graph, id)!, getFsRoot())
    res.json({ ok: true, node: getNode(graph, id), configFile })
  })

  app.post('/api/features/build', (req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const result = buildNode(graph, id, getFsRoot())
    if (result.ok === false) return res.status(404).json(result)
    saveFeatureGraph(graph)
    res.json(result)
  })

  app.get('/api/features/reconcile', (_req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.json({ ok: true, drift: [], checked: 0 })
    const { drift, checked } = reconcileGraph(graph, getFsRoot())
    res.json({ ok: true, drift, checked })
  })

  app.get('/api/features/lint', (_req, res) => {
    const graph = getFeatureGraph()
    res.json({ ok: true, problems: graph ? lintGraph(graph) : [] })
  })

  app.post('/api/features/uninstall', (req, res) => {
    const packId = typeof req.body?.packId === 'string' ? req.body.packId : ''
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const result = uninstallPack(graph, packId)
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error })
    saveFeatureGraph(graph)
    res.json({
      ok: true, pack: result.packId,
      removed: result.removed.map(nodeSummary),
      lifted: result.lifted,
      rollup: graphRollup(graph).overall,
    })
  })

  app.post('/api/features/install', (req, res) => {
    const packId = typeof req.body?.packId === 'string' ? req.body.packId : ''
    const pack = getPack(packId)
    if (!pack) return res.status(404).json({ ok: false, error: `No feature pack with id ${packId}` })
    const graph = getFeatureGraph() ?? createFeatureGraph(pack.name)
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : undefined
    const result = graftPack(graph, pack, { parentId })
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error })
    saveFeatureGraph(graph)
    res.json({
      ok: true, pack: pack.id,
      added: result.added, internalEdges: result.internalEdges,
      wired: result.wired, unwired: result.unwired,
      pendingLinks: graph.pendingLinks ?? [],
      resolvedLinks: result.resolvedLinks,
      buildOrder: result.buildOrder.map(n => n.id),
      rollup: graphRollup(graph).overall,
    })
  })

  app.post('/api/features/links', (req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const type = parseFeatureEdgeType(req.body?.type)
    if (!type) return res.status(400).json({ ok: false, error: 'Unknown edge type' })
    const from = typeof req.body?.from === 'string' ? req.body.from : ''
    const to = typeof req.body?.to === 'string' ? req.body.to : ''
    if (!addEdge(graph, { from, to, type })) {
      return res.status(400).json({ ok: false, error: 'Edge refused: missing endpoint, self-link, or duplicate' })
    }
    saveFeatureGraph(graph)
    res.json({ ok: true, totalEdges: graph.edges.length })
  })

  app.post('/api/features/unlinks', (req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const type = parseFeatureEdgeType(req.body?.type)
    if (!type) return res.status(400).json({ ok: false, error: 'Unknown edge type' })
    const from = typeof req.body?.from === 'string' ? req.body.from : ''
    const to = typeof req.body?.to === 'string' ? req.body.to : ''
    if (!removeEdge(graph, { from, to, type })) {
      return res.status(404).json({ ok: false, error: 'No such edge' })
    }
    saveFeatureGraph(graph)
    res.json({ ok: true, totalEdges: graph.edges.length })
  })

  /** Rename and/or reparent a node — the pane's structural editing,
   * through the same store functions as the feature-edit-node tool. */
  app.post('/api/features/edit', (req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    if (!getNode(graph, id)) return res.status(404).json({ ok: false, error: `No node with id ${id}` })
    if (typeof req.body?.name === 'string' && !renameNode(graph, id, req.body.name)) {
      return res.status(400).json({ ok: false, error: 'Name refused (empty)' })
    }
    if ('parentId' in (req.body ?? {})) {
      const parentId = typeof req.body.parentId === 'string' ? req.body.parentId : undefined
      const problem = reparentNode(graph, id, parentId)
      if (problem) return res.status(422).json({ ok: false, error: problem })
    }
    saveFeatureGraph(graph)
    res.json({ ok: true, node: getNode(graph, id) })
  })

  app.post('/api/features/remove-node', (req, res) => {
    const graph = getFeatureGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No feature graph in this project' })
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const mode = req.body?.mode === 'cascade' ? 'cascade' : 'lift'
    const result = removeNode(graph, id, mode)
    if (!result) return res.status(404).json({ ok: false, error: `No node with id ${id}` })
    saveFeatureGraph(graph)
    res.json({
      ok: true,
      removed: result.removed.map(nodeSummary),
      lifted: result.lifted,
      rollup: graphRollup(graph).overall,
    })
  })
}
