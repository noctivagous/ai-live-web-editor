import React, { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  getAgentSettings, getProjectConfig, postAgentSettings, postProjectConfig, setPlaywrightPool,
  type AgentSettings, type LauncherConfig, type ProjectConfig,
} from '../lib/api'
import {
  loadUiPrefs, replaceUiPrefs, saveUiPrefs, UI_PREFS_CHANGED_EVENT, UI_PREFS_DEFAULTS, UI_PREFS_KEY, type UiPrefs,
} from '../lib/uiPrefs'
import { buildSettingsExport, chatSessionKeys, parseSettingsImport } from '../lib/settingsData'
import {
  SHORTCUTS, comboFromEvent, effectiveCombo, findConflict, formatCombo, shortcutDef,
} from '../lib/shortcuts'
import {
  SETTING_SECTIONS, fieldsForSection, searchSettings, sectionById,
  type SettingField, type SettingSection,
} from '../lib/settingsSchema'
import { ModalityPanel, ProviderSetup, useConnections } from './ProviderSetup'
import { SearchSetup } from './SearchSetup'

/* The Settings window: a left rail of sections over one content area.
   Declarative sections render generically from the settings model
   (lib/settingsSchema.ts) with values read/written through their
   instance stores — project.ai.json for Project scope, uiPrefs for
   Device scope, agent-settings.json for the agent behavior switches.
   Workflow sections (providers, search) mount the same
   hand-built components the setup wizard uses. Everything saves on
   change, like the settings it replaces; there is no Apply queue. */

const THEMES = ['vs-dark', 'light', 'hc-black']
const SCOPE_LABEL: Record<SettingSection['scope'], string> = { global: 'Global', project: 'Project', device: 'Device' }

