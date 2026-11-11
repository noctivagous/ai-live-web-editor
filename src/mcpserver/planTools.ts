/**
 * Plan tools for the ALE MCP server (Muse Code design §10,
 * slice 7).
 *
 * ALE's plans store is the source of truth — it renders in the
 * Plan overlay and survives engine switches — so these tools
 * are a thin, honest surface over src/plans/plans.ts: create,
 * read, list, update step state, attach criteria, mark ready.
 *
 * Muse's own planner is an INPUT, never a sync: /plan and
 * /grill produce documents in the project, and ale_plan_import
 * turns one into an ALE plan EXPLICITLY (an agent or user
 * invokes it), stamping provenance on the imported doc —
 * source + session id + time. Nothing watches the project for
 * plan documents, and nothing mirrors edits in either
 * direction.
 */
import {
  addQuestion, addTask, createPlan, getActivePlan, getPlan, listPlans, parsePlanKind, parsePlanLevel,
  savePlan, type PlanDoc, type PlanTask,
} from '../plans/plans.js'
import { obj, str, type AleToolDef } from './tools.js'

type Input = Record<string, any>

function summary(doc: PlanDoc): Record<string, unknown> {
  return {
    slug: doc.slug, title: doc.title, kind: doc.kind, level: doc.level,
    status: doc.status, goal: doc.goal,
    tasks: doc.tasks.length,
    tasksDone: doc.tasks.filter((t) => t.status === 'done').length,
    questions: doc.questions.length,
    ...(doc.criteria?.length ? { criteria: doc.criteria } : {}),
    ...(doc.provenance ? { provenance: doc.provenance } : {}),
    updatedAt: doc.updatedAt,
  }
}

function full(doc: PlanDoc): Record<string, unknown> {
  return { ...doc }
}

function loadPlan(input: Input): PlanDoc | { error: string } {
  const slug = typeof input.slug === 'string' && input.slug ? input.slug : null
  const doc = slug ? getPlan(slug) : getActivePlan()
  if (!doc) return { error: slug ? `No plan with slug "${slug}".` : 'No active plan in this project. Create one with ale_plan_create.' }
  return doc
}

async function planCreate(input: Input): Promise<unknown> {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : ''
  if (!goal) return { ok: false, error: 'Pass goal: what this plan is for.' }
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : goal.slice(0, 60)
  const doc = createPlan({
    title,
    kind: parsePlanKind(input.kind),
    level: parsePlanLevel(input.level),
    goal,
  })
  const steps = Array.isArray(input.steps) ? input.steps.filter((s: unknown) => typeof s === 'string' && s.trim()) : []
  for (const text of steps) addTask(doc, { text: (text as string).trim() })
  if (steps.length) savePlan(doc)
  return { ok: true, plan: summary(doc) }
}

async function planRead(input: Input): Promise<unknown> {
  const doc = loadPlan(input)
  if ('error' in doc) return { ok: false, error: doc.error }
  return { ok: true, plan: full(doc) }
}

async function planList(): Promise<unknown> {
  const plans = listPlans()
  const active = getActivePlan()
  return { ok: true, plans: plans.map(summary), active: active?.slug ?? null }
}

async function planUpdateStep(input: Input): Promise<unknown> {
  const doc = loadPlan(input)
  if ('error' in doc) return { ok: false, error: doc.error }
  const taskId = typeof input.taskId === 'string' ? input.taskId : ''
  const task = doc.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `No task with id "${taskId}" in plan ${doc.slug}. Read the plan for its task ids.` }
  if (input.status !== undefined) {
    if (input.status !== 'todo' && input.status !== 'doing' && input.status !== 'done') {
      return { ok: false, error: 'status must be one of: todo, doing, done.' }
    }
    task.status = input.status as PlanTask['status']
  }
  if (typeof input.text === 'string' && input.text.trim()) task.text = input.text.trim()
  if (typeof input.detail === 'string') task.detail = input.detail
  savePlan(doc)
  return { ok: true, plan: summary(doc), task }
}

async function planAttachCriteria(input: Input): Promise<unknown> {
  const doc = loadPlan(input)
  if ('error' in doc) return { ok: false, error: doc.error }
  const criteria = Array.isArray(input.criteria)
    ? input.criteria.filter((c: unknown) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())
    : []
  if (!criteria.length) return { ok: false, error: 'Pass criteria: a non-empty array of checkable statements.' }
  doc.criteria = [...(doc.criteria ?? []), ...criteria]
  savePlan(doc)
  return { ok: true, plan: summary(doc) }
}

async function planReady(input: Input): Promise<unknown> {
  const doc = loadPlan(input)
  if ('error' in doc) return { ok: false, error: doc.error }
  if (doc.status === 'draft') {
    doc.status = 'approved'
    savePlan(doc)
  }
  return { ok: true, plan: summary(doc), note: doc.status === 'approved' ? 'Plan is approved (ready for execution).' : `Plan is already ${doc.status}; ready applies to drafts.` }
}

const IMPORT_SOURCES = ['muse-plan', 'muse-grill'] as const

/**
 * The explicit import (§10): a Muse planner document's
 * content, carried in the call, becomes an ALE plan — steps
 * become tasks, settled questions become plan questions,
 * "done when" lines become criteria — stamped with provenance.
 * The import is a snapshot, not a link: later edits to the
 * Muse document do not flow here, and edits here never flow
 * back.
 */
