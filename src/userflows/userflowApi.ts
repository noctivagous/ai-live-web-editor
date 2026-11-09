import type { Express } from 'express'
import {
  addExercises, addFlowEdge, addJourney, addStep, createUserFlowGraph, findJourney,
  getJourney, getStep, getUserFlowGraph, parseBlockKind, parseUserFlowEdgeType, parseUserFlowStepType,
  parseVerificationState, removeExercises, removeFlowEdge, saveUserFlowGraph,
  setVerification, userFlowCounts,
} from './userflows.js'
import { getFeatureGraph } from '../features/features.js'

/**
 * User flow graph HTTP API, mounted on both servers (the featureApi
 * pattern). Reads return the canonical graph + computed counts;
 * writes go through the same store functions the agent tools use,
 * so the API and the agent can never diverge.
 */
export function mountUserFlowApi(app: Express) {
  app.get('/api/userflows', (_req, res) => {
    const graph = getUserFlowGraph()
    res.json({ ok: true, graph, counts: graph ? userFlowCounts(graph) : null })
  })

  app.post('/api/userflows/steps', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) return res.status(400).json({ ok: false, error: 'name required' })
    const type = parseUserFlowStepType(req.body?.type)
    if (!type) return res.status(400).json({ ok: false, error: 'Unknown step type' })
    const journeyRef = typeof req.body?.journey === 'string' ? req.body.journey.trim() : ''
    if (!journeyRef) return res.status(400).json({ ok: false, error: 'journey required' })
    const graph = getUserFlowGraph() ?? createUserFlowGraph(
      typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title : name,
    )
    const journey = findJourney(graph, journeyRef) ?? addJourney(graph, { name: journeyRef })
    const step = addStep(graph, {
      name, type, journey: journey.id,
      ...(typeof req.body?.note === 'string' ? { note: req.body.note } : {}),
    })!
    saveUserFlowGraph(graph)
    res.json({ ok: true, step, journey: { id: journey.id, name: journey.name }, totalSteps: graph.steps.length })
  })

  /** Rename, retype or move a step to another journey — the pane's
   * structural editing, mirroring /api/features/edit. The store
   * exposes no edit op (slice 1 grew graphs and set verification
   * only), so the edit is applied to the loaded graph here and
   * saved through the same saveUserFlowGraph as every other write. */
  app.post('/api/userflows/steps/edit', (req, res) => {
    const graph = getUserFlowGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No user flow graph in this project' })
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const step = getStep(graph, id)
    if (!step) return res.status(404).json({ ok: false, error: `No step with id ${id}` })
    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim()
      if (!name) return res.status(400).json({ ok: false, error: 'Name refused (empty)' })
      step.name = name
    }
    if (typeof req.body?.type === 'string') {
      const type = parseUserFlowStepType(req.body.type)
      if (!type) return res.status(400).json({ ok: false, error: 'Unknown step type' })
      step.type = type
    }
    if (typeof req.body?.journey === 'string') {
      if (!getJourney(graph, req.body.journey)) {
        return res.status(400).json({ ok: false, error: `No journey with id ${req.body.journey}` })
      }
      step.journey = req.body.journey
    }
    saveUserFlowGraph(graph)
    res.json({ ok: true, step: getStep(graph, id) })
  })

  app.post('/api/userflows/verification', (req, res) => {
    const graph = getUserFlowGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No user flow graph in this project' })
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const state = parseVerificationState(req.body?.state)
    const rawBlock = req.body?.block as { kind?: unknown, evidence?: unknown, runId?: unknown, at?: unknown } | undefined
    const kind = rawBlock ? parseBlockKind(rawBlock.kind) : null
    const kept = setVerification(graph, id, {
      state,
      ...(kind
        ? {
            block: {
              kind,
              evidence: typeof rawBlock?.evidence === 'string' ? rawBlock.evidence : '',
              runId: typeof rawBlock?.runId === 'string' ? rawBlock.runId : '',
              at: typeof rawBlock?.at === 'string' ? rawBlock.at : new Date().toISOString(),
            },
          }
        : {}),
    })
    if (!kept) return res.status(404).json({ ok: false, error: `No step with id ${id}` })
    saveUserFlowGraph(graph)
    res.json({ ok: true, step: getStep(graph, id), counts: userFlowCounts(graph) })
  })

  app.post('/api/userflows/links', (req, res) => {
    const graph = getUserFlowGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No user flow graph in this project' })
    const from = typeof req.body?.from === 'string' ? req.body.from : ''
    const to = typeof req.body?.to === 'string' ? req.body.to : ''
    if (req.body?.type === 'exercises') {
      const problem = addExercises(graph, getFeatureGraph(), from, to)
      if (problem) return res.status(400).json({ ok: false, error: problem })
      saveUserFlowGraph(graph)
      return res.json({ ok: true, totalExercises: graph.exercises.length })
    }
    const type = parseUserFlowEdgeType(req.body?.type)
    if (!type) return res.status(400).json({ ok: false, error: 'Unknown edge type' })
    if (!addFlowEdge(graph, { from, to, type })) {
      return res.status(400).json({ ok: false, error: 'Edge refused: missing endpoint, self-link, or duplicate' })
    }
    saveUserFlowGraph(graph)
    res.json({ ok: true, totalEdges: graph.edges.length })
  })

  app.post('/api/userflows/unlinks', (req, res) => {
    const graph = getUserFlowGraph()
    if (!graph) return res.status(404).json({ ok: false, error: 'No user flow graph in this project' })
    const from = typeof req.body?.from === 'string' ? req.body.from : ''
    const to = typeof req.body?.to === 'string' ? req.body.to : ''
    if (req.body?.type === 'exercises') {
      if (!removeExercises(graph, from, to)) {
        return res.status(404).json({ ok: false, error: 'No such exercises link' })
      }
      saveUserFlowGraph(graph)
      return res.json({ ok: true, totalExercises: graph.exercises.length })
    }
    const type = parseUserFlowEdgeType(req.body?.type)
    if (!type) return res.status(400).json({ ok: false, error: 'Unknown edge type' })
    if (!removeFlowEdge(graph, { from, to, type })) {
      return res.status(404).json({ ok: false, error: 'No such edge' })
    }
    saveUserFlowGraph(graph)
    res.json({ ok: true, totalEdges: graph.edges.length })
  })
}