export function SettingsWindow({ initialSection, onClose, config, editorTheme, onTheme, onReplayWizard, onConfigSaved }: {
  initialSection: string
  onClose: () => void
  config: LauncherConfig | null
  editorTheme: string
  onTheme: (t: string) => void
  onReplayWizard: () => void
  onConfigSaved: () => void
}) {
  const [section, setSection] = useState(initialSection)
  const [query, setQuery] = useState('')
  const { payload, reload } = useConnections()
  const [projectCfg, setProjectCfg] = useState<ProjectConfig | null>(null)
  const [designated, setDesignated] = useState(false)
  const [prefs, setPrefs] = useState<UiPrefs>(() => loadUiPrefs())
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [poolOn, setPoolOn] = useState(false)
  const [poolSaving, setPoolSaving] = useState(false)
  const [dataNotice, setDataNotice] = useState<string | null>(null)
  const [dataConfirm, setDataConfirm] = useState<'reset' | 'clearChats' | null>(null)
  const importRef = React.useRef<HTMLInputElement>(null)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [shortcutError, setShortcutError] = useState<string | null>(null)

  // Click-to-record: while a row is recording, the next real key
  // press becomes its binding. Plain Escape cancels.
  useEffect(() => {
    if (!recordingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { setRecordingId(null); return }
      const combo = comboFromEvent(e)
      if (!combo) return // modifier alone — keep waiting
      const clash = findConflict(recordingId, combo, prefs.shortcutOverrides)
      if (clash) {
        setShortcutError(`“${formatCombo(combo)}” is already used by “${shortcutDef(clash)?.label}”.`)
        setRecordingId(null)
        return
      }
      const next = { ...prefs.shortcutOverrides }
      if (combo === shortcutDef(recordingId)?.combo) delete next[recordingId]
      else next[recordingId] = combo
      setPrefs(saveUiPrefs({ shortcutOverrides: next }))
      setShortcutError(null)
      setRecordingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingId, prefs.shortcutOverrides])

  const shortcutsSection = () => {
    const scopes = [...new Set(SHORTCUTS.map(s => s.scope))]
    const anyOverrides = Object.keys(prefs.shortcutOverrides).length > 0
    return (
      <div>
        {scopes.map(scope => (
          <div key={scope}>
            <div className="set-group-label">{scope}</div>
            {SHORTCUTS.filter(s => s.scope === scope).map(s => {
              const overridden = s.editable && s.id in prefs.shortcutOverrides
              return (
                <div className="set-row" key={s.id}>
                  <div className="set-row-text">
                    <div className="set-row-label">{s.label}</div>
                    {s.note && <div className="field-hint">{s.note}</div>}
                    {overridden && <div className="field-hint">Changed from {formatCombo(s.combo)}.</div>}
                  </div>
                  <div className="set-row-control set-keys">
                    <span className="set-key-chip">{s.editable ? formatCombo(effectiveCombo(s.id, prefs.shortcutOverrides)) : s.combo}</span>
                    {s.editable ? (
                      <>
                        <button type="button" className="deck-btn" onClick={() => { setShortcutError(null); setRecordingId(s.id) }}>
                          {recordingId === s.id ? 'Press keys…' : 'Record'}
                        </button>
                        {overridden && (
                          <button type="button" className="deck-btn" onClick={() => {
                            const next = { ...prefs.shortcutOverrides }
                            delete next[s.id]
                            setPrefs(saveUiPrefs({ shortcutOverrides: next }))
                          }}>Reset</button>
                        )}
                      </>
                    ) : (
                      <span className="set-note">Built in</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {shortcutError && <div className="field-hint" style={{ color: 'var(--red)', marginTop: 8 }}>{shortcutError}</div>}
        {anyOverrides && (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="deck-btn" onClick={() => setPrefs(saveUiPrefs({ shortcutOverrides: {} }))}>
              Reset all bindings to defaults
            </button>
          </div>
        )}
      </div>
    )
  }

  useEffect(() => { setSection(initialSection) }, [initialSection])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => { setPoolOn(Boolean(config?.playwrightPool)) }, [config?.playwrightPool])
  useEffect(() => {
    let live = true
    void getProjectConfig().then(r => { if (live) { setProjectCfg(r.config); setDesignated(r.designated) } }).catch(() => {})
    void getAgentSettings().then(s => { if (live) setAgentSettings(s) }).catch(() => {})
    return () => { live = false }
  }, [])

  const results = useMemo(() => searchSettings(query), [query])
  const activeSection = sectionById(section) ?? SETTING_SECTIONS[0]

  const displayValue = (f: SettingField): string | boolean | string[] => {
    const raw = (f.store === 'project' ? projectCfg : f.store === 'agent' ? agentSettings : prefs) as Record<string, unknown> | null
    const v = raw?.[f.id]
    if (f.control === 'toggle') return v === undefined && f.id === 'contextTrim' ? true : v === true
    if (f.control === 'checkboxes') return Array.isArray(v) ? v.map(String) : []
    if (v === undefined || v === null) {
      if (f.id === 'planLevel') return '1'
      if (f.id === 'planMutability') return '5'
      if (f.id === 'mapInjection') return 'auto'
      if (f.id === 'defaultWorkflow') return 'files'
      return ''
    }
    return String(v)
  }

  const applyField = async (f: SettingField, value: string | boolean | string[]) => {
    const coerced: unknown = f.control === 'toggle' ? value === true
      : f.control === 'checkboxes' ? value
      : f.numeric ? Number(value)
      : value
    setSaveError(null)
    if (f.store === 'prefs') {
      setPrefs(saveUiPrefs({ [f.id]: coerced } as Partial<UiPrefs>))
      return
    }
    if (f.store === 'agent') {
      try {
        setAgentSettings(await postAgentSettings({ [f.id]: coerced } as Partial<AgentSettings>))
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
      }
      return
    }
    try {
      const r = await postProjectConfig({ [f.id]: coerced })
      setProjectCfg(r.config)
      setDesignated(r.designated)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  const fieldRow = (f: SettingField) => {
    const v = displayValue(f)
    return (
      <div className="set-row" key={`${f.store}:${f.id}`}>
        <div className="set-row-text">
          <label className="set-row-label" htmlFor={`set-${f.id}`}>{f.label}</label>
          {f.hint && <div className="field-hint">{f.hint}</div>}
        </div>
        <div className="set-row-control">
          {f.control === 'select' && (
            <select id={`set-${f.id}`} className="deck-select" value={v as string} onChange={e => void applyField(f, e.target.value)}>
              {f.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {f.control === 'toggle' && (
            <input id={`set-${f.id}`} type="checkbox" checked={v as boolean} onChange={e => void applyField(f, e.target.checked)} />
          )}
          {f.control === 'slider' && (
            <span className="set-slider">
              <input id={`set-${f.id}`} type="range" min={f.min} max={f.max} step={1} value={v as string} onChange={e => void applyField(f, e.target.value)} />
              <span className="set-slider-val">{v as string}{f.id === 'planMutability' ? '/10' : ''}</span>
            </span>
          )}
          {f.control === 'text' && (
            <input
              id={`set-${f.id}`} className="set-text" type="text" value={v as string}
              onChange={e => setProjectCfg(c => ({ ...(c || {}), [f.id]: e.target.value }))}
              onBlur={e => void applyField(f, e.target.value)}
              placeholder="None"
            />
          )}
          {f.control === 'checkboxes' && (
            <span className="set-checks">
              {f.options!.map(o => {
                const arr = v as string[]
                const on = arr.includes(o.value)
                return (
                  <label key={o.value} className="set-check">
                    <input
                      type="checkbox" checked={on}
                      onChange={() => void applyField(f, on ? arr.filter(x => x !== o.value) : [...arr, o.value])}
                    />
                    {o.label}
                  </label>
                )
              })}
            </span>
          )}
        </div>
      </div>
    )
  }

  const providersSection = () => {
    const hasKey = Boolean(config?.hasApiKey ?? config?.hasOpenAiKey)
    const keyTone = config === null ? '' : hasKey ? 'good' : 'warn'
    const active = payload?.connections.find(c => c.id === payload.activeId)
    return (
      <div>
        <div style={{ marginBottom: 10 }}>
          <span className={`pill ${keyTone}`}>
            <span className="dot" />
            {config === null ? 'launcher unreachable' : active ? `${active.name} · ${active.model}` : hasKey ? 'key set on launcher' : 'no provider connected'}
          </span>
        </div>
        <ProviderSetup payload={payload} reload={reload} onChanged={onConfigSaved} />
        <label className="field-label" style={{ marginTop: 16 }}>Models by type</label>
        <ModalityPanel payload={payload} reload={reload} onChanged={onConfigSaved} />
      </div>
    )
  }

  const previewSection = () => (
    <div>
      <div className="set-row">
        <div className="set-row-text">
          <label className="set-row-label" htmlFor="set-pool">Playwright pool (optional)</label>
          <div className="field-hint">Off by default. When on, the agent can open a headed Chrome for other URLs and CDP layout. The Vite page bridge still handles inspect/patch/eval on :5173. Chrome starts on first pool use.</div>
        </div>
        <div className="set-row-control">
          <input
            id="set-pool" type="checkbox" checked={poolOn} disabled={poolSaving}
            onChange={e => {
              const enabled = e.target.checked
              setPoolOn(enabled)
              setPoolSaving(true)
              void setPlaywrightPool(enabled)
                .then(() => onConfigSaved())
                .catch(err => { setPoolOn(!enabled); setSaveError(err instanceof Error ? err.message : String(err)) })
                .finally(() => setPoolSaving(false))
            }}
          />
        </div>
      </div>
      <dl className="set-facts">
        <div><dt>Live target</dt><dd>{config?.liveTarget || 'bridge'}</dd></div>
        <div><dt>Static preview</dt><dd className="mono">{config?.previewStaticUrl || '—'}</dd></div>
        <div><dt>Live preview</dt><dd className="mono">{config?.previewHmrUrl || '—'}</dd></div>
      </dl>
    </div>
  )

  const dataSection = () => {
    let chatCount = 0
    try { chatCount = chatSessionKeys(Object.keys(globalThis.localStorage)).length } catch { /* no storage */ }
    const doExport = async () => {
      setDataNotice(null)
      try {
        const pc = await getProjectConfig()
        const data = buildSettingsExport(prefs, pc.config)
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = 'ai-live-settings.json'
        a.click()
        URL.revokeObjectURL(url)
        setDataNotice('Exported device settings and the active project’s settings. API keys are never included — they stay on the launcher.')
      } catch (e) { setDataNotice(e instanceof Error ? e.message : String(e)) }
    }
    const doImportFile = async (file: File) => {
      setDataNotice(null)
      try {
        const parsed = parseSettingsImport(await file.text())
        setPrefs(replaceUiPrefs(parsed.prefs))
        let note = 'Imported device settings.'
        if (parsed.project) {
          const r = await postProjectConfig(parsed.project)
          setProjectCfg(r.config)
          setDesignated(r.designated)
          note += ' Project settings were applied to the active project.'
        }
        setDataNotice(note)
      } catch (e) { setDataNotice(e instanceof Error ? e.message : String(e)) }
    }
    const doReset = () => {
      try { globalThis.localStorage.removeItem(UI_PREFS_KEY) } catch { /* ignore */ }
      setPrefs({ ...UI_PREFS_DEFAULTS })
      try { globalThis.dispatchEvent(new CustomEvent(UI_PREFS_CHANGED_EVENT)) } catch { /* ignore */ }
      setDataConfirm(null)
      setDataNotice('Device settings reset to defaults.')
    }
    const doClearChats = () => {
      let removed = 0
      try {
        for (const k of chatSessionKeys(Object.keys(globalThis.localStorage))) { globalThis.localStorage.removeItem(k); removed++ }
      } catch { /* ignore */ }
      setDataConfirm(null)
      setDataNotice(`Cleared ${removed} saved chat session${removed === 1 ? '' : 's'}. Open chats keep their in-memory state until the page reloads.`)
    }
    const confirmRow = (kind: 'reset' | 'clearChats', text: string, action: () => void) => dataConfirm === kind ? (
      <span className="set-confirm">
        <span>{text}</span>
        <button type="button" className="deck-btn danger" onClick={action}>Confirm</button>
        <button type="button" className="deck-btn" onClick={() => setDataConfirm(null)}>Cancel</button>
      </span>
    ) : null
    return (
      <div>
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">Export settings</div>
            <div className="field-hint">Downloads a JSON file with this device’s settings and the active project’s settings. API keys and connections stay on the launcher and are never exported.</div>
          </div>
          <div className="set-row-control"><button type="button" className="deck-btn" onClick={() => void doExport()}>Export</button></div>
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">Import settings</div>
            <div className="field-hint">Reads a settings export. Device settings replace this device’s; project settings apply to the active project.</div>
          </div>
          <div className="set-row-control">
            <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void doImportFile(f); e.target.value = '' }} />
            <button type="button" className="deck-btn" onClick={() => importRef.current?.click()}>Import…</button>
          </div>
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">Reset device settings</div>
            <div className="field-hint">Chat view, file pane, and editor options on this device go back to their defaults. Project settings and providers are untouched.</div>
          </div>
          <div className="set-row-control">
            {confirmRow('reset', 'Reset device settings?', doReset) ?? (
              <button type="button" className="deck-btn" onClick={() => setDataConfirm('reset')}>Reset…</button>
            )}
          </div>
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">Clear saved chat sessions</div>
            <div className="field-hint">{chatCount} saved session{chatCount === 1 ? '' : 's'} on this device. Transcripts saved per project are removed; files are untouched.</div>
          </div>
          <div className="set-row-control">
            {confirmRow('clearChats', `Clear ${chatCount} saved sessions?`, doClearChats) ?? (
              <button type="button" className="deck-btn" disabled={chatCount === 0} onClick={() => setDataConfirm('clearChats')}>Clear…</button>
            )}
          </div>
        </div>
        {dataNotice && <div className="field-hint" style={{ marginTop: 10 }}>{dataNotice}</div>}
      </div>
    )
  }

  const aboutSection = () => (
    <div>
      <dl className="set-facts">
        <div><dt>Launcher</dt><dd className="mono">{config?.launcherUrl || 'unreachable'}</dd></div>
        <div><dt>Workspace</dt><dd className="mono">{config?.workspace || '—'}</dd></div>
        <div><dt>Active project root</dt><dd className="mono">{config?.fsRoot || '—'}</dd></div>
        <div><dt>Provider</dt><dd>{config?.providerName || config?.providerId || '—'}{config?.modelName ? ` · ${config.modelName}` : ''}</dd></div>
      </dl>
      <button onClick={onReplayWizard} className="deck-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
        Replay setup wizard
      </button>
    </div>
  )

  const sectionBody = (s: SettingSection) => {
    if (s.custom === 'providers') return providersSection()
    if (s.custom === 'search') return <SearchSetup />
    if (s.custom === 'preview') return previewSection()
    if (s.custom === 'data') return dataSection()
    if (s.custom === 'shortcuts') return shortcutsSection()
    if (s.custom === 'about') return aboutSection()
    return (
      <div>
        {s.id === 'appearance' && (
          <div className="set-row">
            <div className="set-row-text">
              <label className="set-row-label" htmlFor="set-editor-theme">Editor theme</label>
              <div className="field-hint">The code editor color theme.</div>
            </div>
            <div className="set-row-control">
              <select id="set-editor-theme" className="deck-select" value={editorTheme} onChange={e => onTheme(e.target.value)}>
                {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        )}
        {s.id === 'project' && (
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Stored in this project's project.ai.json. {designated ? 'This project is designated.' : 'This project is not designated.'} The Preview bar reflects changes within a few seconds.
          </div>
        )}
        {fieldsForSection(s.id).map(fieldRow)}
      </div>
    )
  }

  return (
    <div className="set-overlay" onClick={onClose}>
      <div className="set-window" onClick={e => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="set-head">
          <b>Settings</b>
          <div className="set-search">
            <Search size={12} className="set-search-icon" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings" />
            {query && <button type="button" className="ft-filter-clear" onClick={() => setQuery('')}><X size={12} /></button>}
          </div>
          <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
        </div>
        <div className="set-body">
          <nav className="set-rail" aria-label="Settings sections">
            {SETTING_SECTIONS.map(s => (
              <button
                key={s.id} type="button"
                className={`set-rail-item${!query && s.id === activeSection.id ? ' on' : ''}`}
                onClick={() => { setSection(s.id); setQuery('') }}
              >
                <span>{s.title}</span>
                <span className="set-scope">{SCOPE_LABEL[s.scope]}</span>
              </button>
            ))}
          </nav>
          <div className="set-content">
            {saveError && <div className="field-hint" style={{ color: '#fca5a5', marginBottom: 8 }}>{saveError}</div>}
            {query ? (
              <div>
                {results.sections.map(s => (
                  <button key={s.id} type="button" className="set-result" onClick={() => { setSection(s.id); setQuery('') }}>
                    <span>{s.title}</span><span className="set-scope">{SCOPE_LABEL[s.scope]}</span>
                  </button>
                ))}
                {results.fields.map(f => (
                  <div key={`${f.store}:${f.id}`} className="set-result-field">
                    <button type="button" className="set-result-jump" onClick={() => { setSection(f.section); setQuery('') }}>
                      {sectionById(f.section)?.title} › {f.label}
                    </button>
                    {fieldRow(f)}
                  </div>
                ))}
                {results.sections.length === 0 && results.fields.length === 0 && (
                  <div className="field-hint">No settings match “{query}”.</div>
                )}
              </div>
            ) : (
              <div>
                <div className="set-section-head">
                  <h3>{activeSection.title}</h3>
                  <span className="set-scope">{SCOPE_LABEL[activeSection.scope]} scope</span>
                </div>
                {sectionBody(activeSection)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
