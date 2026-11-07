import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  clearServerChatThreads, getAgentSettings, getProjectConfig, getWorkflow, postAgentSettings, postProjectConfig, postWorkflow, setPlaywrightPool,
  type AgentSettings, type LauncherConfig, type ProjectConfig, type SearchBackendId, type SearchOption,
} from '../lib/api'
import { parseWorkflowSnapshot } from '../lib/workflowSync'
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
import {
  UI_THEMES, UI_FONT_SIZE_MAX, UI_FONT_SIZE_MIN, monacoThemeFor, themeById, type UiThemeId,
} from '../lib/themes'
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

const MONACO_THEMES = ['vs-dark', 'light', 'hc-black']
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
  const [searchSnap, setSearchSnap] = useState<{ backend: SearchBackendId, options: SearchOption[] } | null>(null)

  const refreshSearchSnap = useCallback(async () => {
    try {
      const snap = parseWorkflowSnapshot(await getWorkflow())
      if (snap) setSearchSnap({ backend: snap.searchBackend || 'off', options: snap.searchOptions || [] })
    } catch { /* launcher unreachable — the section shows its loading state */ }
  }, [])
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
    void refreshSearchSnap()
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

  const themesSection = () => {
    const active = themeById(prefs.uiTheme)
    const pick = (id: UiThemeId) => {
      setPrefs(saveUiPrefs({ uiTheme: id }))
      // The code editor follows the UI theme; the select below can
      // still override it afterwards.
      onTheme(monacoThemeFor(id))
    }
    const kebab = (k: string) => k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
    return (
      <div>
        <div className="theme-cards" role="radiogroup" aria-label="UI theme">
          {UI_THEMES.map(t => (
            <button
              key={t.id} type="button" role="radio" aria-checked={prefs.uiTheme === t.id}
              className={`theme-card${prefs.uiTheme === t.id ? ' on' : ''}`}
              onClick={() => pick(t.id)}
            >
              <span className="theme-swatch" style={{ background: t.tokens.panelBg, borderColor: t.tokens.border }}>
                <span className="theme-swatch-bar" style={{ background: t.tokens.buttonBg, color: t.tokens.text, boxShadow: t.tokens.buttonShadow }}>Button</span>
                <span className="theme-swatch-row">
                  <span className="theme-swatch-well" style={{ background: t.tokens.well, boxShadow: t.tokens.wellShadow }} />
                  <span className="theme-swatch-well" style={{ background: t.tokens.card }} />
                </span>
              </span>
              <span className="theme-card-name">{t.label}</span>
              <span className="theme-card-font">{t.fontLabel}</span>
              <span className="theme-card-desc">{t.description}</span>
            </button>
          ))}
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <label className="set-row-label" htmlFor="set-ui-font-size">UI font size</label>
            <div className="field-hint">Scales the editor’s own interface text, in every theme. The code editor’s font size is separate, under Editor.</div>
          </div>
          <div className="set-row-control">
            <span className="set-slider">
              <input
                id="set-ui-font-size" type="range" min={UI_FONT_SIZE_MIN} max={UI_FONT_SIZE_MAX} step={1}
                value={prefs.uiFontSize}
                onChange={e => setPrefs(saveUiPrefs({ uiFontSize: Number(e.target.value) }))}
              />
              <span className="set-slider-val">{prefs.uiFontSize}px</span>
            </span>
          </div>
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <label className="set-row-label" htmlFor="set-editor-theme">Editor theme</label>
            <div className="field-hint">The code editor color theme. It follows the UI theme when you switch themes; you can still set it separately here.</div>
          </div>
          <div className="set-row-control">
            <select id="set-editor-theme" className="deck-select" value={editorTheme} onChange={e => onTheme(e.target.value)}>
              {MONACO_THEMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>
            Design tokens — {active.label}
          </summary>
          <div className="theme-tokens" style={{ marginTop: 8 }}>
            {Object.entries(active.tokens).map(([k, v]) => `--${kebab(k)}: ${v}`).join('\n')}
          </div>
        </details>
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
    const doClearChats = async () => {
      let removed = 0
      try {
        for (const k of chatSessionKeys(Object.keys(globalThis.localStorage))) { globalThis.localStorage.removeItem(k); removed++ }
      } catch { /* ignore */ }
      // Chat history also lives server-side now (Mastra Memory threads);
      // clearing only this device would leave the agent still recalling
      // these conversations on the next turn.
      let serverNote = ' Server conversation memory was cleared too.'
      try {
        const r = await clearServerChatThreads()
        if (!r.ok) serverNote = ' The server conversation memory could not be cleared, so the agent may still recall these chats.'
      } catch { serverNote = ' The server conversation memory could not be reached, so the agent may still recall these chats.' }
      setDataConfirm(null)
      setDataNotice(`Cleared ${removed} saved chat session${removed === 1 ? '' : 's'}.${serverNote} Open chats keep their in-memory state until the page reloads.`)
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
            <div className="field-hint">{chatCount} saved session{chatCount === 1 ? '' : 's'} on this device. Transcripts saved per project are removed, on this device and in the server's conversation memory; files are untouched.</div>
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
        <div><dt>Provider</dt><dd>{config?.providerName || config?.providerId || '—'}{config?.modelName ? ` · ${config.modelName}` : ''}{config?.contextWindow ? ` · ${Math.round(config.contextWindow / 1000)}k window` : ''}</dd></div>
      </dl>
      <button onClick={onReplayWizard} className="deck-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
        Replay setup wizard
      </button>
    </div>
  )

  const searchSection = () => {
    const provider = searchSnap?.options.find(o => o.id === 'provider')
    const brave = searchSnap?.options.find(o => o.id === 'brave')
    const available = (searchSnap?.options || []).filter(o => o.available)
    const backend = searchSnap?.backend || 'off'
    const resolvedLabel = backend === 'provider' ? provider?.label
      : backend === 'brave' ? (brave?.label || 'Brave Search')
      : null
    const pickBackend = async (id: SearchBackendId) => {
      try {
        await postWorkflow({ searchBackend: id })
      } catch { /* ignore — refresh shows what stuck */ }
      await refreshSearchSnap()
    }
    return (
      <div>
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">Web search</div>
            <div className="field-hint">
              {searchSnap === null && 'Checking what can serve search…'}
              {searchSnap !== null && backend !== 'off' && resolvedLabel && (
                <>Searches will use <b>{resolvedLabel}</b>. This is the same setting as the Search control in the chat header.</>
              )}
              {searchSnap !== null && backend === 'off' && available.length > 0 && (
                <>Web search is turned off. Turn it back on here or in the chat header.</>
              )}
              {searchSnap !== null && backend === 'off' && available.length === 0 && (
                <>Web search and research are off: nothing is set up to serve them yet.</>
              )}
            </div>
          </div>
          <div className="set-row-control">
            {available.length > 0 ? (
              <select
                className="deck-select" value={backend} aria-label="Web search backend"
                onChange={e => void pickBackend(e.target.value as SearchBackendId)}
              >
                {available.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                <option value="off">Search off</option>
              </select>
            ) : (
              <span className="set-note">Not available</span>
            )}
          </div>
        </div>

        <div className="field-hint" style={{ margin: '10px 0 14px' }}>
          {provider?.available
            ? <><b>{provider.label}</b> is available through your active provider connection — it needs no extra key or setup. It stays available here and in the chat header as long as that connection is active.</>
            : <>None of your connected providers offer built-in web search. (Providers that do — such as Meta and OpenAI — show their search here automatically once connected.)</>}
        </div>

        <div className="set-group-label">{provider?.available ? 'Brave Search — an alternative' : 'Brave Search'}</div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          {provider?.available
            ? 'Brave also works as a search backend: save a key and it joins the list above, selectable here or in the chat header.'
            : 'Brave Search is an option: save a key below and web search and research turn on, served by Brave.'}
        </div>
        <SearchSetup onStatus={() => void refreshSearchSnap()} />
      </div>
    )
  }

  const sectionBody = (s: SettingSection) => {
    if (s.custom === 'providers') return providersSection()
    if (s.custom === 'search') return searchSection()
    if (s.custom === 'preview') return previewSection()
    if (s.custom === 'data') return dataSection()
    if (s.custom === 'shortcuts') return shortcutsSection()
    if (s.custom === 'about') return aboutSection()
    if (s.custom === 'themes') return themesSection()
    return (
      <div>
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
            {saveError && <div className="field-hint" style={{ color: 'var(--red-text)', marginBottom: 8 }}>{saveError}</div>}
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