async function planImport(input: Input): Promise<unknown> {
  const source = typeof input.source === 'string' ? input.source : ''
  if (!(IMPORT_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, error: `Pass source as one of: ${IMPORT_SOURCES.join(', ')} — the import stamps where the plan came from.` }
  }
  const goal = typeof input.goal === 'string' ? input.goal.trim() : ''
  if (!goal) return { ok: false, error: 'Pass goal: the imported plan’s goal, from the source document.' }
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : goal.slice(0, 60)
  const doc = createPlan({
    title,
    kind: parsePlanKind(input.kind),
    level: parsePlanLevel(input.level),
    goal,
  })
  doc.provenance = {
    source,
    ...(typeof input.sessionId === 'string' && input.sessionId ? { sessionId: input.sessionId } : {}),
    at: Date.now(),
  }
  const steps = Array.isArray(input.steps) ? input.steps.filter((s: unknown) => typeof s === 'string' && s.trim()) : []
  for (const text of steps) addTask(doc, { text: (text as string).trim() })
  const questions = Array.isArray(input.questions) ? input.questions.filter((q: unknown) => typeof q === 'string' && q.trim()) : []
  for (const label of questions) {
    addQuestion(doc, { label: (label as string).trim(), control: 'text', default: '' })
  }
  const criteria = Array.isArray(input.criteria)
    ? input.criteria.filter((c: unknown) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())
    : []
  if (criteria.length) doc.criteria = criteria
  savePlan(doc)
  return { ok: true, plan: summary(doc), imported: { source, steps: steps.length, questions: questions.length, criteria: criteria.length } }
}

export const ALE_PLAN_TOOLS: AleToolDef[] = [
  {
    name: 'ale_plan_create',
    description: 'Create a plan in ALE’s plans store (the source of truth — it renders in the Plan overlay and survives engine switches). Pass the goal; title defaults to the goal’s first words. kind: feature | app | install | fix | refactor. level 1 (quick), 2 (structured) or 3 (deep). steps, if given, become the plan’s tasks in order.',
    inputSchema: obj({
      goal: str('What this plan is for'),
      title: str('Plan title; default: the goal’s first words'),
      kind: { type: 'string', enum: ['feature', 'app', 'install', 'fix', 'refactor'] },
      level: { type: 'number', enum: [1, 2, 3] },
      steps: { type: 'array', items: { type: 'string' }, description: 'Step texts, in order' },
    }, ['goal']),
    run: planCreate,
  },
  {
    name: 'ale_plan_read',
    description: 'Read a plan in full (tasks, questions, considerations, criteria, provenance). With no slug, reads the active plan.',
    inputSchema: obj({ slug: str('Plan slug; omit for the active plan') }),
    run: planRead,
  },
  {
    name: 'ale_plan_list',
    description: 'List the project’s plans with their status and progress, and which one is active.',
    inputSchema: obj({}),
    run: () => planList(),
  },
  {
    name: 'ale_plan_update_step',
    description: 'Update one step of a plan: its state (todo | doing | done), text, or detail. Marking a step that is tied to a feature-graph node also promotes the node (doing → building, done → done) — the store does that itself.',
    inputSchema: obj({
      slug: str('Plan slug; omit for the active plan'),
      taskId: str('The task id (from ale_plan_read)'),
      status: { type: 'string', enum: ['todo', 'doing', 'done'] },
      text: str('Replacement step text'),
      detail: str('Step detail'),
    }, ['taskId']),
    run: planUpdateStep,
  },
  {
    name: 'ale_plan_attach_criteria',
    description: 'Attach checkable criteria to a plan — the statements the finished work will be judged against (e.g. "the gate reports no layout findings at 390px"). Appends to any criteria already attached.',
    inputSchema: obj({
      slug: str('Plan slug; omit for the active plan'),
      criteria: { type: 'array', items: { type: 'string' }, description: 'Checkable statements' },
    }, ['criteria']),
    run: planAttachCriteria,
  },
  {
    name: 'ale_plan_ready',
    description: 'Mark a draft plan ready for execution (status draft → approved). Execution itself happens through the Plan overlay / ordinary turns, on whichever engine is active.',
    inputSchema: obj({ slug: str('Plan slug; omit for the active plan') }),
    run: planReady,
  },
  {
    name: 'ale_plan_import',
    description: 'Import a Muse planner document into ALE’s plans store — EXPLICITLY, as a snapshot. Use after /plan or /grill settles a design: pass its goal, steps, settled questions and "done when" criteria. The imported plan is stamped with provenance (source muse-plan or muse-grill, your session id). Import never happens silently and never syncs afterwards; ALE’s store is the truth from this point.',
    inputSchema: obj({
      source: { type: 'string', enum: [...IMPORT_SOURCES], description: 'Where the plan document came from' },
      goal: str('The plan’s goal, from the source document'),
      title: str('Plan title; default: the goal’s first words'),
      kind: { type: 'string', enum: ['feature', 'app', 'install', 'fix', 'refactor'] },
      level: { type: 'number', enum: [1, 2, 3] },
      steps: { type: 'array', items: { type: 'string' }, description: 'Step texts, in order' },
      questions: { type: 'array', items: { type: 'string' }, description: 'Settled/open questions from the document' },
      criteria: { type: 'array', items: { type: 'string' }, description: '"Done when" statements from the document' },
      sessionId: str('Your Muse Code session id, recorded as provenance'),
    }, ['source', 'goal']),
    run: planImport,
  },
]
