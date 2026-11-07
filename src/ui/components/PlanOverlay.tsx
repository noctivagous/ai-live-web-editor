import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, X } from 'lucide-react'
import {
  activatePlan, createPlan, draftPlan, getPlan, getPlans, patchPlan,
  revisePlanItem, type PlanDoc,
} from '../lib/api'

/**
 * The /plan overlay (§O): floats over the file manager + middle
 * section of the shell (chat stays live on the right) and walks
 * Goal → Considerations → Questions → Plan → Execute → Review
 * as slides. Level 1 is the lightest pass; 2 adds considerations
 * and a fuller question round; 3 adds mutability settings.
 * The plan itself is a document in the project (ai-plans/).
 */

const KINDS = [
  { id: 'feature', label: 'Feature' },
  { id: 'app', label: 'New app' },
  { id: 'install', label: 'Install' },
  { id: 'fix', label: 'Fix' },
  { id: 'refactor', label: 'Refactor' },
] as const

const STATUS_LABEL: Record<PlanDoc['status'], string> = {
  draft: 'Draft', approved: 'Approved', executing: 'Executing', done: 'Done',
}

export function PlanOverlay({ initialLevel, initialGoal, onClose, onOpenPath, style }: {
  initialLevel?: number
  initialGoal?: string
  onClose: () => void
  onOpenPath?: (path: string) => void
  style?: React.CSSProperties
}) {
  const [plan, setPlan] = useState<PlanDoc | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [slide, setSlide] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  // New-plan form (before a plan exists)
  const [goal, setGoal] = useState(initialGoal || '')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<string>('feature')
  const [level, setLevel] = useState<number>(initialLevel === 2 || initialLevel === 3 ? initialLevel : 1)
  const [newQuestion, setNewQuestion] = useState('')
  const [newTask, setNewTask] = useState('')
  const pollRef = useRef<number | null>(null)

  const apply = useCallback((r: { ok: boolean, plan?: PlanDoc, error?: string }) => {
    if (r.ok && r.plan) { setPlan(r.plan); setError(''); return r.plan }
    setError(r.error || 'Something went wrong.')
    return null
  }, [])

  // Open on the active plan if there is one.
  useEffect(() => {
    void (async () => {
      const list = await getPlans().catch(() => null)
      if (list?.active) {
        const r = await getPlan(list.active).catch(() => null)
        if (r?.ok && r.plan) {
          setPlan(r.plan)
          setLevel(r.plan.level)
          setSlide(r.plan.status === 'done' ? 5 : r.plan.status === 'executing' ? 4 : r.plan.status === 'approved' ? 3 : 1)
        }
      }
      setLoaded(true)
    })()
  }, [])

  // While executing, poll so task check-offs land live.
  useEffect(() => {
    if (plan?.status !== 'executing' && plan?.status !== 'approved') return
    pollRef.current = window.setInterval(() => {
      void getPlan(plan.slug).then(r => { if (r.ok && r.plan) setPlan(r.plan) }).catch(() => {})
    }, 1500)
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [plan?.status, plan?.slug])

  const effLevel = plan?.level ?? level
  const steps: string[] = ['Goal']
  if (effLevel >= 2) steps.push('Considerations')
  steps.push('Questions', 'Plan', 'Execute', 'Review')
  const slideName = steps[Math.min(slide, steps.length - 1)]
  const gotoName = (name: string) => setSlide(steps.indexOf(name))

  async function create() {
    if (!goal.trim() || busy) return
    setBusy('create')
    const r = await createPlan({ goal: goal.trim(), kind, level, title: title.trim() || undefined }).catch(() => ({ ok: false, error: 'Could not create the plan.' }))
    setBusy('')
    const doc = apply(r as { ok: boolean, plan?: PlanDoc, error?: string })
    if (doc) gotoName('Questions')
  }

  async function draft() {
    if (!plan || busy) return
    setBusy('draft')
    const r = await draftPlan(plan.slug).catch(() => ({ ok: false, error: 'Drafting failed.' }))
    setBusy('')
    apply(r as { ok: boolean, plan?: PlanDoc, error?: string })
  }

  async function patch(p: Record<string, unknown>) {
    if (!plan) return
    const r = await patchPlan(plan.slug, p).catch(() => ({ ok: false, error: 'Save failed.' }))
    apply(r as { ok: boolean, plan?: PlanDoc, error?: string })
  }

  async function revise(target: 'question' | 'consideration', id: string) {
    if (!plan || busy) return
    setBusy(`revise-${id}`)
    const r = await revisePlanItem(plan.slug, target, id).catch(() => ({ ok: false, error: 'Revision failed.' }))
    setBusy('')
    apply(r as { ok: boolean, plan?: PlanDoc, error?: string })
  }

  async function addQuestion() {
    if (!plan || !newQuestion.trim()) return
    const r = await fetch(`/api/plans/${encodeURIComponent(plan.slug)}/questions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', label: newQuestion.trim() }),
    }).then(x => x.json()).catch(() => ({ ok: false, error: 'Could not add the question.' }))
    if ((r as { ok: boolean }).ok) { setNewQuestion(''); apply(r as { ok: boolean, plan?: PlanDoc }) }
    else setError((r as { error?: string }).error || 'Could not add the question.')
  }

  async function removeQuestion(id: string) {
    if (!plan) return
    const r = await fetch(`/api/plans/${encodeURIComponent(plan.slug)}/questions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id }),
    }).then(x => x.json()).catch(() => ({ ok: false }))
    if ((r as { ok: boolean }).ok) apply(r as { ok: boolean, plan?: PlanDoc })
  }

  function execute() {
    if (!plan) return
    void patch({ status: 'approved' }).then(() => {
      window.dispatchEvent(new CustomEvent('ai-live:plan-execute', { detail: { slug: plan.slug, title: plan.title } }))
      gotoName('Execute')
    })
  }

  const doneCount = plan?.tasks.filter(t => t.status === 'done').length ?? 0

  return (
    <div className="plan-overlay" role="dialog" aria-label="Plan" style={style}>
      <style>{PLAN_CSS}</style>
      <div className="plan-head">
        {plan
          ? <input className="plan-title" value={plan.title} onChange={e => setPlan({ ...plan, title: e.target.value })}
              onBlur={e => void patch({ title: e.target.value })} aria-label="Plan title" />
          : <span className="plan-title-static">New plan</span>}
        <select className="deck-select" value={plan?.kind ?? kind} disabled={!plan && false}
          onChange={e => { if (plan) void patch({ kind: e.target.value }); else setKind(e.target.value) }} aria-label="Plan kind">
          {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <div className="plan-levels" role="group" aria-label="Planning level">
          {[1, 2, 3].map(n => (
            <button key={n} type="button" className={effLevel === n ? 'on' : ''}
              onClick={() => { if (plan) void patch({ level: n }); else setLevel(n) }}>{n}</button>
          ))}
        </div>
        {plan && <span className={`plan-status st-${plan.status}`}>{STATUS_LABEL[plan.status]}</span>}
        {plan && onOpenPath && (
          <button type="button" className="deck-btn" onClick={() => onOpenPath(`/ai-plans/${plan.slug}.md`)} title="Open the plan file">
            <FileText size={13} /> File
          </button>
        )}
        <button type="button" className="deck-btn plan-x" onClick={onClose} aria-label="Close planner"><X size={14} /></button>
      </div>

      <div className="plan-steps">
        {steps.map((s, i) => (
          <button key={s} type="button" className={`plan-step${i === Math.min(slide, steps.length - 1) ? ' on' : ''}`} onClick={() => setSlide(i)}>{s}</button>
        ))}
      </div>

      {error && <div className="plan-error">{error}</div>}

      <div className="plan-body">
        {!loaded && <p className="plan-dim">Loading…</p>}

        {loaded && slideName === 'Goal' && (
          <div className="plan-slide">
            {!plan && (
              <>
                <label className="plan-lab">Title <span className="plan-dim">(optional — taken from the goal)</span></label>
                <input className="plan-in" value={title} onChange={e => setTitle(e.target.value)} placeholder="Add sharing to notes" />
              </>
            )}
            <label className="plan-lab">What are we building?</label>
            <textarea className="plan-in plan-goal" rows={4} value={plan?.goal ?? goal}
              onChange={e => { if (plan) setPlan({ ...plan, goal: e.target.value }); else setGoal(e.target.value) }}
              onBlur={e => { if (plan) void patch({ goal: e.target.value }) }}
              placeholder="Share a note with a link…" />
            {effLevel === 3 && plan && (
              <div className="plan-mut">
                <p className="plan-dim">Mutability — how much may the agent change each part while executing? 0 = locked, 10 = free.</p>
                {(['goal', 'steps', 'methods'] as const).map(k => (
                  <label key={k} className="plan-mutrow">
                    <span>{k === 'goal' ? 'Goal' : k === 'steps' ? 'Main steps' : 'Materials & methods'}</span>
                    <input type="range" min={0} max={10} value={plan.mutability?.[k] ?? (k === 'goal' ? 2 : 5)}
                      onChange={e => {
                        const m = { goal: 2, steps: 5, methods: 5, ...(plan.mutability || {}), [k]: Number(e.target.value) }
                        setPlan({ ...plan, mutability: m })
                      }}
                      onMouseUp={() => void patch({ mutability: plan.mutability })}
                      onTouchEnd={() => void patch({ mutability: plan.mutability })} />
                    <b>{plan.mutability?.[k] ?? (k === 'goal' ? 2 : 5)}</b>
                  </label>
                ))}
              </div>
            )}
            {!plan && (
              <div className="plan-actions">
                <button type="button" className="plan-primary" disabled={!goal.trim() || busy === 'create'} onClick={() => void create()}>
                  {busy === 'create' ? 'Creating…' : 'Create plan'}
                </button>
                <span className="plan-dim">Level {level} · {level === 1 ? 'goal, one round of questions, plan' : level === 2 ? 'adds considerations and follow-ups' : 'adds the full questionnaire and mutability'}</span>
              </div>
            )}
            {plan && plan.questions.length === 0 && (
              <div className="plan-actions">
                <button type="button" className="plan-primary" disabled={busy === 'draft'} onClick={() => void draft()}>
                  {busy === 'draft' ? 'Drafting…' : 'Draft questions & tasks'}
                </button>
                <span className="plan-dim">The agent drafts from the goal — or add questions yourself on the Questions slide.</span>
              </div>
            )}
          </div>
        )}

        {loaded && slideName === 'Considerations' && (
          <div className="plan-slide">
            {!plan || plan.considerations.length === 0
              ? <p className="plan-dim">No considerations yet. {plan ? 'Draft the plan from the Goal slide, or ask in chat.' : 'Create the plan first.'}</p>
              : plan.considerations.map(c => (
                <div key={c.id} className="plan-qrow">
                  <div className="plan-qmain">
                    <div className="plan-qlabel">{c.title} {c.revised && <span className="plan-rev">Revised</span>}</div>
                    <p className="plan-ctext">{c.text}</p>
                  </div>
                  <div className="plan-notebox">
                    <input className="plan-note" placeholder="Add a note…" value={c.note || ''}
                      onChange={e => setPlan({ ...plan, considerations: plan.considerations.map(x => x.id === c.id ? { ...x, note: e.target.value } : x) })}
                      onBlur={e => void patch({ notes: { [c.id]: e.target.value } })} />
                    <button type="button" className="plan-upd" disabled={!c.note?.trim() || busy === `revise-${c.id}`}
                      onClick={() => void revise('consideration', c.id)}>
                      {busy === `revise-${c.id}` ? 'Revising…' : 'Update consideration'}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {loaded && slideName === 'Questions' && (
          <div className="plan-slide">
            {!plan
              ? <p className="plan-dim">Create the plan from the Goal slide first.</p>
              : (
                <>
                  {plan.questions.length === 0 && <p className="plan-dim">No questions yet — draft from the Goal slide or add one below. You can also ask in chat: “add a question about …”.</p>}
                  {plan.questions.map(q => (
                    <div key={q.id} className="plan-qrow">
                      <div className="plan-qmain">
                        <div className="plan-qlabel">
                          {q.label} {q.revised && <span className="plan-rev">Revised</span>}
                          <button type="button" className="plan-del" title="Remove question" onClick={() => void removeQuestion(q.id)}>×</button>
                        </div>
                        {q.control === 'choice' && q.options?.length
                          ? (
                            <div className="plan-chips">
                              {q.options.map(opt => (
                                <button key={opt} type="button"
                                  className={`plan-chip${(q.answer ?? q.default) === opt ? ' on' : ''}`}
                                  onClick={() => void patch({ answers: { [q.id]: opt } })}>
                                  {opt}{opt === q.default ? ' · default' : ''}
                                </button>
                              ))}
                            </div>
                          )
                          : (
                            <div className="plan-chips">
                              <input className="plan-in plan-ans" placeholder={`Default: ${q.default}`} value={q.answer || ''}
                                onChange={e => setPlan({ ...plan, questions: plan.questions.map(x => x.id === q.id ? { ...x, answer: e.target.value } : x) })}
                                onBlur={e => void patch({ answers: { [q.id]: e.target.value } })} />
                            </div>
                          )}
                        <div className="plan-dim">If unanswered: {q.default}</div>
                      </div>
                      <div className="plan-notebox">
                        <input className="plan-note" placeholder="Note…" value={q.note || ''}
                          onChange={e => setPlan({ ...plan, questions: plan.questions.map(x => x.id === q.id ? { ...x, note: e.target.value } : x) })}
                          onBlur={e => void patch({ notes: { [q.id]: e.target.value } })} />
                        <button type="button" className="plan-upd" disabled={!q.note?.trim() || busy === `revise-${q.id}`}
                          onClick={() => void revise('question', q.id)}>
                          {busy === `revise-${q.id}` ? 'Revising…' : 'Update question'}
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="plan-addrow">
                    <input className="plan-in" placeholder="Add a question…" value={newQuestion}
                      onChange={e => setNewQuestion(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void addQuestion() }} />
                    <button type="button" className="deck-btn" disabled={!newQuestion.trim()} onClick={() => void addQuestion()}>Add</button>
                  </div>
                </>
              )}
          </div>
        )}

        {loaded && slideName === 'Plan' && (
          <div className="plan-slide">
            {!plan
              ? <p className="plan-dim">Create the plan from the Goal slide first.</p>
              : (
                <>
                  {plan.tasks.length === 0 && <p className="plan-dim">No tasks yet — draft from the Goal slide or add tasks below.</p>}
                  {plan.tasks.map((t, i) => (
                    <div key={t.id} className="plan-trow">
                      <span className={`plan-tbox st-${t.status}`}>{t.status === 'done' ? '✓' : t.status === 'doing' ? '~' : ''}</span>
                      <input className="plan-in plan-ttext" value={t.text}
                        onChange={e => setPlan({ ...plan, tasks: plan.tasks.map(x => x.id === t.id ? { ...x, text: e.target.value } : x) })}
                        onBlur={() => void patch({ tasks: plan.tasks.map(x => ({ id: x.id, text: x.text })) })} />
                      <span className="plan-tbtns">
                        <button type="button" className="plan-del" title="Move up" disabled={i === 0}
                          onClick={() => { const ts = [...plan.tasks]; [ts[i - 1], ts[i]] = [ts[i], ts[i - 1]]; void patch({ tasks: ts.map(x => ({ id: x.id, text: x.text })) }) }}>↑</button>
                        <button type="button" className="plan-del" title="Move down" disabled={i === plan.tasks.length - 1}
                          onClick={() => { const ts = [...plan.tasks]; [ts[i + 1], ts[i]] = [ts[i], ts[i + 1]]; void patch({ tasks: ts.map(x => ({ id: x.id, text: x.text })) }) }}>↓</button>
                        <button type="button" className="plan-del" title="Delete task"
                          onClick={() => void patch({ tasks: plan.tasks.filter(x => x.id !== t.id).map(x => ({ id: x.id, text: x.text })) })}>×</button>
                      </span>
                      {t.detail && <div className="plan-dim plan-tdetail">{t.detail}</div>}
                    </div>
                  ))}
                  <div className="plan-addrow">
                    <input className="plan-in" placeholder="Add a task…" value={newTask}
                      onChange={e => setNewTask(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newTask.trim()) {
                          void patch({ tasks: [...plan.tasks.map(x => ({ id: x.id, text: x.text })), { text: newTask.trim() }] })
                          setNewTask('')
                        }
                      }} />
                    <button type="button" className="deck-btn" disabled={!newTask.trim()}
                      onClick={() => { void patch({ tasks: [...plan.tasks.map(x => ({ id: x.id, text: x.text })), { text: newTask.trim() }] }); setNewTask('') }}>Add</button>
                  </div>
                  <div className="plan-actions">
                    {plan.status === 'draft' && (
                      <button type="button" className="plan-primary" disabled={plan.tasks.length === 0} onClick={execute}>
                        Approve & execute
                      </button>
                    )}
                    {plan.status === 'approved' && <span className="plan-dim">Approved — execution starts in chat. <button type="button" className="deck-btn" onClick={execute}>Send to chat again</button></span>}
                    {(plan.status === 'executing' || plan.status === 'done') && <span className="plan-dim">{doneCount} of {plan.tasks.length} tasks done — watch the Execute slide or the chat.</span>}
                    <span className="plan-dim">Unanswered questions proceed with their defaults.</span>
                  </div>
                </>
              )}
          </div>
        )}

        {loaded && slideName === 'Execute' && (
          <div className="plan-slide">
            {!plan
              ? <p className="plan-dim">Nothing to execute yet.</p>
              : (
                <>
                  <div className="plan-progress"><div style={{ width: `${plan.tasks.length ? (doneCount / plan.tasks.length) * 100 : 0}%` }} /></div>
                  <p className="plan-dim">{plan.status === 'approved' ? 'Approved — waiting for the agent to pick it up in chat.' : plan.status === 'executing' ? 'The agent is working the plan in the chat on the right.' : plan.status === 'done' ? 'Execution finished.' : 'Approve the plan first (Plan slide).'}</p>
                  {plan.tasks.map(t => (
                    <div key={t.id} className="plan-trow">
                      <span className={`plan-tbox st-${t.status}`}>{t.status === 'done' ? '✓' : t.status === 'doing' ? '~' : ''}</span>
                      <span className="plan-ttext-static">{t.text}</span>
                      {t.detail && <div className="plan-dim plan-tdetail">{t.detail}</div>}
                    </div>
                  ))}
                </>
              )}
          </div>
        )}

        {loaded && slideName === 'Review' && (
          <div className="plan-slide">
            {!plan
              ? <p className="plan-dim">Nothing to review yet.</p>
              : (
                <>
                  {plan.review
                    ? <div className="plan-review">{plan.review.summary}</div>
                    : <p className="plan-dim">{plan.status === 'done' ? 'Finished — no summary was recorded.' : 'The review lands here when execution finishes.'}</p>}
                  <div className="plan-dim">{doneCount} of {plan.tasks.length} tasks done.</div>
                  {plan.questions.length > 0 && (
                    <div className="plan-recap">
                      {plan.questions.map(q => (
                        <div key={q.id} className="plan-recaprow"><span>{q.label}</span><b>{q.answer ?? q.default}</b></div>
                      ))}
                    </div>
                  )}
                  <div className="plan-actions">
                    <button type="button" className="deck-btn" onClick={() => { setPlan(null); setGoal(''); setTitle(''); gotoName('Goal') }}>New follow-up plan</button>
                    <button type="button" className="deck-btn" onClick={onClose}>Close</button>
                  </div>
                </>
              )}
          </div>
        )}
      </div>

      <div className="plan-foot">
        <button type="button" className="deck-btn" disabled={slide === 0} onClick={() => setSlide(s => Math.max(0, s - 1))}>Back</button>
        <span className="plan-dim">{plan ? `Saved to ai-plans/${plan.slug}.md` : 'The plan is saved as a file in the project.'}</span>
        <button type="button" className="deck-btn" disabled={slide >= steps.length - 1} onClick={() => setSlide(s => Math.min(steps.length - 1, s + 1))}>Next</button>
      </div>
    </div>
  )
}

const PLAN_CSS = `
.plan-overlay { position:absolute; z-index:40; display:flex; flex-direction:column; background:var(--panel-bg); border:1px solid var(--border); border-radius:12px; box-shadow:0 18px 50px rgba(0,0,0,.55); overflow:hidden; color:var(--text); }
.plan-head { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--border-soft); }
.plan-title { flex:1; min-width:0; background:transparent; border:1px solid transparent; border-radius:6px; color:var(--text-strong); font-size:calc(14px * var(--ui-scale, 1)); font-weight:600; padding:4px 6px; }
.plan-title:hover, .plan-title:focus { border-color:var(--border-strong); outline:none; }
.plan-title-static { flex:1; font-size:calc(14px * var(--ui-scale, 1)); font-weight:600; }
.plan-levels { display:flex; border:1px solid var(--border-strong); border-radius:7px; overflow:hidden; }
.plan-levels button { background:transparent; border:0; color:var(--muted); padding:4px 10px; cursor:pointer; font-size:calc(12px * var(--ui-scale, 1)); }
.plan-levels button.on { background:#2e5f4f; color:#eafff5; }
.plan-status { font-size:calc(11px * var(--ui-scale, 1)); padding:3px 8px; border-radius:99px; background:var(--card-hover); color:var(--text-soft); }
.plan-status.st-approved { background:#274b63; color:#d8efff; }
.plan-status.st-executing { background:#5c4a1f; color:#ffe9b0; }
.plan-status.st-done { background:#2e5f4f; color:#d9ffe9; }
.plan-x { margin-left:auto; }
.plan-head .plan-x { margin-left:0; }
.plan-steps { display:flex; gap:4px; padding:8px 12px 0; flex-wrap:wrap; }
.plan-step { background:transparent; border:1px solid var(--border); border-bottom:0; border-radius:8px 8px 0 0; color:var(--muted); padding:5px 12px; cursor:pointer; font-size:calc(12px * var(--ui-scale, 1)); }
.plan-step.on { background:var(--card); color:var(--text-strong); border-color:var(--border-strong); }
.plan-error { margin:8px 12px 0; background:#4a2323; color:#ffd9d9; border:1px solid #6e3434; border-radius:8px; padding:7px 10px; font-size:calc(12px * var(--ui-scale, 1)); }
.plan-body { flex:1; min-height:0; overflow:auto; margin:0 12px; background:var(--card); border:1px solid var(--border-strong); border-radius:0 8px 8px 8px; padding:14px; }
.plan-slide { display:flex; flex-direction:column; gap:10px; }
.plan-lab { font-size:calc(12px * var(--ui-scale, 1)); color:var(--muted); }
.plan-dim { font-size:calc(12px * var(--ui-scale, 1)); color:var(--faint); }
.plan-in { background:var(--well); border:1px solid var(--border-strong); border-radius:7px; color:var(--text); padding:7px 9px; font-size:calc(13px * var(--ui-scale, 1)); width:100%; box-sizing:border-box; }
.plan-in:focus { border-color:#2e5f4f; outline:none; }
.plan-goal { resize:vertical; font-family:inherit; }
.plan-actions { display:flex; align-items:center; gap:10px; margin-top:4px; flex-wrap:wrap; }
.plan-primary { background:#2e5f4f; color:#eafff5; border:1px solid #3a7a64; border-radius:8px; padding:8px 16px; cursor:pointer; font-size:calc(13px * var(--ui-scale, 1)); font-weight:600; }
.plan-primary:disabled { opacity:.45; cursor:default; }
.plan-qrow { display:grid; grid-template-columns:minmax(0,1fr) 240px; gap:12px; padding:10px 0; border-bottom:1px solid var(--border-soft); align-items:start; }
.plan-qmain { min-width:0; display:flex; flex-direction:column; gap:7px; }
.plan-qlabel { font-size:calc(13px * var(--ui-scale, 1)); font-weight:550; display:flex; align-items:center; gap:8px; }
.plan-ctext { font-size:calc(12.5px * var(--ui-scale, 1)); color:var(--text-soft); margin:0; }
.plan-rev { font-size:calc(10px * var(--ui-scale, 1)); background:#274b63; color:#bfe3ff; border-radius:99px; padding:2px 7px; font-weight:600; }
.plan-chips { display:flex; flex-wrap:wrap; gap:6px; }
.plan-chip { background:var(--card-hover); border:1px solid var(--border-strong); color:var(--text); border-radius:99px; padding:5px 11px; cursor:pointer; font-size:calc(12px * var(--ui-scale, 1)); }
.plan-chip.on { background:#2e5f4f; border-color:#3a7a64; color:#eafff5; }
.plan-ans { max-width:420px; }
.plan-notebox { border:1px solid var(--border-strong); border-radius:9px; padding:8px; display:flex; flex-direction:column; gap:7px; background:var(--card); }
.plan-note { background:var(--well); border:1px solid var(--border); border-radius:6px; color:var(--text); padding:6px 8px; font-size:calc(12px * var(--ui-scale, 1)); width:100%; box-sizing:border-box; }
.plan-upd { background:var(--card-hover); border:1px solid var(--border-strong); color:var(--text); border-radius:7px; padding:6px 9px; cursor:pointer; font-size:calc(12px * var(--ui-scale, 1)); }
.plan-upd:disabled { opacity:.4; cursor:default; }
.plan-upd:not(:disabled):hover { background:#2e5f4f; color:#eafff5; }
.plan-del { background:transparent; border:0; color:var(--faint); cursor:pointer; font-size:calc(14px * var(--ui-scale, 1)); padding:2px 5px; }
.plan-del:hover { color:var(--red-text); }
.plan-del:disabled { opacity:.3; }
.plan-addrow { display:flex; gap:8px; align-items:center; }
.plan-addrow .plan-in { flex:1; }
.plan-trow { display:flex; align-items:center; gap:9px; flex-wrap:wrap; padding:5px 0; border-bottom:1px solid var(--border-soft); }
.plan-tbox { width:18px; height:18px; border:1.5px solid var(--border-strong); border-radius:5px; display:inline-flex; align-items:center; justify-content:center; font-size:calc(12px * var(--ui-scale, 1)); color:var(--green-text); flex-shrink:0; }
.plan-tbox.st-doing { color:var(--amber-text); border-color:#8a6d2f; }
.plan-tbox.st-done { background:#2e5f4f; border-color:#3a7a64; }
.plan-ttext { flex:1; min-width:200px; }
.plan-ttext-static { flex:1; min-width:200px; font-size:calc(13px * var(--ui-scale, 1)); }
.plan-tbtns { display:flex; }
.plan-tdetail { flex-basis:100%; padding-left:27px; }
.plan-progress { height:6px; background:var(--card-hover); border-radius:99px; overflow:hidden; }
.plan-progress > div { height:100%; background:#3a7a64; transition:width .5s; }
.plan-review { background:var(--card); border:1px solid var(--border-strong); border-radius:9px; padding:11px 13px; font-size:calc(13px * var(--ui-scale, 1)); white-space:pre-wrap; }
.plan-recap { display:flex; flex-direction:column; gap:5px; }
.plan-recaprow { display:flex; justify-content:space-between; gap:12px; font-size:calc(12.5px * var(--ui-scale, 1)); border-bottom:1px solid var(--border-soft); padding:4px 0; }
.plan-recaprow b { color:var(--green-text); font-weight:550; text-align:right; }
.plan-mut { display:flex; flex-direction:column; gap:7px; }
.plan-mutrow { display:grid; grid-template-columns:150px 1fr 28px; align-items:center; gap:10px; font-size:calc(12.5px * var(--ui-scale, 1)); }
.plan-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 12px; }
`
