import React, { useEffect, useState } from 'react'
import { btn } from '../lib/styles'
import { probeModels, saveAiConfig, setPlaywrightPool, type LauncherConfig } from '../lib/api'

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

export function SettingsModal({ open, onClose, config, editorTheme, onTheme, onReplayWizard, onConfigSaved }: {
  open: boolean
  onClose: () => void
  config: LauncherConfig | null
  editorTheme: string
  onTheme: (t: string) => void
  onReplayWizard: () => void
  onConfigSaved: () => void
}) {
  const [keyInput, setKeyInput] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [providerName, setProviderName] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [poolOn, setPoolOn] = useState(false)
  const [poolSaving, setPoolSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setKeyInput('')
    setBaseUrl('')
    setModel('')
    setModels([])
    setProviderName(null)
    setModelsError(null)
    setSaveError(null)
    setPoolOn(Boolean(config?.playwrightPool))
  }, [open, config?.playwrightPool])

  useEffect(() => {
    if (!open) return
    const key = keyInput.trim()
    if (key.length < 8) return
    const t = setTimeout(() => { void loadModels(key, baseUrl) }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, keyInput, baseUrl])

  async function loadModels(key: string, url: string) {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const listed = await probeModels({ key, baseUrl: url })
      setModels(listed.models)
      setProviderName(listed.providerName || listed.provider || null)
      if (listed.baseUrl && listed.baseUrl !== url) setBaseUrl(listed.baseUrl)
      setModel(prev => listed.models.includes(prev) ? prev : (listed.suggested || ''))
    } catch (e: unknown) {
      setModels([])
      setProviderName(null)
      setModel('')
      setModelsError(e instanceof Error ? e.message : String(e))
    } finally {
      setModelsLoading(false)
    }
  }

  if (!open) return null
  const hasKey = Boolean(config?.hasApiKey ?? config?.hasOpenAiKey)
  const keyTone = config === null ? '' : hasKey ? 'good' : 'warn'

  async function save() {
    const already = hasKey
    if (!keyInput.trim() && !already) {
      setSaveError('Paste an API key first.')
      return
    }
    if (!model.trim()) {
      setSaveError('Select a model after the provider list loads.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await saveAiConfig({
        key: keyInput.trim() || undefined,
        baseUrl,
        model,
      })
      setKeyInput('')
      onConfigSaved()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <b>Settings</b>
        <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
      </div>

      <label className="field-label">API key</label>
      <div style={{ marginBottom: 8 }}>
        <span className={`pill ${keyTone}`}>
          <span className="dot" />
          {config === null ? 'launcher unreachable' : hasKey ? 'key set on launcher' : 'no key set'}
        </span>
      </div>
      <input
        type="password"
        autoComplete="off"
        className="deck-input"
        value={keyInput}
        onChange={e => { setKeyInput(e.target.value); setSaveError(null) }}
        placeholder={hasKey ? 'Paste a new key to replace it' : 'sk-… or any OpenAI-compatible key'}
        style={{ marginBottom: 8 }}
      />
      <label className="field-label">Base URL</label>
      <input
        className="deck-input"
        value={baseUrl}
        onChange={e => setBaseUrl(e.target.value)}
        placeholder="Filled when the provider is detected"
        style={{ marginBottom: 8 }}
      />
      <label className="field-label">Model</label>
      <select
        className="deck-select"
        value={model}
        onChange={e => setModel(e.target.value)}
        disabled={!models.length}
        style={{ marginBottom: 4 }}
      >
        <option value="">
          {modelsLoading
            ? 'Loading models…'
            : models.length
              ? 'Select a model'
              : 'Paste a key to load models'}
        </option>
        {models.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
      <div className="field-hint" style={{ marginBottom: 8 }}>
        {providerName
          ? `${providerName} — ${models.length} chat models.`
          : 'Paste a key to detect the provider and load models. Stored on the launcher; never shown back.'}
      </div>
      {modelsError && <div className="field-hint" style={{ color: '#fca5a5', marginBottom: 8 }}>{modelsError}</div>}
      {saveError && <div className="field-hint" style={{ color: '#fca5a5', marginBottom: 8 }}>{saveError}</div>}
      <button className="deck-btn primary" disabled={saving || modelsLoading || !model} onClick={() => void save()} style={{ marginBottom: 12 }}>
        {saving ? 'Saving…' : 'Save AI settings'}
      </button>

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

      <button onClick={onReplayWizard} className="deck-btn" style={{ ...btn, width: '100%', justifyContent: 'center' }}>
        Replay setup wizard
      </button>
    </Overlay>
  )
}
