import React, { useEffect, useMemo, useRef, useState } from 'react'
import { actionAvailability, searchActions, type ActionContext, type AgentAction } from '../lib/agentActions'
import { runAction } from '../lib/actionDispatch'
import { recordRecent } from '../lib/actionHistory'

/**
 * ⌘K command search (slice 2): the registry as a keyboard-first
 * overlay. Every word in the query must match (see searchActions);
 * unavailable actions are listed greyed with their reason and cannot
 * be run. ↑/↓ move, Enter runs, Esc closes. Menus, wizards, and this
 * palette are overlays — they never take a route.
 */
export function ActionCommandPalette({ ctx, onOpenLibrary, onOpenSettings, onClose }: {
  ctx: ActionContext
  onOpenLibrary: () => void
  onOpenSettings: (section: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchActions(query), [query])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const first = results.findIndex(a => actionAvailability(a, ctx).available)
    setSel(first >= 0 ? first : 0)
  }, [results, ctx])

  function run(a: AgentAction) {
    if (!actionAvailability(a, ctx).available) return
    recordRecent(a.id)
    runAction(a, ctx, { openLibrary: onOpenLibrary, openSettings: onOpenSettings })
    onClose()
  }

  function move(dir: 1 | -1) {
    if (results.length === 0) return
    let next = sel
    for (let step = 0; step < results.length; step++) {
      next = (next + dir + results.length) % results.length
      if (actionAvailability(results[next], ctx).available) break
    }
    setSel(next)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); const a = results[sel]; if (a) run(a) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="cmdk-scrim" onPointerDown={onClose}>
      <div className="cmdk" role="dialog" aria-label="Search actions" onPointerDown={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search actions…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search actions"
        />
        <div className="cmdk-list">
          {results.map((a, i) => {
            const v = actionAvailability(a, ctx)
            return (
              <button
                key={a.id}
                type="button"
                className={`cmdk-row${i === sel ? ' sel' : ''}`}
                disabled={!v.available}
                onMouseEnter={() => setSel(i)}
                onClick={() => run(a)}
              >
                <b>{a.title}</b>
                <span>{v.available ? a.blurb : v.reason}</span>
                <span className="cmdk-group">{a.group}</span>
              </button>
            )
          })}
          {results.length === 0 && <div className="ap-empty">No actions match.</div>}
        </div>
        <div className="cmdk-foot">↑↓ to move · Enter to run · Esc to close</div>
      </div>
    </div>
  )
}
