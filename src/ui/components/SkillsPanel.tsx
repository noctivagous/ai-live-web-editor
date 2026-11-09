import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, BookOpen, ChevronDown, CirclePlay, Pencil, Plus, X } from 'lucide-react'
import {
  createSkill, criterionHow, fetchSkillsState, firesWhen, runSkillChecks, toggleSkill, updateSkill,
  type CriterionResult, type SkillEntry, type SkillFieldsInput, type SkillsState,
} from '../lib/skills'
import { Markdown } from './Markdown'

/**
 * The Skills panel.
 *
 * Slice 1 — visibility: a header button (right of the MCP button,
 * via App's renderAiSelects) carrying the resident index cost,
 * and a panel that shows which skills the app carries, what each
 * costs, and when it fires. Nothing is ever dropped silently: an
 * over-budget index shows as a warning.
 *
 * Slice 2 — control: per-skill switches (off removes the skill
 * from the index, trigger matching and read-skill entirely — the
 * meter and the header chip count enabled skills only), editing
 * of every field including the briefing body, and new-skill
 * authoring. All state lives server-side (/api/skills); this
 * component keeps only view state.
 */

interface FormState {
  name: string
  description: string
  category: string
  triggersText: string
  typesText: string
  dependsOnText: string
  body: string
}

const splitList = (text: string) => text.split(',').map(s => s.trim()).filter(Boolean)

function formFromEntry(s: SkillEntry): FormState {
  return {
    name: s.name,
    description: s.description,
    category: s.category,
    triggersText: s.triggers.join(', '),
    typesText: s.types.join(', '),
    dependsOnText: s.dependsOn.join(', '),
    body: s.body,
  }
}

function emptyForm(): FormState {
  return {
    name: '', description: '', category: '', triggersText: '', typesText: '', dependsOnText: '',
    body: '# New skill\n\nSay what the agent should do differently when this skill applies — the steps, the order, and what done looks like.\n',
  }
}

function formToFields(f: FormState): SkillFieldsInput {
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    category: f.category.trim() || 'General',
    triggers: splitList(f.triggersText),
    types: splitList(f.typesText),
    dependsOn: splitList(f.dependsOnText),
    body: f.body,
  }
}

function Switch({ on, onToggle, label }: { on: boolean, onToggle: (v: boolean) => void, label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`skills-switch${on ? ' on' : ''}`}
      onClick={e => { e.stopPropagation(); onToggle(!on) }}
    >
      <span className="skills-knob" />
    </button>
  )
}

