import type { Express } from 'express'
import {
  addEdge, addNode, createFeatureGraph, getFeatureGraph, getNode, graphRollup,
  parseFeatureEdgeType, parseFeatureNodeKind, parseFeatureStatus, saveFeatureGraph,
  setNodeStatus,
} from './features.js'

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
    saveFeatureGraph(graph)
    res.json({ ok: true, node, totalNodes: graph.nodes.length })
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
}
