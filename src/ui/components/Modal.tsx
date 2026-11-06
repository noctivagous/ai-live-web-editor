import React, { useEffect, useState } from 'react'
import { btn } from '../lib/styles'
import { setPlaywrightPool, type LauncherConfig } from '../lib/api'
import { ModalityPanel, ProviderSetup, useConnections } from './ProviderSetup'
import { SearchSetup } from './SearchSetup'

function Overlay({ onClose, children }: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141417', border: '1px solid #26262c', borderRadius: 12, padding: 18, maxWidth: 900, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
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

export function SettingsModal({ open, onClose, config, editorTheme, onTheme, onReplayWizard, onConfigSaved }: {
  open: boolean
  onClose: () => void
  config: LauncherConfig | null
  editorTheme: string
  onTheme: (t: string) => void
  onReplayWizard: () => void
  onConfigSaved: () => void
}) {
  const { payload, reload } = useConnections()
  const [poolOn, setPoolOn] = useState(false)
  const [poolSaving, setPoolSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPoolOn(Boolean(config?.playwrightPool))
    setSaveError(null)
    void reload()
  }, [open, config?.playwrightPool, reload])

  if (!open) return null
  const hasKey = Boolean(config?.hasApiKey ?? config?.hasOpenAiKey)
  const keyTone = config === null ? '' : hasKey ? 'good' : 'warn'
  const active = payload?.connections.find(c => c.id === payload.activeId)

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <b>Settings</b>
        <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
      </div>

      <label className="field-label">AI providers</label>
      <div style={{ marginBottom: 10 }}>
        <span className={`pill ${keyTone}`}>
          <span className="dot" />
          {config === null
            ? 'launcher unreachable'
            : active
              ? `${active.name} · ${active.model}`
              : hasKey
                ? 'key set on launcher'
                : 'no provider connected'}
        </span>
      </div>

      <ProviderSetup payload={payload} reload={reload} onChanged={onConfigSaved} />

      <label className="field-label" style={{ marginTop: 16 }}>Models by type</label>
      <ModalityPanel payload={payload} reload={reload} onChanged={onConfigSaved} />

      <label className="field-label" style={{ marginTop: 16 }}>Search</label>
      <SearchSetup />

      <label className="field-label" htmlFor="editor-theme" style={{ marginTop: 16 }}>Editor theme</label>
      <select
        id="editor-theme"
        className="deck-select"
        value={editorTheme}
        onChange={e => onTheme(e.target.value)}
        style={{ marginBottom: 12 }}
      >
        {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={poolOn}
          disabled={poolSaving}
          onChange={e => {
            const enabled = e.target.checked
            setPoolOn(enabled)
            setPoolSaving(true)
            void setPlaywrightPool(enabled)
              .then(() => onConfigSaved())
              .catch(err => {
                setPoolOn(!enabled)
                setSaveError(err instanceof Error ? err.message : String(err))
              })
              .finally(() => setPoolSaving(false))
          }}
        />
        Playwright pool (optional)
      </label>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        Off by default. When on, the agent can open a headed Chrome for other URLs and CDP layout. The Vite page bridge still handles inspect/patch/eval on :5173. Chrome starts on first pool use.
      </div>
      {saveError && <div className="field-hint" style={{ color: '#fca5a5', marginBottom: 8 }}>{saveError}</div>}

      <button onClick={onReplayWizard} className="deck-btn" style={{ ...btn, width: '100%', justifyContent: 'center' }}>
        Replay setup wizard
      </button>
    </Overlay>
  )
}
