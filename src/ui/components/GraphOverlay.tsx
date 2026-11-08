import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Circle, CircleDot, Clock, Loader2, Maximize2, Minimize2, Minus, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import {
  addFeatureNode, editFeatureNode, getFeatureCurrency, getFeatureLint, getFeatureReconcile, getFeatures, linkFeatures,
  planFromGraph, removeFeatureNode, setFeatureNodeStatus, setFeatureParam, unlinkFeatures,
  type DriftItem, type FeatureEdgeItem, type FeatureGraphItem, type FeatureNodeItem, type FeatureNodeStatus, type FeatureParamItem, type FeatureRollup, type GraphCurrency, type GraphProblemItem,
} from '../lib/api'
import { formatGraphCurrency, launchGraphUpdate } from '../lib/graphUpdate'
import { loadUiPrefs, saveUiPrefs } from '../lib/uiPrefs'
import type { GraphView } from '../lib/layoutRoute'
import { GraphDiagram } from './GraphDiagram'

/**
 * The feature graph overlay: floats over the file manager + middle
 * section like the planner (chat stays live on the right) and shows
 * the project's durable map — regions with their features, status
 * rollups computed server-side, and an inspector for one node
 * (bindings, parameters, typed connections). Status changes go
 * through the same /api/features store the agent's tools use, and
 * "Plan from here" generates a plan from a subtree or pack via
 * /api/plans/from-graph, then hands over to the plan overlay.
 *
 * The pane is also the watching surface for /graph-update: the
 * Build/Update button launches the command (lib/graphUpdate), the
 * agent's tool writes land in the store, and this pane polls the
 * store — diffing each load against the last so new and changed
 * nodes flash, and every change (the agent's or the user's own
 * edits below) is narrated in the feed under the header. Editing
 * here — rename, reparent, add/remove nodes and connections —
 * goes through the same store functions as the agent's tools.
 *
 * Two views of the same graph, routed (layoutRoute): the report
 * (tree-list navigation with connection links) and the diagram —
 * the general GraphDiagram resource rendering regions and nodes
 * spatially with drawn edges, sharing this pane's selection,
 * inspector rail, feed and flash state, so a /graph-update run
 * streams into whichever view is open.
 */

const STATUSES: FeatureNodeStatus[] = ['proposed', 'planned', 'building', 'done', 'verified', 'blocked', 'dropped']

const STATUS_COLOR: Record<FeatureNodeStatus, string> = {
  proposed: 'var(--text-muted, #8a8a8c)',
  planned: 'var(--blue)',
  building: 'var(--amber)',
  done: 'var(--green)',
  verified: 'var(--green)',
  blocked: 'var(--red)',
  dropped: 'var(--text-muted, #8a8a8c)',
}

const STATUS_MARK: Record<FeatureNodeStatus, ReactNode> = {
  proposed: <Circle size={12} aria-hidden />,
  planned: <Clock size={12} aria-hidden />,
  building: <Loader2 size={12} aria-hidden />,
  done: <CircleDot size={12} aria-hidden />,
  verified: <Check size={12} aria-hidden />,
  blocked: <X size={12} aria-hidden />,
  dropped: <Minus size={12} aria-hidden />,
}

interface Connection { label: string, node: FeatureNodeItem, edge: FeatureEdgeItem }

interface FeedEntry { id: number, time: string, text: string }

const EDGE_TYPES = ['depends-on', 'configures', 'renders', 'data-flows', 'derived-from']
const NODE_KINDS = ['region', 'feature', 'screen', 'component', 'setting', 'data', 'service']

/** What changed between two graph snapshots, in words for the feed. */
function diffGraphs(prev: FeatureGraphItem, next: FeatureGraphItem): { feed: string[], flash: Record<string, 'added' | 'changed'> } {
  const feed: string[] = []
  const flash: Record<string, 'added' | 'changed'> = {}
  const prevById = new Map(prev.nodes.map(n => [n.id, n]))
  const nextById = new Map(next.nodes.map(n => [n.id, n]))
  const nameOf = (id: string) => nextById.get(id)?.name ?? prevById.get(id)?.name ?? id
  for (const n of next.nodes) {
    const p = prevById.get(n.id)
    if (!p) { flash[n.id] = 'added'; feed.push(`Node added — ${n.name} (${n.kind})`) }
    else if (p.status !== n.status) { flash[n.id] = 'changed'; feed.push(`Status — ${n.name}: ${p.status} → ${n.status}`) }
    else if (p.name !== n.name) { flash[n.id] = 'changed'; feed.push(`Renamed — ${p.name} → ${n.name}`) }
    else if ((p.parent ?? '') !== (n.parent ?? '')) { flash[n.id] = 'changed'; feed.push(`Moved — ${n.name} → ${n.parent ? nameOf(n.parent) : 'top level'}`) }
  }
  for (const p of prev.nodes) {
    if (!nextById.has(p.id)) feed.push(`Node removed — ${p.name}`)
  }
  const key = (e: FeatureEdgeItem) => `${e.from}|${e.to}|${e.type}`
  const prevEdges = new Map(prev.edges.map(e => [key(e), e]))
  const nextEdges = new Map(next.edges.map(e => [key(e), e]))
  for (const [k, e] of nextEdges) if (!prevEdges.has(k)) feed.push(`Connection added — ${nameOf(e.from)} ${e.type} ${nameOf(e.to)}`)
  for (const [k, e] of prevEdges) if (!nextEdges.has(k)) feed.push(`Connection removed — ${nameOf(e.from)} ${e.type} ${nameOf(e.to)}`)
  return { feed, flash }
}

