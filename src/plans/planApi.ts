/**
 * Plans API (phase-11-06 §O): the overlay's server half.
 * Mounted on both servers like the other project APIs.
 */
import type { Express } from 'express'
import {
  addQuestion, createPlan, draftPlanContent, getActivePlan, getPlan, listPlans,
  parsePlanKind, parsePlanLevel, removeQuestion, reviseWithModel, savePlan,
  setActivePlan, type PlanDoc,
} from './plans.js'
import { planFromGraph } from './planFromGraph.js'

function summary(doc: PlanDoc) {
  return {
    slug: doc.slug, title: doc.title, kind: doc.kind, level: doc.level,
    status: doc.status, updatedAt: doc.updatedAt,
    questions: doc.questions.length,
    tasks: doc.tasks.length,
    tasksDone: doc.tasks.filter(t => t.status === 'done').length,
  }
}

export function planSnapshotField(): { slug: string; title: string; status: string; level: number } | null {
  const active = getActivePlan()
  return active ? { slug: active.slug, title: active.title, status: active.status, level: active.level } : null
}

export function mountPlanApi(app: Express) {
  app.get('/api/plans', (_req, res) => {
    const active = getActivePlan()
    res.json({ ok: true, plans: listPlans().map(summary), active: active?.slug ?? null })
  })

  app.post('/api/plans', (req, res) => {
    const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim() : ''
    const title = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : goal.slice(0, 60) || 'Untitled plan'
    if (!goal) return res.status(400).json({ ok: false, error: 'goal required' })
    const doc = createPlan({
      title,
      goal,
      kind: parsePlanKind(req.body?.kind),
      level: parsePlanLevel(req.body?.level),
    })
    return res.json({ ok: true, plan: doc })
  })

  // Registered before /api/plans/:slug so "from-graph" is not a slug.
  app.post('/api/plans/from-graph', (req, res) => {
    const nodeId = typeof req.body?.nodeId === 'string' ? req.body.nodeId : undefined
    const packId = typeof req.body?.packId === 'string' ? req.body.packId : undefined
    const result = planFromGraph({ nodeId, packId })
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error })
    return res.json({ ok: true, plan: result.plan, skippedBuilt: result.skippedBuilt })
  })

  app.get('/api/plans/:slug', (req, res) => {
    const doc = getPlan(req.params.slug)
    if (!doc) return res.status(404).json({ ok: false, error: 'plan not found' })
    return res.json({ ok: true, plan: doc })
  })

  app.post('/api/plans/:slug/activate', (req, res) => {
    const doc = getPlan(req.params.slug)
    if (!doc) return res.status(404).json({ ok: false, error: 'plan not found' })
    setActivePlan(doc.slug)
    return res.json({ ok: true, plan: doc })
  })

  // Draft questions/tasks/considerations with the active model.
  app.post('/api/plans/:slug/draft', async (req, res) => {
    const doc = getPlan(req.params.slug)
    if (!doc) return res.status(404).json({ ok: false, error: 'plan not found' })
    const drafted = await draftPlanContent(doc)
    if (!drafted) {
      return res.status(422).json({
        ok: false,
        error: 'Drafting needs a working model connection (the reply was empty or unusable). You can add questions and tasks by hand instead.',
      })
    }
    doc.considerations = drafted.considerations
    doc.questions = drafted.questions
    doc.tasks = drafted.tasks
    savePlan(doc)
    return res.json({ ok: true, plan: doc })
  })

  // Structured patch: answers, notes, tasks, status, header fields.
  app.post('/api/plans/:slug', (req, res) => {
    const doc = getPlan(req.params.slug)
    if (!doc) return res.status(404).json({ ok: false, error: 'plan not found' })
    const body = (req.body || {}) as Record<string, unknown>

    if (typeof body.title === 'string' && body.title.trim()) doc.title = body.title.trim()
    if (typeof body.goal === 'string') doc.goal = body.goal
    if (body.level !== undefined) doc.level = parsePlanLevel(body.level)
    if (body.kind !== undefined) doc.kind = parsePlanKind(body.kind)
    if (body.mutability && typeof body.mutability === 'object') {
      const m = body.mutability as Record<string, unknown>
      const clamp = (v: unknown) => Math.min(10, Math.max(0, typeof v === 'number' ? Math.round(v) : 0))
      doc.mutability = { goal: clamp(m.goal), steps: clamp(m.steps), methods: clamp(m.methods) }
    }

    if (body.answers && typeof body.answers === 'object') {
      for (const [id, value] of Object.entries(body.answers as Record<string, unknown>)) {
        const q = doc.questions.find(x => x.id === id)
        if (q && typeof value === 'string') q.answer = value || undefined
      }
    }
    if (body.notes && typeof body.notes === 'object') {
      for (const [id, value] of Object.entries(body.notes as Record<string, unknown>)) {
        if (typeof value !== 'string') continue
        const q = doc.questions.find(x => x.id === id)
        if (q) { q.note = value || undefined; continue }
        const c = doc.considerations.find(x => x.id === id)
        if (c) c.note = value || undefined
      }
    }
    if (Array.isArray(body.questions)) {
      // Full question-list replacement from the overlay editor (ids preserved).
      const byId = new Map(doc.questions.map(q => [q.id, q]))
      doc.questions = body.questions.flatMap((item) => {
        const q = item as Record<string, unknown>
        if (typeof q?.label !== 'string' || !q.label) return []
        const prev = typeof q.id === 'string' ? byId.get(q.id) : undefined
        return [{
          id: prev?.id ?? `q${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
          label: q.label,
          control: q.control === 'choice' ? 'choice' as const : 'text' as const,
          options: Array.isArray(q.options) ? q.options.filter(o => typeof o === 'string') as string[] : undefined,
          default: typeof q.default === 'string' ? q.default : '',
          answer: prev?.answer,
          note: prev?.note,
          revised: prev?.revised,
        }]
      })
    }
    if (Array.isArray(body.tasks)) {
      const byId = new Map(doc.tasks.map(t => [t.id, t]))
      doc.tasks = body.tasks.flatMap((item) => {
        const t = item as Record<string, unknown>
        if (typeof t?.text !== 'string' || !t.text) return []
        const prev = typeof t.id === 'string' ? byId.get(t.id) : undefined
        return [{
          id: prev?.id ?? `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
          text: t.text,
          status: prev?.status ?? 'todo' as const,
          detail: prev?.detail,
        }]
      })
    }
    if (body.taskStatus && typeof body.taskStatus === 'object') {
      const ts = body.taskStatus as Record<string, unknown>
      const task = doc.tasks.find(t => t.id === ts.id)
      if (task) {
        if (ts.status === 'todo' || ts.status === 'doing' || ts.status === 'done') task.status = ts.status
        if (typeof ts.detail === 'string') task.detail = ts.detail || undefined
      }
    }

    if (typeof body.status === 'string') {
      const next = body.status
      const allowed: Record<string, string[]> = {
        draft: ['approved', 'draft'],
        approved: ['executing', 'draft'],
        executing: ['done', 'approved'],
        done: ['draft'],
      }
      if (next === 'review' && typeof body.reviewSummary === 'string') {
        // not a status; handled below
      } else if ((allowed[doc.status] || []).includes(next)) {
        doc.status = next as PlanDoc['status']
        if (next === 'done' && getActivePlan()?.slug === doc.slug) setActivePlan(null)
      } else if (next !== doc.status) {
        return res.status(400).json({ ok: false, error: `cannot move a ${doc.status} plan to ${next}` })
      }
    }
    if (typeof body.reviewSummary === 'string') {
      doc.review = { summary: body.reviewSummary, at: Date.now() }
    }

    savePlan(doc)
    return res.json({ ok: true, plan: doc })
  })

  // Add/remove a single question — the chat-driven update path (§O).
  app.post('/api/plans/:slug/questions', (req, res) => {
    const doc = getPlan(req.params.slug)
    if (!doc) return res.status(404).json({ ok: false, error: 'plan not found' })
    const body = (req.body || {}) as Record<string, unknown>
    if (body.action === 'add') {
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if (!label) return res.status(400).json({ ok: false, error: 'label required' })
      const q = addQuestion(doc, {
        label,
        control: body.control === 'choice' ? 'choice' : 'text',
        options: Array.isArray(body.options) ? body.options.filter(o => typeof o === 'string') as string[] : undefined,
        default: typeof body.default === 'string' && body.default ? body.default : 'Decide during build',
      })
      savePlan(doc)
      return res.json({ ok: true, plan: doc, question: q })
    }
    if (body.action === 'remove') {
      if (!removeQuestion(doc, String(body.id || ''))) {
        return res.status(404).json({ ok: false, error: 'question not found' })
      }
      savePlan(doc)
      return res.json({ ok: true, plan: doc })
    }
    return res.status(400).json({ ok: false, error: 'action must be add or remove' })
  })

  // Revise one item from its note, via the active model.
  app.post('/api/plans/:slug/revise', async (req, res) => {
    const doc = getPlan(req.params.slug)
    if (!doc) return res.status(404).json({ ok: false, error: 'plan not found' })
    const target = req.body?.target === 'consideration' ? 'consideration' : 'question'
    const id = String(req.body?.id || '')
    const note = target === 'question'
      ? doc.questions.find(q => q.id === id)?.note
      : doc.considerations.find(c => c.id === id)?.note
    if (!note?.trim()) return res.status(400).json({ ok: false, error: 'add a note first — the revision responds to it' })
    const revised = await reviseWithModel(doc, target, id)
    if (!revised) {
      return res.status(422).json({ ok: false, error: 'Revision needs a working model connection (the reply was empty or unusable).' })
    }
    if (target === 'question') {
      const q = doc.questions.find(x => x.id === id)
      if (!q) return res.status(404).json({ ok: false, error: 'question not found' })
      if (revised.label) q.label = revised.label
      if (revised.options?.length) { q.options = revised.options; q.control = 'choice' }
      if (revised.default) q.default = revised.default
      q.revised = true
    } else {
      const c = doc.considerations.find(x => x.id === id)
      if (!c) return res.status(404).json({ ok: false, error: 'consideration not found' })
      if (revised.label) c.title = revised.label
      if (revised.text) c.text = revised.text
      c.revised = true
    }
    savePlan(doc)
    return res.json({ ok: true, plan: doc })
  })
}
