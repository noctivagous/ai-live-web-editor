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
import {
  listFiles, readFile, writeFile, getConfig,
  listProjects, selectProject, createProject,
  type LauncherConfig, type ProjectInfo,
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
  const { leftW, setLeftW, rightW, setRightW, previewH, colDrag, rowDrag } = useSplitPanes()

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
    try { setConfig(await getConfig()) } catch { setConfig(null) }
  }

  async function save(silent = false) {
    const res = await writeFile(activePath, content)
    if (!silent) setStatus(res.ok ? `saved ${activePath} ${res.bytes}b @ ${new Date().toLocaleTimeString()}` : res.error)
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
          <span className={`pill mono ${keyTone}`} title={config ? `Model ${config.model}` : 'Launcher config unknown'}>
            <span className="dot" />{config ? (hasKey ? config.model : 'no API key') : 'config…'}
          </span>
          <select
            className="deck-btn"
            value={activeProject}
            onChange={e => { void handleSelectProject(e.target.value) }}
            title="Active project"
            style={{ maxWidth: 160 }}
          >
            {projects.length === 0 && <option value="">no projects</option>}
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
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

        <div className="panel" style={{ flex: 1 }}>
          <div className="panel-head">
            <span className="mono" style={{ fontWeight: 500 }}>{activePath}</span>
            <span className="sub" style={{ marginLeft: 'auto' }}>Monaco • Real FS • Vite HMR</span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <MonacoEditor path={activePath} value={content} onChange={setContent} theme={editorTheme} />
          </div>
          <HDivider onMouseDown={rowDrag()} title="Drag to resize preview" />
          <div style={{ height: `${previewH}%`, borderTop: '1px solid #1e1e23', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Preview key={activeProject} onChanged={() => { loadFiles(); setTimeout(() => loadFile(activePath), 500) }} onResult={setNotice} />
          </div>
        </div>
        <VDivider onMouseDown={colDrag(setRightW, -1)} title="Drag to resize chat" />
        <div className="panel" style={{ width: rightW, flexShrink: 0, minWidth: 0 }}>
          <Chat
            activePath={activePath}
            keyKnown={config === null ? undefined : hasKey}
            onNeedSetup={reopenSetup}
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
