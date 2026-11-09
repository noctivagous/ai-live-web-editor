/**
 * User flow graph tools: the chat agent's handle on the project's
 * user flow graph (src/userflows/userflows.ts) — the app as used,
 * beside the feature graph's app as built. The agent grows the flow
 * graph while planning user-facing work, records verification as
 * steps are driven (today by hand or from what it observes; the
 * dogfood runner writes the same records), and follows `exercises`
 * links between a step and the features behind it.
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import path from 'node:path'
import {
  addExercises, addFlowEdge, addJourney, addStep, createUserFlowGraph, findJourney,
  getStep, getUserFlowGraph, saveUserFlowGraph,
  searchSteps, setVerification, stepSummary, stepsInJourney, userFlowCounts,
  BLOCK_KINDS, USERFLOW_EDGE_TYPES, USERFLOW_STEP_TYPES, VERIFICATION_STATES,
  type UserFlowEdgeType,
} from '../../userflows/userflows.js'
import { featuresNeverExercised, featuresOnBlockedSteps, stepsWithoutFeatures } from '../../userflows/coverage.js'
import { getFeatureGraph, getNode, saveFeatureGraph } from '../../features/features.js'
import { deriveSuggestions, liveSuggestions } from '../../features/suggestions.js'
import { getFsRoot } from '../../launcher.js'

function noGraph() {
  return { ok: false, error: 'No user flow graph in this project yet. Start one by adding its first step with userflow-add-step.' }
}

export const userflowAddStepTool = createTool({
  id: 'userflow-add-step',
  description:
    'Add ONE step to the project user flow graph, in place (starts the graph when none exists). Steps live in journeys (the graph\'s regions): pass the journey by name or id — a name that does not exist yet starts that journey. Step types: screen (what the user sees), action (what the user does), outcome (what should happen as a result). Steps start unverified; record how a step actually behaves with userflow-set-verification once it has been driven. Every other step stays exactly as it is — never rebuild the graph to add a step.',
  inputSchema: z.object({
    journey: z.string().describe('Journey name or id, e.g. "Checkout"'),
    name: z.string().describe('Step name, e.g. "Cart page", "Pay with card", "Order confirmed"'),
    type: z.enum(USERFLOW_STEP_TYPES).describe('screen | action | outcome'),
    note: z.string().optional(),
  }),
  execute: async ({ journey, name, type, note }) => {
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
  },
})

export const userflowSetVerificationTool = createTool({
  id: 'userflow-set-verification',
  description:
    'Record how one user flow step actually behaved when driven: ok (it worked), blocked or error (it did not — pass blockKind, evidence and runId to say why: unreachable, missing-affordance, console-error, dead-end, state-blocked), or untested to reset it. Verifying ok (or resetting) clears any recorded block, so a block never outlives the state it described.',
  inputSchema: z.object({
    id: z.string().describe('The step id'),
    state: z.enum(VERIFICATION_STATES).describe('untested | ok | blocked | error'),
    blockKind: z.enum(BLOCK_KINDS).optional().describe('For blocked / error: what kind of block it was'),
    evidence: z.string().optional().describe('What was seen — the console error text, the affordance that was missing'),
    runId: z.string().optional().describe('The run that recorded this block'),
  }),
  execute: async ({ id, state, blockKind, evidence, runId }) => {
    const graph = getUserFlowGraph()
    if (!graph) return noGraph()
    const kept = setVerification(graph, id, {
      state,
      ...(blockKind
        ? { block: { kind: blockKind, evidence: evidence ?? '', runId: runId ?? '', at: new Date().toISOString() } }
        : {}),
    })
    if (!kept) return { ok: false, error: `No step with id ${id} in the user flow graph.` }
    saveUserFlowGraph(graph)
    return { ok: true, step: stepSummary(graph, getStep(graph, id)!), counts: userFlowCounts(graph) }
  },
})

export const userflowLinkTool = createTool({
  id: 'userflow-link',
  description:
    'Link two user flow steps with a typed edge, or link a step to the feature behind it. navigates-to: the source step leads the user to the target. submits: the source sends a form / commits data at the target. branches-on: the flow forks on the target (a decision or state). requires: the source cannot happen until the target has (a state, an account, a prior step). exercises: the cross-graph link — from is a flow step, to is a FEATURE node id from the feature graph (feature-query finds them); this is how a step names the built features it uses. Containment is NOT an edge: a step\'s journey is set on userflow-add-step.',
  inputSchema: z.object({
    from: z.string().describe('Source step id'),
    to: z.string().describe('Target step id — or, for type exercises, a feature node id'),
    type: z.enum([...USERFLOW_EDGE_TYPES, 'exercises']).describe('navigates-to | submits | branches-on | requires | exercises'),
  }),
  execute: async ({ from, to, type }) => {
    const graph = getUserFlowGraph()
    if (!graph) return noGraph()
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
  },
})

export const userflowDeriveSuggestionsTool = createTool({
  id: 'userflow-derive-suggestions',
  description:
    'Reflect the user flow graph into the feature graph: derive dogfood suggestions from the steps\' current records. Every blocked or error step yields a fix suggestion and every step exercising no feature yields a coverage suggestion — one per step, as feature nodes with status suggested in the "Suggested by dogfooding" region, carrying their provenance (source step, block kind, evidence, run). Deterministic and idempotent: live suggestions are not duplicated, a suggestion whose step has since verified ok is withdrawn, and suggestions the user dismissed are never offered again (a step blocking with a different kind is a new suggestion). Suggestions count toward nothing in the feature rollup until the user accepts one in the graph pane. Call this after recording a dogfood run\'s verifications so the run reflects into Features by itself; report the counts it returns.',
  inputSchema: z.object({}),
  execute: async () => {
    const graph = getUserFlowGraph()
    if (!graph) return noGraph()
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
  },
})

export const userflowQueryTool = createTool({
  id: 'userflow-query',
  description:
    'Query the project user flow graph before planning user-facing work. Modes: overview (journeys + step counts + verification totals), journey (one journey\'s steps and their edges — pass id as a journey id or name), coverage (the two graphs read together: features no step exercises, steps exercising no feature, features sitting on blocked steps — needs the feature graph), search (steps by name — pass text).',
  inputSchema: z.object({
    mode: z.enum(['overview', 'journey', 'coverage', 'search']),
    id: z.string().optional().describe('Journey id or name, for mode journey'),
    text: z.string().optional().describe('For mode search'),
  }),
  execute: async ({ mode, id, text }) => {
    const graph = getUserFlowGraph()
    if (!graph) return noGraph()
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
  },
})
