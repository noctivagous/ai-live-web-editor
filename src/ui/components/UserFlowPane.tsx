import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Circle, Plus, Sparkles, X } from 'lucide-react'
import {
  addUserFlowStep, editUserFlowStep, getUserFlows, linkUserFlows, unlinkUserFlows,
  type FeatureGraphItem, type FeatureNodeItem, type UserFlowCountsItem, type UserFlowEdgeType,
  type UserFlowGraphItem, type UserFlowStepItem, type UserFlowStepType, type VerificationState,
} from '../lib/api'
import { launchGraphUpdate } from '../lib/graphUpdate'
import {
  diagramRollup, diffFlowGraphs, exercisesOfStep, flowCoverage, flowDiagramEdges, flowDiagramNodes,
  journeyRollups, latestBlockRecord, stepNeighbours, verificationBadge, verificationColor, type StepNeighbour,
} from '../lib/userFlowDiagram'
import type { GraphView } from '../lib/layoutRoute'
import { GraphDiagram } from './GraphDiagram'

/**
 * The User Flow view of the graph pane — the second graph of the
 * Features Facet, beside the feature graph (GraphOverlay renders
 * one or the other; both stay mounted, so each keeps its own
 * selection and scroll). Journeys are the regions, steps the
 * nodes, and the same diagram resource renders them spatially.
 *
 * Data is slice 1's /api/userflows, polled like the feature
 * graph: each load diffs against the last so steps the agent (or
 * a dogfood run) adds or re-verifies flash and are narrated in
 * the feed. Editing here — rename, retype, move journey, wire
 * edges, manage exercises links — goes through the same API the
 * agent's tools write to. Verification itself is read-only in
 * the pane: it is recorded by whoever drove the step.
 *
 * The exercises join is the pane's cross-graph thread: a step's
 * inspector lists the features it exercises as chips, and a chip
 * jumps to the feature graph with that feature selected (the
 * shell owns that switch). The coverage strip under the header
 * reads the two graphs together — links, uncovered steps,
 * unexercised features, features sitting on blocked steps.
 */

const STEP_TYPES: UserFlowStepType[] = ['screen', 'action', 'outcome']
const EDGE_TYPES: UserFlowEdgeType[] = ['navigates-to', 'submits', 'branches-on', 'requires']

const FEATURE_STATUS_COLOR: Record<FeatureNodeItem['status'], string> = {
  proposed: 'var(--text-muted, #8a8a8c)',
  planned: 'var(--blue)',
  building: 'var(--amber)',
  done: 'var(--green)',
  verified: 'var(--green)',
  blocked: 'var(--red)',
  dropped: 'var(--text-muted, #8a8a8c)',
  suggested: 'var(--violet, #a371f7)',
}

const VERIFY_MARK: Record<VerificationState, React.ReactNode> = {
  ok: <Check size={12} aria-hidden />,
  blocked: <X size={12} aria-hidden />,
  error: <AlertTriangle size={12} aria-hidden />,
  untested: <Circle size={12} aria-hidden />,
}

interface FeedEntry { id: number, time: string, text: string }

