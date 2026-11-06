import React, { useEffect, useRef, useState } from 'react'
import { FileTree } from './components/FileTree'
import { MonacoEditor } from './components/MonacoEditor'
import { Preview } from './components/Preview'
import { Chat } from './components/Chat'
import { NoticeDialog, SettingsModal } from './components/Modal'
import { SetupWizard } from './components/SetupWizard'
import { VDivider, HDivider } from './components/PaneDivider'
import { useSplitPanes } from './hooks/useSplitPanes'
import { SETUP_DONE_KEY, SETUP_DONE_VALUE, EDITOR_THEME_KEY } from './lib/styles'
import { loadCollapse, saveCollapse } from './lib/collapse'
import {
  listFiles, readFile, writeFile, getConfig, probeModels, saveAiConfig,
  getConnections, activateConnection, saveConnection,
  listProjects, selectProject, createProject,
  type LauncherConfig, type ProjectInfo, type ConnectionsPayload,
} from './lib/api'

function connTone(status: string): string {
  if (status.startsWith('real FS:')) return 'good'
  if (status.startsWith('Failed') || status.startsWith('connecting')) return status.startsWith('Failed') ? 'bad' : ''
  return ''
}

export default function App() {
  const [files, setFiles] = useState<string[]>([])
  const [activePath, setActivePath] = useState('/index.html')
  const [content, setContent] = useState('// loading...')
  const [status, setStatus] = useState('connecting to :4112...')
  const [notice, setNotice] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<LauncherConfig | null>(null)
  const [editorTheme, setEditorTheme] = useState(() => localStorage.getItem(EDITOR_THEME_KEY) || 'vs-dark')
  const [setupDone, setSetupDone] = useState(() => localStorage.getItem(SETUP_DONE_KEY) === SETUP_DONE_VALUE)
  // skip autosave for placeholder content and right after a file loads
  const skipSave = useRef(true)

  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [activeProject, setActiveProject] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [connPayload, setConnPayload] = useState<ConnectionsPayload | null>(null)
  const { leftW, setLeftW, rightW, setRightW, previewH, colDrag, rowDrag } = useSplitPanes()
  // Editor / preview collapse persists (like the split sizes above) so the
  // layout — relative positions and states — survives reloads.
  const [collapse, setCollapse] = useState(loadCollapse)

  function toggleCollapse(which: 'editor' | 'preview') {
    setCollapse(prev => {
      const next = { ...prev, [which]: !prev[which] }
      saveCollapse(next)
      return next
    })
  }

  async function loadFiles() {
    try {
      const data = await listFiles()
      setFiles(data.files)
      setStatus(`real FS: ${data.files.length} files @ ${data.root}`)
      if (data.files.length) {
        loadFile(data.files.includes(activePath) ? activePath : data.files[0])
      }
    } catch (e: unknown) { setStatus('Failed to connect to launcher at :4112 - is it running? ' + (e instanceof Error ? e.message : String(e))) }
  }

  async function loadFile(p: string) {
    setActivePath(p)
    const data = await readFile(p)
    skipSave.current = true
    setContent(data.content || data.error || '')
  }

  async function refreshConfig() {
    try {
      const data = await getConfig()
      setConfig(data)
      let conns: ConnectionsPayload | null = null
      try {
        conns = await getConnections()
        setConnPayload(conns)
      } catch { setConnPayload(null) }
      if (conns?.connections.length) {
        // Model choices come from the active connection's verified models.
        setModels([])
        return
      }
      if (data.hasApiKey || data.hasOpenAiKey) {
        try {
          const listed = await probeModels()
          const current = data.modelName || data.model
          const ids = listed.models?.length ? listed.models : []
          setModels(current && !ids.includes(current) ? [current, ...ids] : ids)
        } catch {
          const current = data.modelName || data.model
          setModels(current ? [current] : [])
        }
      } else setModels([])
    } catch { setConfig(null); setModels([]); setConnPayload(null) }
  }

  const activeConn = connPayload?.connections.find(c => c.id === connPayload.activeId) || null

  async function handleModel(id: string) {
    if (!id) return
    try {
      if (activeConn) {
        if (id === activeConn.model) return
        await saveConnection({ id: activeConn.id, presetId: activeConn.presetId, model: id })
      } else {
        if (id === (config?.modelName || config?.model)) return
        const next = await saveAiConfig({ model: id })
        setConfig(next)
      }
      setStatus(`model ${id}`)
      void refreshConfig()
    } catch (e: unknown) {
      setStatus('model save failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleConnection(id: string) {
    if (!id || id === connPayload?.activeId) return
    try {
      await activateConnection(id)
      const conn = connPayload?.connections.find(c => c.id === id)
      setStatus(`provider ${conn?.name || id} · ${conn?.model || ''}`)
      void refreshConfig()
    } catch (e: unknown) {
      setStatus('provider switch failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function save(silent = false) {
    const res = await writeFile(activePath, content)
    if (!res.ok) setStatus(res.error || 'save failed')
    else if (!silent) setStatus(`saved ${activePath} ${res.bytes}b @ ${new Date().toLocaleTimeString()}`)
    else setStatus(`autosaved ${activePath}`)
  }

  // autosave (skipped for placeholder and freshly loaded content)
  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return }
    const t = setTimeout(() => { if (content) save(true) }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  async function loadProjects() {
    try {
      const data = await listProjects()
      setProjects(data.projects || [])
      setActiveProject(data.active || '')
    } catch { /* launcher down */ }
  }

  async function handleSelectProject(id: string) {
    if (!id || id === activeProject) return
    setStatus(`switching to ${id}…`)
    try {
      await selectProject(id)
      setActiveProject(id)
      skipSave.current = true
      setActivePath('/index.html')
      await loadProjects()
      await loadFiles()
      setStatus(`project ${id}`)
    } catch (e: unknown) {
      setStatus('switch failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleNewProject() {
    const name = prompt('New project name (letters, numbers, dash, underscore)')
    if (!name) return
    setStatus(`creating ${name}…`)
    try {
      const data = await createProject(name.trim())
      skipSave.current = true
      setActivePath('/index.html')
      await loadProjects()
      if (data.active) setActiveProject(data.active)
      await loadFiles()
      setStatus(`project ${data.active}`)
    } catch (e: unknown) {
      setStatus('create failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  useEffect(() => { loadFiles(); refreshConfig(); loadProjects() }, [])

  useEffect(() => {
    const es = new EventSource('/api/projects/events')
    es.onmessage = () => { void loadProjects() }
    return () => es.close()
  }, [])

  function finishSetup() {
    localStorage.setItem(SETUP_DONE_KEY, SETUP_DONE_VALUE)
    setSetupDone(true)
    loadFiles()
    refreshConfig()
    loadProjects()
  }

  function reopenSetup() {
    localStorage.removeItem(SETUP_DONE_KEY)
    setShowSettings(false)
    setSetupDone(false)
  }

  function changeTheme(t: string) {
    setEditorTheme(t)
    localStorage.setItem(EDITOR_THEME_KEY, t)
  }

  const hasKey = Boolean(config?.hasApiKey ?? config?.hasOpenAiKey)
  const keyTone = config === null ? '' : hasKey ? 'good' : 'warn'

  return (
    <div className="deck-app">
      {!setupDone && <SetupWizard onDone={finishSetup} />}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◧</span>
          <span>AI Live Editor</span>
        </div>
        <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className={`pill mono ${connTone(status)}`} title={status}>
            <span className="dot" />{status.startsWith('real FS:') ? status.replace('real FS: ', '') : status.slice(0, 42)}
          </span>
          {activeConn ? (
            <>
              <select
                className={`pill mono ${keyTone}`}
                value={activeConn.id}
                onChange={e => { void handleConnection(e.target.value) }}
                title="Provider connection"
                style={{ maxWidth: 190 }}
              >
                {(connPayload?.connections || []).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                className={`pill mono ${keyTone}`}
                value={activeConn.model}
                onChange={e => { void handleModel(e.target.value) }}
                title="Chat model"
                style={{ maxWidth: 220 }}
              >
                {!activeConn.verifiedModels.some(m => m.id === activeConn.model) && (
                  <option value={activeConn.model}>{activeConn.model}</option>
                )}
                {activeConn.verifiedModels
                  .filter(m => m.modalities.includes('text'))
                  .map(m => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
              </select>
            </>
          ) : (
            <select
              className={`pill mono ${keyTone}`}
              value={hasKey ? (config?.modelName || '') : ''}
              disabled={!hasKey}
              onChange={e => { void handleModel(e.target.value) }}
              title="Chat model"
            >
              {!hasKey && <option value="">{config ? 'no API key' : 'config…'}</option>}
              {hasKey && (config?.modelName && !models.includes(config.modelName)) && (
                <option value={config.modelName}>{config.modelName}</option>
              )}
              {models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          <select
            className="deck-btn"
            value={activeProject}
            onChange={e => {
              const id = e.target.value
              if (id === '__refresh') {
                void loadProjects()
                void loadFiles()
                return
              }
              void handleSelectProject(id)
            }}
            title="Active project"
            style={{ maxWidth: 180 }}
          >
            {projects.length === 0 && <option value="">no projects</option>}
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
            <hr />
            <option value="__refresh">Refresh list</option>
          </select>
          <button className="deck-btn" onClick={() => { void handleNewProject() }} title="Create a new app under projects/">New project</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="deck-btn" onClick={() => setShowSettings(true)} title="Settings">Settings</button>
          <button className="deck-btn" onClick={() => save()}>Save</button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 10, padding: 12 }}>
        <div className="panel" style={{ width: leftW, flexShrink: 0 }}>
          <div className="panel-head">Files <span className="sub">{files.length}</span></div>
          <FileTree files={files} active={activePath} onSelect={loadFile} onNew={async () => {
            const p = prompt('Path e.g. /src/new.tsx'); if (!p) return;
            await writeFile(p, '// new'); loadFiles(); loadFile(p)
          }} />
        </div>
        <VDivider onMouseDown={colDrag(setLeftW, 1)} title="Drag to resize file tree" />

        <div className="panel" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <div className="panel-head">
            <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => toggleCollapse('editor')} title={collapse.editor ? 'Expand editor' : 'Collapse editor'}>
              {collapse.editor ? '▸' : '▾'}
            </button>
            <span className="mono" style={{ fontWeight: 500 }}>{activePath}</span>
            <span className="sub" style={{ marginLeft: 'auto' }}>Monaco • Real FS • Vite HMR</span>
          </div>
          {!collapse.editor && (
            <div style={{ flex: `${Math.max(15, 100 - previewH)} 1 0`, minHeight: 0 }}>
              <MonacoEditor path={activePath} value={content} onChange={setContent} theme={editorTheme} />
            </div>
          )}
          {!collapse.editor && !collapse.preview && (
            <HDivider onMouseDown={rowDrag()} title="Drag to resize preview" />
          )}
          <div style={{ flex: collapse.preview ? '0 0 auto' : collapse.editor ? '1 1 0' : `${previewH} 1 0`, minHeight: 0, borderTop: '1px solid #1e1e23', display: 'flex', flexDirection: 'column' }}>
            <Preview
              key={activeProject}
              hmrUrl={config?.previewHmrUrl || 'http://localhost:5173'}
              collapsed={collapse.preview}
              onToggleCollapse={() => toggleCollapse('preview')}
              onChanged={() => { loadFiles(); setTimeout(() => loadFile(activePath), 500) }}
              onResult={setNotice}
            />
          </div>
        </div>
        <VDivider onMouseDown={colDrag(setRightW, -1)} title="Drag to resize chat" />
        <div className="panel" style={{ width: rightW, flexShrink: 0, minWidth: 0, minHeight: 0 }}>
          <Chat
            key={activeProject}
            projectId={activeProject}
            activePath={activePath}
            keyKnown={config === null ? undefined : hasKey}
            onNeedSetup={reopenSetup}
            onOpenPath={(p) => { void loadFile(p) }}
            onAfterChat={() => { loadFiles(); setTimeout(() => loadFile(activePath), 400) }}
          />
        </div>
      </div>

      <NoticeDialog notice={notice} onClose={() => setNotice(null)} />
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        config={config}
        editorTheme={editorTheme}
        onTheme={changeTheme}
        onReplayWizard={reopenSetup}
        onConfigSaved={() => { void refreshConfig() }}
      />
    </div>
  )
}
