import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { PANE_KEY } from '../lib/styles'
import { clampPanes, PANE_DEFAULTS, type Panes } from '../lib/panes'

function load(): Panes {
  try {
    const raw = localStorage.getItem(PANE_KEY)
    if (!raw) return clampPanes(PANE_DEFAULTS, window.innerWidth)
    const p = JSON.parse(raw) as Partial<Panes>
    return clampPanes({
      leftW: typeof p.leftW === 'number' ? p.leftW : PANE_DEFAULTS.leftW,
      rightW: typeof p.rightW === 'number' ? p.rightW : PANE_DEFAULTS.rightW,
      previewH: typeof p.previewH === 'number' ? p.previewH : PANE_DEFAULTS.previewH,
    }, window.innerWidth)
  } catch {
    return clampPanes(PANE_DEFAULTS, typeof window !== 'undefined' ? window.innerWidth : 1400)
  }
}

export function useSplitPanes() {
  const [panes, setPanes] = useState<Panes>(load)
  // Latest state for the drag-end persist (the mouseup closure would
  // otherwise capture the stale render).
  const panesRef = useRef(panes)
  panesRef.current = panes

  function persist(next: Panes) {
    try { localStorage.setItem(PANE_KEY, JSON.stringify(next)) } catch { /* private mode etc. */ }
  }

  // A mid-drag unmount must not strand the overlay (it would eat all clicks).
  useEffect(() => () => {
    document.querySelectorAll('[data-ai-drag]').forEach((el) => el.remove())
  }, [])

  useEffect(() => {
    const onResize = () => {
      // Clamp in memory only: persisting here would destroy the user's
      // widths every time the window shrinks and grows back.
      setPanes((p) => {
        const next = clampPanes(p, window.innerWidth)
        if (next.leftW === p.leftW && next.rightW === p.rightW) return p
        return next
      })
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function setLeftW(f: (v: number) => number) {
    setPanes(p => clampPanes({ ...p, leftW: f(p.leftW) }, window.innerWidth))
  }
  function setRightW(f: (v: number) => number) {
    setPanes(p => clampPanes({ ...p, rightW: f(p.rightW) }, window.innerWidth))
  }
  function setPreviewH(f: (v: number) => number) {
    setPanes(p => clampPanes({ ...p, previewH: f(p.previewH) }, window.innerWidth))
  }

  /**
   * Full-window transparent overlay for the duration of a drag. Mouse
   * events over the cross-origin preview iframe never reach our document,
   * so without this a release over the preview leaks the move handler and
   * every later hover keeps resizing (runaway drag). The overlay keeps
   * all moves and the release in-document; it is removed on mouseup.
   */
  function dragOverlay(cursor: string): () => void {
    const el = document.createElement('div')
    el.setAttribute('data-ai-drag', '1')
    el.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${cursor};`
    document.body.appendChild(el)
    return () => el.remove()
  }

  function endDrag(
    move: (ev: MouseEvent) => void,
    up: () => void,
    hide: () => void,
  ) {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    hide()
    persist(panesRef.current)
  }

  function colDrag(set: (f: (v: number) => number) => void, dir: 1 | -1) {
    return (e: ReactMouseEvent) => {
      e.preventDefault()
      const hide = dragOverlay('col-resize')
      const move = (ev: MouseEvent) => set(v => Math.min(600, Math.max(140, v + dir * ev.movementX)))
      const up = () => endDrag(move, up, hide)
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
  }

  function rowDrag() {
    return (e: ReactMouseEvent) => {
      e.preventDefault()
      const hide = dragOverlay('row-resize')
      const move = (ev: MouseEvent) => setPreviewH(p => p - (ev.movementY / window.innerHeight) * 100)
      const up = () => endDrag(move, up, hide)
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
  }

  return { leftW: panes.leftW, setLeftW, rightW: panes.rightW, setRightW, previewH: panes.previewH, colDrag, rowDrag }
}
