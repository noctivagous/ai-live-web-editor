/** In-memory Live sketch session: mode, patch log, undo/discard/accept. No disk. */

export const SKETCH_WRITE_BLOCKED =
  'Live sketch is on. Accept or switch to Files to write disk.'

export type SketchMode = 'files' | 'sketch'
export type SketchOp = 'html' | 'text' | 'style' | 'attr' | 'class' | 'remove' | 'insert' | 'move' | 'restore'

export type SketchBefore = {
  innerHTML?: string
  textContent?: string
  cssText?: string
  className?: string
  attrName?: string
  attrValue?: string | null
  outerHTML?: string
  parentSelector?: string
  childIndex?: number
  position?: string
  targetSelector?: string
}

export type SketchPatch = {
  id: string
  selector: string
  op: SketchOp
  before: SketchBefore
  after: Record<string, string>
  ok: boolean
  detail?: string
}

export type SketchState = {
  mode: SketchMode
  patches: SketchPatch[]
  accepted: boolean
}

export function emptySketchState(): SketchState {
  return { mode: 'files', patches: [], accepted: false }
}

export function parseSketchMode(value: unknown): SketchMode | null {
  if (value === 'files' || value === 'sketch') return value
  return null
}

export function setModeState(state: SketchState, mode: SketchMode): SketchState {
  if (mode === state.mode) return state
  return { ...state, mode, accepted: mode === 'files' ? state.accepted : false }
}

export function appendPatchState(state: SketchState, patch: SketchPatch): SketchState {
  return { ...state, patches: [...state.patches, patch], accepted: false }
}

export function undoLastState(state: SketchState): { state: SketchState, undone: SketchPatch | null } {
  if (!state.patches.length) return { state, undone: null }
  const undone = state.patches[state.patches.length - 1]
  return { state: { ...state, patches: state.patches.slice(0, -1), accepted: false }, undone }
}

export function discardState(state: SketchState): { state: SketchState, undone: SketchPatch[] } {
  const undone = [...state.patches].reverse()
  return { state: { ...state, patches: [], accepted: false }, undone }
}

export function acceptState(state: SketchState): SketchState {
  return { ...state, accepted: true }
}

export function snapshotPublic(state: SketchState) {
  return {
    ok: true,
    mode: state.mode,
    accepted: state.accepted,
    patches: state.patches.map((p) => ({
      id: p.id,
      selector: p.selector,
      op: p.op,
      ok: p.ok,
      detail: p.detail || `${p.op} ${p.selector}`,
    })),
  }
}

export const SKETCH_TURN_PREAMBLE =
  'Live sketch mode is ON. Disk writes (str-replace, write-real-file) are blocked. '
  + 'Use take-snapshot / inspect-dom / layout-snapshot, then patch-dom with small sequential ops '
  + '(text, style, class, attr, insert, move, remove; html only if needed). '
  + 'insert: html with one root element and position before|after|prepend|append. '
  + 'move: target selector and position. One visual change per patch-dom call. '
  + 'After tools, write one short sentence of what the page should now show. '
  + 'If this turn is not about the live page, do not call write tools.'

export function withSketchPreamble(messages: unknown): unknown {
  const list = Array.isArray(messages) ? messages : []
  return [{ role: 'system', content: SKETCH_TURN_PREAMBLE }, ...list]
}

let live: SketchState = emptySketchState()

export function getSketchState(): SketchState {
  return live
}

export function getSketchMode(): SketchMode {
  return live.mode
}

export function isSketchMode(): boolean {
  return live.mode === 'sketch'
}

export function sketchWriteGuard(): { error: string } | null {
  if (!isSketchMode()) return null
  return { error: SKETCH_WRITE_BLOCKED }
}

export function setSketchMode(mode: SketchMode): SketchState {
  live = setModeState(live, mode)
  return live
}

export function appendSketchPatch(patch: SketchPatch): SketchState {
  live = appendPatchState(live, patch)
  return live
}

/** Record a successful live patch on this process (the 4112 sketch log). Skip restore. */
export function recordLiveSketchPatch(payload: Record<string, unknown>, result: unknown) {
  if (!isSketchMode() || !result || typeof result !== 'object') return
  const r = result as Record<string, unknown>
  if (r.ok === false || r.error) return
  const applied = typeof r.op === 'string' ? r.op : String(payload.op || 'html')
  if (applied === 'restore') return
  appendSketchPatch({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    selector: String(payload.selector || r.selector || 'body'),
    op: applied as SketchOp,
    before: (r.before && typeof r.before === 'object' ? r.before : {}) as SketchBefore,
    after: {
      html: String(payload.html || ''),
      text: String(payload.text || ''),
      style: String(payload.style || ''),
      className: String(payload.className || ''),
      target: String(payload.target || ''),
      position: String(payload.position || ''),
    },
    ok: true,
    detail: [applied, payload.selector || r.selector || '', payload.position, payload.target].filter(Boolean).join(' '),
  })
}

export function undoLastSketch(): { state: SketchState, undone: SketchPatch | null } {
  const result = undoLastState(live)
  live = result.state
  return result
}

export function discardSketch(): { state: SketchState, undone: SketchPatch[] } {
  const result = discardState(live)
  live = result.state
  return result
}

export function acceptSketch(): SketchState {
  live = acceptState(live)
  return live
}

/** Vite restart wipes the DOM; drop the log, keep the mode. */
export function resetSketchForProjectSwitch(): SketchState {
  live = { mode: live.mode, patches: [], accepted: false }
  return live
}

export function resetSketchStateForTests(): void {
  live = emptySketchState()
}
