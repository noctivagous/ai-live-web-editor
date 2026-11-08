/**
 * The node-link diagram's data model and geometry — a general
 * resource, deliberately graph-agnostic. Any facet that keeps a
 * durable graph in the { nodes, edges } shape (id / name / kind /
 * status / parent containment + typed edges) can render it as a
 * spatial diagram: the feature graph is the first consumer
 * (#/facets/features/graph/diagram); an architecture or data
 * graph plugs in by handing over its own nodes and edges.
 *
 * Containment is the parent field, edges are the typed links —
 * the same model the feature store uses. A "region" is any node
 * of kind 'region'; every other node belongs to the box of its
 * nearest region ancestor, or to the top-level box when it has
 * none. The view component (components/GraphDiagram) owns the
 * DOM; everything here is pure and testable.
 */

export interface DiagramNode {
  id: string
  name: string
  kind: string
  status: string
  parent?: string
}

export interface DiagramEdge {
  from: string
  to: string
  type: string
}

export interface DiagramGroup {
  /** The region node, or null for the top-level box. */
  region: DiagramNode | null
  nodes: DiagramNode[]
}

/** Group nodes into region boxes. Regions keep their input
 * order; each non-region node lands in its nearest region
 * ancestor's box (nested children flatten into the region),
 * or the top-level box when it has no region ancestor. Region
 * nodes themselves are boxes, never cards. */
export function diagramGroups(nodes: DiagramNode[]): DiagramGroup[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const regions = nodes.filter(n => n.kind === 'region')
  const groups = new Map<string, DiagramGroup>(regions.map(r => [r.id, { region: r, nodes: [] }]))
  const top: DiagramGroup = { region: null, nodes: [] }
  const regionOf = (node: DiagramNode): string | null => {
    let cur: DiagramNode | undefined = node
    const seen = new Set<string>()
    while (cur?.parent && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = byId.get(cur.parent)
      if (cur?.kind === 'region') return cur.id
    }
    return null
  }
  for (const n of nodes) {
    if (n.kind === 'region') continue
    const rid = regionOf(n)
    if (rid && groups.has(rid)) groups.get(rid)!.nodes.push(n)
    else top.nodes.push(n)
  }
  const out = [...groups.values()]
  if (top.nodes.length) out.push(top)
  return out
}

/** Edges touching a node, in either direction. */
export function diagramEdgesFor(edges: DiagramEdge[], id: string): DiagramEdge[] {
  return edges.filter(e => e.from === id || e.to === id)
}

export interface DiagramPoint { x: number, y: number }

/** A horizontal cubic between two card anchor points, bowing
 * with distance so near cards get a shallow curve and far ones
 * a sweeping one. */
export function diagramEdgePath(a: DiagramPoint, b: DiagramPoint): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2)
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

/** The point at t = 0.5 on the same cubic — where the type
 * label sits for a highlighted edge. */
export function diagramEdgeMid(a: DiagramPoint, b: DiagramPoint): DiagramPoint {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2)
  const c1 = { x: a.x + dx, y: a.y }
  const c2 = { x: b.x - dx, y: b.y }
  const t = 0.5
  const mt = 1 - t
  return {
    x: mt ** 3 * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * b.x,
    y: mt ** 3 * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * b.y,
  }
}

/* ── Canvas mode ──────────────────────────────────────────────
 * The pannable canvas places regions and cards at free world
 * coordinates. The store keeps no coordinates, so the canvas
 * seeds them deterministically (below) and the view keeps the
 * user's moves for the session. */

export const DIAGRAM_CARD_W = 164
export const DIAGRAM_CARD_H = 54
const CANVAS_PAD = 8
const CANVAS_HEADER = 38
const CANVAS_GAP = 8
const CANVAS_REGION_GAP = 28
const CANVAS_ROW_WIDTH = 1500
const CANVAS_ORIGIN = 32

export interface DiagramBox { x: number, y: number, w: number, h: number }

/** Deterministic seed layout for canvas mode: regions flow
 * left→right in rows from the origin, widening with their card
 * count; cards grid inside their region under its header. */
