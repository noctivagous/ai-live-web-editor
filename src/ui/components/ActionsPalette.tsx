import React, { useMemo, useState } from 'react'
import { Pin } from 'lucide-react'
import {
  ACTION_FACETS, ACTION_GROUPS, actionAvailability, actionById, actionsForContext, actionsForFacet,
  searchActions,
  type ActionContext, type ActionContextKind, type ActionFacet, type AgentAction,
} from '../lib/agentActions'
import { runAction } from '../lib/actionDispatch'
import { facetEnabled } from '../lib/facetPrefs'
import { loadUiPrefs } from '../lib/uiPrefs'
import {
  ACTION_PINS_KEY, ACTION_RECENTS_KEY, loadIdList, pushRecent, saveIdList, togglePin,
} from '../lib/actionHistory'

/**
 * The Actions palette (slice 2): the registry docked in the left
 * pane, next to Files and Library. Search on top, facet chips under
 * it (Features / Architecture / Graphic Design — facet-free actions belong
 * to every facet), then the same cards the menu shows, grouped.
 * Cards can be pinned; pinned and recently-run actions surface at
 * the top when the palette is unfiltered. Pins and recents are
 * device-local (localStorage), like other UI preferences.
 *
 * Slice 4: unfiltered, the palette leads with the context sections —
 * the actions for the open file and for the preview page ("Right
 * now"). Context actions live there, not in the group lists; search
 * and facet filtering still find them.
 */
export function ActionsPalette({ ctx, onOpenLibrary, onOpenSettings }: {
  ctx: ActionContext
  onOpenLibrary: () => void
  onOpenSettings: (section: string) => void
}) {
  const [query, setQuery] = useState('')
  const [facet, setFacet] = useState<ActionFacet | null>(null)
  const [pins, setPins] = useState<string[]>(() => loadIdList(ACTION_PINS_KEY))
  const [recents, setRecents] = useState<string[]>(() => loadIdList(ACTION_RECENTS_KEY))

  const filtered = useMemo(
    () => searchActions(query, actionsForFacet(facet)),
    [query, facet],
  )
  const filtering = query.trim().length > 0 || facet !== null

  function run(a: AgentAction) {
    const next = pushRecent(recents, a.id)
    setRecents(next)
    saveIdList(ACTION_RECENTS_KEY, next)
    runAction(a, ctx, { openLibrary: onOpenLibrary, openSettings: onOpenSettings })
  }

  function pin(a: AgentAction) {
    const next = togglePin(pins, a.id)
    setPins(next)
    saveIdList(ACTION_PINS_KEY, next)
  }

  function card(a: AgentAction) {
    const v = actionAvailability(a, ctx)
    const pinned = pins.includes(a.id)
    return (
      <div key={a.id} style={{ position: 'relative' }}>
        <button
          type="button"
          className="ap-card"
          disabled={!v.available}
          title={v.available ? a.title : `${a.title} — ${v.reason ?? ''}`}
          onClick={() => run(a)}
        >
          <b>{a.title}</b>
          <span>{a.blurb}</span>
          {a.writes && <span className="aa-tag">writes files</span>}
          {!v.available && v.reason && <span className="aa-reason">{v.reason}</span>}
        </button>
        <button
          type="button"
          className={`ap-pin${pinned ? ' on' : ''}`}
          title={pinned ? `Unpin ${a.title}` : `Pin ${a.title}`}
          aria-label={pinned ? `Unpin ${a.title}` : `Pin ${a.title}`}
          onClick={() => pin(a)}
        >
          <Pin size={12} />
        </button>
      </div>
    )
  }

  function contextSection(kind: ActionContextKind, title: string) {
    const items = actionsForContext(kind)
    if (items.length === 0) return null
    return (
      <React.Fragment key={kind}>
        <div className="aa-group">{title}</div>
        {items.map(card)}
      </React.Fragment>
    )
  }

  function idSection(title: string, ids: string[]) {
    const items = ids.map(actionById).filter((a): a is AgentAction => !!a)
    if (items.length === 0) return null
    return (
      <React.Fragment key={title}>
        <div className="aa-group">{title}</div>
        {items.map(card)}
      </React.Fragment>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, padding: 10 }}>
      <input
        className="ap-search"
        type="text"
        placeholder="Search actions…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        aria-label="Search actions"
      />
      <div className="ap-chips" role="group" aria-label="Filter by facet">
        <button type="button" className={`ap-chip${facet === null ? ' on' : ''}`} onClick={() => setFacet(null)}>All facets</button>
        {ACTION_FACETS.filter(f => facetEnabled(loadUiPrefs(), f.id)).map(f => (
          <button key={f.id} type="button" className={`ap-chip${facet === f.id ? ' on' : ''}`} onClick={() => setFacet(facet === f.id ? null : f.id)}>{f.title}</button>
        ))}
      </div>
      <div className="ap-list">
        {!filtering && ctx.activePath && contextSection('file', `Open file — ${ctx.activePath.split('/').filter(Boolean).pop() ?? ctx.activePath}`)}
        {!filtering && ctx.hasProject && contextSection('page', 'Preview page')}
        {!filtering && idSection('Pinned', pins)}
        {!filtering && idSection('Recent', recents.filter(id => !pins.includes(id)))}
        {ACTION_GROUPS.map(g => {
          const items = filtered.filter(a => a.group === g && (filtering || !a.context))
          if (items.length === 0) return null
          return (
            <React.Fragment key={g}>
              <div className="aa-group">{g}</div>
              {items.map(card)}
            </React.Fragment>
          )
        })}
        {filtered.length === 0 && <div className="ap-empty">No actions match. Try fewer words, or clear the facet filter.</div>}
      </div>
    </div>
  )
}
