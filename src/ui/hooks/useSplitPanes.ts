import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { PANE_KEY } from '../lib/styles'

interface Panes { leftW: number, rightW: number, previewH: number }

const DEFAULTS: Panes = { leftW: 220, rightW: 360, previewH: 42 }

function load(): Panes {
  try {
    const raw = localStorage.getItem(PANE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Panes>
    return {
      leftW: typeof p.leftW === 'number' ? Math.min(600, Math.max(140, p.leftW)) : DEFAULTS.leftW,
      rightW: typeof p.rightW === 'number' ? Math.min(600, Math.max(140, p.rightW)) : DEFAULTS.rightW,
      previewH: typeof p.previewH === 'number' ? Math.min(85, Math.max(10, p.previewH)) : DEFAULTS.previewH,
    }
  } catch {
    return DEFAULTS
  }
}

export function useSplitPanes() {
  const [panes, setPanes] = useState<Panes>(load)

  function persist(next: Panes) {
    try { localStorage.setItem(PANE_KEY, JSON.stringify(next)) } catch { /* private mode etc. */ }
  }

  function setLeftW(f: (v: number) => number) {
    setPanes(p => { const next = { ...p, leftW: Math.min(600, Math.max(140, f(p.leftW))) }; persist(next); return next })
  }
  function setRightW(f: (v: number) => number) {
    setPanes(p => { const next = { ...p, rightW: Math.min(600, Math.max(140, f(p.rightW))) }; persist(next); return next })
  }
  function setPreviewH(f: (v: number) => number) {
    setPanes(p => { const next = { ...p, previewH: Math.min(85, Math.max(10, f(p.previewH))) }; persist(next); return next })
  }

  function colDrag(set: (f: (v: number) => number) => void, dir: 1 | -1) {
    return (e: ReactMouseEvent) => {
      e.preventDefault()
      const move = (ev: MouseEvent) => set(v => Math.min(600, Math.max(140, v + dir * ev.movementX)))
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
  }

  function rowDrag() {
    return (e: ReactMouseEvent) => {
      e.preventDefault()
      const move = (ev: MouseEvent) => setPreviewH(p => p - (ev.movementY / window.innerHeight) * 100)
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
  }

  return { leftW: panes.leftW, setLeftW, rightW: panes.rightW, setRightW, previewH: panes.previewH, colDrag, rowDrag }
}