export function diagramCanvasLayout(groups: DiagramGroup[]): { regions: Record<string, DiagramBox>, cards: Record<string, DiagramPoint> } {
  const regions: Record<string, DiagramBox> = {}
  const cards: Record<string, DiagramPoint> = {}
  let x = CANVAS_ORIGIN
  let y = CANVAS_ORIGIN
  let rowH = 0
  for (const g of groups) {
    const count = g.nodes.length
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3
    const rows = Math.max(1, Math.ceil(count / cols))
    // A floor of 250 keeps the header (name + rollup + Add) on one line.
    const w = Math.max(250, CANVAS_PAD * 2 + cols * DIAGRAM_CARD_W + (cols - 1) * CANVAS_GAP)
    const h = CANVAS_HEADER + rows * DIAGRAM_CARD_H + (rows - 1) * CANVAS_GAP + CANVAS_PAD
    if (x + w > CANVAS_ROW_WIDTH && x > CANVAS_ORIGIN) {
      x = CANVAS_ORIGIN
      y += rowH + CANVAS_REGION_GAP
      rowH = 0
    }
    const key = g.region?.id ?? ''
    regions[key] = { x, y, w, h }
    g.nodes.forEach((node, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      cards[node.id] = {
        x: x + CANVAS_PAD + col * (DIAGRAM_CARD_W + CANVAS_GAP),
        y: y + CANVAS_HEADER + row * (DIAGRAM_CARD_H + CANVAS_GAP),
      }
    })
    x += w + CANVAS_REGION_GAP
    rowH = Math.max(rowH, h)
  }
  return { regions, cards }
}

/* ── Canvas view (pan / zoom) ─────────────────────────────────
 * The view is { x, y, k }: the world renders as
 * translate(x, y) scale(k) with transform-origin 0 0. The
 * formulas are the Feature Graph Pane prototype's, kept exact:
 * wheel zoom anchors at the cursor (the world point under it
 * stays put), buttons step k by 1.2 without re-anchoring, and
 * Fit scales the content bounds into the viewport. */

export interface DiagramView { x: number, y: number, k: number }
export const DIAGRAM_ZOOM_MIN = 0.2
export const DIAGRAM_ZOOM_MAX = 2.5

const clampZoom = (k: number) => Math.min(DIAGRAM_ZOOM_MAX, Math.max(DIAGRAM_ZOOM_MIN, k))

/** Zoom by a factor around a viewport point (the cursor):
 * the world point under it does not move on screen. */
export function diagramZoomAt(view: DiagramView, at: DiagramPoint, factor: number): DiagramView {
  const k = clampZoom(view.k * factor)
  if (k === view.k) return view
  const ratio = k / view.k
  return { x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio, k }
}

/** The + / − buttons: step k by 1.2, position untouched. */
export function diagramZoomStep(view: DiagramView, dir: 1 | -1): DiagramView {
  return { ...view, k: clampZoom(view.k * (dir > 0 ? 1.2 : 1 / 1.2)) }
}

/** The union of every region box and card, in world coords. */
export function diagramContentBounds(regions: Record<string, DiagramBox>, cards: Record<string, DiagramPoint>): DiagramBox {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const b of Object.values(regions)) {
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h)
  }
  for (const p of Object.values(cards)) {
    x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y)
    x2 = Math.max(x2, p.x + DIAGRAM_CARD_W); y2 = Math.max(y2, p.y + DIAGRAM_CARD_H)
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, w: 800, h: 600 }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Fit bounds into a viewport: scale (never above 1.15,
 * never below the zoom floor) and center. */
export function diagramFitView(bounds: DiagramBox, vw: number, vh: number): DiagramView {
  const k = Math.max(Math.min(vw / (bounds.w + 48), vh / (bounds.h + 48), 1.15), DIAGRAM_ZOOM_MIN)
  return {
    x: (vw - bounds.w * k) / 2 - bounds.x * k,
    y: (vh - bounds.h * k) / 2 - bounds.y * k,
    k,
  }
}

/** Which region box contains a world point (the drop test).
 * Overlapping boxes resolve to the smallest one; the empty
 * string key is the top-level box. Null when over bare canvas. */
export function diagramRegionAt(regions: Record<string, DiagramBox>, x: number, y: number): string | null {
  let best: string | null = null
  let bestArea = Infinity
  for (const [key, b] of Object.entries(regions)) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      const area = b.w * b.h
      if (area < bestArea) { bestArea = area; best = key }
    }
  }
  return best
}

/** Anchor points for an edge between two card rectangles
 * (content-relative): right edge of the left card to left edge
 * of the right card, at mid height — so edges read left→right
 * whichever card is the source. */
export function diagramAnchors(
  a: { left: number, top: number, width: number, height: number },
  b: { left: number, top: number, width: number, height: number },
): { from: DiagramPoint, to: DiagramPoint } {
  const aC = { x: a.left + a.width / 2, y: a.top + a.height / 2 }
  const bC = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  if (bC.x >= aC.x) {
    return { from: { x: a.left + a.width, y: aC.y }, to: { x: b.left, y: bC.y } }
  }
  return { from: { x: a.left, y: aC.y }, to: { x: b.left + b.width, y: bC.y } }
}
