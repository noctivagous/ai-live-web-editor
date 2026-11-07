import React, { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  getProjectConfig, postProjectConfig, setPlaywrightPool,
  type LauncherConfig, type ProjectConfig,
} from '../lib/api'
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from '../lib/uiPrefs'
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
   Device scope. Workflow sections (providers, search) mount the same
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [poolOn, setPoolOn] = useState(false)
  const [poolSaving, setPoolSaving] = useState(false)

  useEffect(() => { setSection(initialSection) }, [initialSection])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => { setPoolOn(Boolean(config?.playwrightPool)) }, [config?.playwrightPool])
  useEffect(() => {
    let live = true
    void getProjectConfig().then(r => { if (live) { setProjectCfg(r.config); setDesignated(r.designated) } }).catch(() => {})
    return () => { live = false }
  }, [])

  const results = useMemo(() => searchSettings(query), [query])
  const activeSection = sectionById(section) ?? SETTING_SECTIONS[0]

  const displayValue = (f: SettingField): string | boolean | string[] => {
    const raw = (f.store === 'project' ? projectCfg : prefs) as Record<string, unknown> | null
    const v = raw?.[f.id]
    if (f.control === 'toggle') return v === true
    if (f.control === 'checkboxes') return Array.isArray(v) ? v.map(String) : []
    if (v === undefined || v === null) {
      if (f.id === 'planLevel') return '1'
      if (f.id === 'planMutability') return '5'
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
              <span className="set-slider-val">{v as string}/10</span>
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
