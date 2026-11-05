import React from 'react'
import { btn } from '../lib/styles'
import type { LauncherConfig } from '../lib/api'

function Overlay({ onClose, children }: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141417', border: '1px solid #26262c', borderRadius: 12, padding: 18, maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

function Header({ title, onClose }: { title: string, onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
      <b>{title}</b>
      <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
    </div>
  )
}

export function NoticeDialog({ notice, onClose }: {
  notice: string | null
  onClose: () => void
}) {
  if (notice === null) return null
  return (
    <Overlay onClose={onClose}>
      <Header title="Inspect result" onClose={onClose} />
      <pre style={{ overflow: 'auto', fontSize: 12, color: '#ccc', margin: 0, fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}>{notice}</pre>
    </Overlay>
  )
}

const THEMES = ['vs-dark', 'light', 'hc-black']

export function SettingsModal({ open, onClose, config, editorTheme, onTheme, onReplayWizard }: {
  open: boolean
  onClose: () => void
  config: LauncherConfig | null
  editorTheme: string
  onTheme: (t: string) => void
  onReplayWizard: () => void
}) {
  if (!open) return null
  const keyTone = config === null ? '' : config.hasOpenAiKey ? 'good' : 'warn'
  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <b>Settings</b>
        <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
      </div>

      <label className="field-label">AI model</label>
      <input disabled value={config?.model || '…'} className="deck-input" style={{ marginBottom: 4 }} />
      <div className="field-hint" style={{ marginBottom: 12 }}>Fixed by the launcher agent wiring.</div>

      <label className="field-label">API key</label>
      <div style={{ marginBottom: 4 }}>
        <span className={`pill ${keyTone}`}>
          <span className="dot" />
          {config === null ? 'launcher unreachable' : config.hasOpenAiKey ? 'key set on launcher' : 'no key set'}
        </span>
      </div>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        Set via <code>OPENAI_API_KEY</code> in the launcher environment, then restart the launcher.
        The key itself is never shown or sent to the browser.
      </div>

      <label className="field-label" htmlFor="editor-theme">Editor theme</label>
      <select
        id="editor-theme"
        className="deck-select"
        value={editorTheme}
        onChange={e => onTheme(e.target.value)}
        style={{ marginBottom: 12 }}
      >
        {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <label className="field-label">Browser pool</label>
      <input disabled value={config?.poolUrl || '…'} className="deck-input" style={{ marginBottom: 12 }} />

      <button onClick={onReplayWizard} className="deck-btn" style={{ ...btn, width: '100%', justifyContent: 'center' }}>
        Replay setup wizard
      </button>
    </Overlay>
  )
}
