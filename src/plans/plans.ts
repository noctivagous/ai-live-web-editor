/**
 * Plans (phase-11-06 §O): the planning system's store.
 *
 * A plan is a first-class document in the project, not chat
 * ephemera. Canonical state lives at `ai-plans/<slug>.json`;
 * two rendered views sit beside it, regenerated on every
 * save: `<slug>.md` (the human record) and `<slug>.xml` (an
 * XForms-style schema: a model of question definitions, an
 * instance of answers + notes — the slides are the UI layer
 * bound to both). The model/instance split is what lets the
 * agent revise the questions mid-plan without touching the
 * answers: everything is keyed by stable ids.
 */
import fs from 'node:fs'
import path from 'node:path'
import { openaiApiKey, openaiBaseUrl, openaiModelName } from '../env.js'
import { getFsRoot } from '../launcher.js'
import { getFeatureGraph, getNode, saveFeatureGraph, setNodeStatus } from '../features/features.js'

export type PlanStatus = 'draft' | 'approved' | 'executing' | 'done'
export type PlanKind = 'feature' | 'app' | 'install' | 'fix' | 'refactor'
export type PlanLevel = 1 | 2 | 3

export interface PlanQuestion {
  id: string
  label: string
  control: 'choice' | 'text'
  options?: string[]
  /** The agent's proposal — a skipped question proceeds with this. */
  default: string
  answer?: string
  note?: string
  revised?: boolean
}

export interface PlanConsideration {
  id: string
  title: string
  text: string
  note?: string
  revised?: boolean
}

export interface PlanTask {
  id: string
  text: string
  status: 'todo' | 'doing' | 'done'
  detail?: string
  /** Feature-graph node this task builds (plan ↔ graph loop):
   *  marking the task doing/done writes the node's status back. */
  nodeId?: string
}

/** Where a plan came from when it was imported rather than
 * drafted in ALE (Muse Code design §10): a Muse planner
 * document (/plan, /grill) imported explicitly, stamped at
 * import so the record never pretends ALE drafted it. */
export interface PlanProvenance {
  source: string
  sessionId?: string
  at: number
}

export interface PlanDoc {
  slug: string
  title: string
  kind: PlanKind
  level: PlanLevel
  status: PlanStatus
  goal: string
  /** Import provenance (§10); absent on ALE-drafted plans. */
  provenance?: PlanProvenance
  /** Checkable statements the finished work is judged against,
   * attached via the plan tools (§10); absent until attached. */
  criteria?: string[]
  mutability?: { goal: number; steps: number; methods: number }
  considerations: PlanConsideration[]
  questions: PlanQuestion[]
  tasks: PlanTask[]
  review?: { summary: string; at: number }
  createdAt: number
  updatedAt: number
}

export const PLAN_KINDS: PlanKind[] = ['feature', 'app', 'install', 'fix', 'refactor']

export function parsePlanKind(value: unknown): PlanKind {
  return PLAN_KINDS.includes(value as PlanKind) ? (value as PlanKind) : 'feature'
}

export function parsePlanLevel(value: unknown): PlanLevel {
  return value === 2 || value === 3 ? value : 1
}

export function slugifyPlan(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return base || 'plan'
}

function plansDir(root = getFsRoot()): string {
  return path.join(root, 'ai-plans')
}

