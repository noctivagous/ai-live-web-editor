import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  DIAGRAM_CARD_H, DIAGRAM_CARD_W, diagramAnchors, diagramCanvasLayout, diagramContentBounds, diagramEdgeMid,
  diagramEdgePath, diagramFitView, diagramGroups, diagramRegionAt, diagramZoomAt, diagramZoomStep,
  type DiagramBox, type DiagramEdge, type DiagramNode, type DiagramPoint, type DiagramView,
} from '../lib/graphDiagram'

/**
 * The node-link diagram — a general resource for any durable
 * graph in the { nodes, edges } shape (lib/graphDiagram). Region
 * nodes become boxes, their contents become cards, and the typed
 * edges are drawn as curves between the cards; the edges touching
 * the selection light up and carry their type labels. Cards can
 * be dragged onto another region box to reparent (the caller
 * persists it through its own store), and selection is shared
 * with whatever inspector the caller renders beside the canvas —
 * for the feature graph, the graph pane's rail.
 *
 * Two layouts, one component (the pane header carries the
 * Flow | Canvas toggle):
 *  - Flow: region boxes wrap inside the pane and cards grid
 *    within them — the compact in-pane arrangement.
 *  - Canvas: the infinite pannable, zoomable surface — the
 *    prototype's view model exactly ({ x, y, k }, world rendered
 *    translate + scale). Regions and cards sit at free world
 *    coordinates (seeded deterministically by diagramCanvasLayout;
 *    the store keeps no coordinates, so moves live for the
 *    session). Drag the background to pan; the scroll wheel
 *    zooms to the cursor (clamped 0.2–2.5) and the corner cluster
 *    steps zoom by 1.2, reads the percentage, and Fits the whole
 *    graph into view; drag a region's header to move the region
 *    with its cards; drag a card to move it, dropping it over
 *    another region to reparent, exactly as in Flow. All drag
 *    and edge math runs in world coordinates, so it is exact at
 *    any zoom.
 *
 * The component is presentational: it owns layout, drawing and
 * drag gestures, never storage. A future facet (architecture,
 * data) reuses it by passing its own nodes, edges, status colors
 * and callbacks.
 */

export const DIAGRAM_STATUS_COLORS: Record<string, string> = {
  proposed: 'var(--text-muted, #8a8a8c)',
  planned: 'var(--blue)',
  building: 'var(--amber)',
  done: 'var(--green)',
  verified: 'var(--green)',
  blocked: 'var(--red)',
  dropped: 'var(--text-muted, #8a8a8c)',
}

export interface DiagramRollup { pct: number, built: number, total: number }
export type DiagramMode = 'flow' | 'canvas'

interface DrawnEdge {
  key: string
  d: string
  type: string
  active: boolean
  label?: { x: number, y: number }
}

