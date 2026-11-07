import { actionAvailability, actionsForContext, type ActionContext, type AgentAction } from '../lib/agentActions'
import { runAction } from '../lib/actionDispatch'
import { recordRecent } from '../lib/actionHistory'

/**
 * The editor's file-actions menu (slice 4): the context palette for
 * the open file, one click from the file's name in the editor header.
 * Only file-context actions — explain, check, unpack — each resolved
 * against the file actually open ({file} in their prompts).
 */
export function FileActionsMenu({ ctx, onOpenLibrary, onOpenSettings, onClose }: {
  ctx: ActionContext
  onOpenLibrary: () => void
  onOpenSettings: (section: string) => void
  onClose: () => void
}) {
  function run(a: AgentAction) {
    recordRecent(a.id)
    runAction(a, ctx, { openLibrary: onOpenLibrary, openSettings: onOpenSettings })
    onClose()
  }

  return (
    <div className="aa-menu narrow" role="menu" aria-label="Actions for the open file">
      <div className="aa-group">For {ctx.activePath ?? 'this file'}</div>
      <div className="aa-grid" style={{ gridTemplateColumns: '1fr' }}>
        {actionsForContext('file').map(a => {
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
              {!v.available && v.reason && <span className="aa-reason">{v.reason}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
