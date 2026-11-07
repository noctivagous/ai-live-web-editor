/**
 * Plan tools (phase-11-06 §O): the chat agent's handle on the
 * active plan. This is how "update the questions from chat"
 * works — the agent edits the plan's model in place (stable
 * ids, answers preserved) instead of restarting the plan.
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  addQuestion, getActivePlan, removeQuestion, savePlan,
} from '../../plans/plans.js'
import { planFromGraph } from '../../plans/planFromGraph.js'

function noPlan() {
  return { ok: false, error: 'No active plan in this project. The user opens one with /plan in the chat.' }
}

export const planAddQuestionTool = createTool({
  id: 'plan-add-question',
  description:
    'Add ONE question to the ACTIVE plan, in place. Use when the user asks to add/ask about something in the plan ("add a question about offline support"). Every other question, answer, note and task stays exactly as it is — never rebuild the plan to add a question. Always give the question a sensible default proposal (what happens if the user skips it).',
  inputSchema: z.object({
    label: z.string().describe('The question text'),
    control: z.enum(['choice', 'text']).optional().describe('choice when there is a small set of options'),
    options: z.array(z.string()).optional().describe('Options for a choice question (2-5)'),
    defaultProposal: z.string().describe('What happens if the user does not answer'),
  }),
  execute: async ({ label, control, options, defaultProposal }) => {
    const doc = getActivePlan()
    if (!doc) return noPlan()
    const q = addQuestion(doc, {
      label,
      control: control === 'choice' && options?.length ? 'choice' : 'text',
      options: control === 'choice' ? options : undefined,
      default: defaultProposal,
    })
    savePlan(doc)
    return { ok: true, plan: doc.slug, question: q, totalQuestions: doc.questions.length }
  },
})

export const planRemoveQuestionTool = createTool({
  id: 'plan-remove-question',
  description:
    'Remove ONE question from the ACTIVE plan by its id (ids are in the plan summary in your brief, or read the plan file at ai-plans/<slug>.md). Use when the user asks to drop a question. Everything else in the plan is untouched.',
  inputSchema: z.object({
    id: z.string().describe('The question id, e.g. "qm3k…"'),
  }),
  execute: async ({ id }) => {
    const doc = getActivePlan()
    if (!doc) return noPlan()
    if (!removeQuestion(doc, id)) return { ok: false, error: `No question with id ${id} in plan ${doc.slug}.` }
    savePlan(doc)
    return { ok: true, plan: doc.slug, totalQuestions: doc.questions.length }
  },
})

export const planReviseQuestionTool = createTool({
  id: 'plan-revise-question',
  description:
    'Revise ONE question in the ACTIVE plan in place — reword it, change its options, or replace its default proposal (e.g. in response to the user\'s note on it, or new information in chat). The user\'s existing answer and note on that question are preserved.',
  inputSchema: z.object({
    id: z.string().describe('The question id'),
    label: z.string().optional().describe('New question text'),
    options: z.array(z.string()).optional().describe('New options (choice questions)'),
    defaultProposal: z.string().optional().describe('New default proposal'),
  }),
  execute: async ({ id, label, options, defaultProposal }) => {
    const doc = getActivePlan()
    if (!doc) return noPlan()
    const q = doc.questions.find(x => x.id === id)
    if (!q) return { ok: false, error: `No question with id ${id} in plan ${doc.slug}.` }
    if (label) q.label = label
    if (options?.length) { q.options = options; q.control = 'choice' }
    if (defaultProposal) q.default = defaultProposal
    q.revised = true
    savePlan(doc)
    return { ok: true, plan: doc.slug, question: q }
  },
})

export const planFromGraphTool = createTool({
  id: 'plan-from-graph',
  description:
    'Generate a plan FROM the feature graph: pass a region/feature nodeId (its subtree) or an installed packId, and the plan\'s tasks are that subgraph\'s unbuilt nodes in depends-on order, each tied to its graph node. Already-built nodes are skipped and reported; unbuilt prerequisites outside the selection are pulled in. Marking these tasks doing/done with plan-update-task writes the node statuses back (building/done) automatically. Use this instead of drafting tasks from memory whenever the work is a region or pack the graph already describes.',
  inputSchema: z.object({
    nodeId: z.string().optional().describe('A graph node id — plan its subtree (find ids with feature-query)'),
    packId: z.string().optional().describe('An installed pack id — plan building out that pack'),
  }),
  execute: async ({ nodeId, packId }) => {
    const result = planFromGraph({ nodeId, packId })
    if (result.ok === false) return { ok: false, error: result.error }
    const { plan, skippedBuilt } = result
    return {
      ok: true,
      plan: plan.slug,
      title: plan.title,
      kind: plan.kind,
      tasks: plan.tasks.map(t => ({ id: t.id, text: t.text, nodeId: t.nodeId })),
      skippedBuilt,
    }
  },
})

export const planUpdateTaskTool = createTool({
  id: 'plan-update-task',
  description:
    'Update one task\'s status in the ACTIVE plan while executing it: mark it "doing" when you start it and "done" (with a one-line detail of what was produced) when it lands. The plan overlay and the plan file reflect this live.',
  inputSchema: z.object({
    id: z.string().describe('The task id (from the plan file / execute prompt)'),
    status: z.enum(['todo', 'doing', 'done']),
    detail: z.string().optional().describe('One line: what was produced or found'),
  }),
  execute: async ({ id, status, detail }) => {
    const doc = getActivePlan()
    if (!doc) return noPlan()
    const task = doc.tasks.find(t => t.id === id)
    if (!task) return { ok: false, error: `No task with id ${id} in plan ${doc.slug}.` }
    task.status = status
    if (detail !== undefined) task.detail = detail || undefined
    if (doc.status === 'approved' && status !== 'todo') doc.status = 'executing'
    savePlan(doc)
    return { ok: true, plan: doc.slug, task, done: doc.tasks.filter(t => t.status === 'done').length, total: doc.tasks.length }
  },
})

export const planFinishTool = createTool({
  id: 'plan-finish',
  description:
    'Finish executing the ACTIVE plan: writes the review summary (what was built, anything left open) and marks the plan done. Call after the last task is done.',
  inputSchema: z.object({
    summary: z.string().describe('The review summary: what shipped, what is left, anything the user should check'),
  }),
  execute: async ({ summary }) => {
    const doc = getActivePlan()
    if (!doc) return noPlan()
    doc.review = { summary, at: Date.now() }
    doc.status = 'done'
    savePlan(doc)
    return { ok: true, plan: doc.slug }
  },
})
