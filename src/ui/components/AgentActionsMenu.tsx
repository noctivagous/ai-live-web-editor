import React from 'react'
import {
  ACTION_GROUPS, actionAvailability, actionsForGroup,
  type ActionContext, type AgentAction,
} from '../lib/agentActions'
import { runAction } from '../lib/actionDispatch'

/**
 * The Agent Actions menu (slice 1): a two-column panel of pressable
 * cards, grouped like the registry. Menus in this app are small
 * palettes, not single-column text lists — each card carries its
 * one-line description, and an unavailable action stays visible,
 * greyed, with the reason it cannot run.
 *
 * Dispatch rides the channels that already exist: prompt actions go
 * through askAi (ai-live:ask-ai), plan/graph open their overlays,
 * library/settings are App-level view changes passed in as props.
 */
export function AgentActionsMenu({ ctx, onOpenLibrary, onOpenSettings, onClose }: {
  ctx: ActionContext
  onOpenLibrary: () => void
  onOpenSettings: (section: string) => void
  onClose: () => void
}) {
  function run(a: AgentAction) {
    runAction(a, ctx, { openLibrary: onOpenLibrary, openSettings: onOpenSettings })
    onClose()
  }

  return (
    <div className="aa-menu" role="menu" aria-label="Agent Actions">
      {ACTION_GROUPS.map(group => (
        <React.Fragment key={group}>
          <div className="aa-group">{group}</div>
          <div className="aa-grid">
            {actionsForGroup(group).map(a => {
              const v = actionAvailability(a, ctx)
              return (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  className="aa-card"
                  disabled={!v.available}
                  title={v.available ? a.title : `${a.title} — ${v.reason ?? ''}`}
                  onClick={() => run(a)}
                >
                  <b>{a.title}</b>
                  <span>{a.blurb}</span>
                  {a.writes && <span className="aa-tag">writes files</span>}
                  {!v.available && v.reason && <span className="aa-reason">{v.reason}</span>}
                </button>
              )
            })}
          </div>
        </React.Fragment>
      ))}
      <div className="aa-foot">Tip: press ⌘K (Ctrl+K) to search all actions, or pin them in the Actions pane.</div>
    </div>
  )
}
