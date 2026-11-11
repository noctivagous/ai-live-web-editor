import { useState } from 'react'
import type { MuseCodeAvailability } from '../lib/api'
import { MUSE_CODE_PRODUCT_URL } from '../lib/museSandbox'
import { InstallIcon, RefreshIcon } from './menuIcons'

/**
 * The "Requirement: Muse Code" note (setup polish): one
 * component wherever the Muse Code path states its install
 * requirement — the setup wizard's Specialized card and the
 * Settings engine option first, the sandbox surface's absence
 * row in the same words.
 *
 * Two states, driven entirely by the availability the parent
 * holds, so a state change re-renders in place:
 * - Not installed: the requirement line plus its control row —
 *   [Refresh] [Install…], same button chrome, different glyphs.
 *   Refresh re-runs the host's availability check (fresh — the
 *   parent passes the recheck in); when the check finds the
 *   binary, the parent's availability flips and this note flips
 *   with it — the card or option it guards enables in the same
 *   render, no restart, no lost step. Install… opens the dialog
 *   below; the product URL lives there, not as a bare link in
 *   the card.
 * - Installed: the satisfied line, naming the detected version.
 *
 * Renders nothing while availability is unknown (null) — the
 * surfaces' own checking states cover that moment.
 */
export function MuseRequirementNote({ availability, onRefresh, refreshing = false }: {
  availability: MuseCodeAvailability | null
  onRefresh: () => void
  refreshing?: boolean
}) {
  const [installOpen, setInstallOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  if (availability === null) return null

  if (availability.available) {
    return (
      <div className="check-row ok">
        <span className="mark">✓</span>
        <div>
          <b>Requirement: Muse Code</b> — Muse Code {availability.version ?? ''} is installed on this machine.
        </div>
      </div>
    )
  }

  const copyLink = () => {
    try {
      const p = navigator.clipboard?.writeText(MUSE_CODE_PRODUCT_URL)
      void p?.then(() => setCopied(true)).catch(() => setCopied(false))
    } catch { /* clipboard unavailable — the link itself is right there */ }
  }

  const buttonStyle = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--panel)' }}>
      <div style={{ fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.55, color: 'var(--text)' }}>
        <b>Requirement: Muse Code</b> — installed on this machine before this path can be used.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="deck-btn" style={buttonStyle} disabled={refreshing} onClick={onRefresh}>
          <RefreshIcon size={13} />{refreshing ? 'Checking…' : 'Refresh'}
        </button>
        <button type="button" className="deck-btn" style={buttonStyle} onClick={() => setInstallOpen(true)}>
          <InstallIcon size={13} />Install…
        </button>
      </div>
      {installOpen && (
        <div
          onClick={() => setInstallOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, maxWidth: 480, width: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <b>Install Muse Code</b>
              <button type="button" onClick={() => setInstallOpen(false)} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
            </div>
            <p style={{ fontSize: 'calc(13px * var(--ui-scale, 1))', lineHeight: 1.6, color: 'var(--text)', margin: '0 0 10px' }}>
              Muse Code is Meta’s coding agent — a separate program this path runs.
              Get it from its product page, install it on this machine, then come
              back and press Refresh.
            </p>
            <p style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 'calc(12.5px * var(--ui-scale, 1))', wordBreak: 'break-all', margin: '0 0 12px', userSelect: 'text' }}>
              <a href={MUSE_CODE_PRODUCT_URL} target="_blank" rel="noreferrer">{MUSE_CODE_PRODUCT_URL}</a>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="deck-btn" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