/** Run window pointer handlers for one gesture; removes itself on up. */
function trackPointer(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) {
  const move = (e: PointerEvent) => onMove(e)
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onUp(e)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

export function GraphDiagram({ nodes, edges, selectedId, onSelect, flash, regionRollup, statusColor, onReparent, onAddNode, mode = 'flow' }: {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  flash?: Record<string, 'added' | 'changed'>
  regionRollup?: Map<string, DiagramRollup>
  statusColor?: (status: string) => string
  onReparent?: (nodeId: string, parentId: string | undefined) => void
  onAddNode?: (parentId: string | undefined) => void
  mode?: DiagramMode
}) {
  const colorOf = statusColor ?? ((s: string) => DIAGRAM_STATUS_COLORS[s] ?? 'var(--text-muted, #8a8a8c)')
  const groups = useMemo(() => diagramGroups(nodes), [nodes])
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const groupOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups) for (const n of g.nodes) m.set(n.id, g.region?.id ?? '')
    return m
  }, [groups])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const regionRefs = useRef(new Map<string, HTMLElement>())
  const [drawn, setDrawn] = useState<DrawnEdge[]>([])
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const measureSigRef = useRef('')

  // Flow-mode drag (floating clone + DOM hit test).
  const [drag, setDrag] = useState<{ id: string, x: number, y: number, w: number, dx: number, dy: number } | null>(null)
  const [dropRegion, setDropRegion] = useState<string | null>(null)
  const dragRef = useRef<{ id: string, startX: number, startY: number, active: boolean } | null>(null)

  // Canvas-mode world state: the view (pan + zoom), region
  // boxes, card positions.
  const [view, setView] = useState<DiagramView>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [panning, setPanning] = useState(false)
  const [regionBox, setRegionBox] = useState<Record<string, DiagramBox>>({})
  const [cardPos, setCardPos] = useState<Record<string, DiagramPoint>>({})
  const groupOfRef = useRef(new Map<string, string>())
  const groupsSig = useMemo(
    () => groups.map(g => `${g.region?.id ?? ''}:${g.nodes.map(n => n.id).join(',')}`).join('|'),
    [groups],
  )

  // Seed canvas positions: new regions/cards take the deterministic
  // layout; existing ones keep the user's moves (region boxes keep
  // their position, take the layout's size); a card whose group
  // changed (reparented from the inspector) re-seeds into its new
  // region. Runs when the graph structure or the mode changes.
  useEffect(() => {
    if (mode !== 'canvas') return
    const layout = diagramCanvasLayout(groups)
    setRegionBox(prev => {
      const next: Record<string, DiagramBox> = {}
      for (const [key, box] of Object.entries(layout.regions)) {
        next[key] = prev[key] ? { ...box, x: prev[key].x, y: prev[key].y } : box
      }
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
    })
    setCardPos(prev => {
      const next: Record<string, DiagramPoint> = {}
      for (const g of groups) {
        const rid = g.region?.id ?? ''
        for (const n of g.nodes) {
          next[n.id] = prev[n.id] && groupOfRef.current.get(n.id) === rid ? prev[n.id] : layout.cards[n.id]
        }
      }
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
    })
    groupOfRef.current = groupOf
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, groupsSig])

  const worldSize = useMemo(() => {
    let w = 1200
    let h = 800
    for (const b of Object.values(regionBox)) { w = Math.max(w, b.x + b.w + 240); h = Math.max(h, b.y + b.h + 240) }
    for (const p of Object.values(cardPos)) { w = Math.max(w, p.x + DIAGRAM_CARD_W + 240); h = Math.max(h, p.y + DIAGRAM_CARD_H + 240) }
    return { w, h }
  }, [regionBox, cardPos])

  /** Recompute every edge path from the cards' measured positions,
   * relative to the coordinate parent (flow content, or the canvas
   * world — its rect already includes the view transform, and
   * dividing out the scale yields world geometry, so edges are
   * pan- and zoom-invariant). Runs after every render and on
   * scroll/resize — so it only writes state when the geometry
   * actually changed, or the setState would retrigger the render
   * it serves, forever. */
  function measure() {
    const content = contentRef.current
    if (!content) return
    const base = content.getBoundingClientRect()
    const k = mode === 'canvas' ? viewRef.current.k : 1
    const rectOf = (id: string) => {
      const el = cardRefs.current.get(id)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: (r.left - base.left) / k, top: (r.top - base.top) / k, width: r.width / k, height: r.height / k }
    }
    const out: DrawnEdge[] = []
    for (const e of edges) {
      const a = rectOf(e.from)
      const b = rectOf(e.to)
      if (!a || !b) continue
      const { from, to } = diagramAnchors(a, b)
      const active = selectedId !== null && (e.from === selectedId || e.to === selectedId)
      out.push({
        key: `${e.from}|${e.to}|${e.type}`,
        d: diagramEdgePath(from, to),
        type: e.type,
        active,
        ...(active ? { label: diagramEdgeMid(from, to) } : {}),
      })
    }
    const size = { w: content.scrollWidth, h: content.scrollHeight }
    const sig = JSON.stringify([size, out])
    if (sig === measureSigRef.current) return
    measureSigRef.current = sig
    setCanvasSize(size)
    setDrawn(out)
  }

  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(content)
    scroll.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      scroll.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  /* ── Flow-mode card drag ─────────────────────────────────── */
  function startFlowDrag(node: DiagramNode, e: React.PointerEvent) {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    dragRef.current = { id: node.id, startX, startY, active: false }
    const hitRegion = (ev: PointerEvent): string | null => {
      for (const [rid, el] of regionRefs.current) {
        const r = el.getBoundingClientRect()
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return rid
      }
      return null
    }
    trackPointer(
      ev => {
        const d = dragRef.current
        if (!d || d.id !== node.id) return
        if (!d.active) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
          d.active = true
          const r = cardRefs.current.get(node.id)?.getBoundingClientRect()
          setDrag({ id: node.id, x: ev.clientX, y: ev.clientY, w: r?.width ?? DIAGRAM_CARD_W, dx: r ? startX - r.left : 0, dy: r ? startY - r.top : 0 })
        }
        setDrag(prev => (prev ? { ...prev, x: ev.clientX, y: ev.clientY } : prev))
        setDropRegion(hitRegion(ev))
      },
      ev => {
        const d = dragRef.current
        dragRef.current = null
        if (d?.active) {
          const target = hitRegion(ev)
          if (target !== null && target !== (groupOf.get(node.id) ?? '')) {
            onReparent?.(node.id, target === '' ? undefined : target)
          }
        }
        onSelect(node.id)
        setDrag(null)
        setDropRegion(null)
      },
    )
  }

  /* ── Canvas-mode gestures ────────────────────────────────── */
  /** Client point → world coordinates: the world rect already
   * carries the view transform, so subtract and divide out k. */
  function worldPoint(e: PointerEvent | React.PointerEvent): DiagramPoint {
    const world = contentRef.current
    if (!world) return { x: 0, y: 0 }
    const r = world.getBoundingClientRect()
    const k = viewRef.current.k
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }
  }

  function startPan(e: React.PointerEvent) {
    if (e.button !== 0 || mode !== 'canvas') return
    const target = e.target as HTMLElement
    if (target.closest('.gd-card, .gd-region-head, button, input, select')) return
    const startView = { ...viewRef.current }
    const start = { x: e.clientX, y: e.clientY }
    setPanning(true)
    trackPointer(
      ev => setView(v => ({ ...v, x: startView.x + ev.clientX - start.x, y: startView.y + ev.clientY - start.y })),
      () => setPanning(false),
    )
  }

  // Wheel = zoom to the cursor, the prototype's way. A native
  // non-passive listener: React's synthetic wheel can't reliably
  // preventDefault, and the page must not scroll while zooming.
  useEffect(() => {
    if (mode !== 'canvas') return
    const viewport = scrollRef.current
    if (!viewport) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      setView(v => diagramZoomAt(v, at, e.deltaY < 0 ? 1.1 : 0.9))
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [mode])

  function fitView() {
    const viewport = scrollRef.current
    if (!viewport) return
    setView(diagramFitView(diagramContentBounds(regionBox, cardPos), viewport.clientWidth, viewport.clientHeight))
  }

  function startRegionDrag(rid: string, e: React.PointerEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    e.stopPropagation()
    const startWorld = worldPoint(e)
    const origBox = regionBox[rid]
    if (!origBox) return
    const members = (groups.find(g => (g.region?.id ?? '') === rid)?.nodes ?? []).map(n => n.id)
    const origCards = new Map(members.map(id => [id, cardPos[id]] as const).filter(([, p]) => !!p))
    trackPointer(
      ev => {
        const wp = worldPoint(ev)
        const dx = wp.x - startWorld.x
        const dy = wp.y - startWorld.y
        setRegionBox(prev => (prev[rid] ? { ...prev, [rid]: { ...prev[rid], x: origBox.x + dx, y: origBox.y + dy } } : prev))
        setCardPos(prev => {
          const next = { ...prev }
          for (const [id, p] of origCards) next[id] = { x: p.x + dx, y: p.y + dy }
          return next
        })
      },
      () => {},
    )
  }

  function startCanvasDrag(node: DiagramNode, e: React.PointerEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    const startWorld = worldPoint(e)
    const orig = cardPos[node.id]
    if (!orig) { onSelect(node.id); return }
    const offset = { x: startWorld.x - orig.x, y: startWorld.y - orig.y }
    let moved = false
    let lastPos = orig
    trackPointer(
      ev => {
        const wp = worldPoint(ev)
        if (!moved && Math.hypot(wp.x - startWorld.x, wp.y - startWorld.y) < 4) return
        moved = true
        lastPos = { x: Math.max(2, wp.x - offset.x), y: Math.max(2, wp.y - offset.y) }
        setCardPos(prev => ({ ...prev, [node.id]: lastPos }))
        setDropRegion(diagramRegionAt(regionBox, lastPos.x + DIAGRAM_CARD_W / 2, lastPos.y + DIAGRAM_CARD_H / 2))
      },
      () => {
        if (moved) {
          const center = { x: lastPos.x + DIAGRAM_CARD_W / 2, y: lastPos.y + DIAGRAM_CARD_H / 2 }
          const target = diagramRegionAt(regionBox, center.x, center.y)
          if (target !== null && target !== (groupOf.get(node.id) ?? '')) {
            onReparent?.(node.id, target === '' ? undefined : target)
          }
        }
        onSelect(node.id)
        setDropRegion(null)
      },
    )
  }

  const cardEl = (node: DiagramNode, style?: React.CSSProperties) => (
    <div
      key={node.id}
      role="button"
      tabIndex={0}
      ref={el => { if (el) cardRefs.current.set(node.id, el); else cardRefs.current.delete(node.id) }}
      className={`gd-card${selectedId === node.id ? ' sel' : ''}${flash?.[node.id] ? ` flash-${flash[node.id]}` : ''}${drag?.id === node.id ? ' dragging' : ''}`}
      style={style}
      onPointerDown={e => { if (mode === 'canvas') startCanvasDrag(node, e); else startFlowDrag(node, e) }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node.id) } }}
      title={`${node.name} — drag onto another region to move it`}
    >
      <span className="gd-card-main">
        <span className="gd-dot" style={{ background: colorOf(node.status) }} />
        <span className="gd-card-name">{node.name}</span>
      </span>
      <span className="gd-card-sub">
        <span className="gd-chip">{node.kind}</span>
        <span className="gd-status">{node.status}</span>
        {node.status === 'blocked' && <span className="gd-blocked">blocked</span>}
      </span>
    </div>
  )

  const regionHead = (g: (typeof groups)[number]) => {
    const roll = g.region ? regionRollup?.get(g.region.id) : undefined
    return (
      <div
        className="gd-region-head"
        onPointerDown={mode === 'canvas' && g.region ? e => startRegionDrag(g.region!.id, e) : undefined}
        title={mode === 'canvas' && g.region ? 'Drag to move this region' : undefined}
      >
        {g.region ? (
          <button type="button" className="gd-region-name" onClick={() => onSelect(g.region!.id)}>{g.region.name}</button>
        ) : (
          <span className="gd-region-name">Top level</span>
        )}
        {roll && (
          <span className="gd-region-roll">
            <span className="gd-bar"><span className="gd-bar-fill" style={{ width: `${roll.pct}%` }} /></span>
            <span>{roll.pct}%</span>
          </span>
        )}
        {onAddNode && (
          <button
            type="button"
            className="deck-btn gd-add"
            title={g.region ? `Add a node under ${g.region.name}` : 'Add a top-level node or region'}
            onClick={() => onAddNode(g.region?.id)}
          ><Plus size={12} />Add</button>
        )}
      </div>
    )
  }

  const edgeSvg = (w: number, h: number) => (
    <svg className="gd-edges" width={w} height={h} aria-hidden>
      {drawn.map(ed => (
        <path key={ed.key} d={ed.d} className={ed.active ? 'gd-edge active' : 'gd-edge'} />
      ))}
      {drawn.filter(ed => ed.active && ed.label).map(ed => (
        <text key={`${ed.key}:label`} x={ed.label!.x} y={ed.label!.y - 4} className="gd-edge-label">{ed.type}</text>
      ))}
    </svg>
  )

  if (mode === 'canvas') {
    return (
      <div
        className={`gd-viewport${panning ? ' panning' : ''}`}
        ref={scrollRef}
        onPointerDown={startPan}
        onClick={e => { if (e.target === e.currentTarget) onSelect(null) }}
      >
        <style>{DIAGRAM_CSS}</style>
        <div
          className="gd-world"
          ref={contentRef}
          style={{ width: worldSize.w, height: worldSize.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          {edgeSvg(worldSize.w, worldSize.h)}
          {groups.map(g => {
            const rid = g.region?.id ?? ''
            const box = regionBox[rid]
            if (!box) return null
            return (
              <section
                key={rid || 'top'}
                className={`gd-region canvas${dropRegion === rid ? ' drop' : ''}`}
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              >
                {regionHead(g)}
                {g.nodes.length === 0 && <div className="gd-region-empty">No features yet.</div>}
              </section>
            )
          })}
          {groups.flatMap(g => g.nodes.map(node => {
            const p = cardPos[node.id]
            if (!p) return null
            return cardEl(node, { position: 'absolute', left: p.x, top: p.y })
          }))}
        </div>
        <div className="gd-view-controls" role="group" aria-label="Canvas zoom">
          <button type="button" className="deck-btn" onClick={() => setView(v => diagramZoomStep(v, -1))} title="Zoom out">−</button>
          <span className="gd-zoom-pct mono" aria-label="Zoom level">{Math.round(view.k * 100)}%</span>
          <button type="button" className="deck-btn" onClick={() => setView(v => diagramZoomStep(v, 1))} title="Zoom in">+</button>
          <button type="button" className="deck-btn" onClick={fitView} title="Fit the whole graph in the view">Fit</button>
        </div>
      </div>
    )
  }

  const dragNode = drag ? byId.get(drag.id) : undefined
  return (
    <div className="gd-scroll" ref={scrollRef}>
      <style>{DIAGRAM_CSS}</style>
      <div
        className="gd-content"
        ref={contentRef}
        onClick={e => { if (e.target === e.currentTarget) onSelect(null) }}
      >
        {edgeSvg(canvasSize.w, canvasSize.h)}
        {groups.map(g => {
          const rid = g.region?.id ?? ''
          return (
            <section
              key={rid || 'top'}
              className={`gd-region${dropRegion === rid && drag ? ' drop' : ''}`}
              ref={el => { if (el) regionRefs.current.set(rid, el); else regionRefs.current.delete(rid) }}
            >
              {regionHead(g)}
              <div className="gd-cards">
                {g.nodes.map(node => cardEl(node))}
                {g.nodes.length === 0 && <div className="gd-region-empty">No features yet.</div>}
              </div>
            </section>
          )
        })}
      </div>
      {drag && dragNode && (
        <div className="gd-clone" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          <span className="gd-dot" style={{ background: colorOf(dragNode.status) }} />
          <span className="gd-card-name">{dragNode.name}</span>
          <span className="gd-chip">{dragNode.kind}</span>
        </div>
      )}
    </div>
  )
}

const DIAGRAM_CSS = `
.gd-scroll { flex:1; min-height:0; overflow:auto; position:relative; }
.gd-content { position:relative; display:flex; flex-wrap:wrap; gap:12px; align-content:flex-start; padding:12px; min-height:100%; box-sizing:border-box; }
.gd-viewport { flex:1; min-height:0; overflow:hidden; position:relative; cursor:grab; background:radial-gradient(circle, var(--border-soft) 1px, transparent 1px); background-size:24px 24px; }
.gd-viewport.panning { cursor:grabbing; }
.gd-world { position:absolute; left:0; top:0; transform-origin:0 0; }
.gd-view-controls { position:absolute; right:10px; bottom:10px; z-index:5; display:flex; align-items:center; gap:5px; background:var(--panel-bg); border:1px solid var(--border-strong); border-radius:8px; padding:4px 6px; box-shadow:0 6px 18px rgba(0,0,0,.25); }
.gd-zoom-pct { font-size:calc(12px * var(--ui-scale, 1)); min-width:40px; text-align:center; opacity:.85; }
.gd-viewport .mono { font-family:monospace; }
.gd-edges { position:absolute; left:0; top:0; pointer-events:none; z-index:1; overflow:visible; }
.gd-edge { fill:none; stroke:var(--border-strong); stroke-width:1.2; opacity:.55; }
.gd-edge.active { stroke:var(--accent); stroke-width:1.8; opacity:1; }
.gd-edge-label { fill:var(--accent); font-size:calc(10.5px * var(--ui-scale, 1)); font-weight:600; text-anchor:middle; paint-order:stroke; stroke:var(--panel-bg); stroke-width:3px; }
.gd-region { flex:1 1 250px; max-width:560px; border:1px solid var(--border-soft); border-radius:10px; padding:8px; position:relative; z-index:0; background:color-mix(in srgb, var(--bg) 45%, transparent); }
.gd-region.canvas { position:absolute; flex:none; max-width:none; box-sizing:border-box; }
.gd-region.drop { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft-bg); }
.gd-region-head { display:flex; align-items:center; gap:9px; padding:2px 4px 8px; }
.gd-region.canvas .gd-region-head { cursor:grab; }
.gd-region-name { font-weight:700; font-size:calc(13.5px * var(--ui-scale, 1)); background:none; border:none; color:inherit; cursor:pointer; padding:0; text-align:left; }
span.gd-region-name { cursor:default; }
.gd-region-roll { display:flex; align-items:center; gap:7px; font-size:calc(11.5px * var(--ui-scale, 1)); opacity:.85; margin-right:auto; }
.gd-bar { width:64px; height:6px; border-radius:3px; background:var(--border-soft); overflow:hidden; display:inline-block; }
.gd-bar-fill { display:block; height:100%; background:var(--green); border-radius:3px; transition:width .8s ease; }
.gd-add { margin-left:auto; }
.gd-region-roll + .gd-add { margin-left:0; }
.gd-cards { display:flex; flex-wrap:wrap; gap:8px; position:relative; z-index:2; }
.gd-card { display:flex; flex-direction:column; align-items:stretch; gap:3px; width:164px; box-sizing:border-box; padding:7px 9px; border:1px solid var(--border-strong); border-radius:8px; background:var(--panel-bg); cursor:grab; user-select:none; -webkit-user-select:none; touch-action:none; position:relative; z-index:2; }
.gd-card:hover { border-color:var(--accent); }
.gd-card.sel { border-color:var(--accent); background:var(--accent-soft-bg); box-shadow:0 0 0 1px var(--accent); }
.gd-card.dragging { opacity:.35; }
.gd-card.flash-added { animation:gd-flash-added 2.6s ease-out; }
.gd-card.flash-changed { animation:gd-flash-changed 2.6s ease-out; }
@keyframes gd-flash-added { 0% { background:var(--green); color:#fff; } 100% { } }
@keyframes gd-flash-changed { 0% { background:var(--amber); color:#111; } 100% { } }
.gd-card-main { display:flex; align-items:center; gap:7px; }
.gd-card-sub { display:flex; align-items:center; gap:6px; }
.gd-status { font-size:calc(10.5px * var(--ui-scale, 1)); opacity:.6; }
.gd-dot { width:9px; height:9px; border-radius:50%; flex:none; }
.gd-card-name { font-weight:550; font-size:calc(12.5px * var(--ui-scale, 1)); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
.gd-chip { font-size:calc(10.5px * var(--ui-scale, 1)); opacity:.65; border:1px solid var(--border-strong); border-radius:8px; padding:0 6px; flex:none; }
.gd-blocked { color:var(--red-text); font-size:calc(11px * var(--ui-scale, 1)); font-weight:600; }
.gd-region-empty { opacity:.55; font-size:calc(12px * var(--ui-scale, 1)); padding:2px 4px 4px; }
.gd-clone { position:fixed; z-index:80; display:flex; align-items:center; gap:7px; box-sizing:border-box; padding:7px 9px; border:1px solid var(--accent); border-radius:8px; background:var(--panel-bg); box-shadow:0 10px 26px rgba(0,0,0,.45); pointer-events:none; }
`