function planPaths(slug: string, root = getFsRoot()) {
  const dir = plansDir(root)
  return {
    dir,
    json: path.join(dir, `${slug}.json`),
    md: path.join(dir, `${slug}.md`),
    xml: path.join(dir, `${slug}.xml`),
    active: path.join(dir, '.active'),
  }
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

export function createPlan(input: { title: string; kind: PlanKind; level: PlanLevel; goal: string }, root?: string): PlanDoc {
  const dir = plansDir(root)
  fs.mkdirSync(dir, { recursive: true })
  let slug = slugifyPlan(input.title)
  let n = 2
  while (fs.existsSync(planPaths(slug, root).json)) {
    slug = `${slugifyPlan(input.title)}-${n}`
    n += 1
  }
  const now = Date.now()
  const doc: PlanDoc = {
    slug,
    title: input.title,
    kind: input.kind,
    level: input.level,
    status: 'draft',
    goal: input.goal,
    considerations: [],
    questions: [],
    tasks: [],
    createdAt: now,
    updatedAt: now,
  }
  savePlan(doc, root)
  fs.writeFileSync(planPaths(slug, root).active, slug, 'utf-8')
  return doc
}

export function getPlan(slug: string, root?: string): PlanDoc | null {
  try {
    const raw = fs.readFileSync(planPaths(slug, root).json, 'utf-8')
    return JSON.parse(raw) as PlanDoc
  } catch {
    return null
  }
}

export function listPlans(root?: string): PlanDoc[] {
  const dir = plansDir(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => getPlan(f.slice(0, -'.json'.length), root))
    .filter((p): p is PlanDoc => p !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getActivePlan(root?: string): PlanDoc | null {
  try {
    const slug = fs.readFileSync(planPaths('', root).active, 'utf-8').trim()
    if (slug) return getPlan(slug, root)
  } catch { /* no active plan */ }
  return null
}

export function setActivePlan(slug: string | null, root?: string) {
  const { active } = planPaths('', root)
  if (slug) {
    fs.mkdirSync(plansDir(root), { recursive: true })
    fs.writeFileSync(active, slug, 'utf-8')
  } else if (fs.existsSync(active)) {
    fs.unlinkSync(active)
  }
}

export function savePlan(doc: PlanDoc, root?: string): PlanDoc {
  doc.updatedAt = Date.now()
  const p = planPaths(doc.slug, root)
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(p.json, JSON.stringify(doc, null, 2), 'utf-8')
  fs.writeFileSync(p.md, renderPlanMarkdown(doc), 'utf-8')
  fs.writeFileSync(p.xml, renderPlanXml(doc), 'utf-8')
  syncGraphStatuses(doc, root)
  return doc
}

/**
 * The plan ↔ graph loop's write-back, at the store so EVERY save
 * path (agent tools, the HTTP API, the overlay) syncs alike: a task
 * tied to a feature-graph node promotes that node's status —
 * doing → building, done → done. Promotions only, never demotions:
 * moving a node backwards is a decision for feature-set-status.
 * Best-effort by construction — a graph problem never breaks a
 * plan save.
 */
function syncGraphStatuses(doc: PlanDoc, root?: string): void {
  if (!doc.tasks.some(t => t.nodeId)) return
  try {
    const graph = getFeatureGraph(root)
    if (!graph) return
    let changed = false
    for (const task of doc.tasks) {
      if (!task.nodeId) continue
      const target = task.status === 'doing' ? 'building' : task.status === 'done' ? 'done' : null
      if (!target) continue
      const node = getNode(graph, task.nodeId)
      if (node && node.status !== target && setNodeStatus(graph, task.nodeId, target)) changed = true
    }
    if (changed) saveFeatureGraph(graph, root)
  } catch { /* the graph never breaks a plan save */ }
}

/** Append a task with a fresh stable id; existing tasks are untouched. */
export function addTask(doc: PlanDoc, task: Omit<PlanTask, 'id' | 'status'> & { status?: PlanTask['status'] }): PlanTask {
  const created: PlanTask = { ...task, id: nextId('t'), status: task.status ?? 'todo' }
  doc.tasks.push(created)
  return created
}

/** Append a question with a fresh stable id; existing answers are untouched. */
export function addQuestion(doc: PlanDoc, q: Omit<PlanQuestion, 'id'>): PlanQuestion {
  const question: PlanQuestion = { ...q, id: nextId('q') }
  doc.questions.push(question)
  return question
}

/** Remove a question by id; everything else in the plan is untouched. */
export function removeQuestion(doc: PlanDoc, id: string): boolean {
  const before = doc.questions.length
  doc.questions = doc.questions.filter(q => q.id !== id)
  return doc.questions.length !== before
}

/* ── Rendered views ─────────────────────────────────────────── */

export function renderPlanMarkdown(doc: PlanDoc): string {
  const lines: string[] = [
    `# Plan: ${doc.title}`,
    '',
    `Kind: ${doc.kind} · Level: ${doc.level} · Status: ${doc.status}`,
    '',
    '## Goal',
    doc.goal || '_(not stated)_',
    '',
  ]
  if (doc.mutability) {
    lines.push(`Mutability — goal ${doc.mutability.goal}/10 · steps ${doc.mutability.steps}/10 · methods ${doc.mutability.methods}/10`, '')
  }
  if (doc.considerations.length) {
    lines.push('## Considerations')
    for (const c of doc.considerations) {
      lines.push(`- **${c.title}** — ${c.text}${c.revised ? ' _(revised)_' : ''}`)
      if (c.note) lines.push(`  - Note: ${c.note}`)
    }
    lines.push('')
  }
  if (doc.questions.length) {
    lines.push('## Questions', '', '| Question | Default proposal | Answer |', '| --- | --- | --- |')
    for (const q of doc.questions) {
      const answer = q.answer ?? `_(default)_ ${q.default}`
      lines.push(`| ${q.label}${q.revised ? ' _(revised)_' : ''} | ${q.default} | ${answer} |`)
      if (q.note) lines.push(`| Note: ${q.note} | | |`)
    }
    lines.push('')
  }
  if (doc.tasks.length) {
    lines.push('## Tasks')
    for (const t of doc.tasks) {
      const box = t.status === 'done' ? '[x]' : t.status === 'doing' ? '[~]' : '[ ]'
      lines.push(`- ${box} ${t.text}${t.detail ? ` — ${t.detail}` : ''}${t.nodeId ? ` (graph node ${t.nodeId})` : ''}`)
    }
    lines.push('')
  }
  if (doc.review) {
    lines.push('## Review', doc.review.summary, '')
  }
  return lines.join('\n')
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The XForms-style schema view: the model (question
 * definitions), the instance (answers + notes), and the task
 * list. Slides in the UI bind to this; the agent edits the
 * model, the instance persists.
 */
export function renderPlanXml(doc: PlanDoc): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Plan form schema (XForms-style): model = question definitions,',
    '     instance = answers + notes, slides = the UI layer bound to both. -->',
    `<plan slug="${xmlEscape(doc.slug)}" kind="${doc.kind}" level="${doc.level}" status="${doc.status}">`,
    `  <goal>${xmlEscape(doc.goal)}</goal>`,
    '  <xf:model>',
  ]
  for (const q of doc.questions) {
    out.push(`    <question id="${q.id}" control="${q.control}" default="${xmlEscape(q.default)}"${q.revised ? ' revised="true"' : ''}>`)
    out.push(`      <label>${xmlEscape(q.label)}</label>`)
    for (const opt of q.options || []) out.push(`      <item>${xmlEscape(opt)}</item>`)
    out.push('    </question>')
  }
  out.push('  </xf:model>', '  <xf:instance>')
  for (const q of doc.questions) {
    out.push(`    <answer ref="${q.id}">${xmlEscape(q.answer ?? '')}</answer>`)
    if (q.note) out.push(`    <note ref="${q.id}">${xmlEscape(q.note)}</note>`)
  }
  for (const c of doc.considerations) {
    if (c.note) out.push(`    <note ref="${c.id}">${xmlEscape(c.note)}</note>`)
  }
  out.push('  </xf:instance>', '  <tasks>')
  for (const t of doc.tasks) {
    out.push(`    <task id="${t.id}" status="${t.status}">${xmlEscape(t.text)}</task>`)
  }
  out.push('  </tasks>', '</plan>')
  return out.join('\n')
}

/* ── Model calls (drafting + revision) ──────────────────────── */

/** One JSON-mode chat completion through the active connection; null when unavailable. */
export async function callModelJson(system: string, user: string): Promise<unknown | null> {
  const key = openaiApiKey()
  if (!key) return null
  const base = (openaiBaseUrl() || 'https://api.openai.com/v1').replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: openaiModelName(),
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return null
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

export interface DraftedContent {
  considerations: PlanConsideration[]
  questions: PlanQuestion[]
  tasks: PlanTask[]
}

/** Ask the active model to draft the plan's content for its level. Null = no model / bad reply. */
export async function draftPlanContent(doc: PlanDoc): Promise<DraftedContent | null> {
  const questionCount = doc.level === 1 ? '3-6' : doc.level === 2 ? '6-9' : '9-12'
  const parsed = await callModelJson(
    'You draft plans inside a code editor. Reply with ONE JSON object, no prose: ' +
    '{"considerations":[{"title":"...","text":"..."}],' +
    '"questions":[{"label":"...","control":"choice"|"text","options":["..."],"default":"..."}],' +
    '"tasks":["..."]}. ' +
    'Every question MUST carry a sensible "default" proposal (what happens if the user skips it). ' +
    'Questions cover the decisions a builder would otherwise guess: scope, layout, data, edge cases.',
    `Goal: ${doc.goal}\nKind: ${doc.kind}\nLevel: ${doc.level} (extensiveness)\n` +
    `Draft ${questionCount} questions and 4-8 concrete tasks in build order.` +
    (doc.level >= 2 ? ' Include 3-4 considerations (implications, risks, alternatives).' : ' Considerations may be an empty list.'),
  )
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const questions: PlanQuestion[] = []
  if (Array.isArray(raw.questions)) {
    for (const item of raw.questions) {
      const q = item as Record<string, unknown>
      if (!str(q.label)) continue
      questions.push({
        id: nextId('q'),
        label: str(q.label),
        control: q.control === 'choice' && Array.isArray(q.options) && q.options.length ? 'choice' : 'text',
        options: Array.isArray(q.options) ? q.options.map(str).filter(Boolean) : undefined,
        default: str(q.default) || 'Decide during build',
      })
    }
  }
  const considerations: PlanConsideration[] = []
  if (Array.isArray(raw.considerations)) {
    for (const item of raw.considerations) {
      const c = item as Record<string, unknown>
      if (!str(c.title) && !str(c.text)) continue
      considerations.push({ id: nextId('c'), title: str(c.title) || 'Consideration', text: str(c.text) })
    }
  }
  const tasks: PlanTask[] = []
  if (Array.isArray(raw.tasks)) {
    for (const item of raw.tasks) {
      if (str(item)) tasks.push({ id: nextId('t'), text: str(item), status: 'todo' })
    }
  }
  if (!questions.length && !tasks.length) return null
  return { considerations, questions, tasks }
}

/**
 * Revise one question or consideration in response to the
 * user's note on it. Null = no model / no note / bad reply.
 */
export async function reviseWithModel(
  doc: PlanDoc,
  target: 'question' | 'consideration',
  id: string,
): Promise<{ label?: string; text?: string; options?: string[]; default?: string } | null> {
  const note = target === 'question'
    ? doc.questions.find(q => q.id === id)?.note
    : doc.considerations.find(c => c.id === id)?.note
  if (!note?.trim()) return null
  if (target === 'question') {
    const q = doc.questions.find(x => x.id === id)
    if (!q) return null
    const parsed = await callModelJson(
      'You revise ONE planning question inside a code editor, in response to the user\'s note on it. ' +
      'Reply with ONE JSON object: {"label":"...","options":["..."],"default":"..."}. ' +
      'Keep the question\'s topic; fold the note\'s constraint or preference into the wording and the default proposal. ' +
      'If the note matches one of the options, make that option the default. Omit "options" for a text question.',
      `Plan goal: ${doc.goal}\nQuestion: ${q.label}\nControl: ${q.control}\nOptions: ${(q.options || []).join(' | ') || '(none)'}\nCurrent default: ${q.default}\nUser's note: ${note}`,
    )
    if (!parsed || typeof parsed !== 'object') return null
    const r = parsed as Record<string, unknown>
    const label = typeof r.label === 'string' && r.label ? r.label : undefined
    const def = typeof r.default === 'string' && r.default ? r.default : undefined
    const options = Array.isArray(r.options) ? r.options.filter(o => typeof o === 'string') as string[] : undefined
    if (!label && !def && !options?.length) return null
    return { label, options, default: def }
  }
  const c = doc.considerations.find(x => x.id === id)
  if (!c) return null
  const parsed = await callModelJson(
    'You revise ONE planning consideration inside a code editor, in response to the user\'s note on it. ' +
    'Reply with ONE JSON object: {"title":"...","text":"..."}. Fold the note into the consideration; keep it to one or two sentences.',
    `Plan goal: ${doc.goal}\nConsideration: ${c.title} — ${c.text}\nUser's note: ${note}`,
  )
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as Record<string, unknown>
  const text = typeof r.text === 'string' && r.text ? r.text : undefined
  const title = typeof r.title === 'string' && r.title ? r.title : undefined
  if (!text && !title) return null
  return { label: title, text }
}