export function UserFlowPane({ featureGraph, onSelectFeature, view = 'graph-report', canvasMode, reloadRef, onHasGraph, onFlowGraph }: {
  featureGraph: FeatureGraphItem | null
  onSelectFeature: (featureId: string) => void
  view?: GraphView
  canvasMode: boolean
  reloadRef?: { current: (() => void) | null }
  onHasGraph?: (has: boolean) => void
  /** Each load is reported up: the shell's Features view reads
   * the flow graph for flow-blocked badges + suggestion targets. */
  onFlowGraph?: (graph: UserFlowGraphItem | null) => void
}) {
  const [graph, setGraph] = useState<UserFlowGraphItem | null>(null)
  const [counts, setCounts] = useState<UserFlowCountsItem | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [flash, setFlash] = useState<Record<string, 'added' | 'changed'>>({})
  const [addForm, setAddForm] = useState<{ journeyId: string, newJourney: string, name: string, type: UserFlowStepType, origin: 'section' | 'inspector' | 'diagram' | 'footer' } | null>(null)
  const [linkDraft, setLinkDraft] = useState<{ type: UserFlowEdgeType, toId: string }>({ type: 'navigates-to', toId: '' })
  const [exDraft, setExDraft] = useState('')
  const prevGraphRef = useRef<UserFlowGraphItem | null>(null)
  const firstLoadRef = useRef(false)
  const feedIdRef = useRef(0)
  const featureGraphRef = useRef(featureGraph)
  featureGraphRef.current = featureGraph
  const onFlowGraphRef = useRef(onFlowGraph)
  onFlowGraphRef.current = onFlowGraph

  const load = useCallback(async (silent = false) => {
    try {
      const d = await getUserFlows()
      if (d.ok) {
        const prev = prevGraphRef.current
        const next = d.graph
        const base = prev ?? (firstLoadRef.current ? { title: '', journeys: [], steps: [], edges: [], exercises: [] } : null)
        if (base && next) {
          const fg = featureGraphRef.current
          const fname = fg ? (id: string) => fg.nodes.find(n => n.id === id)?.name : undefined
          const { feed: entries, flash: flashes } = diffFlowGraphs(base, next, fname)
          if (entries.length) {
            const time = new Date().toLocaleTimeString([], { hour12: false })
            const shown = entries.slice(0, 6)
            if (entries.length > shown.length) shown.push(`…and ${entries.length - shown.length} more changes`)
            setFeed(f => [...shown.map(text => ({ id: ++feedIdRef.current, time, text })), ...f].slice(0, 9))
          }
          if (Object.keys(flashes).length) {
            setFlash(f => ({ ...f, ...flashes }))
            const ids = Object.keys(flashes)
            window.setTimeout(() => {
              setFlash(f => {
                const copy = { ...f }
                for (const id of ids) delete copy[id]
                return copy
              })
            }, 2600)
          }
        }
        prevGraphRef.current = next
        firstLoadRef.current = true
        setGraph(d.graph); setCounts(d.counts); setError('')
        onFlowGraphRef.current?.(d.graph)
      }
      else if (!silent) setError(d.error || 'User flow graph failed to load')
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'User flow graph failed to load')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const t = window.setInterval(() => { void load(true) }, 2500)
    return () => window.clearInterval(t)
  }, [load])
  useEffect(() => {
    if (reloadRef) reloadRef.current = () => { void load() }
  }, [load, reloadRef])
  useEffect(() => {
    onHasGraph?.(!!graph && (graph.journeys.length > 0 || graph.steps.length > 0))
  }, [graph, onHasGraph])

  const stepById = new Map((graph?.steps ?? []).map(s => [s.id, s]))
  const journeyById = new Map((graph?.journeys ?? []).map(j => [j.id, j]))
  const selectedStep = selectedId ? stepById.get(selectedId) ?? null : null
  const selectedJourney = !selectedStep && selectedId ? journeyById.get(selectedId) ?? null : null
  const rollups = graph ? journeyRollups(graph) : new Map()
  const coverage = graph ? flowCoverage(graph, featureGraph) : null
  const latestBlock = graph ? latestBlockRecord(graph) : null
  const diagramRollupMap = new Map([...rollups.entries()].map(([id, r]) => [id, diagramRollup(r)]))

  const bar = (pct: number) => (
    <div className="graph-bar"><div className="graph-bar-fill" style={{ width: `${pct}%` }} /></div>
  )

  async function renameStep(step: UserFlowStepItem, name: string) {
    if (!name.trim() || name.trim() === step.name) return
    setBusy(step.id)
    const r = await editUserFlowStep(step.id, { name: name.trim() })
    setBusy('')
    if (!r.ok) setError(r.error || 'Rename failed')
    await load(true)
  }

  async function editStep(step: UserFlowStepItem, patch: { type?: UserFlowStepType, journey?: string }) {
    setBusy(step.id)
    const r = await editUserFlowStep(step.id, patch)
    setBusy('')
    if (!r.ok) setError(r.error || 'Edit failed')
    await load(true)
  }

  async function removeEdge(n: StepNeighbour) {
    setBusy('conn')
    const r = await unlinkUserFlows(n.edge.from, n.edge.to, n.edge.type)
    setBusy('')
    if (!r.ok) setError(r.error || 'Edge removal failed')
    await load(true)
  }

  async function addEdge(step: UserFlowStepItem, toId: string, type: UserFlowEdgeType) {
    if (!toId) return
    setBusy('conn')
    const r = await linkUserFlows(step.id, toId, type)
    setBusy('')
    if (!r.ok) setError(r.error || 'Edge failed')
    await load(true)
  }

  async function removeExercises(step: UserFlowStepItem, featureId: string) {
    setBusy('ex')
    const r = await unlinkUserFlows(step.id, featureId, 'exercises')
    setBusy('')
    if (!r.ok) setError(r.error || 'Exercises link removal failed')
    await load(true)
  }

  async function addExercises(step: UserFlowStepItem, featureId: string) {
    if (!featureId) return
    setBusy('ex')
    const r = await linkUserFlows(step.id, featureId, 'exercises')
    setBusy('')
    if (!r.ok) { setError(r.error || 'Exercises link failed'); return }
    setExDraft('')
    await load(true)
  }

  async function submitAddForm() {
    if (!addForm || !addForm.name.trim()) return
    const journeyRef = addForm.journeyId === 'new' ? addForm.newJourney.trim() : addForm.journeyId
    if (!journeyRef) return
    setBusy('add')
    const r = await addUserFlowStep({ name: addForm.name.trim(), type: addForm.type, journey: journeyRef })
    setBusy('')
    if (!r.ok) { setError(r.error || 'Add failed'); return }
    setAddForm(null)
    if (r.step) setSelectedId(r.step.id)
    await load(true)
  }

  const addFormEl = addForm ? (
    <div className="graph-add-form">
      <input
        className="graph-param-input"
        placeholder="Step name"
        value={addForm.name}
        autoFocus
        onChange={e => setAddForm({ ...addForm, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter') void submitAddForm(); if (e.key === 'Escape') setAddForm(null) }}
      />
      <select className="deck-select" value={addForm.type} onChange={e => setAddForm({ ...addForm, type: e.target.value as UserFlowStepType })}>
        {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {addForm.journeyId === 'new' ? (
        <input
          className="graph-param-input"
          placeholder="New journey name"
          value={addForm.newJourney}
          onChange={e => setAddForm({ ...addForm, newJourney: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') void submitAddForm(); if (e.key === 'Escape') setAddForm(null) }}
        />
      ) : (
        <select
          className="deck-select"
          value={addForm.journeyId}
          onChange={e => setAddForm({ ...addForm, journeyId: e.target.value })}
          title="The journey this step belongs to"
        >
          {(graph?.journeys ?? []).map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          <option value="new">New journey…</option>
        </select>
      )}
      <button
        type="button" className="deck-btn"
        disabled={busy === 'add' || !addForm.name.trim() || (addForm.journeyId === 'new' && !addForm.newJourney.trim())}
        onClick={() => void submitAddForm()}
      >Add</button>
      <button type="button" className="deck-btn" onClick={() => setAddForm(null)}>Cancel</button>
    </div>
  ) : null

  const renderStepRow = (step: UserFlowStepItem) => {
    const badge = verificationBadge(step)
    return (
      <button
        key={step.id}
        type="button"
        className={`graph-node${selectedId === step.id ? ' sel' : ''}${flash[step.id] ? ` flash-${flash[step.id]}` : ''}`}
        style={{ paddingLeft: 8 }}
        onClick={() => setSelectedId(step.id)}
      >
        <span className="graph-mark" style={{ color: verificationColor(step.verification.state) }}>{VERIFY_MARK[step.verification.state]}</span>
        <span className="graph-node-name">{step.name}</span>
        <span className="graph-chip">{step.type}</span>
        <span className="graph-flow-state">{step.verification.state}</span>
        {badge && (
          <span className="graph-blocked" style={step.verification.state === 'error' ? { color: 'var(--amber-text)' } : undefined}>
            {badge}
          </span>
        )}
      </button>
    )
  }

  const renderInspector = () => (
    <aside className="graph-rail">
      {selectedStep ? (
        <>
          <input
            key={`${selectedStep.id}:${selectedStep.name}`}
            className="graph-insp-name-input"
            defaultValue={selectedStep.name}
            disabled={busy === selectedStep.id}
            title="Rename — Enter or Tab to save"
            onBlur={e => void renameStep(selectedStep, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
          <div className="graph-insp-row">
            <span className="graph-chip">{selectedStep.type}</span>
            <span className="graph-chip" style={{ color: verificationColor(selectedStep.verification.state) }}>
              {selectedStep.verification.state}
            </span>
          </div>
          <label className="graph-insp-label">Type
            <select
              className="deck-select"
              value={selectedStep.type}
              disabled={busy === selectedStep.id}
              onChange={e => void editStep(selectedStep, { type: e.target.value as UserFlowStepType })}
            >
              {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="graph-insp-label">Journey
            <select
              className="deck-select"
              value={selectedStep.journey}
              disabled={busy === selectedStep.id}
              onChange={e => void editStep(selectedStep, { journey: e.target.value })}
              title="Which journey contains this step — containment is the journey field"
            >
              {(graph?.journeys ?? []).map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </label>
          {selectedStep.note && <div className="graph-insp-note">{selectedStep.note}</div>}
          <div className="graph-insp-block">
            <div className="graph-insp-label">Verification — recorded when the step is driven</div>
            <div className="graph-insp-line">
              <span style={{ color: verificationColor(selectedStep.verification.state), fontWeight: 600 }}>
                {selectedStep.verification.state}
              </span>
              {selectedStep.verification.block && (
                <>
                  {` · ${selectedStep.verification.block.kind}`}
                  {selectedStep.verification.block.runId && <span className="graph-flow-dim">{` · run ${selectedStep.verification.block.runId}`}</span>}
                </>
              )}
            </div>
            {selectedStep.verification.block?.evidence && (
              <div className="graph-insp-note">{selectedStep.verification.block.evidence}</div>
            )}
            {selectedStep.verification.block?.at && (
              <div className="graph-insp-line graph-flow-dim">
                {new Date(selectedStep.verification.block.at).toLocaleString()}
              </div>
            )}
            {selectedStep.verification.state === 'untested' && (
              <div className="graph-insp-line graph-flow-dim">Not driven yet — no verification recorded.</div>
            )}
          </div>
          <div className="graph-insp-block">
            <div className="graph-insp-label">Exercises — features behind this step</div>
            {exercisesOfStep(graph!, featureGraph, selectedStep.id).map(f => (
              <div key={f.id} className="graph-conn-row">
                <button
                  type="button"
                  className="graph-conn"
                  title="Open this feature in the Feature graph"
                  onClick={() => onSelectFeature(f.id)}
                >
                  <span className="graph-mark" style={{ background: FEATURE_STATUS_COLOR[f.status], borderRadius: '50%', width: 9, height: 9, flex: 'none' }} />
                  <span>{f.name}</span>
                  <span className="graph-conn-count">{f.status}</span>
                </button>
                <button
                  type="button"
                  className="graph-conn-x"
                  disabled={busy === 'ex'}
                  title="Remove this exercises link"
                  onClick={() => void removeExercises(selectedStep, f.id)}
                ><X size={11} /></button>
              </div>
            ))}
            {exercisesOfStep(graph!, featureGraph, selectedStep.id).length === 0 && (
              <div className="graph-insp-line graph-flow-dim">
                {featureGraph ? 'No feature linked yet — this step exercises nothing recorded.' : 'No feature graph yet — exercises links need a feature to point at.'}
              </div>
            )}
            {featureGraph && featureGraph.nodes.length > 0 && (
              <div className="graph-add-conn">
                <select className="deck-select" value={exDraft} onChange={e => setExDraft(e.target.value)}>
                  <option value="">Choose a feature…</option>
                  {featureGraph.nodes
                    .filter(n => !exercisesOfStep(graph!, featureGraph, selectedStep.id).some(f => f.id === n.id))
                    .map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
                <button
                  type="button"
                  className="deck-btn"
                  disabled={busy === 'ex' || !exDraft}
                  onClick={() => void addExercises(selectedStep, exDraft)}
                >Link</button>
              </div>
            )}
          </div>
          <div className="graph-insp-block">
            <div className="graph-insp-label">Connections</div>
            {stepNeighbours(graph!, selectedStep.id).map((n, i) => (
              <div key={i} className="graph-conn-row">
                <button type="button" className="graph-conn" onClick={() => setSelectedId(n.step.id)}>
                  <span className="graph-conn-label">{n.label}</span>
                  <span className="graph-mark" style={{ color: verificationColor(n.step.verification.state) }}>{VERIFY_MARK[n.step.verification.state]}</span>
                  <span>{n.step.name}</span>
                </button>
                <button
                  type="button"
                  className="graph-conn-x"
                  disabled={busy === 'conn'}
                  title={`Remove this connection (${n.edge.type})`}
                  onClick={() => void removeEdge(n)}
                ><X size={11} /></button>
              </div>
            ))}
            <div className="graph-add-conn">
              <span className="graph-conn-this">{selectedStep.name}</span>
              <select className="deck-select" value={linkDraft.type} onChange={e => setLinkDraft({ ...linkDraft, type: e.target.value as UserFlowEdgeType })}>
                {EDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="deck-select" value={linkDraft.toId} onChange={e => setLinkDraft({ ...linkDraft, toId: e.target.value })}>
                <option value="">Choose a step…</option>
                {(graph?.steps ?? []).filter(s => s.id !== selectedStep.id).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="deck-btn"
                disabled={busy === 'conn' || !linkDraft.toId}
                onClick={() => void addEdge(selectedStep, linkDraft.toId, linkDraft.type)}
              >Link</button>
            </div>
          </div>
        </>
      ) : selectedJourney ? (
        <>
          <div className="graph-insp-name">{selectedJourney.name}</div>
          <div className="graph-insp-row"><span className="graph-chip">journey</span></div>
          {selectedJourney.note && <div className="graph-insp-note">{selectedJourney.note}</div>}
          {(() => {
            const r = rollups.get(selectedJourney.id)
            if (!r) return null
            return (
              <div className="graph-insp-block">
                <div className="graph-insp-label">Verification</div>
                <div className="graph-insp-line">{r.pct}% verified · {r.ok}/{r.total} steps ok</div>
                {r.blocked > 0 && <div className="graph-insp-line" style={{ color: 'var(--red-text)' }}>{r.blocked} blocked</div>}
                {r.error > 0 && <div className="graph-insp-line" style={{ color: 'var(--amber-text)' }}>{r.error} in error</div>}
                {r.untested > 0 && <div className="graph-insp-line graph-flow-dim">{r.untested} not driven yet</div>}
              </div>
            )
          })()}
          <div className="graph-insp-block">
            <div className="graph-insp-label">Steps</div>
            {(graph?.steps ?? []).filter(s => s.journey === selectedJourney.id).map(s => (
              <button key={s.id} type="button" className="graph-conn" onClick={() => setSelectedId(s.id)}>
                <span className="graph-mark" style={{ color: verificationColor(s.verification.state) }}>{VERIFY_MARK[s.verification.state]}</span>
                <span>{s.name}</span>
                <span className="graph-conn-count">{s.type}</span>
              </button>
            ))}
            {(graph?.steps ?? []).filter(s => s.journey === selectedJourney.id).length === 0 && (
              <div className="graph-insp-line graph-flow-dim">No steps yet.</div>
            )}
          </div>
          <div className="graph-insp-actions">
            <button
              type="button"
              className="deck-btn"
              onClick={() => setAddForm({ journeyId: selectedJourney.id, newJourney: '', name: '', type: 'screen', origin: 'inspector' })}
            ><Plus size={12} />Add a step</button>
          </div>
          {addForm && addForm.origin === 'inspector' && addForm.journeyId === selectedJourney.id && addFormEl}
        </>
      ) : (
        <>
          <div className="graph-insp-name">Overview</div>
          <div className="graph-insp-line">Select a step to see its verification, the features it exercises, and its connections.</div>
          {(graph?.journeys ?? []).map(j => {
            const r = rollups.get(j.id)
            return (
              <button key={j.id} type="button" className="graph-conn" onClick={() => setSelectedId(j.id)}>
                <span className="graph-conn-label">{r ? `${r.pct}%` : ''}</span>
                <span>{j.name}</span>
                <span className="graph-conn-count">{r ? `${r.ok}/${r.total}` : ''}</span>
              </button>
            )
          })}
          {coverage && coverage.featuresOnBlockedSteps.length > 0 && (
            <div className="graph-insp-block">
              <div className="graph-insp-label">Features on blocked steps</div>
              {coverage.featuresOnBlockedSteps.map(({ feature, steps }) => (
                <button key={feature.id} type="button" className="graph-conn" onClick={() => onSelectFeature(feature.id)}>
                  <span className="graph-mark" style={{ color: 'var(--red)', display: 'inline-flex' }}><X size={12} aria-hidden /></span>
                  <span>{feature.name}</span>
                  <span className="graph-conn-count">{steps.length} blocked</span>
                </button>
              ))}
            </div>
          )}
          {coverage && coverage.stepsWithoutFeatures.length > 0 && (
            <div className="graph-insp-block">
              <div className="graph-insp-label">Steps with no feature</div>
              {coverage.stepsWithoutFeatures.map(s => (
                <button key={s.id} type="button" className="graph-conn" onClick={() => setSelectedId(s.id)}>
                  <span className="graph-conn-label">{s.type}</span>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          )}
          {coverage && coverage.featuresNeverExercised.length > 0 && (
            <div className="graph-insp-block">
              <div className="graph-insp-label">Features no step exercises</div>
              {coverage.featuresNeverExercised.map(f => (
                <button key={f.id} type="button" className="graph-conn" onClick={() => onSelectFeature(f.id)}>
                  <span className="graph-conn-label">{f.kind}</span>
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          )}
          {graph && graph.steps.filter(s => s.verification.state === 'blocked' || s.verification.state === 'error').length > 0 && (
            <div className="graph-insp-block">
              <div className="graph-insp-label">Blocked and error steps</div>
              {graph.steps.filter(s => s.verification.state === 'blocked' || s.verification.state === 'error').map(s => (
                <button key={s.id} type="button" className="graph-conn" onClick={() => setSelectedId(s.id)}>
                  <span className="graph-mark" style={{ color: verificationColor(s.verification.state), display: 'inline-flex' }}>{VERIFY_MARK[s.verification.state]}</span>
                  <span>{s.name}</span>
                  <span className="graph-conn-count">{verificationBadge(s)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  )

  if (!loaded) return <div className="graph-empty">Loading the user flow graph…</div>
  if (!graph || (graph.journeys.length === 0 && graph.steps.length === 0)) {
    return (
      <div className="graph-empty">
        <p>No user flow graph in this project yet.</p>
        <p>The flow graph is the app as used — journeys a person takes, the screens they see, the actions they take, and what should happen, each step linked to the features behind it and marked with how it actually behaved when driven. Have the agent build it from the app and watch it land here, step by step.</p>
        <div className="graph-empty-actions">
          <button type="button" className="deck-btn graph-build-btn" onClick={() => launchGraphUpdate('userflow')}>
            <Sparkles size={13} />Build the graph
          </button>
        </div>
        <p className="graph-cmd-hint mono">launches /graph-update userflow</p>
        <p className="graph-cmd-note">/graph-update takes a target — feature and userflow are the graphs today.</p>
      </div>
    )
  }

  return (
    <>
      <style>{FLOW_CSS}</style>
      {error && <div className="graph-error">{error}</div>}
      {feed.length > 0 && (
        <div className="graph-feed" aria-label="Recent user flow changes">
          {feed.map(f => (
            <div key={f.id} className="graph-feed-row"><span className="graph-feed-time mono">{f.time}</span><span>{f.text}</span></div>
          ))}
        </div>
      )}
      {counts && coverage && (
        <div className="graph-flow-strip" aria-label="User flow coverage">
          <span>{counts.verifiedPct}% verified · {counts.ok}/{counts.steps} steps ok</span>
          {counts.blocked > 0 && <span className="graph-flow-bad">{counts.blocked} blocked</span>}
          {counts.error > 0 && <span className="graph-flow-err">{counts.error} in error</span>}
          {counts.untested > 0 && <span className="graph-flow-dim">{counts.untested} not driven</span>}
          <span className="graph-flow-sep" />
          <span>{coverage.links} exercises link{coverage.links === 1 ? '' : 's'}</span>
          {coverage.stepsWithoutFeatures.length > 0 && <span>{coverage.stepsWithoutFeatures.length} step{coverage.stepsWithoutFeatures.length === 1 ? '' : 's'} with no feature</span>}
          {coverage.featuresNeverExercised.length > 0 && <span>{coverage.featuresNeverExercised.length} feature{coverage.featuresNeverExercised.length === 1 ? '' : 's'} never exercised</span>}
          {coverage.featuresOnBlockedSteps.length > 0 && <span className="graph-flow-bad">{coverage.featuresOnBlockedSteps.length} feature{coverage.featuresOnBlockedSteps.length === 1 ? '' : 's'} on blocked steps</span>}
          {latestBlock && (
            <>
              <span className="graph-flow-sep" />
              <span title="The most recent block a run recorded. Only blocks carry a run stamp — an ok records none — so this is the latest block, not necessarily the latest run.">
                latest block — {latestBlock.step.name} · {latestBlock.kind}
                {latestBlock.runId ? ` · run ${latestBlock.runId}` : ''} · {new Date(latestBlock.at).toLocaleString()}
              </span>
            </>
          )}
        </div>
      )}
      {view === 'graph-diagram' ? (
        <div className="graph-body">
          <div className="graph-diagram-wrap">
            {addForm && <div className="graph-diagram-add">{addFormEl}</div>}
            <GraphDiagram
              nodes={flowDiagramNodes(graph)}
              edges={flowDiagramEdges(graph)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              mode={canvasMode ? 'canvas' : 'flow'}
              flash={flash}
              regionRollup={diagramRollupMap}
              statusColor={s => (s === 'journey' ? 'var(--text-muted, #8a8a8c)' : verificationColor(s as VerificationState))}
              onReparent={(id, parentId) => {
                const step = stepById.get(id)
                if (step && parentId && journeyById.has(parentId) && parentId !== step.journey) {
                  void editStep(step, { journey: parentId })
                }
              }}
              onAddNode={parentId => setAddForm({
                journeyId: parentId && journeyById.has(parentId) ? parentId : 'new',
                newJourney: '', name: '', type: 'screen', origin: 'diagram',
              })}
            />
          </div>
          {renderInspector()}
        </div>
      ) : (
        <div className="graph-body">
          <div className="graph-main">
            {graph.journeys.map(journey => {
              const r = rollups.get(journey.id)
              const steps = graph.steps.filter(s => s.journey === journey.id)
              return (
                <section key={journey.id} className="graph-region">
                  <div className="graph-region-head">
                    <button type="button" className="graph-region-name" onClick={() => setSelectedId(journey.id)}>{journey.name}</button>
                    {r && (
                      <span className="graph-region-roll">
                        {bar(r.pct)}
                        <span>{r.pct}% verified · {r.ok}/{r.total}</span>
                        {r.blocked > 0 && <span className="graph-blocked">{r.blocked} blocked</span>}
                        {r.error > 0 && <span className="graph-blocked" style={{ color: 'var(--amber-text)' }}>{r.error} error</span>}
                      </span>
                    )}
                    <button
                      type="button"
                      className="deck-btn"
                      onClick={() => setAddForm({ journeyId: journey.id, newJourney: '', name: '', type: 'screen', origin: 'section' })}
                      title={`Add a step to ${journey.name}`}
                    ><Plus size={12} />Add</button>
                  </div>
                  {addForm && addForm.origin === 'section' && addForm.journeyId === journey.id && addFormEl}
                  {steps.map(renderStepRow)}
                  {steps.length === 0 && <div className="graph-region-empty">No steps yet.</div>}
                </section>
              )
            })}
            <div className="graph-main-foot">
              {addForm && addForm.origin === 'footer' && addFormEl}
              {!addForm && (
                <button
                  type="button"
                  className="deck-btn"
                  onClick={() => setAddForm({ journeyId: graph.journeys[0]?.id ?? 'new', newJourney: '', name: '', type: 'screen', origin: 'footer' })}
                >
                  <Plus size={12} />Add a step or journey
                </button>
              )}
            </div>
          </div>
          {renderInspector()}
        </div>
      )}
    </>
  )
}

const FLOW_CSS = `
.graph-flow-strip { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:7px 12px; border-bottom:1px solid var(--border-soft); font-size:calc(12px * var(--ui-scale, 1)); }
.graph-flow-strip .graph-flow-sep { flex:0 0 1px; align-self:stretch; background:var(--border-soft); }
.graph-flow-bad { color:var(--red-text); font-weight:600; }
.graph-flow-err { color:var(--amber-text); font-weight:600; }
.graph-flow-dim { opacity:.55; }
.graph-flow-state { font-size:calc(11px * var(--ui-scale, 1)); opacity:.6; }
`
