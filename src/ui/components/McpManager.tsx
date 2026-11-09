import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Copy, Eye, EyeOff, Pencil, Plug, Plus,
  RefreshCw, Search, Trash2, X, Zap,
} from 'lucide-react'
import {
  addMcpServer, fetchConnectorCatalog, fetchMcpState, importMcpJson, installConnector,
  keyValuesToText, MCP_PRESETS,
  parseKeyValues, removeMcpServer, revealMcpServer, serverEnabledTools, serverReach,
  setMcpBudget, splitArgs, testMcpConfig, testMcpServer, toggleAllMcpTools,
  toggleMcpServer, toggleMcpTool, trimMcpBudget, updateMcpServer,
  type ConnectorCatalog, type ConnectorEntry, type McpConfig, type McpProbeResult,
  type McpProtocolChoice, type McpServer,
  type McpServerInput, type McpState, type McpTransport,
} from '../lib/mcp'

/**
 * The MCP manager: a header button (right of the model picker,
 * via App's renderAiSelects) and the panel it opens.
 *
 * The button is the always-visible summary: how many tools are
 * enabled, an amber alert style + warning badge when that runs
 * over the tool budget, and a red dot when a server's last test
 * failed — the problems are visible with the panel closed, and
 * the panel is where they get resolved (budget meter with Trim,
 * per-server and per-tool switches, real connection tests).
 *
 * All state lives in the server's MCP store (/api/mcp); this
 * component keeps only view state and the session activity log.
 */

interface LogEntry { at: string, text: string }

interface FormState {
  name: string
  transport: McpTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  protocol: McpProtocolChoice
  hint?: string
}

const EMPTY_FORM: FormState = { name: '', transport: 'stdio', command: '', argsText: '', envText: '', url: '', headersText: '', protocol: 'legacy' }

function formFromInput(input: McpServerInput, hint?: string): FormState {
  return {
    name: input.name,
    transport: input.transport,
    command: input.command ?? '',
    argsText: (input.args ?? []).join(' '),
    envText: keyValuesToText(input.env),
    url: input.url ?? '',
    headersText: keyValuesToText(input.headers),
    protocol: input.protocolVersion ?? 'legacy',
    ...(hint ? { hint } : {}),
  }
}

function formToInput(f: FormState): McpServerInput {
  const env = parseKeyValues(f.envText)
  const headers = parseKeyValues(f.headersText)
  return {
    name: f.name.trim(),
    transport: f.transport,
    // Always round-trips the form's protocol value: with the
    // Settings gate off the selector is hidden but the stored
    // choice (from the server being edited) survives the save.
    protocolVersion: f.protocol,
    ...(f.transport === 'stdio'
      ? {
          command: f.command.trim(),
          ...(f.argsText.trim() ? { args: splitArgs(f.argsText.trim()) } : { args: [] }),
          ...(Object.keys(env).length ? { env } : {}),
        }
      : {
          url: f.url.trim(),
          ...(Object.keys(headers).length ? { headers } : {}),
        }),
  }
}

function Switch({ on, onToggle, label }: { on: boolean, onToggle: (v: boolean) => void, label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`mcp-switch${on ? ' on' : ''}`}
      onClick={e => { e.stopPropagation(); onToggle(!on) }}
    >
      <span className="mcp-knob" />
    </button>
  )
}