function SkillForm({ form, setForm, creating, categories, error, busy, onSave, onCancel }: {
  form: FormState
  setForm: (f: FormState) => void
  creating: boolean
  categories: string[]
  error: string
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const bodyTokens = Math.ceil(form.body.length / 4)
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch })
  return (
    <div className="skills-form">
      <div className="skills-detail-name">{creating ? 'New skill' : `Edit ${form.name}`}</div>
      {creating && (
        <>
          <label className="skills-flabel" htmlFor="sk-name">Name</label>
          <input id="sk-name" className="skills-input mono" value={form.name} onChange={e => set({ name: e.target.value })}
            placeholder="e.g. release-checks" />
          <p className="skills-note">Lowercase letters, numbers and single hyphens. The name is the folder name — it can't be changed later.</p>
        </>
      )}
      <label className="skills-flabel" htmlFor="sk-desc">Description — the line the agent scans</label>
      <textarea id="sk-desc" className="skills-input" rows={3} value={form.description} onChange={e => set({ description: e.target.value })}
        placeholder="What the skill does AND when to use it — this line alone decides whether the briefing loads." />
      <p className="skills-note">{form.description.trim().length} of 1,024 characters. Say what it does and when to use it.</p>
      <label className="skills-flabel" htmlFor="sk-cat">Category</label>
      <input id="sk-cat" className="skills-input" value={form.category} onChange={e => set({ category: e.target.value })}
        placeholder="General" list="sk-categories" />
      <datalist id="sk-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
      <label className="skills-flabel" htmlFor="sk-trig">Fires when your ask mentions (comma-separated)</label>
      <input id="sk-trig" className="skills-input" value={form.triggersText} onChange={e => set({ triggersText: e.target.value })}
        placeholder="layout, landing page, arrange" />
      <label className="skills-flabel" htmlFor="sk-dep">Or when the project uses (package names, comma-separated)</label>
      <input id="sk-dep" className="skills-input" value={form.dependsOnText} onChange={e => set({ dependsOnText: e.target.value })}
        placeholder="paper" />
      <label className="skills-flabel" htmlFor="sk-types">Or the project type is (comma-separated)</label>
      <input id="sk-types" className="skills-input" value={form.typesText} onChange={e => set({ typesText: e.target.value })}
        placeholder="canvas-tool, game" />
      <label className="skills-flabel" htmlFor="sk-body">The briefing — about {bodyTokens.toLocaleString()} tokens{bodyTokens > 5000 && <span className="skills-warn"> (over the 5,000-token guide size)</span>}</label>
      <textarea id="sk-body" className="skills-input mono" rows={12} value={form.body} onChange={e => set({ body: e.target.value })} />
      {error && <p className="skills-form-error">{error}</p>}
      <div className="skills-form-actions">
        <button type="button" className="deck-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="deck-btn skills-save" onClick={onSave} disabled={busy || !form.description.trim() || (creating && !form.name.trim())}>
          {creating ? 'Create skill' : 'Save changes'}
        </button>
      </div>
      <p className="skills-note">Saving rewrites the skill's SKILL.md file. Changes apply to the next chat turn.</p>
    </div>
  )
}

function VerdictChip({ result }: { result: CriterionResult }) {
  const text = result.verdict === 'pass' ? 'Pass' : result.verdict === 'fail' ? 'Fail' : "Couldn't check"
  return (
    <span className={`skills-verdict ${result.verdict}`}>
      {text}{result.score !== undefined ? ` · ${result.score.toFixed(2)}` : ''}
    </span>
  )
}

function runSummary(run: { results: CriterionResult[] }): string {
  const pass = run.results.filter(r => r.verdict === 'pass').length
  const fail = run.results.filter(r => r.verdict === 'fail').length
  const rest = run.results.length - pass - fail
  return `${pass} of ${run.results.length} checks pass${fail ? ` · ${fail} fail` : ''}${rest ? ` · ${rest} couldn't check` : ''}`
}

