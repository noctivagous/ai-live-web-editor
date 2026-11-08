import React, { useEffect, useRef, useState } from 'react'
import { askAi } from '../lib/api'
import type { PreviewRenderer } from '../lib/previewRender'
import { promptForFormatAction, toolbarFor } from '../lib/formatToolbar'

/**
 * The AI-actions portion of a preview surface, and the row that
 * carries it for surfaces without their own editor chrome.
 *
 * FormatActionMenus is the shared piece: the menus of prepared AI
 * actions for a file's format (lib/formatToolbar), dispatched
 * through askAi. Two places render it:
 *  - FormatToolbar (below): a standalone row under the preview bar,
 *    for surfaces that are not editors (pages, components, CSS,
 *    JSON, spreadsheets, stubs).
 *  - The base editors (BaseTextEditor, BaseImageEditor): their
 *    second portion, under their own normal-functions toolbar —
 *    an editor has TWO portions, its normal toolbar functions and
 *    then the AI actions the user can take on that file.
 *
 * The preview bar's "AI toolbar" checkbox hides the AI portion in
 * both places; the checkbox itself stays in the bar, so bringing
 * it back is the same one click.
 */
export function FormatActionMenus({ renderer, path, onDispatched }: {
  renderer: PreviewRenderer
  path: string
  onDispatched?: (title: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const bar = toolbarFor(renderer, path)

  useEffect(() => { setOpen(null) }, [path, renderer])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open ])

  const menuBtn: React.CSSProperties = { padding: '2px 8px', fontSize: 'calc(11px * var(--ui-scale, 1))' }

  return (
    <span ref={barRef} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {bar.menus.map((menu) => (
        <span key={menu.title} style={{ position: 'relative' }}>
          <button
            type="button"
            className="deck-btn"
            style={menuBtn}
            aria-haspopup="menu"
            aria-expanded={open === menu.title}
            onClick={() => setOpen(open === menu.title ? null : menu.title)}
          >
            {menu.title} ▾
          </button>
          {open === menu.title && (
            <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 300, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,.35)', padding: 6, zIndex: 20 }}>
              {menu.actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpen(null); askAi(promptForFormatAction(a, path)); onDispatched?.(a.title) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 7, padding: '6px 8px', cursor: 'pointer', color: 'var(--text)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--well)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                >
                  <span style={{ display: 'block', fontSize: 'calc(12px * var(--ui-scale, 1))', fontWeight: 600 }}>{a.title}</span>
                  <span style={{ display: 'block', fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--muted)', marginTop: 1, lineHeight: 1.4 }}>{a.blurb}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      ))}
    </span>
  )
}

/** The standalone AI-actions row for non-editor preview surfaces. */
export function FormatToolbar({ renderer, path, onDispatched }: {
  renderer: PreviewRenderer
  path: string
  onDispatched?: (title: string) => void
}) {
  const bar = toolbarFor(renderer, path)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 10px', background: 'var(--card)', borderBottom: '1px solid var(--border-soft)', flexShrink: 0, position: 'relative', zIndex: 5 }}>
      <span className="pill" title={`AI actions for ${bar.formatLabel}`}>{bar.formatLabel}</span>
      <FormatActionMenus renderer={renderer} path={path} onDispatched={onDispatched} />
      <span style={{ marginLeft: 'auto', fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--faint)' }}>AI actions for this file</span>
    </div>
  )
}