export function McpManager() {
  const [state, setState] = useState<McpState | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off' | 'error'>('all')
  const [log, setLog] = useState<LogEntry[]>([])
  const [busy, setBusy] = useState<string>('')
  const [tab, setTab] = useState<'servers' | 'connectors'>('servers')
  const [catalog, setCatalog] = useState<ConnectorCatalog | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installValues, setInstallValues] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<McpServer | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<'form' | 'json'>('form')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formTest, setFormTest] = useState<McpProbeResult | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonResult, setJsonResult] = useState<string>('')
  const rootRef = useRef<HTMLDivElement>(null)

  const cfg: McpConfig | null = state?.config ?? null
  const counts = state?.counts ?? { enabled: 0, total: 0 }
  const over = cfg ? counts.enabled > cfg.budget : false
  const hasError = cfg?.servers.some(s => s.enabled && s.status === 'error') ?? false

  const pushLog = useCallback((text: string) => {
    setLog(prev => [{ at: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 30))
  }, [])

  const refresh = useCallback(async () => {
    try {
      setState(await fetchMcpState())
    } catch { /* server unreachable: the button just shows no count */ }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const refreshCatalog = useCallback(async () => {
    try {
      const r = await fetchConnectorCatalog()
      setCatalog({ entries: r.entries, installed: r.installed })
    } catch { /* catalog is bundled server-side; a failure just leaves the tab empty */ }
  }, [])

  const installEntry = async (entry: ConnectorEntry) => {
    setBusy(`install:${entry.id}`)
    try {
      const r = await installConnector(entry.id, installValues)
      apply(r)
      void refreshCatalog()
      setInstallingId(null)
      setInstallValues({})
      setTab('servers')
      setSelectedId(r.serverId)
      setRevealed(null); setEditing(false)
      if (r.alreadyInstalled) {
        pushLog(`${entry.title} is already installed — showing it`)
      } else {
        pushLog(`Installed ${entry.title} from the catalog — testing it now`)
        const added = r.config.servers.find(s => s.id === r.serverId)
        if (added) await runTest(added, 'Tested')
      }
    } catch (e) {
      pushLog(`Install ${entry.title} — failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy('')
    }
  }

  // Close on outside click / Escape (the app-wide menu pattern).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open ])

  const apply = (next: McpState) => setState(next)

  const runTest = async (server: McpServer, verb: string) => {
    setBusy(`test:${server.id}`)
    try {
      const r = await testMcpServer(server.id)
      apply(r)
      if (r.result.ok) pushLog(`${verb} ${server.name} — connected in ${r.result.latencyMs} ms, ${r.result.tools?.length ?? 0} tools found`)
      else pushLog(`${verb} ${server.name} — failed: ${r.result.error ?? 'unknown error'}`)
    } catch (e) {
      pushLog(`${verb} ${server.name} — failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy('')
    }
  }

  const doTrim = async () => {
    setBusy('trim')
    try {
      const r = await trimMcpBudget()
      apply(r)
      const n = r.disabled.reduce((a, d) => a + d.tools.length, 0)
      pushLog(n
        ? `Trimmed ${n} tools to meet the budget (${r.disabled.map(d => `${d.tools.length} from ${d.serverName}`).join(', ')})`
        : 'Trim: nothing to turn off')
    } finally {
      setBusy('')
    }
  }

  const changeBudget = async (budget: number) => {
    const clamped = Math.min(500, Math.max(5, budget))
    try {
      apply(await setMcpBudget(clamped))
      pushLog(`Tool budget set to ${clamped}`)
    } catch { /* ignore */ }
  }

  const reviewLargest = () => {
    if (!cfg) return
    const largest = [...cfg.servers]
      .filter(s => s.enabled)
      .sort((a, b) => serverEnabledTools(b) - serverEnabledTools(a))[0]
    if (largest) {
      setSelectedId(largest.id)
      setRevealed(null)
      setEditing(false)
      pushLog(`Reviewing ${largest.name} — the largest server, ${serverEnabledTools(largest)} tools on`)
    }
  }

  const doAdd = async () => {
    const input = formToInput(form)
    if (!input.name || (input.transport === 'stdio' && !input.command) || (input.transport !== 'stdio' && !input.url)) return
    setBusy('add')
    try {
      const r = await addMcpServer(input)
      apply(r)
      setSelectedId(r.serverId)
      setRevealed(null)
      setAddOpen(false)
      setForm(EMPTY_FORM)
      setFormTest(null)
      pushLog(`Added ${input.name} — testing it now`)
      const added = r.config.servers.find(s => s.id === r.serverId)
      if (added) await runTest(added, 'Tested')
    } finally {
      setBusy('')
    }
  }

  const doFormTest = async () => {
    setBusy('formtest')
    setFormTest(null)
    try {
      const r = await testMcpConfig(formToInput(form))
      setFormTest(r.result)
    } catch (e) {
      setFormTest({ ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy('')
    }
  }

  const doImport = async () => {
    setBusy('import')
    try {
      const r = await importMcpJson(jsonText)
      apply(r)
      const parts = [
        r.added.length ? `Added ${r.added.join(', ')}` : 'Nothing added',
        ...r.errors,
      ]
      setJsonResult(parts.join(' · '))
      pushLog(`Import: ${parts.join(' · ')}`)
      if (r.added.length) setJsonText('')
    } catch (e) {
      setJsonResult(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const startEdit = async (server: McpServer) => {
    // Edits round-trip secret values, so fetch the real record
    // first — the list state only carries masks.
    try {
      const r = await revealMcpServer(server.id)
      setEditForm(formFromInput(r.server))
      setEditing(true)
      setConfirmDelete(false)
    } catch { /* ignore */ }
  }

  const saveEdit = async (server: McpServer) => {
    setBusy('edit')
    try {
      apply(await updateMcpServer(server.id, formToInput(editForm)))
      setEditing(false)
      setRevealed(null)
      pushLog(`Saved ${editForm.name || server.name}`)
    } finally {
      setBusy('')
    }
  }

  const doReveal = async (server: McpServer) => {
    if (revealed?.id === server.id) { setRevealed(null); return }
    try {
      const r = await revealMcpServer(server.id)
      setRevealed(r.server)
    } catch { /* ignore */ }
  }

  const doCopyJson = async (server: McpServer) => {
    try {
      const r = await revealMcpServer(server.id)
      await navigator.clipboard.writeText(JSON.stringify(r.json, null, 2))
      pushLog(`Copied ${server.name} as mcpServers JSON`)
    } catch { /* clipboard unavailable */ }
  }

  const selected = cfg?.servers.find(s => s.id === selectedId) ?? cfg?.servers[0] ?? null
  const shownRevealed = revealed && selected && revealed.id === selected.id ? revealed : null
  const shownConfig = shownRevealed ?? selected

  const visibleServers = (cfg?.servers ?? []).filter(s => {
    if (filter === 'on' && !s.enabled) return false
    if (filter === 'off' && s.enabled) return false
    if (filter === 'error' && s.status !== 'error') return false
    const q = search.trim().toLowerCase()
    if (q && !s.name.toLowerCase().includes(q) && !s.tools.some(t => t.name.toLowerCase().includes(q))) return false
    return true
  })

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <style>{MCP_CSS}</style>
      <button
        type="button"
        className={`pill mono mcp-btn${over ? ' alert' : ''}`}
        onClick={() => { setOpen(o => !o); if (!open) void refresh() }}
        title={over
          ? `${counts.enabled} tools enabled — over the budget of ${cfg?.budget}. Open to resolve.`
          : hasError
            ? 'An MCP server failed its last test. Open to see which.'
            : `${counts.enabled} MCP tools enabled. Manage servers.`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Plug size={12} />
        MCP
        {cfg && <span className="mcp-count">{counts.enabled}</span>}
        {over && <span className="mcp-badge" aria-label="Over tool budget"><AlertTriangle size={10} /></span>}
        {hasError && <span className="mcp-errdot" aria-label="A server failed its test" />}
        <ChevronDown size={11} aria-hidden />
      </button>

      {open && cfg && (
        <div className="mcp-panel" role="dialog" aria-label="MCP server manager">
          <div className="mcp-head">
            <span className="mcp-title">MCP servers</span>
            <span className="mcp-sub">
              {cfg.servers.length} servers · {counts.enabled} of {counts.total} tools enabled
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="deck-btn" onClick={() => setOpen(false)} title="Close"><X size={13} /></button>
          </div>

          <div className="mcp-tabs" role="tablist" aria-label="Manager views">
            <button type="button" role="tab" aria-selected={tab === 'servers'} className={`mcp-tab${tab === 'servers' ? ' on' : ''}`} onClick={() => setTab('servers')}>Servers</button>
            <button type="button" role="tab" aria-selected={tab === 'connectors'} className={`mcp-tab${tab === 'connectors' ? ' on' : ''}`} onClick={() => { setTab('connectors'); void refreshCatalog() }}>
              Connectors
              {catalog && Object.keys(catalog.installed).length > 0 && <span className="mcp-tab-n">{Object.keys(catalog.installed).length} installed</span>}
            </button>
          </div>

          <div className="mcp-budget">
            <div className="mcp-budget-row">
              <span className="mcp-budget-label">Tool budget</span>
              <div className="mcp-meter" role="img" aria-label={`${counts.enabled} of ${cfg.budget} budget used`}>
                <div
                  className={`mcp-meter-fill${over ? ' over' : ''}`}
                  style={{ width: `${Math.min(100, (counts.enabled / Math.max(1, cfg.budget)) * 100)}%` }}
                />
              </div>
              <span className="mcp-budget-nums mono">{counts.enabled} / {cfg.budget}</span>
              <span className="mcp-stepper">
                <button type="button" className="deck-btn" onClick={() => void changeBudget(cfg.budget - 5)} title="Lower the budget by 5">−</button>
                <button type="button" className="deck-btn" onClick={() => void changeBudget(cfg.budget + 5)} title="Raise the budget by 5">+</button>
              </span>
            </div>
            {over && (
              <div className="mcp-banner">
                <AlertTriangle size={13} />
                <span>
                  <strong>{counts.enabled - cfg.budget} tools over budget.</strong>{' '}
                  Every enabled tool is listed to the model on every turn — trimming sharpens answers and cuts cost.
                </span>
                <button type="button" className="deck-btn" disabled={busy === 'trim'} onClick={() => void doTrim()}>Trim to budget</button>
                <button type="button" className="deck-btn" onClick={reviewLargest}>Review largest</button>
                <button type="button" className="deck-btn" onClick={() => void changeBudget(cfg.budget + 10)}>Raise budget</button>
              </div>
            )}
          </div>

          {tab === 'servers' && (<>
          <div className="mcp-toolbar">
            <label className="mcp-search">
              <Search size={12} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search servers and tools…" />
            </label>
            {(['all', 'on', 'off', 'error'] as const).map(f => (
              <button
                key={f}
                type="button"
                className={`deck-btn mcp-chip${filter === f ? ' on' : ''}`}
                onClick={() => setFilter(f)}
              >{f === 'all' ? 'All' : f === 'on' ? 'On' : f === 'off' ? 'Off' : 'Error'}</button>
            ))}
            <span style={{ flex: 1 }} />
            <button type="button" className="deck-btn" onClick={() => { setAddOpen(o => !o); setAddMode('form') }}>
              <Plus size={12} /> Add a server
            </button>
          </div>

          {addOpen && (
            <div className="mcp-add">
              <div className="mcp-add-tabs">
                <button type="button" className={`deck-btn${addMode === 'form' ? ' on' : ''}`} onClick={() => setAddMode('form')}>Form</button>
                <button type="button" className={`deck-btn${addMode === 'json' ? ' on' : ''}`} onClick={() => setAddMode('json')}>Paste JSON</button>
                <span style={{ flex: 1 }} />
                <button type="button" className="deck-btn" onClick={() => setAddOpen(false)}><X size={12} /></button>
              </div>
              {addMode === 'form' ? (
                <>
                  <div className="mcp-presets">
                    {MCP_PRESETS.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="deck-btn mcp-chip"
                        onClick={() => { setForm(formFromInput(p.input, p.hint)); setFormTest(null) }}
                      >{p.label}</button>
                    ))}
                    <button type="button" className="deck-btn mcp-chip" onClick={() => { setForm(EMPTY_FORM); setFormTest(null) }}>Custom…</button>
                  </div>
                  <ServerForm form={form} setForm={setForm} showProtocol={state?.config.settings.protocolChoiceEnabled} />
                  {form.hint && <div className="mcp-hint">{form.hint}</div>}
                  {formTest && (
                    <div className={`mcp-testline${formTest.ok ? ' ok' : ' err'}`}>
                      {formTest.ok
                        ? <><Check size={12} /> Connected in {formTest.latencyMs} ms — {formTest.tools?.length ?? 0} tools{formTest.serverName ? ` · ${formTest.serverName}${formTest.serverVersion ? ` ${formTest.serverVersion}` : ''}` : ''}</>
                        : <><AlertTriangle size={12} /> {formTest.error}</>}
                    </div>
                  )}
                  <div className="mcp-form-actions">
                    <button type="button" className="deck-btn" disabled={busy === 'formtest'} onClick={() => void doFormTest()}>
                      <Zap size={12} /> Test connection
                    </button>
                    <button type="button" className="deck-btn mcp-primary" disabled={busy === 'add'} onClick={() => void doAdd()}>
                      <Plus size={12} /> Add server
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    className="mcp-json"
                    value={jsonText}
                    onChange={e => setJsonText(e.target.value)}
                    placeholder={'Paste a config in the standard shape:\n{ "mcpServers": { "name": { "command": "npx", "args": ["…"] } } }'}
                    rows={6}
                  />
                  {jsonResult && <div className="mcp-hint">{jsonResult}</div>}
                  <div className="mcp-form-actions">
                    <button type="button" className="deck-btn mcp-primary" disabled={busy === 'import' || !jsonText.trim()} onClick={() => void doImport()}>
                      Import servers
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          </>)}

          {tab === 'connectors' ? (
            <div className="mcp-catalog">
              <div className="mcp-catalog-note">
                A small catalog bundled with ALE, curated by hand — not independently verified.
                {catalog?.entries.some(e => e.server.transport === 'stdio') && ' Installing a local connector runs its command on your machine, so the exact command is shown before you install.'}
              </div>
              <label className="mcp-search">
                <Search size={12} />
                <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Search connectors…" />
              </label>
              <div className="mcp-catalog-list">
                {(catalog?.entries ?? [])
                  .filter(e => {
                    const q = catalogSearch.trim().toLowerCase()
                    return !q || e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.publisher.name.toLowerCase().includes(q)
                  })
                  .map(entry => {
                    const installedId = catalog?.installed[entry.id]
                    const expanding = installingId === entry.id
                    const reach = entry.server.transport === 'stdio'
                      ? [entry.server.command, ...(entry.server.args ?? [])].filter(Boolean).join(' ')
                      : (entry.server.url ?? '')
                    const missingRequired = entry.inputs.some(i => i.isRequired && !(installValues[i.name] ?? '').trim())
                    return (
                      <div key={entry.id} className="mcp-conn">
                        <div className="mcp-conn-main">
                          <div className="mcp-conn-top">
                            <strong>{entry.title}</strong>
                            <span className="mcp-conn-badge">{entry.server.transport === 'stdio' ? 'Local' : 'Remote'}</span>
                            <span className="mcp-conn-ver mono">v{entry.version}</span>
                            <span style={{ flex: 1 }} />
                            {installedId ? (
                              <button type="button" className="deck-btn" onClick={() => { setTab('servers'); setSelectedId(installedId); setRevealed(null); setEditing(false) }}>Installed · Open</button>
                            ) : (
                              <button type="button" className="deck-btn mcp-primary" onClick={() => { setInstallingId(expanding ? null : entry.id); setInstallValues({}) }}>{expanding ? 'Cancel' : 'Install'}</button>
                            )}
                          </div>
                          <div className="mcp-conn-desc">{entry.description}</div>
                          <div className="mcp-conn-pub">
                            {entry.publisher.name}
                            {entry.inputs.length === 0
                              ? ' · No sign-in needed'
                              : ` · Needs: ${entry.inputs.map(i => { const d = i.description.replace(/^(A |An |Your |Optional — an |Optional — a )/i, ''); return d.charAt(0).toLowerCase() + d.slice(1) }).join(', ')}`}
                          </div>
                        </div>
                        {expanding && !installedId && (
                          <div className="mcp-conn-install">
                            <div className="mcp-conn-reach mono">
                              {entry.server.transport === 'stdio' ? `$ ${reach}` : reach}
                              {entry.inputs.filter(i => i.target === 'env').map(i => <div key={i.name}>{i.name}=…</div>)}
                              {entry.inputs.filter(i => i.target === 'header').map(i => <div key={i.name}>{i.name}: …</div>)}
                            </div>
                            {entry.inputs.map(i => (
                              <label key={i.name} className="mcp-field">
                                <span>{i.description}{i.isRequired ? '' : ' (optional)'}</span>
                                <input
                                  type={i.isSecret ? 'password' : 'text'}
                                  value={installValues[i.name] ?? ''}
                                  onChange={e => setInstallValues(v => ({ ...v, [i.name]: e.target.value }))}
                                  placeholder={i.name}
                                  autoComplete="off"
                                />
                              </label>
                            ))}
                            <div className="mcp-form-actions">
                              <button type="button" className="deck-btn mcp-primary" disabled={busy === `install:${entry.id}` || missingRequired} onClick={() => void installEntry(entry)}>
                                <Plus size={12} /> Install {entry.title}
                              </button>
                              {entry.docsUrl && <a className="mcp-conn-docs" href={entry.docsUrl} target="_blank" rel="noreferrer">About this connector</a>}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                {catalog && (catalog.entries ?? []).length === 0 && <div className="mcp-hint" style={{ padding: 10 }}>The catalog could not be loaded.</div>}
                {catalog && catalog.entries.length > 0 && (catalog?.entries ?? []).filter(e => { const q = catalogSearch.trim().toLowerCase(); return !q || e.title.toLowerCase().includes(q) }).length === 0 && (
                  <div className="mcp-hint" style={{ padding: 10 }}>No connectors match.</div>
                )}
              </div>
            </div>
          ) : cfg.servers.length === 0 ? (
            <div className="mcp-empty">
              <p><strong>No MCP servers yet.</strong></p>
              <p>MCP servers give the agent extra tools — a filesystem, GitHub, a browser, a database. Add one with a preset above, or paste a config you already use in another tool.</p>
            </div>
          ) : (
            <div className="mcp-body">
              <div className="mcp-list" role="listbox" aria-label="Servers">
                {visibleServers.map(s => (
                  <div
                    key={s.id}
                    role="option"
                    aria-selected={selected?.id === s.id}
                    className={`mcp-row${selected?.id === s.id ? ' sel' : ''}`}
                    onClick={() => { setSelectedId(s.id); setRevealed(null); setEditing(false); setConfirmDelete(false) }}
                  >
                    <span className={`mcp-dot ${!s.enabled ? 'off' : s.status === 'ok' ? 'ok' : s.status === 'error' ? 'err' : 'untested'}`} />
                    <span className="mcp-row-main">
                      <span className="mcp-row-name">{s.name}</span>
                      <span className="mcp-row-reach mono">{serverReach(s) || '—'}</span>
                    </span>
                    <span className="mcp-row-count mono">{serverEnabledTools(s)}/{s.tools.length} on</span>
                    <Switch
                      on={s.enabled}
                      label={`${s.name} on or off`}
                      onToggle={v => { void toggleMcpServer(s.id, v).then(apply); pushLog(`${s.name} turned ${v ? 'on' : 'off'}`) }}
                    />
                  </div>
                ))}
                {visibleServers.length === 0 && <div className="mcp-hint" style={{ padding: 10 }}>No servers match.</div>}
              </div>

              {selected && shownConfig && (
                <div className="mcp-detail">
                  {editing ? (
                    <>
                      <div className="mcp-detail-head"><strong>Editing {selected.name}</strong></div>
                      <ServerForm form={editForm} setForm={setEditForm} showProtocol={state?.config.settings.protocolChoiceEnabled} />
                      <div className="mcp-form-actions">
                        <button type="button" className="deck-btn mcp-primary" disabled={busy === 'edit'} onClick={() => void saveEdit(selected)}>Save</button>
                        <button type="button" className="deck-btn" onClick={() => setEditing(false)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mcp-detail-head">
                        <strong>{selected.name}</strong>
                        <span className={`mcp-status ${selected.status}`}>
                          {selected.status === 'ok' ? 'Connected' : selected.status === 'error' ? 'Failed' : 'Untested'}
                        </span>
                        {selected.lastLatencyMs !== undefined && selected.status === 'ok' && (
                          <span className="mcp-lat mono">{selected.lastLatencyMs} ms</span>
                        )}
                        <span style={{ flex: 1 }} />
                        <button type="button" className="deck-btn" disabled={busy === `test:${selected.id}`} onClick={() => void runTest(selected, 'Tested')}>
                          <Zap size={12} /> Test connection
                        </button>
                        <button type="button" className="deck-btn" disabled={busy === `test:${selected.id}`} onClick={() => void runTest(selected, 'Restarted')} title="Fresh handshake, same as a restart for a stdio server">
                          <RefreshCw size={12} /> Restart
                        </button>
                        <button type="button" className="deck-btn" onClick={() => void startEdit(selected)}><Pencil size={12} /> Edit</button>
                        {confirmDelete ? (
                          <>
                            <button
                              type="button"
                              className="deck-btn mcp-danger"
                              onClick={() => {
                                void removeMcpServer(selected.id).then(r => {
                                  apply(r)
                                  setSelectedId(null)
                                  pushLog(`Deleted ${selected.name}`)
                                })
                              }}
                            ><Trash2 size={12} /> Delete?</button>
                            <button type="button" className="deck-btn" onClick={() => setConfirmDelete(false)}>Keep</button>
                          </>
                        ) : (
                          <button type="button" className="deck-btn" onClick={() => setConfirmDelete(true)}><Trash2 size={12} /></button>
                        )}
                      </div>

                      {selected.status === 'error' && selected.lastError && (
                        <div className="mcp-error-box">{selected.lastError}</div>
                      )}
                      {(selected.serverName || selected.lastTestAt || selected.origin || (state?.config.settings.protocolChoiceEnabled && selected.protocolVersion)) && (
                        <div className="mcp-meta">
                          {selected.serverName && <span>Server: {selected.serverName}{selected.serverVersion ? ` ${selected.serverVersion}` : ''}</span>}
                          {selected.lastTestAt && <span>Last tested {new Date(selected.lastTestAt).toLocaleString()}</span>}
                          {selected.origin && <span>From the catalog: {selected.origin.catalogId} · v{selected.origin.version}</span>}
                          {state?.config.settings.protocolChoiceEnabled && selected.protocolVersion && (
                            <span>Protocol: {selected.protocolVersion === 'auto' ? 'Auto' : '2026 revision'}</span>
                          )}
                        </div>
                      )}

                      <div className="mcp-config mono">
                        {shownConfig.transport === 'stdio' ? (
                          <>
                            <div>$ {[shownConfig.command, ...(shownConfig.args ?? [])].filter(Boolean).join(' ')}</div>
                            {shownConfig.env && Object.entries(shownConfig.env).map(([k, v]) => (
                              <div key={k}>{k}={v}</div>
                            ))}
                          </>
                        ) : (
                          <>
                            <div>{shownConfig.transport === 'sse' ? 'SSE' : 'HTTP'} {shownConfig.url}</div>
                            {shownConfig.headers && Object.entries(shownConfig.headers).map(([k, v]) => (
                              <div key={k}>{k}: {v}</div>
                            ))}
                          </>
                        )}
                        <div className="mcp-config-actions">
                          <button type="button" className="deck-btn" onClick={() => void doReveal(selected)}>
                            {shownRevealed ? <EyeOff size={12} /> : <Eye size={12} />} {shownRevealed ? 'Hide values' : 'Reveal values'}
                          </button>
                          <button type="button" className="deck-btn" onClick={() => void doCopyJson(selected)}>
                            <Copy size={12} /> Copy as JSON
                          </button>
                        </div>
                      </div>

                      <div className="mcp-tools-head">
                        <span>Tools — {serverEnabledTools(selected)} of {selected.tools.length} on</span>
                        <span style={{ flex: 1 }} />
                        <button type="button" className="deck-btn" onClick={() => void toggleAllMcpTools(selected.id, true).then(apply)}>All on</button>
                        <button type="button" className="deck-btn" onClick={() => void toggleAllMcpTools(selected.id, false).then(apply)}>All off</button>
                      </div>
                      <div className="mcp-tools">
                        {selected.tools.length === 0 && (
                          <div className="mcp-hint">No tools known yet — run Test connection to list what this server offers.</div>
                        )}
                        {selected.tools.map(t => (
                          <div key={t.name} className="mcp-tool">
                            <span className="mcp-tool-main">
                              <span className="mcp-tool-name mono">{t.name}</span>
                              {t.description && <span className="mcp-tool-desc">{t.description}</span>}
                            </span>
                            <Switch
                              on={t.enabled}
                              label={`${t.name} on or off`}
                              onToggle={v => void toggleMcpTool(selected.id, t.name, v).then(apply)}
                            />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {log.length > 0 && (
            <div className="mcp-log" aria-label="Activity">
              {log.slice(0, 6).map((e, i) => (
                <div key={i} className="mcp-log-line"><span className="mono">{e.at}</span> {e.text}</div>
              ))}
            </div>
          )}

          <div className="mcp-foot">
            <span>
              {cfg.servers.filter(s => s.enabled).length} of {cfg.servers.length} servers on · {counts.enabled} of {counts.total} tools enabled
            </span>
            <span className="mcp-foot-note">Changes apply to the next chat turn.</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="deck-btn mcp-primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ServerForm({ form, setForm, showProtocol }: { form: FormState, setForm: (f: FormState) => void, showProtocol?: boolean }) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch })
  return (
    <div className="mcp-form">
      <label className="mcp-field">
        <span>Name</span>
        <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="my-server" />
      </label>
      <div className="mcp-field">
        <span>Transport</span>
        <div className="mcp-seg" role="group" aria-label="Transport">
          {([['stdio', 'Command (stdio)'], ['http', 'Streamable HTTP'], ['sse', 'SSE']] as [McpTransport, string][]).map(([t, label]) => (
            <button
              key={t}
              type="button"
              className={`deck-btn${form.transport === t ? ' on' : ''}`}
              onClick={() => set({ transport: t })}
            >{label}</button>
          ))}
        </div>
      </div>
      {showProtocol && (
        <label className="mcp-field">
          <span>Protocol</span>
          <select value={form.protocol} onChange={e => set({ protocol: e.target.value as McpProtocolChoice })}>
            <option value="legacy">Legacy (classic handshake)</option>
            <option value="auto">Auto (probe for the newest)</option>
            <option value="2026">2026 revision</option>
          </select>
        </label>
      )}
      {form.transport === 'stdio' ? (
        <>
          <label className="mcp-field">
            <span>Command</span>
            <input value={form.command} onChange={e => set({ command: e.target.value })} placeholder="npx" className="mono" />
          </label>
          <label className="mcp-field">
            <span>Arguments</span>
            <input value={form.argsText} onChange={e => set({ argsText: e.target.value })} placeholder="-y @modelcontextprotocol/server-filesystem ." className="mono" />
          </label>
          <label className="mcp-field">
            <span>Environment</span>
            <textarea value={form.envText} onChange={e => set({ envText: e.target.value })} placeholder={'API_KEY=…\n(one KEY=value per line)'} rows={2} className="mono" />
          </label>
        </>
      ) : (
        <>
          <label className="mcp-field">
            <span>URL</span>
            <input value={form.url} onChange={e => set({ url: e.target.value })} placeholder="https://example.com/mcp" className="mono" />
          </label>
          <label className="mcp-field">
            <span>Headers</span>
            <textarea value={form.headersText} onChange={e => set({ headersText: e.target.value })} placeholder={'Authorization=Bearer …\n(one KEY=value per line)'} rows={2} className="mono" />
          </label>
        </>
      )}
    </div>
  )
}

const MCP_CSS = `
.mcp-btn { position:relative; display:inline-flex; align-items:center; gap:5px; cursor:pointer; }
.mcp-btn.alert { border-color:var(--amber); color:var(--amber); box-shadow:0 0 0 1px var(--amber) inset; }
.mcp-count { background:var(--accent-soft-bg); border-radius:8px; padding:0 6px; font-size:calc(11px * var(--ui-scale, 1)); }
.mcp-btn.alert .mcp-count { background:transparent; }
.mcp-badge { position:absolute; top:-7px; right:-7px; width:15px; height:15px; border-radius:50%; background:var(--amber); color:#111; display:flex; align-items:center; justify-content:center; animation:mcp-pulse 1.6s ease-in-out infinite; }
@keyframes mcp-pulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.18); } }
.mcp-errdot { position:absolute; top:-3px; left:-3px; width:8px; height:8px; border-radius:50%; background:var(--red); }
.mcp-panel { position:fixed; top:50px; right:10px; width:min(940px, calc(100vw - 20px)); max-height:calc(100vh - 62px); overflow-y:auto; z-index:70; background:var(--panel-bg); border:1px solid var(--border-strong); border-radius:12px; box-shadow:0 18px 50px rgba(0,0,0,.35); padding:12px 14px; text-align:left; }
.mcp-head { display:flex; align-items:center; gap:10px; }
.mcp-title { font-weight:700; font-size:calc(15px * var(--ui-scale, 1)); }
.mcp-sub { opacity:.75; font-size:calc(12px * var(--ui-scale, 1)); }
.mcp-budget { margin-top:10px; border:1px solid var(--border-soft); border-radius:9px; padding:9px 11px; }
.mcp-budget-row { display:flex; align-items:center; gap:10px; }
.mcp-budget-label { font-weight:600; font-size:calc(12px * var(--ui-scale, 1)); white-space:nowrap; }
.mcp-meter { flex:1; height:9px; border-radius:5px; background:var(--border-soft); overflow:hidden; }
.mcp-meter-fill { height:100%; background:var(--accent); border-radius:5px; transition:width .25s ease; }
.mcp-meter-fill.over { background:var(--amber); }
.mcp-budget-nums { font-size:calc(12px * var(--ui-scale, 1)); white-space:nowrap; }
.mcp-stepper { display:inline-flex; gap:4px; }
.mcp-banner { margin-top:9px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:color-mix(in srgb, var(--amber) 14%, transparent); border:1px solid var(--amber); border-radius:8px; padding:7px 9px; font-size:calc(12px * var(--ui-scale, 1)); }
.mcp-toolbar { display:flex; align-items:center; gap:6px; margin-top:11px; flex-wrap:wrap; }
.mcp-tabs { display:flex; gap:4px; margin-top:11px; border-bottom:1px solid var(--border-soft); }
.mcp-tab { border:1px solid transparent; border-bottom:none; background:transparent; color:inherit; font:inherit; font-size:calc(12.5px * var(--ui-scale, 1)); font-weight:600; padding:6px 12px; border-radius:8px 8px 0 0; cursor:pointer; opacity:.65; display:inline-flex; align-items:center; gap:7px; }
.mcp-tab.on { opacity:1; background:var(--bg); border-color:var(--border-soft); margin-bottom:-1px; }
.mcp-tab-n { font-weight:400; font-size:calc(11px * var(--ui-scale, 1)); opacity:.75; }
.mcp-catalog { margin-top:11px; border:1px solid var(--border-soft); border-radius:9px; padding:10px 11px; }
.mcp-catalog-note { font-size:calc(12px * var(--ui-scale, 1)); opacity:.8; margin-bottom:9px; }
.mcp-catalog-list { display:flex; flex-direction:column; gap:8px; margin-top:9px; }
.mcp-conn { border:1px solid var(--border-soft); border-radius:9px; padding:9px 11px; }
.mcp-conn-top { display:flex; align-items:center; gap:8px; }
.mcp-conn-badge { font-size:calc(10.5px * var(--ui-scale, 1)); border:1px solid var(--border-strong); border-radius:20px; padding:1px 7px; opacity:.85; }
.mcp-conn-ver { font-size:calc(11px * var(--ui-scale, 1)); opacity:.6; }
.mcp-conn-desc { font-size:calc(12.5px * var(--ui-scale, 1)); margin-top:4px; }
.mcp-conn-pub { font-size:calc(11.5px * var(--ui-scale, 1)); opacity:.7; margin-top:2px; }
.mcp-conn-install { margin-top:9px; border-top:1px dashed var(--border-soft); padding-top:9px; display:flex; flex-direction:column; gap:8px; }
.mcp-conn-reach { font-size:calc(11.5px * var(--ui-scale, 1)); background:var(--bg); border:1px solid var(--border-soft); border-radius:7px; padding:6px 8px; word-break:break-all; }
.mcp-conn-docs { font-size:calc(12px * var(--ui-scale, 1)); align-self:center; }
.mcp-search { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--border-strong); border-radius:7px; padding:4px 8px; min-width:210px; }
.mcp-search input { border:none; background:transparent; color:inherit; outline:none; flex:1; font:inherit; font-size:calc(12.5px * var(--ui-scale, 1)); }
.mcp-chip.on, .mcp-seg .deck-btn.on, .mcp-add-tabs .deck-btn.on { background:var(--accent-soft-bg); border-color:var(--accent); }
.mcp-add { margin-top:10px; border:1px dashed var(--border-strong); border-radius:9px; padding:10px 11px; }
.mcp-add-tabs { display:flex; gap:6px; align-items:center; }
.mcp-presets { display:flex; gap:5px; flex-wrap:wrap; margin:9px 0; }
.mcp-form { display:grid; grid-template-columns:1fr 1fr; gap:8px 14px; margin-top:9px; }
.mcp-field { display:flex; flex-direction:column; gap:4px; font-size:calc(12px * var(--ui-scale, 1)); }
.mcp-field > span { font-weight:600; opacity:.85; }
.mcp-field input, .mcp-field textarea, .mcp-field select, .mcp-json { border:1px solid var(--border-strong); border-radius:7px; background:var(--bg); color:inherit; padding:6px 8px; font:inherit; font-size:calc(12.5px * var(--ui-scale, 1)); resize:vertical; }
.mcp-seg { display:flex; gap:5px; }
.mcp-hint { font-size:calc(12px * var(--ui-scale, 1)); opacity:.8; margin-top:8px; }
.mcp-testline { margin-top:9px; display:flex; align-items:center; gap:6px; font-size:calc(12.5px * var(--ui-scale, 1)); border-radius:8px; padding:7px 9px; }
.mcp-testline.ok { background:color-mix(in srgb, var(--green) 13%, transparent); }
.mcp-testline.err { background:color-mix(in srgb, var(--red) 12%, transparent); }
.mcp-form-actions { display:flex; gap:7px; margin-top:10px; }
.mcp-primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.mcp-danger { border-color:var(--red); color:var(--red-text); }
.mcp-json { width:100%; margin-top:9px; box-sizing:border-box; }
.mcp-empty { padding:22px 14px; text-align:center; opacity:.9; }
.mcp-body { display:grid; grid-template-columns:290px 1fr; gap:0; margin-top:11px; border:1px solid var(--border-soft); border-radius:9px; overflow:hidden; }
.mcp-list { border-right:1px solid var(--border-soft); max-height:430px; overflow-y:auto; }
.mcp-row { display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer; border-bottom:1px solid var(--border-soft); }
.mcp-row.sel { background:var(--accent-soft-bg); }
.mcp-dot { width:9px; height:9px; border-radius:50%; flex:none; background:var(--border-strong); }
.mcp-dot.ok { background:var(--green); }
.mcp-dot.err { background:var(--red); }
.mcp-dot.off { background:transparent; border:1.5px solid var(--border-strong); }
.mcp-dot.untested { background:var(--amber); }
.mcp-row-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.mcp-row-name { font-weight:600; font-size:calc(13px * var(--ui-scale, 1)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mcp-row-reach { font-size:calc(11px * var(--ui-scale, 1)); opacity:.65; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mcp-row-count { font-size:calc(11px * var(--ui-scale, 1)); opacity:.8; white-space:nowrap; }
.mcp-switch { width:32px; height:18px; border-radius:10px; border:1px solid var(--border-strong); background:transparent; position:relative; cursor:pointer; flex:none; padding:0; }
.mcp-switch .mcp-knob { position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:var(--border-strong); transition:left .15s ease, background .15s ease; }
.mcp-switch.on { background:var(--accent); border-color:var(--accent); }
.mcp-switch.on .mcp-knob { left:16px; background:#fff; }
.mcp-detail { padding:11px 13px; max-height:430px; overflow-y:auto; min-width:0; }
.mcp-detail-head { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.mcp-status { font-size:calc(11px * var(--ui-scale, 1)); border:1px solid var(--border-strong); border-radius:9px; padding:1px 8px; }
.mcp-status.ok { border-color:var(--green); color:var(--green); }
.mcp-status.error { border-color:var(--red); color:var(--red-text); }
.mcp-lat { font-size:calc(11.5px * var(--ui-scale, 1)); opacity:.75; }
.mcp-error-box { margin-top:9px; background:color-mix(in srgb, var(--red) 10%, transparent); border:1px solid var(--red); border-radius:8px; padding:8px 10px; font-size:calc(12.5px * var(--ui-scale, 1)); white-space:pre-wrap; word-break:break-word; }
.mcp-meta { display:flex; gap:14px; margin-top:8px; font-size:calc(12px * var(--ui-scale, 1)); opacity:.8; flex-wrap:wrap; }
.mcp-config { margin-top:10px; border:1px solid var(--border-soft); border-radius:8px; padding:8px 10px; font-size:calc(12px * var(--ui-scale, 1)); word-break:break-all; }
.mcp-config-actions { display:flex; gap:6px; margin-top:8px; }
.mcp-tools-head { display:flex; align-items:center; gap:6px; margin-top:13px; font-weight:600; font-size:calc(12.5px * var(--ui-scale, 1)); }
.mcp-tools { margin-top:6px; }
.mcp-tool { display:flex; align-items:center; gap:9px; padding:5px 2px; border-bottom:1px solid var(--border-soft); }
.mcp-tool-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.mcp-tool-name { font-size:calc(12.5px * var(--ui-scale, 1)); }
.mcp-tool-desc { font-size:calc(11.5px * var(--ui-scale, 1)); opacity:.65; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mcp-log { margin-top:11px; border-top:1px solid var(--border-soft); padding-top:7px; font-size:calc(11.5px * var(--ui-scale, 1)); opacity:.85; max-height:96px; overflow-y:auto; }
.mcp-log-line { padding:1.5px 0; }
.mcp-foot { display:flex; align-items:center; gap:10px; margin-top:11px; font-size:calc(12px * var(--ui-scale, 1)); }
.mcp-foot-note { opacity:.65; }
.mcp-panel .mono { font-family:monospace; }
@media (max-width: 760px) { .mcp-body { grid-template-columns:1fr; } .mcp-list { border-right:none; border-bottom:1px solid var(--border-soft); max-height:220px; } .mcp-form { grid-template-columns:1fr; } }
`