export function SkillsPanel() {
  const [state, setState] = useState<SkillsState | null>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = async () => {
    try {
      setState(await fetchSkillsState())
      setFailed(false)
    } catch { setFailed(true) }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open ])

  const apply = (next: SkillsState) => { setState(next); setFailed(false) }

  const doToggle = async (skill: SkillEntry, enabled: boolean) => {
    try { apply(await toggleSkill(skill.name, enabled)) } catch { void refresh() }
  }

  const startEdit = (skill: SkillEntry) => {
    setForm(formFromEntry(skill))
    setFormError('')
    setCreating(false)
    setEditing(true)
  }

  const startCreate = () => {
    setForm(emptyForm())
    setFormError('')
    setEditing(false)
    setCreating(true)
    setSelected(null)
  }

  const saveForm = async () => {
    setBusy(true)
    setFormError('')
    try {
      const fields = formToFields(form)
      const next = creating ? await createSkill(fields) : await updateSkill(fields)
      apply(next)
      setEditing(false)
      setCreating(false)
      setSelected(fields.name)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doRunChecks = async (skill: SkillEntry) => {
    setChecking(true)
    setCheckError('')
    try {
      apply(await runSkillChecks(skill.name))
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }

  const over = state ? state.indexTokens > state.indexBudget : false
  const sel: SkillEntry | null = state?.skills.find(s => s.name === selected) ?? null
  const enabledCount = state?.skills.filter(s => s.enabled).length ?? 0
  const categoryNames = [...new Set((state?.skills ?? []).map(s => s.category))]

  const categories: { name: string, skills: SkillEntry[] }[] = []
  for (const s of state?.skills ?? []) {
    const group = categories.find(c => c.name === s.category)
    if (group) group.skills.push(s)
    else categories.push({ name: s.category, skills: [s] })
  }

  const inForm = editing || creating

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <style>{SKILLS_CSS}</style>
      <button
        type="button"
        className={`pill mono skills-btn${over ? ' alert' : ''}`}
        onClick={() => { setOpen(o => !o); if (!open) void refresh() }}
        title={over
          ? `The skill index costs ${state?.indexTokens} tokens on every request — past the guide budget of ${state?.indexBudget}. Open to resolve.`
          : 'The skills this app carries, what they cost, and when they fire.'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BookOpen size={12} />
        Skills
        {state && <span className="skills-count">{state.indexTokens} tok</span>}
        {over && <span className="skills-badge" aria-label="Index over the guide budget"><AlertTriangle size={10} /></span>}
        <ChevronDown size={11} aria-hidden />
      </button>

      {open && (
        <div className="skills-panel" role="dialog" aria-label="Skills">
          <div className="skills-head">
            <span className="skills-title">Skills</span>
            <span className="skills-sub">
              {failed
                ? 'Could not load the skill list.'
                : state
                  ? `${state.skills.length} skills · ${enabledCount} on · the index costs ${state.indexTokens} tokens on every request`
                  : 'Loading…'}
            </span>
            <span style={{ flex: 1 }} />
            {state && !inForm && !sel && (
              <button type="button" className="deck-btn skills-new" onClick={startCreate}>
                <Plus size={12} /> New skill
              </button>
            )}
            <button type="button" className="deck-btn" onClick={() => setOpen(false)} title="Close"><X size={13} /></button>
          </div>

          {inForm ? (
            <SkillForm
              form={form} setForm={setForm} creating={creating} categories={categoryNames}
              error={formError} busy={busy}
              onSave={() => void saveForm()}
              onCancel={() => { setEditing(false); setCreating(false) }}
            />
          ) : sel ? (
            <div className="skills-detail">
              <button type="button" className="deck-btn skills-back" onClick={() => setSelected(null)}>
                <ArrowLeft size={12} /> All skills
              </button>
              <div className="skills-detail-head">
                <div className="skills-detail-name">{sel.name} <span className="skills-cat">{sel.category}</span></div>
                <span style={{ flex: 1 }} />
                <Switch on={sel.enabled} onToggle={v => void doToggle(sel, v)} label={`Turn ${sel.name} ${sel.enabled ? 'off' : 'on'}`} />
                <button type="button" className="deck-btn" onClick={() => startEdit(sel)}>
                  <Pencil size={12} /> Edit
                </button>
              </div>
              {!sel.enabled && <p className="skills-off-note">Off — not in the index, never loads, costs nothing.</p>}
              <div className="skills-label">What the agent scans</div>
              <blockquote className="skills-scan">{sel.description}</blockquote>
              <p className="skills-note">This one line is all the agent sees until the skill is picked. It has to say what the skill does and when to use it.</p>
              <div className="skills-label">Fires when</div>
              <ul className="skills-fires">
                {firesWhen(sel).map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <div className="skills-label">
                The briefing — {sel.bodyTokens.toLocaleString()} tokens, read only on a match
                {sel.overBodyBudget && <span className="skills-warn"> · over the 5,000-token guide size</span>}
              </div>
              <div className="skills-body"><Markdown text={sel.body} /></div>
              {sel.files.length > 0 && (
                <>
                  <div className="skills-label">Also carries</div>
                  <p className="skills-note">{sel.files.join(' · ')} — files bundled with the skill. Scripts among them run without their text entering the request; a verify.json declares the checks below.</p>
                </>
              )}
              {(sel.criteria.length > 0 || sel.criteriaError) && (
                <>
                  <div className="skills-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    Checks — what "done" means for this skill
                    <span style={{ flex: 1 }} />
                    <button type="button" className="deck-btn" disabled={checking} onClick={() => void doRunChecks(sel)}>
                      <CirclePlay size={12} /> {checking ? 'Checking…' : 'Run checks'}
                    </button>
                  </div>
                  <p className="skills-note">
                    Declared in the skill's verify.json. The editor's own tooling judges each one against the live project — pass, fail, or couldn't-check, with the evidence. Nothing is skipped silently. Run them any time, not only after work: the verdicts name the size and element at fault, so the same checks double as a way to investigate a reported problem.
                    {sel.lastRun && <> Last run {new Date(sel.lastRun.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: {runSummary(sel.lastRun)}.</>}
                  </p>
                  {sel.criteriaError && <p className="skills-warn">verify.json has problems: {sel.criteriaError}</p>}
                  {checkError && <p className="skills-form-error">{checkError}</p>}
                  <div className="skills-checks">
                    {sel.criteria.map(c => {
                      const result = sel.lastRun?.results.find(r => r.id === c.id)
                      return (
                        <div key={c.id} className="skills-check-row">
                          <div className="skills-check-main">
                            <span className="skills-check-say">{c.say}</span>
                            <span className="skills-check-how">{criterionHow(c)}</span>
                            {result && <span className="skills-check-evidence">{result.evidence}</span>}
                            {result?.details && result.details.length > 1 && (
                              <span className="skills-check-evidence">{result.details.join(' · ')}</span>
                            )}
                          </div>
                          {result
                            ? <VerdictChip result={result} />
                            : <span className="skills-verdict none">Not run yet</span>}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          ) : state && (
            <>
              <div className="skills-how">
                <div className="skills-step"><strong>1 · Always in mind.</strong> Every turned-on skill's name and one-line description ride in every request — about 100 tokens each.</div>
                <div className="skills-step"><strong>2 · Loaded on a match.</strong> When your request matches, the skill's full briefing joins that one request (up to {state.injectionBudget.toLocaleString()} tokens of briefings per request).</div>
                <div className="skills-step"><strong>3 · Nothing else loads.</strong> Skills that don't match cost only their one line. Skills that are off cost nothing and never load.</div>
                <p className="skills-note">A skill is a written briefing, not code: it steers the work, the tools do it. Matching is by rule — the words in your request, what the project uses, the project type — the same rules every time, shown per skill below.</p>
              </div>

              <div className="skills-budget">
                <div className="skills-budget-row">
                  <span>Index cost</span>
                  <span className="skills-budget-nums">
                    {state.indexTokens} of {state.indexBudget} tokens
                    {over ? <span className="skills-warn"> — over the guide budget; every request pays this</span> : ' — within the guide budget'}
                  </span>
                </div>
                <div className="skills-meter"><span className={over ? 'over' : ''} style={{ width: `${Math.min(100, (state.indexTokens / Math.max(1, state.indexBudget)) * 100)}%` }} /></div>
              </div>

              {categories.map(cat => (
                <div key={cat.name} className="skills-group">
                  <div className="skills-group-head">
                    <span>{cat.name}</span>
                    <span className="skills-group-n">{cat.skills.length} skill{cat.skills.length === 1 ? '' : 's'} · {cat.skills.reduce((n, s) => n + (s.enabled ? s.indexTokens : 0), 0)} tok</span>
                  </div>
                  {cat.skills.map(s => (
                    <div key={s.name} className={`skills-row${s.enabled ? '' : ' off'}`}>
                      <button type="button" className="skills-row-open" onClick={() => setSelected(s.name)}>
                        <span className="skills-row-name">{s.name}</span>
                        <span className="skills-row-desc">{s.description}</span>
                        <span className="skills-row-meta">
                          {s.enabled
                            ? <>Fires when: {firesWhen(s).join(' · ')}</>
                            : 'Off — not in the index, never loads.'}
                        </span>
                        {s.overBodyBudget && <span className="skills-warn">Body over the 5,000-token guide size</span>}
                        {s.criteria.length > 0 && (
                          <span className="skills-row-meta">
                            Carries {s.criteria.length} check{s.criteria.length === 1 ? '' : 's'}
                            {s.lastRun ? ` · last run: ${runSummary(s.lastRun)}` : ' · not run yet'}
                          </span>
                        )}
                      </button>
                      <span className="skills-row-side">
                        <span className="skills-row-cost">body {s.bodyTokens.toLocaleString()} tok<br />index {s.enabled ? s.indexTokens : 0} tok</span>
                        <Switch on={s.enabled} onToggle={v => void doToggle(s, v)} label={`Turn ${s.name} ${s.enabled ? 'off' : 'on'}`} />
                      </span>
                    </div>
                  ))}
                </div>
              ))}

              <div className="skills-foot">When a skill joins a request, the chat turn shows it — look for “Skills used” under your message.</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const SKILLS_CSS = `
.skills-btn { position:relative; display:inline-flex; align-items:center; gap:5px; cursor:pointer; }
.skills-btn.alert { border-color:var(--amber); color:var(--amber); box-shadow:0 0 0 1px var(--amber) inset; }
.skills-count { background:var(--accent-soft-bg); border-radius:8px; padding:0 6px; font-size:calc(11px * var(--ui-scale, 1)); }
.skills-btn.alert .skills-count { background:transparent; }
.skills-badge { position:absolute; top:-7px; right:-7px; width:15px; height:15px; border-radius:50%; background:var(--amber); color:#111; display:flex; align-items:center; justify-content:center; }
.skills-panel { position:fixed; top:50px; right:10px; width:min(880px, calc(100vw - 20px)); max-height:calc(100vh - 70px); overflow-y:auto; z-index:70; background:var(--panel, #f6f5f1); color:var(--text, #222); border:1px solid var(--border, #c9c6bd); border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.28); padding:14px 16px; text-align:left; }
.skills-head { display:flex; align-items:baseline; gap:10px; margin-bottom:10px; }
.skills-title { font-weight:700; font-size:calc(15px * var(--ui-scale, 1)); }
.skills-sub { color:var(--muted); font-size:calc(12px * var(--ui-scale, 1)); }
.skills-new { display:inline-flex; align-items:center; gap:4px; }
.skills-how { display:grid; gap:6px; background:var(--surface, rgba(0,0,0,.04)); border-radius:8px; padding:10px 12px; margin-bottom:12px; }
.skills-step { font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.5; }
.skills-note { color:var(--muted); font-size:calc(12px * var(--ui-scale, 1)); line-height:1.5; margin:4px 0 0; }
.skills-budget { margin-bottom:14px; }
.skills-budget-row { display:flex; justify-content:space-between; font-size:calc(12.5px * var(--ui-scale, 1)); font-weight:600; margin-bottom:5px; }
.skills-budget-nums { font-weight:400; color:var(--muted); }
.skills-meter { height:8px; border-radius:5px; background:rgba(0,0,0,.12); overflow:hidden; }
.skills-meter span { display:block; height:100%; background:var(--accent, #2f5aa6); border-radius:5px; }
.skills-meter span.over { background:var(--amber); }
.skills-warn { color:var(--amber); font-weight:600; }
.skills-group { margin-bottom:14px; }
.skills-group-head { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; font-size:calc(13px * var(--ui-scale, 1)); border-bottom:1px solid var(--border, #c9c6bd); padding-bottom:4px; margin-bottom:6px; }
.skills-group-n { font-weight:400; color:var(--muted); font-size:calc(11.5px * var(--ui-scale, 1)); }
.skills-row { display:flex; gap:12px; border:1px solid transparent; border-radius:8px; padding:8px 10px; align-items:flex-start; }
.skills-row:hover { background:var(--surface, rgba(0,0,0,.04)); border-color:var(--border, #c9c6bd); }
.skills-row.off .skills-row-open { opacity:.55; }
.skills-row-open { flex:1; display:grid; gap:2px; min-width:0; text-align:left; background:transparent; border:none; padding:0; cursor:pointer; color:inherit; font:inherit; }
.skills-row-side { display:flex; align-items:flex-start; gap:10px; }
.skills-row-name { font-weight:700; font-size:calc(13px * var(--ui-scale, 1)); }
.skills-row-desc { color:var(--muted); font-size:calc(12px * var(--ui-scale, 1)); line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.skills-row-meta { font-size:calc(11.5px * var(--ui-scale, 1)); color:var(--muted); }
.skills-row-cost { font-size:calc(11.5px * var(--ui-scale, 1)); color:var(--muted); text-align:right; white-space:nowrap; line-height:1.5; }
.skills-switch { width:32px; height:18px; border-radius:10px; border:1px solid var(--border-strong, #9a968c); background:transparent; position:relative; cursor:pointer; flex:none; padding:0; margin-top:2px; }
.skills-switch .skills-knob { position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:var(--border-strong, #9a968c); transition:left .15s ease, background .15s ease; }
.skills-switch.on { background:var(--accent, #2f5aa6); border-color:var(--accent, #2f5aa6); }
.skills-switch.on .skills-knob { left:16px; background:#fff; }
.skills-foot { color:var(--muted); font-size:calc(12px * var(--ui-scale, 1)); border-top:1px solid var(--border, #c9c6bd); padding-top:8px; }
.skills-back { display:inline-flex; align-items:center; gap:5px; margin-bottom:10px; }
.skills-detail-head { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
.skills-detail-name { font-weight:700; font-size:calc(15px * var(--ui-scale, 1)); }
.skills-cat { color:var(--muted); font-weight:400; font-size:calc(12px * var(--ui-scale, 1)); }
.skills-off-note { color:var(--amber); font-weight:600; font-size:calc(12.5px * var(--ui-scale, 1)); margin:4px 0 0; }
.skills-label { font-weight:700; font-size:calc(12.5px * var(--ui-scale, 1)); margin:12px 0 4px; }
.skills-scan { margin:0; padding:8px 12px; border-left:3px solid var(--accent, #2f5aa6); background:var(--surface, rgba(0,0,0,.04)); border-radius:0 8px 8px 0; font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.55; }
.skills-fires { margin:0; padding-left:18px; font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.6; }
.skills-body { background:var(--surface, rgba(0,0,0,.04)); border-radius:8px; padding:10px 14px; font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.55; max-height:340px; overflow-y:auto; }
.skills-form { display:grid; gap:5px; }
.skills-flabel { font-weight:700; font-size:calc(12.5px * var(--ui-scale, 1)); margin-top:9px; }
.skills-input { width:100%; box-sizing:border-box; background:var(--bg, #fff); color:inherit; border:1px solid var(--border, #c9c6bd); border-radius:7px; padding:7px 9px; font:inherit; font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.5; }
.skills-input.mono { font-family:ui-monospace, monospace; font-size:calc(12px * var(--ui-scale, 1)); }
.skills-form-error { color:var(--amber); font-weight:600; font-size:calc(12.5px * var(--ui-scale, 1)); margin:6px 0 0; }
.skills-checks { display:grid; gap:6px; margin-top:6px; }
.skills-check-row { display:flex; gap:10px; align-items:flex-start; border:1px solid var(--border, #c9c6bd); border-radius:8px; padding:8px 10px; background:var(--surface, rgba(0,0,0,.03)); }
.skills-check-main { flex:1; display:grid; gap:2px; min-width:0; }
.skills-check-say { font-weight:600; font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.45; }
.skills-check-how { color:var(--muted); font-size:calc(11.5px * var(--ui-scale, 1)); }
.skills-check-evidence { font-size:calc(11.5px * var(--ui-scale, 1)); line-height:1.5; }
.skills-verdict { flex:none; font-weight:700; font-size:calc(11px * var(--ui-scale, 1)); border-radius:8px; padding:2px 8px; border:1px solid var(--border-strong, #9a968c); }
.skills-verdict.pass { background:#2e7d32; border-color:#2e7d32; color:#fff; }
.skills-verdict.fail { background:#b3261e; border-color:#b3261e; color:#fff; }
.skills-verdict.couldnt-check { background:var(--amber); border-color:var(--amber); color:#111; }
.skills-verdict.none { color:var(--muted); font-weight:400; }
.skills-form-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
.skills-save { font-weight:700; }
`
