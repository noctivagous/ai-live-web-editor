import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
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

  function persist(next: Panes) {
    try { localStorage.setItem(PANE_KEY, JSON.stringify(next)) } catch { /* private mode etc. */ }
  }

  useEffect(() => {
    const onResize = () => {
      setPanes((p) => {
        const next = clampPanes(p, window.innerWidth)
        if (next.leftW === p.leftW && next.rightW === p.rightW) return p
        persist(next)
        return next
      })
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function setLeftW(f: (v: number) => number) {
    setPanes(p => { const next = clampPanes({ ...p, leftW: f(p.leftW) }, window.innerWidth); persist(next); return next })
  }
  function setRightW(f: (v: number) => number) {
    setPanes(p => { const next = clampPanes({ ...p, rightW: f(p.rightW) }, window.innerWidth); persist(next); return next })
  }
  function setPreviewH(f: (v: number) => number) {
    setPanes(p => { const next = clampPanes({ ...p, previewH: f(p.previewH) }, window.innerWidth); persist(next); return next })
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