export function GraphOverlay({ onClose, onShowLibrary, onOpenReport, onOpenDiagram, expanded, onToggleExpand, view = 'graph-report', style }: {
  onClose: () => void
  onShowLibrary?: () => void
  onOpenReport?: () => void
  onOpenDiagram?: () => void
  expanded?: boolean
  onToggleExpand?: () => void
  view?: GraphView
  style?: React.CSSProperties
}) {
  const [graph, setGraph] = useState<FeatureGraphItem | null>(null)
  const [problems, setProblems] = useState<GraphProblemItem[]>([])
  const [drift, setDrift] = useState<DriftItem[]>([])
  const [currency, setCurrency] = useState<GraphCurrency | null>(null)
  const [rollup, setRollup] = useState<{ overall: FeatureRollup, regions: { node: FeatureNodeItem, rollup: FeatureRollup }[] } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [flash, setFlash] = useState<Record<string, 'added' | 'changed'>>({})
  const [addForm, setAddForm] = useState<{ parentId: string, name: string, kind: string } | null>(null)
  const [linkDraft, setLinkDraft] = useState<{ type: string, toId: string }>({ type: 'depends-on', toId: '' })
  // Diagram layout (Flow | Canvas): a device preference, set from
  // the header switch in the diagram view.
  const [canvasMode, setCanvasMode] = useState(() => loadUiPrefs().diagramCanvas)
  function changeCanvasMode(on: boolean) {
    setCanvasMode(on)
    saveUiPrefs({ diagramCanvas: on })
  }
  const prevGraphRef = useRef<FeatureGraphItem | null>(null)
  const firstLoadRef = useRef(false)
  const feedIdRef = useRef(0)

  const load = useCallback(async (silent = false) => {
    try {
      const d = await getFeatures()
      if (d.ok) {
        // Diff against the previous snapshot: this is what makes
        // the pane a watching surface — changes flash on the node
        // rows and are narrated in the feed, whoever made them.
        const prev = prevGraphRef.current
        const next = d.graph
        // First load just sets the baseline. After that, a null
        // graph diffs against empty — so a graph the agent builds
        // from nothing flashes in node by node.
        const base = prev ?? (firstLoadRef.current ? { title: '', nodes: [], edges: [] } : null)
        if (base && next) {
          const { feed: entries, flash: flashes } = diffGraphs(base, next)
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
        setGraph(d.graph); setRollup(d.rollup); setError('')
      }
      else if (!silent) setError(d.error || 'Feature graph failed to load')
      if (!silent) {
        const lint = await getFeatureLint().catch(() => null)
        if (lint?.ok) setProblems(lint.problems)
        const rec = await getFeatureReconcile().catch(() => null)
        if (rec?.ok) setDrift(rec.drift)
        const cur = await getFeatureCurrency().catch(() => null)
        if (cur?.ok) setCurrency(cur)
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Feature graph failed to load')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // The agent can change the graph from chat while this is open —
  // and during a /graph-update run this poll is the live view.
  useEffect(() => {
    const t = window.setInterval(() => { void load(true) }, 2500)
    return () => window.clearInterval(t)
  }, [load])

  const byId = new Map((graph?.nodes ?? []).map(n => [n.id, n]))
  const selected = selectedId ? byId.get(selectedId) ?? null : null
  const childrenOf = (parent?: string) => (graph?.nodes ?? []).filter(n => (n.parent ?? undefined) === parent)
  const regions = childrenOf(undefined).filter(n => n.kind === 'region')
  const topLevel = childrenOf(undefined).filter(n => n.kind !== 'region')
  const regionRollup = new Map((rollup?.regions ?? []).map(r => [r.node.id, r.rollup]))

  function connections(node: FeatureNodeItem): Connection[] {
    const out: Connection[] = []
    const edges: FeatureEdgeItem[] = graph?.edges ?? []
    const push = (label: string, id: string, edge: FeatureEdgeItem) => { const n = byId.get(id); if (n) out.push({ label, node: n, edge }) }
    for (const e of edges) {
      if (e.from === node.id) {
        if (e.type === 'configures') push('configures', e.to, e)
        else if (e.type === 'depends-on') push('depends on', e.to, e)
        else if (e.type === 'renders') push('renders', e.to, e)
        else if (e.type === 'data-flows') push('data flows to', e.to, e)
        else if (e.type === 'derived-from') push('derived from', e.to, e)
      }
      if (e.to === node.id) {
        if (e.type === 'configures') push('configured by', e.from, e)
        else if (e.type === 'depends-on') push('needed by', e.from, e)
        else if (e.type === 'renders') push('rendered by', e.from, e)
        else if (e.type === 'data-flows') push('data flows from', e.from, e)
        else if (e.type === 'derived-from') push('realized by', e.from, e)
      }
    }
    return out
  }

  /** Ids that may not become the node's parent: itself and its subtree. */
  function descendantIds(id: string): Set<string> {
    const out = new Set<string>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const n of graph?.nodes ?? []) {
        if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true }
      }
    }
    return out
  }

  async function rename(node: FeatureNodeItem, name: string) {
    if (!name.trim() || name.trim() === node.name) return
    setBusy(node.id)
    const r = await editFeatureNode(node.id, { name: name.trim() })
    setBusy('')
    if (!r.ok) setError(r.error || 'Rename failed')
    await load(true)
  }

  async function reparent(node: FeatureNodeItem, parentId: string) {
    setBusy(node.id)
    const r = await editFeatureNode(node.id, { parentId: parentId || null })
    setBusy('')
    if (!r.ok) setError(r.error || 'Move failed')
    await load(true)
  }

  async function removeConn(c: Connection) {
    setBusy('conn')
    const r = await unlinkFeatures(c.edge.from, c.edge.to, c.edge.type)
    setBusy('')
    if (!r.ok) setError(r.error || 'Connection removal failed')
    await load(true)
  }

  async function addConn(node: FeatureNodeItem, toId: string, type: string) {
    if (!toId) return
    setBusy('conn')
    const r = await linkFeatures(node.id, toId, type)
    setBusy('')
    if (!r.ok) setError(r.error || 'Connection failed')
    await load(true)
  }

  async function removeSelNode(node: FeatureNodeItem, mode: 'lift' | 'cascade') {
    setBusy('remove')
    const r = await removeFeatureNode(node.id, mode)
    setBusy('')
    if (!r.ok) { setError(r.error || 'Remove failed'); return }
    setSelectedId(null)
    await load(true)
  }

  async function submitAddForm() {
    if (!addForm || !addForm.name.trim()) return
    setBusy('add')
    const r = await addFeatureNode({
      name: addForm.name.trim(),
      kind: addForm.kind,
      ...(addForm.parentId ? { parentId: addForm.parentId } : {}),
    })
    setBusy('')
    if (!r.ok) { setError(r.error || 'Add failed'); return }
    setAddForm(null)
    if (r.node) setSelectedId(r.node.id)
    await load(true)
  }

  async function changeStatus(node: FeatureNodeItem, status: FeatureNodeStatus) {
    setBusy(node.id)
    const r = await setFeatureNodeStatus(node.id, status)
    setBusy('')
    if (!r.ok) setError(r.error || 'Status change failed')
    await load(true)
  }

  async function changeParam(node: FeatureNodeItem, name: string, value: string) {
    setBusy(`${node.id}:${name}`)
    const r = await setFeatureParam(node.id, name, value)
    setBusy('')
    if (!r.ok) setError(r.error || 'Value change failed')
    await load(true)
  }

  const paramEditor = (node: FeatureNodeItem, p: FeatureParamItem) => {
    const value = node.values?.[p.name] ?? p.default ?? ''
    const busyKey = `${node.id}:${p.name}`
    if (p.type === 'choice') {
      return (
        <select className="deck-select" value={value} disabled={busy === busyKey}
          onChange={e => void changeParam(node, p.name, e.target.value)}>
          {(p.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (p.type === 'boolean') {
      return (
        <select className="deck-select" value={value || 'false'} disabled={busy === busyKey}
          onChange={e => void changeParam(node, p.name, e.target.value)}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )
    }
    if (p.type === 'color') {
      return (
        <span className="graph-param-color">
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} disabled={busy === busyKey}
            onChange={e => void changeParam(node, p.name, e.target.value)} />
          <span className="mono">{value}</span>
        </span>
      )
    }
    return (
      <input
        key={`${node.id}:${p.name}:${value}`}
        className="graph-param-input"
        type={p.type === 'number' ? 'number' : 'text'}
        defaultValue={value}
        disabled={busy === busyKey}
        onBlur={e => { if (e.target.value !== value) void changeParam(node, p.name, e.target.value) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    )
  }

  async function planFrom(selector: { nodeId?: string, packId?: string }) {
    setBusy('plan')
    setNotice('')
    const r = await planFromGraph(selector)
    setBusy('')
    if (!r.ok || !r.plan) { setError(r.error || 'Could not generate a plan from the graph'); return }
    setNotice(`Plan "${r.plan.title}" created (${r.plan.tasks.length} tasks${r.skippedBuilt ? `, ${r.skippedBuilt} already built` : ''}). Opening the planner…`)
    window.dispatchEvent(new CustomEvent('ai-live:plan-open', { detail: {} }))
  }

  const bar = (r: FeatureRollup) => (
    <div className="graph-bar"><div className="graph-bar-fill" style={{ width: `${r.pct}%` }} /></div>
  )

  const addFormEl = addForm ? (
    <div className="graph-add-form">
      <input
        className="graph-param-input"
        placeholder={addForm.kind === 'region' ? 'Region name' : 'Node name'}
        value={addForm.name}
        autoFocus
        onChange={e => setAddForm({ ...addForm, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter') void submitAddForm(); if (e.key === 'Escape') setAddForm(null) }}
      />
      <select
        className="deck-select"
        value={addForm.kind}
        onChange={e => setAddForm({ ...addForm, kind: e.target.value })}
      >
        {NODE_KINDS.filter(k => addForm.parentId ? k !== 'region' : true).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <button type="button" className="deck-btn" disabled={busy === 'add' || !addForm.name.trim()} onClick={() => void submitAddForm()}>Add</button>
      <button type="button" className="deck-btn" onClick={() => setAddForm(null)}>Cancel</button>
    </div>
  ) : null

  const renderNode = (node: FeatureNodeItem, depth: number): React.ReactNode => (
    <div key={node.id}>
      <button
        type="button"
        className={`graph-node${selectedId === node.id ? ' sel' : ''}${flash[node.id] ? ` flash-${flash[node.id]}` : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => setSelectedId(node.id)}
      >
        <span className="graph-mark" style={{ color: STATUS_COLOR[node.status] }}>{STATUS_MARK[node.status]}</span>
        <span className="graph-node-name">{node.name}</span>
        <span className="graph-chip">{node.kind}</span>
        {node.pack && <span className="graph-chip pack">{node.pack}</span>}
        {node.status === 'blocked' && <span className="graph-blocked">blocked</span>}
      </button>
      {childrenOf(node.id).map(child => renderNode(child, depth + 1))}
    </div>
  )

  const renderInspector = () => (
          <aside className="graph-rail">
            {selected ? (
              <>
                <input
                  key={`${selected.id}:${selected.name}`}
                  className="graph-insp-name-input"
                  defaultValue={selected.name}
                  disabled={busy === selected.id}
                  title="Rename — Enter or Tab to save"
                  onBlur={e => void rename(selected, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
                <div className="graph-insp-row">
                  <span className="graph-chip">{selected.kind}</span>
                  {selected.pack && <span className="graph-chip pack">{selected.pack}</span>}
                  {selected.derivedFrom && <span className="graph-chip">derived from {selected.derivedFrom}</span>}
                </div>
                <label className="graph-insp-label">Status
                  <select
                    className="deck-select"
                    value={selected.status}
                    disabled={busy === selected.id}
                    onChange={e => void changeStatus(selected, e.target.value as FeatureNodeStatus)}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="graph-insp-label">Inside
                  <select
                    className="deck-select"
                    value={selected.parent ?? ''}
                    disabled={busy === selected.id}
                    onChange={e => void reparent(selected, e.target.value)}
                    title="Which node contains this one — containment is the parent field"
                  >
                    <option value="">Top level</option>
                    {(graph?.nodes ?? []).filter(n => !descendantIds(selected.id).has(n.id)).map(n => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                </label>
                {(selected.component || selected.template) && (
                  <div className="graph-insp-block">
                    <div className="graph-insp-label">Built from</div>
                    {selected.component && <div className="graph-insp-line">component · <span className="mono">{selected.component}</span></div>}
                    {selected.template && <div className="graph-insp-line">template · <span className="mono">{selected.template}</span></div>}
                  </div>
                )}
                {selected.params && selected.params.length > 0 && (
                  <div className="graph-insp-block">
                    <div className="graph-insp-label">Parameters — written to src/config for the app</div>
                    {selected.params.map(p => (
                      <div key={p.name} className="graph-param-row">
                        <span className="mono">{p.name}</span>
                        {paramEditor(selected, p)}
                      </div>
                    ))}
                  </div>
                )}
                {selected.note && <div className="graph-insp-note">{selected.note}</div>}
                <div className="graph-insp-block">
                  <div className="graph-insp-label">Connections</div>
                  {connections(selected).map((c, i) => (
                    <div key={i} className="graph-conn-row">
                      <button type="button" className="graph-conn" onClick={() => setSelectedId(c.node.id)}>
                        <span className="graph-conn-label">{c.label}</span>
                        <span className="graph-mark" style={{ color: STATUS_COLOR[c.node.status] }}>{STATUS_MARK[c.node.status]}</span>
                        <span>{c.node.name}</span>
                      </button>
                      <button
                        type="button"
                        className="graph-conn-x"
                        disabled={busy === 'conn'}
                        title={`Remove this connection (${c.edge.type})`}
                        onClick={() => void removeConn(c)}
                      ><X size={11} /></button>
                    </div>
                  ))}
                  <div className="graph-add-conn">
                    <span className="graph-conn-this">{selected.name}</span>
                    <select className="deck-select" value={linkDraft.type} onChange={e => setLinkDraft({ ...linkDraft, type: e.target.value })}>
                      {EDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select className="deck-select" value={linkDraft.toId} onChange={e => setLinkDraft({ ...linkDraft, toId: e.target.value })}>
                      <option value="">Choose a node…</option>
                      {(graph?.nodes ?? []).filter(n => n.id !== selected.id).map(n => (
                        <option key={n.id} value={n.id}>{n.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="deck-btn"
                      disabled={busy === 'conn' || !linkDraft.toId}
                      onClick={() => void addConn(selected, linkDraft.toId, linkDraft.type)}
                    >Link</button>
                  </div>
                </div>
                <div className="graph-insp-actions">
                  <button type="button" className="deck-btn" disabled={busy === 'plan'} onClick={() => void planFrom({ nodeId: selected.id })}>Plan from this node</button>
                  {selected.pack && (
                    <button type="button" className="deck-btn" disabled={busy === 'plan'} onClick={() => void planFrom({ packId: selected.pack })}>Plan the {selected.pack} pack</button>
                  )}
                </div>
                <div className="graph-danger-row">
                  <button
                    type="button"
                    className="deck-btn"
                    disabled={busy === 'remove'}
                    title="Remove this node; its children move up to its parent"
                    onClick={() => void removeSelNode(selected, 'lift')}
                  >Remove — lift children</button>
                  <button
                    type="button"
                    className="deck-btn graph-danger"
                    disabled={busy === 'remove'}
                    title="Remove this node and everything inside it"
                    onClick={() => void removeSelNode(selected, 'cascade')}
                  >Remove subtree</button>
                </div>
              </>
            ) : (
              <>
                <div className="graph-insp-name">Overview</div>
                {problems.length > 0 && (
                  <div className="graph-insp-block">
                    <div className="graph-insp-label">Graph problems — ask the agent to run feature-lint</div>
                    {problems.map((p, i) => (
                      <button key={i} type="button" className="graph-conn" disabled={!p.nodeId}
                        onClick={() => { if (p.nodeId) setSelectedId(p.nodeId) }}>
                        <span className="graph-lint-kind">{p.kind}</span>
                        <span>{p.message}</span>
                      </button>
                    ))}
                  </div>
                )}
                {(graph.pendingLinks?.length ?? 0) > 0 && (
                  <div className="graph-insp-block">
                    <div className="graph-insp-label">Pending links — wire themselves when a matching node appears</div>
                    {(graph.pendingLinks ?? []).map((l, i) => (
                      <button key={i} type="button" className="graph-conn" onClick={() => setSelectedId(l.from)}>
                        <span className="graph-conn-label">{l.pack}</span>
                        <span>{l.role} — waiting for “{l.match}”</span>
                      </button>
                    ))}
                  </div>
                )}
                {drift.length > 0 && (
                  <div className="graph-insp-block">
                    <div className="graph-insp-label">Drift — marked built, but missing from the project</div>
                    {drift.map((d, i) => (
                      <button key={i} type="button" className="graph-conn" onClick={() => setSelectedId(d.nodeId)}>
                        <span className="graph-lint-kind">{d.binding}</span>
                        <span>{d.problem}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="graph-insp-line">Select a node to see its bindings, parameters and connections.</div>
                {(rollup?.regions ?? []).map(r => (
                  <button key={r.node.id} type="button" className="graph-conn" onClick={() => setSelectedId(r.node.id)}>
                    <span className="graph-conn-label">{r.rollup.pct}%</span>
                    <span>{r.node.name}</span>
                    <span className="graph-conn-count">{r.rollup.built}/{r.rollup.total}</span>
                  </button>
                ))}
                {graph.nodes.filter(n => n.status === 'blocked').length > 0 && (
                  <div className="graph-insp-block">
                    <div className="graph-insp-label">Blocked</div>
                    {graph.nodes.filter(n => n.status === 'blocked').map(n => (
                      <button key={n.id} type="button" className="graph-conn" onClick={() => setSelectedId(n.id)}>
                        <span className="graph-mark" style={{ color: STATUS_COLOR.blocked, display: 'inline-flex' }}><X size={12} aria-hidden /></span>
                        <span>{n.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </aside>
  )

  return (
    <div className="graph-overlay" role="dialog" aria-label="Feature graph" style={style}>
      <style>{GRAPH_CSS}</style>
      <div className="graph-head">
        <span className="graph-title">Feature graph</span>
        {graph && <span className="graph-subtitle">{graph.title}</span>}
        {onOpenReport && onOpenDiagram && (
          <span className="graph-view-switch" role="group" aria-label="Graph view">
            <button
              type="button"
              className={view === 'graph-report' ? 'on' : ''}
              onClick={onOpenReport}
              title="The report — tree-list navigation with connection links"
            >Report</button>
            <button
              type="button"
              className={view === 'graph-diagram' ? 'on' : ''}
              onClick={onOpenDiagram}
              title="The diagram — regions and features as a node-link diagram"
            >Diagram</button>
          </span>
        )}
        {view === 'graph-diagram' && (
          <span className="graph-view-switch" role="group" aria-label="Diagram layout">
            <button
              type="button"
              className={!canvasMode ? 'on' : ''}
              onClick={() => changeCanvasMode(false)}
              title="Flow — region boxes wrap inside the pane"
            >Flow</button>
            <button
              type="button"
              className={canvasMode ? 'on' : ''}
              onClick={() => changeCanvasMode(true)}
              title="Canvas — the infinite pannable canvas: drag the background to pan, drag regions and cards to arrange them"
            >Canvas</button>
          </span>
        )}
        {rollup && (
          <span className="graph-overall">
            {bar(rollup.overall)}
            <span>{rollup.overall.pct}% built · {rollup.overall.built}/{rollup.overall.total}{rollup.overall.blocked ? ` · ${rollup.overall.blocked} blocked` : ''}</span>
          </span>
        )}
        {problems.length > 0 && (
          <span className="graph-lint-badge" title="Structural problems in graph.json — see the overview panel">
            ⚠ {problems.length} graph problem{problems.length === 1 ? '' : 's'}
          </span>
        )}
        {graph && currency && (() => {
          const c = formatGraphCurrency(currency.sync, currency.head, currency.behind)
          return <span className={`graph-currency ${c.tone}`} title={c.title}>{c.text}</span>
        })()}
        <span className="graph-head-spacer" />
        {graph && graph.nodes.length > 0 && (
          <button
            type="button"
            className="deck-btn"
            onClick={() => launchGraphUpdate('feature')}
            title="Launches /graph-update feature — the agent reconciles the graph with the codebase, and each change lands here as it happens"
          >
            <Sparkles size={13} />Update graph
          </button>
        )}
        {onToggleExpand && (
          <button
            type="button"
            className="deck-btn"
            onClick={onToggleExpand}
            title={expanded ? 'Restore — show the chat again' : 'Expand over the chat — more room for the graph'}
            aria-label={expanded ? 'Restore the graph pane' : 'Expand the graph pane over the chat'}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
        <button type="button" className="deck-btn" onClick={() => void load()} title="Reload the graph"><RefreshCw size={13} /></button>
        <button type="button" className="deck-btn" onClick={onClose} aria-label="Close feature graph"><X size={14} /></button>
      </div>

      {error && <div className="graph-error">{error}</div>}
      {notice && <div className="graph-notice">{notice}</div>}
      {feed.length > 0 && (
        <div className="graph-feed" aria-label="Recent graph changes">
          {feed.map(f => (
            <div key={f.id} className="graph-feed-row"><span className="graph-feed-time mono">{f.time}</span><span>{f.text}</span></div>
          ))}
        </div>
      )}

      {!loaded ? (
        <div className="graph-empty">Loading the feature graph…</div>
      ) : !graph || graph.nodes.length === 0 ? (
        <div className="graph-empty">
          <p>No feature graph in this project yet.</p>
          <p>The graph is the durable map of the whole app — regions, features, settings, and how they configure each other. Have the agent build it from the codebase and watch it land here, node by node — or install a feature pack (Admin, Settings, Printing, Auth) and plan from it.</p>
          <div className="graph-empty-actions">
            <button type="button" className="deck-btn graph-build-btn" onClick={() => launchGraphUpdate('feature')}>
              <Sparkles size={13} />Build the graph
            </button>
            {onShowLibrary && <button type="button" className="deck-btn" onClick={onShowLibrary}>Open the Library</button>}
          </div>
          <p className="graph-cmd-hint mono">launches /graph-update feature</p>
          <p className="graph-cmd-note">/graph-update takes a target — feature is the first graph; others will use the same command.</p>
        </div>
      ) : view === 'graph-diagram' ? (
        <div className="graph-body">
          <div className="graph-diagram-wrap">
            {addForm && <div className="graph-diagram-add">{addFormEl}</div>}
            <GraphDiagram
              nodes={graph.nodes}
              edges={graph.edges}
              selectedId={selectedId}
              onSelect={setSelectedId}
              flash={flash}
              regionRollup={regionRollup}
              mode={canvasMode ? 'canvas' : 'flow'}
              onReparent={(id, parentId) => {
                const n = byId.get(id)
                if (n) void reparent(n, parentId ?? '')
              }}
              onAddNode={parentId => setAddForm({ parentId: parentId ?? '', name: '', kind: parentId ? 'feature' : 'region' })}
            />
          </div>
          {renderInspector()}
        </div>
      ) : (
        <div className="graph-body">
          <div className="graph-main">
            {regions.map(region => {
              const r = regionRollup.get(region.id)
              return (
                <section key={region.id} className="graph-region">
                  <div className="graph-region-head">
                    <button type="button" className="graph-region-name" onClick={() => setSelectedId(region.id)}>{region.name}</button>
                    {r && <span className="graph-region-roll">{bar(r)}<span>{r.pct}%</span></span>}
                    <button type="button" className="deck-btn" disabled={busy === 'plan'} onClick={() => void planFrom({ nodeId: region.id })}>Plan from here</button>
                    <button type="button" className="deck-btn" onClick={() => setAddForm({ parentId: region.id, name: '', kind: 'feature' })} title={`Add a node under ${region.name}`}><Plus size={12} />Add</button>
                  </div>
                  {addForm && addForm.parentId === region.id && addFormEl}
                  {childrenOf(region.id).map(n => renderNode(n, 0))}
                  {childrenOf(region.id).length === 0 && <div className="graph-region-empty">No features yet.</div>}
                </section>
              )
            })}
            {topLevel.length > 0 && (
              <section className="graph-region">
                <div className="graph-region-head"><span className="graph-region-name">Top level</span></div>
                {topLevel.map(n => renderNode(n, 0))}
              </section>
            )}
            <div className="graph-main-foot">
              {addForm && !addForm.parentId && addFormEl}
              {!addForm && (
                <button type="button" className="deck-btn" onClick={() => setAddForm({ parentId: '', name: '', kind: 'region' })}>
                  <Plus size={12} />Add a region or top-level node
                </button>
              )}
            </div>
          </div>

          {renderInspector()}
        </div>
      )}
    </div>
  )
}

const GRAPH_CSS = `
.graph-overlay { position:absolute; z-index:40; display:flex; flex-direction:column; background:var(--panel-bg); border:1px solid var(--border); border-radius:12px; box-shadow:0 18px 50px rgba(0,0,0,.55); overflow:hidden; color:var(--text); }
.graph-head { display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--border-soft); flex-wrap:wrap; }
.graph-title { font-weight:700; font-size:calc(14px * var(--ui-scale, 1)); }
.graph-subtitle { opacity:.65; font-size:calc(12.5px * var(--ui-scale, 1)); }
.graph-overall { display:flex; align-items:center; gap:8px; font-size:calc(12px * var(--ui-scale, 1)); opacity:.9; }
.graph-head-spacer { flex:1; }
.graph-bar { width:90px; height:6px; border-radius:3px; background:var(--border-soft); overflow:hidden; display:inline-block; vertical-align:middle; }
.graph-bar-fill { height:100%; background:var(--green); border-radius:3px; }
.graph-error { padding:8px 12px; color:var(--red-text); font-size:calc(12.5px * var(--ui-scale, 1)); border-bottom:1px solid var(--border-soft); }
.graph-notice { padding:8px 12px; color:var(--green-text); font-size:calc(12.5px * var(--ui-scale, 1)); border-bottom:1px solid var(--border-soft); }
.graph-empty { padding:22px; font-size:calc(13px * var(--ui-scale, 1)); line-height:1.55; opacity:.85; max-width:560px; }
.graph-body { display:flex; flex:1; min-height:0; }
.graph-main { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
.graph-region { border:1px solid var(--border-soft); border-radius:10px; padding:8px; }
.graph-region-head { display:flex; align-items:center; gap:10px; padding:2px 4px 8px; }
.graph-region-name { font-weight:700; font-size:calc(13.5px * var(--ui-scale, 1)); background:none; border:none; color:inherit; cursor:pointer; padding:0; text-align:left; }
.graph-region-roll { display:flex; align-items:center; gap:7px; font-size:calc(11.5px * var(--ui-scale, 1)); opacity:.85; margin-right:auto; }
.graph-region-empty { opacity:.55; font-size:calc(12px * var(--ui-scale, 1)); padding:2px 4px 4px; }
.graph-node { display:flex; align-items:center; gap:7px; width:100%; text-align:left; background:none; border:none; border-radius:6px; color:inherit; cursor:pointer; padding-top:4px; padding-bottom:4px; padding-right:6px; font-size:calc(12.5px * var(--ui-scale, 1)); }
.graph-node:hover { background:var(--border-soft); }
.graph-node.sel { background:var(--accent-soft-bg); }
.graph-mark { font-size:calc(11px * var(--ui-scale, 1)); width:14px; text-align:center; flex:none; }
.graph-node-name { font-weight:550; }
.graph-chip { font-size:calc(10.5px * var(--ui-scale, 1)); opacity:.65; border:1px solid var(--border-strong); border-radius:8px; padding:0 6px; }
.graph-chip.pack { opacity:.85; }
.graph-blocked { color:var(--red-text); font-size:calc(11px * var(--ui-scale, 1)); font-weight:600; }
.graph-rail { width:292px; flex:none; border-left:1px solid var(--border-soft); overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
.graph-insp-name { font-weight:700; font-size:calc(14px * var(--ui-scale, 1)); }
.graph-insp-row { display:flex; gap:6px; flex-wrap:wrap; }
.graph-insp-label { font-size:calc(11px * var(--ui-scale, 1)); text-transform:uppercase; letter-spacing:.05em; opacity:.6; display:flex; align-items:center; gap:8px; }
.graph-insp-block { display:flex; flex-direction:column; gap:5px; }
.graph-insp-line { font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.5; }
.graph-insp-note { font-size:calc(12.5px * var(--ui-scale, 1)); line-height:1.5; opacity:.8; font-style:italic; }
.graph-conn { display:flex; align-items:center; gap:7px; width:100%; text-align:left; background:none; border:none; border-radius:6px; color:inherit; cursor:pointer; padding:4px 6px; font-size:calc(12.5px * var(--ui-scale, 1)); }
.graph-conn:hover { background:var(--border-soft); }
.graph-conn-label { opacity:.6; font-size:calc(11.5px * var(--ui-scale, 1)); min-width:86px; }
.graph-conn-count { margin-left:auto; opacity:.6; }
.graph-insp-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:2px; }
.graph-param-row { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:calc(12.5px * var(--ui-scale, 1)); }
.graph-param-input { width:130px; background:var(--bg); color:inherit; border:1px solid var(--border-strong); border-radius:6px; padding:3px 7px; font-size:calc(12.5px * var(--ui-scale, 1)); }
.graph-param-color { display:flex; align-items:center; gap:7px; }
.graph-param-color input[type="color"] { width:34px; height:22px; padding:0; border:1px solid var(--border-strong); border-radius:5px; background:none; cursor:pointer; }
.graph-lint-badge { color:var(--amber-text); border:1px solid var(--amber); border-radius:9px; padding:1px 8px; font-size:calc(11.5px * var(--ui-scale, 1)); font-weight:600; }
.graph-view-switch { display:inline-flex; border:1px solid var(--border-strong); border-radius:8px; overflow:hidden; }
.graph-view-switch button { background:none; border:none; color:inherit; cursor:pointer; padding:3px 10px; font-size:calc(12px * var(--ui-scale, 1)); opacity:.65; font-family:inherit; }
.graph-view-switch button.on { background:var(--accent-soft-bg); opacity:1; font-weight:600; }
.graph-diagram-wrap { flex:1; min-width:0; display:flex; flex-direction:column; }
.graph-diagram-add { padding:10px 12px 0; }
.graph-currency { border:1px solid var(--border); border-radius:9px; padding:1px 8px; font-size:calc(11.5px * var(--ui-scale, 1)); color:var(--text-soft); white-space:nowrap; }
.graph-currency.ok { color:var(--green-text); border-color:var(--green); }
.graph-currency.warn { color:var(--amber-text); border-color:var(--amber); }
.graph-feed { border-bottom:1px solid var(--border-soft); padding:6px 12px; display:flex; flex-direction:column; gap:2px; max-height:104px; overflow-y:auto; background:var(--accent-soft-bg); }
.graph-feed-row { display:flex; gap:9px; font-size:calc(12px * var(--ui-scale, 1)); align-items:baseline; }
.graph-feed-time { opacity:.55; font-size:calc(11px * var(--ui-scale, 1)); flex:none; }
.graph-node.flash-added { animation:graph-flash-added 2.6s ease-out; }
.graph-node.flash-changed { animation:graph-flash-changed 2.6s ease-out; }
@keyframes graph-flash-added { 0% { background:var(--green); color:#fff; } 100% { background:transparent; } }
@keyframes graph-flash-changed { 0% { background:var(--amber); color:#111; } 100% { background:transparent; } }
.graph-bar-fill { transition:width .8s ease; }
.graph-empty-actions { display:flex; gap:8px; align-items:center; margin-top:12px; }
.graph-build-btn { background:var(--accent); color:#fff; border-color:var(--accent); font-weight:600; }
.graph-cmd-hint { margin-top:10px; opacity:.75; font-size:calc(12px * var(--ui-scale, 1)); }
.graph-cmd-note { opacity:.55; font-size:calc(12px * var(--ui-scale, 1)); }
.graph-add-form { display:flex; gap:6px; align-items:center; padding:6px 4px; flex-wrap:wrap; }
.graph-add-form .graph-param-input { width:170px; }
.graph-main-foot { padding:2px 4px; }
.graph-insp-name-input { font-weight:700; font-size:calc(14px * var(--ui-scale, 1)); background:var(--bg); color:inherit; border:1px solid var(--border-strong); border-radius:6px; padding:4px 8px; width:100%; box-sizing:border-box; font-family:inherit; }
.graph-conn-row { display:flex; align-items:center; gap:2px; }
.graph-conn-row .graph-conn { flex:1; }
.graph-conn-x { background:none; border:none; color:inherit; opacity:.55; cursor:pointer; padding:3px; border-radius:5px; display:inline-flex; }
.graph-conn-x:hover { opacity:1; background:var(--border-soft); color:var(--red-text); }
.graph-add-conn { display:flex; gap:5px; align-items:center; flex-wrap:wrap; margin-top:3px; }
.graph-conn-this { font-size:calc(12px * var(--ui-scale, 1)); font-weight:600; max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.graph-danger-row { display:flex; gap:6px; flex-wrap:wrap; border-top:1px solid var(--border-soft); padding-top:10px; }
.graph-danger:hover { color:var(--red-text); border-color:var(--red); }
.graph-lint-kind { color:var(--amber-text); font-size:calc(11px * var(--ui-scale, 1)); min-width:86px; }
.graph-overlay .mono { font-family:monospace; }
`
