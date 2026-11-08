import React from 'react'
import { X } from 'lucide-react'

/* The open-files tab strip over the editor: one tab per pinned file,
 * plus the active file while it is transient (unpinned). Clicking a
 * tab activates it; × unpins a pinned tab (it stays open transiently
 * while it is active, so there is always at least one open file). */

const base = (p: string) => p.split('/').pop() || p

export function OpenTabs({ tabs, active, onActivate, onUnpin }: {
  tabs: string[]
  active: string | null
  onActivate: (path: string) => void
  onUnpin: (path: string) => void
}) {
  const shown = active && !tabs.includes(active) ? [...tabs, active] : tabs
  if (shown.length === 0) return null
  return (
    <div className="tabs" role="tablist" aria-label="Open files">
      {shown.map(p => {
        const pinned = tabs.includes(p)
        const on = p === active
        return (
          <div key={p} role="tab" aria-selected={on} className={`tab${on ? ' on' : ''}${pinned ? '' : ' transient'}`} title={p}>
            <button type="button" className="tab-name" onClick={() => onActivate(p)}>{base(p)}</button>
            {pinned && (
              <button type="button" className="tab-x" aria-label={`Unpin ${base(p)}`} title="Unpin tab" onClick={() => onUnpin(p)}>
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
