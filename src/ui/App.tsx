import React, { useEffect, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ChevronRight, Expand, FileCog, FolderOpen, Layers, LayoutDashboard, LibraryBig, Maximize2, Network, Settings, SquareArrowOutUpRight, Wand2, X, Zap } from 'lucide-react'
import { FileTree } from './components/FileTree'
import { Library } from './components/Library'
import { MonacoEditor } from './components/MonacoEditor'
import { Preview } from './components/Preview'
import { Chat } from './components/Chat'
import { NoticeDialog } from './components/Modal'
import { SettingsWindow } from './components/SettingsWindow'
import { AgentActionsMenu } from './components/AgentActionsMenu'
import { ActionsPalette } from './components/ActionsPalette'
import { ActionCommandPalette } from './components/ActionCommandPalette'
import { WizardsMenu } from './components/WizardsMenu'
import { InsertIcon, HelpIcon, CaretIcon, ProjectIcon } from './components/menuIcons'
import { actionAvailability, actionById } from './lib/agentActions'
import { runAction } from './lib/actionDispatch'
import { wizardById, wizardRowState } from './lib/wizards'
import { MenuStrip } from './components/MenuStrip'
import { ButtonGrid } from './components/ButtonGrid'
import { AddFeatureWizard } from './components/AddFeatureWizard'
import { FileActionsMenu } from './components/FileActionsMenu'
import { FacetView } from './components/FacetView'
import { formatRoute, parseRoute, type AppLayout, type FacetId, type RouteModal } from './lib/layoutRoute'
import { themeById } from './lib/themes'
import { SETTING_SECTIONS } from './lib/settingsSchema'
import { loadUiPrefs, saveUiPrefs, UI_PREFS_CHANGED_EVENT, type UiPrefs } from './lib/uiPrefs'
import { applyUiTheme } from './lib/themes'
import { ImportProgressDialog, ImportReportDialog, OverLimitDialog, ReimportButton } from './components/FolderImport'
import { SyncConflictsDialog, SyncStatusBar, type ConflictChoice, type ConflictItem } from './components/FolderSync'
import {
  applyCaps, classifyPath, defaultCaps, fmtBytes, isFolderImportSupported, loadFolderHandle, pickFolder,
  repickFolder, sanitizeProjectName,
  saveFolderHandle, uploadImport,
  type ImportBatchResult, type ImportProgress, type PickedFolder, type SkippedEntry,
} from './lib/folderImport'
import {
  SYNC_POLL_MS, clearSyncRecord, deleteDiskEntry, ensureWritePermission, hasWritePermission,
  loadSyncRecord, pickSyncFolder, planSync, readDiskText, saveSyncRecord, snapshotDisk,
  uploadSyncBatches, writeDiskText,
  type SyncBaseline, type SyncStatus,
} from './lib/folderSync'
import { SetupWizard } from './components/SetupWizard'
import { PlanOverlay } from './components/PlanOverlay'
import { GraphOverlay } from './components/GraphOverlay'
import { McpManager } from './components/McpManager'
import { SkillsPanel } from './components/SkillsPanel'
import { OpenTabs } from './components/OpenTabs'
import { loadPinnedTabs, savePinnedTabs } from './lib/openTabs'
import { VDivider, HDivider } from './components/PaneDivider'
import { useSplitPanes } from './hooks/useSplitPanes'
import { SETUP_DONE_KEY, SETUP_DONE_VALUE, EDITOR_THEME_KEY } from './lib/styles'
import { loadCollapse, saveCollapse } from './lib/collapse'
import { publishWorkflowChanged, subscribeWorkflow } from './lib/workflowSync'
import {
  listFiles, readFile, writeFile, renameFsPath, deleteFsPath, mkdirFsPath, getConfig, getFeatures, getProjectConfig, getWorkflow, postProjectConfig, postWorkflow, probeModels, saveAiConfig,
  getConnections, activateConnection, saveConnection,
  listProjects, selectProject, createProject, fetchSyncChanges,
  getAppSettings,
  type LauncherConfig, type ProjectInfo, type ProjectSetupInfo, type ConnectionsPayload,
} from './lib/api'
import { pushAppSettings } from './lib/appSettingsSync'

function connTone(status: string): string {
  if (status.startsWith('real FS:')) return 'good'
  if (status.startsWith('Failed') || status.startsWith('connecting')) return status.startsWith('Failed') ? 'bad' : ''
  return ''
}

/**
 * Fixed-width status text with a ticker transition: the capsule never
 * changes width (sized to "000 files"), so neighbors don't shift when
 * the count or status changes. On change the outgoing text scrolls
 * left and out, revealing the incoming text underneath it.
 */
function TickerText({ text }: { text: string }) {
  const [state, setState] = useState({ shown: text, leaving: null as string | null })
  useEffect(() => {
    setState(s => (s.shown === text ? s : { shown: text, leaving: s.shown }))
  }, [text])
  useEffect(() => {
    if (state.leaving === null) return
    const t = setTimeout(() => setState(s => ({ ...s, leaving: null })), 450)
    return () => clearTimeout(t)
  }, [state.leaving])
  return (
    <span className="tick-view" aria-hidden={false}>
      {state.leaving !== null && <span key="old" className="tick-old">{state.leaving}</span>}
      <span key="new" className="tick-cur">{state.shown}</span>
    </span>
  )
}

export default function App() {
  const [files, setFiles] = useState<string[]>([])
  const [fileDirs, setFileDirs] = useState<string[]>([])
  const [fileMtimes, setFileMtimes] = useState<Record<string, number>>({})
  const [leftView, setLeftView] = useState<'files' | 'library' | 'actions'>('files')
  // ⌘K command search over the action registry (slice 2).
  const [cmdkOpen, setCmdkOpen] = useState(false)
  // Layouts + routes (slice 5): Workbench is the default; the Facets
  // layout is the alternative, one route per facet (#/facets/…).
  const [route, setRoute] = useState<AppLayout>(() => parseRoute(window.location.hash))
  const [lastFacet, setLastFacet] = useState<FacetId>('features')
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { if (route.kind === 'facets') setLastFacet(route.facet) }, [route])
  function navigate(layout: AppLayout) {
    const h = formatRoute(layout)
    if (window.location.hash !== h) window.location.hash = h
    else setRoute(layout)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdkOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [activePath, setActivePath] = useState('/index.html')
  const [content, setContent] = useState('// loading...')
  const [status, setStatus] = useState('connecting to :4112...')
  const [notice, setNotice] = useState<string | null>(null)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  // Agent Actions menu (slice 1): the registry-driven card menu in the
  // top bar. Feature-graph presence is fetched per project so graph
  // actions can grey with their reason; null = not known yet.
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  // Wizards (slice 3): the per-facet Wizards menu + the open wizard.
  const [wizardsMenuOpen, setWizardsMenuOpen] = useState(false)
  // Top-bar Insert + Help dropdowns: the same registry rows as the
  // classic menu strip's pops, so the bar has menu parity when the
  // strip is off.
  const [insertOpen, setInsertOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  // Top-bar Project menu: the classic Project menu's rows in the bar, so
  // New/Import/Open/Save live in one dropdown instead of four buttons.
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [wizard, setWizard] = useState<string | null>(null)
  // Context palette (slice 4): the preview mark lives in the launcher
  // workflow state; App mirrors it so page-context actions know
  // whether a page is in the preview. undefined = not known yet.
  const [markedPath, setMarkedPath] = useState<string | null | undefined>(undefined)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  useEffect(() => {
    if (!fileMenuOpen) return
    const close = () => setFileMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [fileMenuOpen])
  const [hasFeatureGraph, setHasFeatureGraph] = useState<boolean | null>(null)
  // Planning (§O): the /plan overlay floats over files + middle; chat stays live.
  const [planOpen, setPlanOpen] = useState<{ level?: number, goal?: string, n: number } | null>(null)
  // Feature graph: the /graph overlay shares the planner's float
  // space; the two never stack. The graph is route-driven
  // (#/facets/features/graph/report|diagram); the ai-live:graph-open
  // event stays as a thin shim so existing dispatchers (chat /graph,
  // FacetView, agent actions, /graph-update) keep working.
  const graphView = route.kind === 'facets' ? route.view : undefined
  // The graph pane's expand control: stretched over the chat
  // column when the user wants the whole window for the graph.
  const [graphExpanded, setGraphExpanded] = useState(false)
  function openGraph(modal?: RouteModal) {
    setPlanOpen(null)
    navigate({ kind: 'facets', facet: 'features', view: 'graph-report', ...(modal ? { modal } : {}) })
  }
  function openGraphDiagram(modal?: RouteModal) {
    setPlanOpen(null)
    navigate({ kind: 'facets', facet: 'features', view: 'graph-diagram', ...(modal ? { modal } : {}) })
  }
  function closeGraphView() {
    if (route.kind !== 'facets' || !route.view) return
    navigate({ kind: 'facets', facet: route.facet, ...(route.modal ? { modal: route.modal } : {}) })
  }
  // Settings is a route-driven backdrop modal (?globalModal=settings&tab=…):
  // opening navigates, closing strips the query, so Back closes it.
  function openSettings(section: string) {
    navigate({ ...route, modal: { name: 'settings', tab: section } })
  }
  function closeModal() {
    const { modal: _dropped, ...rest } = route
    navigate(rest)
  }
  useEffect(() => {
    const onGraphOpen = () => {
      const cur = parseRoute(window.location.hash)
      openGraph(cur.modal)
    }
    window.addEventListener('ai-live:graph-open', onGraphOpen)
    return () => window.removeEventListener('ai-live:graph-open', onGraphOpen)
  }, [])
  useEffect(() => {
    const onPlanOpen = (e: Event) => {
      const cur = parseRoute(window.location.hash)
      if (cur.kind === 'facets' && cur.view) {
        const { view: _dropped, ...rest } = cur
        navigate(rest)
      }
      const d = (e as CustomEvent).detail as { level?: number, goal?: string } | undefined
      const open = (level?: number) => setPlanOpen(prev => ({ level, goal: d?.goal, n: (prev?.n ?? 0) + 1 }))
      if (d?.level) { open(d.level); return }
      // No level named: the project's default plan level applies (§O —
      // defaults ride project.ai.json; Settings → Plans & Workflow).
      void getProjectConfig()
        .then(r => open(r.config.planLevel))
        .catch(() => open(undefined))
    }
    window.addEventListener('ai-live:plan-open', onPlanOpen)
    return () => window.removeEventListener('ai-live:plan-open', onPlanOpen)
  }, [])
  useEffect(() => {
    if (!settingsMenuOpen) return
    const close = () => setSettingsMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [settingsMenuOpen])
  useEffect(() => {
    if (!actionsMenuOpen) return
    const close = () => setActionsMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [actionsMenuOpen])
  useEffect(() => {
    if (!wizardsMenuOpen) return
    const close = () => setWizardsMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [wizardsMenuOpen])
  useEffect(() => {
    if (!insertOpen) return
    const close = () => setInsertOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [insertOpen])
  useEffect(() => {
    if (!helpOpen) return
    const close = () => setHelpOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [helpOpen])
  useEffect(() => {
    if (!projectOpen) return
    const close = () => setProjectOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [projectOpen])
  useEffect(() => {
    if (!projectMenuOpen) return
    const close = () => setProjectMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [projectMenuOpen])

  /** One registry row for the top-bar Insert dropdown (mirrors the strip). */
  function insertActionRow(id: string) {
    const a = actionById(id)
    if (!a) return null
    const v = actionAvailability(a, actionCtx)
    return (
      <button
        key={a.id}
        type="button"
        role="menuitem"
        className="ms-row"
        disabled={!v.available}
        title={v.available ? a.title : `${a.title} — ${v.reason ?? ''}`}
        onClick={() => { setInsertOpen(false); runAction(a, actionCtx, { openLibrary: () => setLeftView('library'), openSettings }) }}
      >
        <span className="ms-row-main">
          <span className="ms-row-title">{a.title.replace(/…$/, '')}</span>
          <span className="ms-row-sub">{v.available ? a.blurb : (v.reason ?? a.blurb)}</span>
        </span>
        {a.writes && <span className="ms-tag">writes files</span>}
      </button>
    )
  }

  const [config, setConfig] = useState<LauncherConfig | null>(null)
  const [editorTheme, setEditorTheme] = useState(() => localStorage.getItem(EDITOR_THEME_KEY) || 'vs-dark')
  const [uiPrefsState, setUiPrefsState] = useState<UiPrefs>(() => loadUiPrefs())
  useEffect(() => {
    const onPrefs = () => setUiPrefsState(loadUiPrefs())
    window.addEventListener(UI_PREFS_CHANGED_EVENT, onPrefs)
    return () => window.removeEventListener(UI_PREFS_CHANGED_EVENT, onPrefs)
  }, [])
  // Grid or list for the top-bar dropdowns — same pref as the strip pops.
  const menuGrid = uiPrefsState.menuLayout !== 'list'
  const insertPopClass = menuGrid ? 'ms-pop grid' : 'ms-pop'
  const rightPopClass = menuGrid ? 'ms-pop grid right' : 'ms-pop'
  // Settings → Themes: the theme + UI font size live on the document
  // root (data-ui-theme selects the token block in index.css;
  // --ui-scale multiplies every CSS font size).
  useEffect(() => {
    applyUiTheme(uiPrefsState.uiTheme, uiPrefsState.uiFontSize)
  }, [uiPrefsState.uiTheme, uiPrefsState.uiFontSize])
  // Settings → Header Bar → Show description lines: off hides the
  // description line under every menu-pop item (titles, tags, and
  // stub reasons stay). One root class, so every menu surface —
  // classic strip pops and top-bar pops — follows it.
  useEffect(() => {
    try {
      document.documentElement.classList.toggle('hide-menu-desc', !uiPrefsState.menuDescriptions)
    } catch { /* non-DOM test env */ }
  }, [uiPrefsState.menuDescriptions])
  const [setupDone, setSetupDone] = useState(() => localStorage.getItem(SETUP_DONE_KEY) === SETUP_DONE_VALUE)
  // App settings converge on boot: the server's SQLite store is the
  // source of truth and overwrites this browser's cache. No migration:
  // an empty server leaves local settings alone, and the first save
  // after that pushes them up (last writer wins across browsers).
  useEffect(() => {
    void (async () => {
      try {
        const s = await getAppSettings()
        if (!s.ok) return
        const hasServer = Boolean(s.uiPrefs || s.editorTheme || s.setupDone)
        if (!hasServer) return
        if (s.uiPrefs) {
          saveUiPrefs(s.uiPrefs, undefined, { sync: false })
          setUiPrefsState(loadUiPrefs())
        }
        if (typeof s.editorTheme === 'string' && s.editorTheme) setEditorTheme(s.editorTheme)
        if (typeof s.setupDone === 'boolean') setSetupDone(s.setupDone)
      } catch { /* launcher down: the local cache stands alone */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // skip autosave for placeholder content and right after a file loads
  const skipSave = useRef(true)

  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [activeProject, setActiveProject] = useState('')
  useEffect(() => {
    if (!activeProject) { setMarkedPath(undefined); return }
    let live = true
    const refresh = () => {
      void getWorkflow()
        .then(wf => { if (live) setMarkedPath(wf.previewMark ?? null) })
        .catch(() => { if (live) setMarkedPath(undefined) })
    }
    refresh()
    const unsub = subscribeWorkflow(refresh)
    return () => { live = false; unsub() }
  }, [activeProject])
  useEffect(() => {
    if (!activeProject) { setHasFeatureGraph(null); return }
    let live = true
    void getFeatures()
      .then(r => { if (live) setHasFeatureGraph(!!r.graph) })
      .catch(() => { if (live) setHasFeatureGraph(null) })
    return () => { live = false }
  }, [activeProject, graphView])
  /** The active project's designated start page (project.ai.json
   * entry), shared by the file pane's badge and the Preview. */
  const [startPage, setStartPage] = useState<string | null>(null)
  useEffect(() => {
    if (!activeProject) { setStartPage(null); return }
    let live = true
    void getProjectConfig()
      .then(r => { if (live) setStartPage(r.config.entry ?? null) })
      .catch(() => { if (live) setStartPage(null) })
    return () => { live = false }
  }, [activeProject])

  /** Promote a file to the start page: write the manifest, and mark
   * the file so the preview shows what was just designated. */
  async function handleSetStartPage(path: string) {
    const entry = path.replace(/^\//, '')
    try {
      const r = await postProjectConfig({ entry })
      setStartPage(r.config.entry ?? entry)
      await postWorkflow({ previewMark: path })
      publishWorkflowChanged()
      setStatus(`start page: ${entry}`)
    } catch {
      setNotice(`Could not set the start page to ${entry}.`)
    }
  }
  // Folder import: Import is a copy, Open is live two-way sync.
  const [overLimit, setOverLimit] = useState<{
    pick: PickedFolder
    plan: ReturnType<typeof applyCaps>
    repick: null | (() => Promise<Omit<PickedFolder, 'dirHandle'>>)
    mode: 'import' | 'sync'
  } | null>(null)
  const [importProg, setImportProg] = useState<{ name: string; progress: ImportProgress } | null>(null)
  const [importReport, setImportReport] = useState<{
    name: string
    result: ImportBatchResult
    skipped: SkippedEntry[]
    mode?: 'import' | 'sync'
    syncDirName?: string
  } | null>(null)
  // Folder sync (Open): live two-way sync with the picked folder.
  const [syncSession, setSyncSession] = useState<{
    projectId: string
    dirName: string
    status: SyncStatus
    message: string
    lastAt: number | null
  } | null>(null)
  const [syncConflicts, setSyncConflicts] = useState<ConflictItem[] | null>(null)
  const syncHandleRef = useRef<PickedFolder['dirHandle'] | null>(null)
  const syncBaseRef = useRef<SyncBaseline | null>(null)
  const syncBusyRef = useRef(false)
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

  /** Expand one section and collapse the other (maximize). */
  function expandOnly(which: 'editor' | 'preview') {
    setCollapse(prev => {
      const next = { ...prev, editor: which !== 'editor', preview: which !== 'preview' }
      saveCollapse(next)
      return next
    })
  }

  /** Fullscreen overlay for one pane (10px margin over the app). Session-only. */
  const [overlay, setOverlay] = useState<null | 'editor' | 'preview'>(null)
  /** Open the overlayed pane on the launcher server: the editor boots
   * the SPA into a project+path deep link, the preview opens the
   * served project route directly. */
  function openOverlayUrl(mode: 'tab' | 'window') {
    if (!overlay) return
    const url = overlay === 'editor'
      ? `/?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(activePath)}`
      : `/projects/${(startPage || 'index.html').replace(/^\//, '')}`
    window.open(url, '_blank', mode === 'tab' ? 'noopener' : 'noopener,width=1280,height=860')
  }
  useEffect(() => {
    if (!overlay) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlay(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlay])

  async function loadFiles(nextActive?: string) {
    try {
      const data = await listFiles()
      setFiles(data.files)
      setFileDirs(data.dirs || [])
      setFileMtimes(data.mtimes || {})
      setStatus(`real FS: ${data.files.length} files @ ${data.root}`)
      const wanted = nextActive ?? activePath
      if (data.files.length) {
        loadFile(data.files.includes(wanted) ? wanted : data.files[0])
      }
    } catch (e: unknown) { setStatus('Failed to connect to launcher at :4112 - is it running? ' + (e instanceof Error ? e.message : String(e))) }
  }

  // File-browser operations: each returns the API result so the pane can
  // show the server's own error; on success the list is reloaded from
  // the server (the pane keeps no shadow state of the disk).
  async function createFileFromPane(p: string) {
    const r = await writeFile(p, '')
    if (r.ok) { await loadFiles(p) }
    return { ok: Boolean(r.ok), error: r.error as string | undefined }
  }
  async function createFolderFromPane(p: string) {
    const r = await mkdirFsPath(p)
    if (r.ok) await loadFiles()
    return r
  }
  async function renameFromPane(from: string, to: string) {
    const r = await renameFsPath(from, to)
    if (r.ok) {
      const next = activePath === from || activePath.startsWith(from + '/')
        ? to + activePath.slice(from.length)
        : undefined
      await loadFiles(next)
    }
    return r
  }
  async function deleteFromPane(p: string, recursive: boolean) {
    const r = await deleteFsPath(p, recursive)
    if (r.ok) await loadFiles()
    return r
  }
  async function duplicateFromPane(p: string) {
    const data = await readFile(p)
    if (data.error || data.content === undefined) return { ok: false, error: data.error || 'Could not read the file' }
    const slash = p.lastIndexOf('/')
    const dir = p.slice(0, slash)
    const name = p.slice(slash + 1)
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = `${dir}/${stem} copy${ext}`
    for (let n = 2; files.includes(candidate); n++) candidate = `${dir}/${stem} copy ${n}${ext}`
    const r = await writeFile(candidate, data.content)
    if (r.ok) await loadFiles(candidate)
    return { ok: Boolean(r.ok), error: r.error as string | undefined }
  }

  async function loadFile(p: string) {
    setActivePath(p)
    const data = await readFile(p)
    skipSave.current = true
    setContent(data.content || data.error || '')
  }

  // File ↔ URL sync: the open file rides ?file=. A deep link or
  // Back/Forward step loads that file; any local open updates the URL.
  // The write-back skips transitions the route itself introduced (the
  // loader above owns those), so a stale URL can never freeze out
  // later clicks the way a plain inequality guard would.
  const routeFile = route.file
  const prevRouteFileRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (routeFile && routeFile !== activePath) void loadFile(routeFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFile])
  useEffect(() => {
    const cur = parseRoute(window.location.hash)
    const routeChanged = cur.file !== prevRouteFileRef.current
    prevRouteFileRef.current = cur.file
    if (routeChanged) return
    if ((cur.file ?? null) !== activePath) navigate({ ...cur, file: activePath })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath])

  // Pinned tabs (the tree's eye icons): kept-open files in the editor
  // tab strip. The active file is separate transient state — a tab
  // need not be pinned to be open in the editor or the URL.
  const [pins, setPins] = useState<string[]>([])
  useEffect(() => {
    if (!activeProject) { setPins([]); return }
    setPins(loadPinnedTabs(activeProject))
  }, [activeProject])
  function persistPins(next: string[]) {
    setPins(next)
    savePinnedTabs(activeProject, next)
  }
  async function activateFile(p: string) {
    await loadFile(p)
    try {
      await postWorkflow({ previewMark: p })
      publishWorkflowChanged()
    } catch { /* the next snapshot refresh reconciles */ }
  }
  function togglePin(path: string) {
    if (pins.includes(path)) {
      persistPins(pins.filter(p => p !== path))
    } else {
      persistPins([...pins, path])
      void activateFile(path)
    }
  }
  function unpinTab(path: string) {
    const next = pins.filter(p => p !== path)
    persistPins(next)
    // The unpinned file stays open transiently while active, so there
    // is always at least one open file; otherwise fall back to the
    // most recently pinned tab.
    if (activePath === path && next.length > 0) void activateFile(next[next.length - 1])
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

  /** Where to land after opening a project: the detected entry page
   * when the folder has an unambiguous one, else /index.html —
   * loadFiles falls back to the first file when that path is absent,
   * so a folder of loose files lands on its first file, not a 404. */
  function landingPath(setup?: ProjectSetupInfo): string {
    return setup?.entry ? `/${setup.entry}` : '/index.html'
  }

  async function handleSelectProject(id: string) {
    if (!id || id === activeProject) return
    setStatus(`switching to ${id}…`)
    try {
      const data = await selectProject(id)
      setActiveProject(id)
      skipSave.current = true
      const landing = landingPath(data.setup)
      setActivePath(landing)
      await loadProjects()
      await loadFiles(landing)
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
      setStatus(data.installError
        ? `project ${data.active} — npm install failed: ${data.installError}. Run npm install in the project folder to finish setup.`
        : `project ${data.active}`)
    } catch (e: unknown) {
      setStatus('create failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  /* Folder import (Step 10): pick → maybe over-limit dialog → name →
   * batched upload → report. A copy, never a live sync. */
  async function runImportFlow(getPick: () => Promise<PickedFolder>) {
    let pick: PickedFolder
    try {
      setStatus('reading folder…')
      pick = await getPick()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('AbortError') || (e instanceof DOMException && e.name === 'AbortError')) {
        setStatus('folder pick cancelled')
        return
      }
      setNotice(`Could not read the folder: ${msg}`)
      setStatus('folder read failed')
      return
    }
    if (pick.files.length === 0) {
      setNotice(`No importable files in “${pick.dirName}”. Only text source files are copied; dependencies (.git, node_modules), build output, and binaries are skipped.`)
      setStatus('nothing to import')
      return
    }
    const plan = applyCaps(pick.files.map(f => ({ path: f.path, size: f.file.size })), defaultCaps())
    // Over the caps (default 50 MB / 2000 files)? Ask — never silently cut.
    if (plan.over) {
      setOverLimit({ pick, plan, repick: null, mode: 'import' })
      return
    }
    await startUpload(pick, pick.files, false)
  }

  async function handleOpenFolder() {
    if (!isFolderImportSupported()) {
      setNotice('Opening a folder needs Chrome, Edge, or Opera on desktop (the File System Access picker is Chromium-only). Alternatives: run this editor inside your own app directory (Vite-plugin path), or copy the folder into projects/ by hand.')
      return
    }
    await runImportFlow(() => pickFolder())
  }

  async function handleReimport(getFolder: () => Promise<Omit<PickedFolder, 'dirHandle'>>) {
    const repick = async () => getFolder()
    let pick: Omit<PickedFolder, 'dirHandle'>
    try {
      setStatus('reading folder…')
      pick = await repick()
    } catch (e: unknown) {
      setNotice(`Could not re-read the folder: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (pick.files.length === 0) {
      setNotice('No importable files in the original folder anymore.')
      return
    }
    const stub = {
      dirName: pick.dirName,
      dirHandle: null as unknown as PickedFolder['dirHandle'],
      files: pick.files,
      skipped: pick.skipped,
      totalBytes: pick.totalBytes,
    }
    const plan = applyCaps(pick.files.map(f => ({ path: f.path, size: f.file.size })), defaultCaps())
    if (plan.over) {
      setOverLimit({ pick: stub, plan, repick, mode: 'import' })
      return
    }
    const ok = confirm(`Re-import replaces every file in project “${activeProject}” with a fresh copy from “${pick.dirName}” (${pick.files.length} files, ${fmtBytes(pick.totalBytes)}). Continue?`)
    if (!ok) return
    await startUpload({ ...stub, dirHandle: stub.dirHandle }, stub.files, true)
  }

  function handleOverLimitChoice(choice: 'cancel' | 'capped' | 'all') {
    const pending = overLimit
    setOverLimit(null)
    if (!pending || choice === 'cancel') {
      setStatus('import cancelled (over limit)')
      return
    }
    const files = choice === 'capped'
      ? pending.pick.files.filter(f => pending.plan.within.some(w => w.path === f.path))
      : pending.pick.files
    // Open (live sync) shares the capped initial copy; the loop converges the rest.
    if (pending.mode === 'sync') {
      void startSyncUpload(pending.pick, files)
      return
    }
    // Fresh picks (repick === null) always create a new project; re-imports overwrite.
    const overwrite = pending.repick !== null
    if (pending.repick) {
      const ok = confirm(`Re-import replaces every file in project “${activeProject}” with a fresh copy (${files.length} files). Continue?`)
      if (!ok) return
    }
    void startUpload(pending.pick, files, overwrite)
  }

  async function startUpload(
    pick: PickedFolder,
    files: { path: string; file: File }[],
    overwrite: boolean,
  ) {
    const suggested = sanitizeProjectName(overwrite ? activeProject : pick.dirName)
    const raw = overwrite ? suggested : prompt('Import as project (letters, numbers, dash, underscore)', suggested)
    if (!raw) {
      setStatus('import cancelled')
      return
    }
    const name = sanitizeProjectName(raw)
    setStatus(`importing ${files.length} files → ${name}…`)
    setImportProg({ name, progress: { sentFiles: 0, totalFiles: files.length, sentBytes: 0, totalBytes: files.reduce((n, f) => n + f.file.size, 0), phase: 'uploading' } })
    try {
      const result = await uploadImport(name, files, {
        overwrite,
        onProgress: (progress) => setImportProg({ name, progress }),
      })
      setImportProg(null)
      if (pick.dirHandle) {
        try { await saveFolderHandle(name, pick.dirHandle) } catch { /* re-import is optional */ }
      }
      skipSave.current = true
      const landing = landingPath(result.setup)
      setActivePath(landing)
      await loadProjects()
      if (result.active) setActiveProject(result.active)
      await loadFiles(landing)
      setStatus(`imported ${name}`)
      setImportReport({ name, result, skipped: pick.skipped })
    } catch (e: unknown) {
      setImportProg(null)
      setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
      setStatus('import failed')
    }
  }

  /* Folder sync (Open): pick with readwrite, copy in, then stay synced. */
  async function handleOpenSync() {
    if (!isFolderImportSupported()) {
      setNotice('Live sync needs Chrome, Edge, or Opera on desktop (the File System Access picker is Chromium-only). Alternatives: run this editor inside your own app directory (Vite-plugin path), or use Import for a copy.')
      return
    }
    let handle: PickedFolder['dirHandle']
    try {
      setStatus('reading folder…')
      handle = await pickSyncFolder()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('AbortError') || (e instanceof DOMException && e.name === 'AbortError')) {
        setStatus('open cancelled')
        return
      }
      setNotice(`Could not read the folder: ${msg}`)
      setStatus('folder read failed')
      return
    }
    if (!(await ensureWritePermission(handle))) {
      setNotice('Live sync needs read + write permission for the picked folder. Nothing was copied — use Import for a permission-free copy instead.')
      setStatus('sync permission denied')
      return
    }
    let rest: Omit<PickedFolder, 'dirHandle'>
    try {
      rest = await repickFolder(handle)
    } catch (e: unknown) {
      setNotice(`Could not read the folder: ${e instanceof Error ? e.message : String(e)}`)
      setStatus('folder read failed')
      return
    }
    const pick: PickedFolder = { ...rest, dirHandle: handle }
    if (pick.files.length === 0) {
      setNotice(`No importable files in “${pick.dirName}”. Only text source files sync; dependencies (.git, node_modules), build output, and binaries are skipped.`)
      setStatus('nothing to open')
      return
    }
    const plan = applyCaps(pick.files.map(f => ({ path: f.path, size: f.file.size })), defaultCaps())
    if (plan.over) {
      setOverLimit({ pick, plan, repick: () => repickFolder(handle), mode: 'sync' })
      return
    }
    await startSyncUpload(pick, pick.files)
  }

  async function startSyncUpload(pick: PickedFolder, files: { path: string; file: File }[]) {
    const suggested = sanitizeProjectName(pick.dirName)
    const raw = prompt('Open live-synced project (letters, numbers, dash, underscore)', suggested)
    if (!raw) {
      setStatus('open cancelled')
      return
    }
    const name = sanitizeProjectName(raw)
    setStatus(`opening ${files.length} files → ${name}…`)
    setImportProg({ name, progress: { sentFiles: 0, totalFiles: files.length, sentBytes: 0, totalBytes: files.reduce((n, f) => n + f.file.size, 0), phase: 'uploading' } })
    try {
      const result = await uploadImport(name, files, {
        onProgress: (progress) => setImportProg({ name, progress }),
      })
      setImportProg(null)
      if (pick.dirHandle) {
        try { await saveFolderHandle(name, pick.dirHandle) } catch { /* resume is optional */ }
      }
      // Baseline both sides so the first pass is quiet.
      const { snapshot } = await snapshotDisk(pick.dirHandle)
      const srv = await fetchSyncChanges(0, [])
      const baseline: SyncBaseline = { disk: snapshot, serverPaths: srv.changed.map(c => c.path), at: srv.now }
      const projectId = result.active || name
      saveSyncRecord(projectId, { dirName: pick.dirName, baseline })
      syncHandleRef.current = pick.dirHandle
      syncBaseRef.current = baseline
      skipSave.current = true
      const landing = landingPath(result.setup)
      setActivePath(landing)
      await loadProjects()
      setActiveProject(projectId)
      await loadFiles(landing)
      setSyncSession({ projectId, dirName: pick.dirName, status: 'live', message: 'live sync on — changes flow both ways', lastAt: Date.now() })
      setStatus(`opened ${name} — live sync on`)
      setImportReport({ name, result, skipped: pick.skipped, mode: 'sync', syncDirName: pick.dirName })
    } catch (e: unknown) {
      setImportProg(null)
      setNotice(`Open failed: ${e instanceof Error ? e.message : String(e)}`)
      setStatus('open failed')
    }
  }

  function describeSyncPass(up: number, down: number, skippedBinary: number): string {
    const skip = skippedBinary > 0 ? ` · ${skippedBinary} non-text skipped` : ''
    if (up + down === 0) return skippedBinary > 0 ? `in sync (${skippedBinary} non-text file(s) not synced)` : 'in sync'
    return `↑${up} to project · ↓${down} to folder${skip}`
  }

  /** Re-read both sides after applying a pass; the loop diffs against this. */
  async function refreshSyncBaseline(handle: PickedFolder['dirHandle']): Promise<void> {
    const { snapshot } = await snapshotDisk(handle)
    const srv = await fetchSyncChanges(0, [])
    const baseline: SyncBaseline = { disk: snapshot, serverPaths: srv.changed.map(c => c.path), at: srv.now }
    syncBaseRef.current = baseline
    setSyncSession(s => {
      if (!s) return s
      saveSyncRecord(s.projectId, { dirName: s.dirName, baseline })
      return s
    })
  }

  async function runSyncPass() {
    const handle = syncHandleRef.current
    const base = syncBaseRef.current
    const session = syncSession
    if (!handle || !base || !session || syncBusyRef.current) return
    if (session.projectId !== activeProject) return
    if (document.hidden) return
    syncBusyRef.current = true
    try {
      if (!(await hasWritePermission(handle))) {
        setSyncSession(s => s && ({ ...s, status: 'paused', message: 'folder permission lost — press Resume' }))
        return
      }
      const { snapshot: disk } = await snapshotDisk(handle)
      const srv = await fetchSyncChanges(base.at, base.serverPaths)
      const plan = planSync({
        baseDisk: base.disk,
        baseServerPaths: base.serverPaths,
        disk,
        serverChanged: srv.changed.map(c => c.path),
        serverDeleted: srv.deleted,
      })
      // Text-only bridge: skip anything the picker would never import.
      const keep = (p: string) => classifyPath(p.replace(/^\//, '')) === 'keep'
      const skippedBinary = [...plan.upload, ...plan.download].filter(p => !keep(p)).length
      plan.upload = plan.upload.filter(keep)
      plan.download = plan.download.filter(keep)
      // Same bytes on both sides (mtime skew only) converge without asking.
      const realConflicts: string[] = []
      for (const p of plan.conflicts) {
        let same = false
        try {
          const [diskText, serverData] = await Promise.all([readDiskText(handle, p), readFile(p)])
          same = !serverData.error && diskText === (serverData.content ?? '')
        } catch { /* fall through to the dialog */ }
        if (!same) realConflicts.push(p)
      }
      const decisions: ConflictItem[] = [
        ...realConflicts.map(path => ({ path, kind: 'conflict' as const })),
        ...plan.diskDeleted.map(path => ({ path, kind: 'diskDeleted' as const })),
        ...plan.serverDeleted.map(path => ({ path, kind: 'serverDeleted' as const })),
      ]
      if (decisions.length > 0) {
        // Defer the whole pass: apply nothing until the user decides.
        setSyncConflicts(decisions)
        setSyncSession(s => s && ({ ...s, message: `${decisions.length} change(s) need a decision` }))
        return
      }
      let up = 0
      let down = 0
      if (plan.upload.length > 0) {
        const batches = []
        for (const p of plan.upload) batches.push({ path: p, content: await readDiskText(handle, p) })
        const r = await uploadSyncBatches(batches)
        if (r.errors.length > 0) throw new Error(r.errors[0].error)
        up = r.received
      }
      if (plan.download.length > 0) {
        for (const p of plan.download) {
          const data = await readFile(p)
          if (data.error || typeof data.content !== 'string') throw new Error(`Could not read ${p} from the project`)
          await writeDiskText(handle, p, data.content)
          down += 1
        }
      }
      await refreshSyncBaseline(handle)
      if (up + down > 0) await loadFiles()
      setSyncSession(s => s && ({ ...s, status: 'live', lastAt: Date.now(), message: describeSyncPass(up, down, skippedBinary) }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/permission|NotAllowed/i.test(msg)) {
        setSyncSession(s => s && ({ ...s, status: 'paused', message: 'folder permission lost — press Resume' }))
      } else {
        setSyncSession(s => s && ({ ...s, status: 'error', message: `sync pass failed (retrying): ${msg.slice(0, 120)}` }))
      }
    } finally {
      syncBusyRef.current = false
    }
  }

  async function resolveSyncConflicts(choices: ConflictChoice[]) {
    const handle = syncHandleRef.current
    const items = syncConflicts || []
    if (!handle || items.length === 0) {
      setSyncConflicts(null)
      return
    }
    setSyncConflicts(null)
    setSyncSession(s => s && ({ ...s, message: 'applying your choices…' }))
    try {
      const uploads: { path: string; content: string }[] = []
      const serverDeletes: string[] = []
      for (const item of items) {
        const choice = choices.find(c => c.path === item.path)
        if (!choice) continue
        if (item.kind === 'conflict') {
          if (choice.side === 'disk') uploads.push({ path: item.path, content: await readDiskText(handle, item.path) })
          else {
            const data = await readFile(item.path)
            if (data.error || typeof data.content !== 'string') throw new Error(`Could not read ${item.path} from the project`)
            await writeDiskText(handle, item.path, data.content)
          }
        } else if (item.kind === 'diskDeleted') {
          if (choice.side === 'disk') serverDeletes.push(item.path)
          else {
            const data = await readFile(item.path)
            if (data.error || typeof data.content !== 'string') throw new Error(`Could not read ${item.path} from the project`)
            await writeDiskText(handle, item.path, data.content)
          }
        } else {
          if (choice.side === 'disk') uploads.push({ path: item.path, content: await readDiskText(handle, item.path) })
          else await deleteDiskEntry(handle, item.path)
        }
      }
      if (uploads.length > 0 || serverDeletes.length > 0) {
        const r = await uploadSyncBatches(uploads, serverDeletes)
        if (r.errors.length > 0) throw new Error(r.errors[0].error)
      }
      await refreshSyncBaseline(handle)
      await loadFiles()
      setSyncSession(s => s && ({ ...s, status: 'live', lastAt: Date.now(), message: 'choices applied — in sync' }))
    } catch (e: unknown) {
      setSyncSession(s => s && ({ ...s, status: 'error', message: `apply failed (retrying): ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` }))
    }
  }

  function postponeSyncConflicts() {
    setSyncConflicts(null)
    // Stay paused so the same decisions don't pop back up in 8s;
    // Sync now re-runs the check whenever the user is ready.
    setSyncSession(s => s && ({ ...s, status: 'paused', message: 'paused for your decisions — press Sync now to review' }))
  }

  async function resumeSync() {
    const s = syncSession
    if (!s) return
    let handle = syncHandleRef.current
    if (!handle) {
      try {
        handle = await pickSyncFolder()
      } catch {
        setStatus('resume cancelled')
        return
      }
      // Rebinding a handle: make sure it's the same folder before the old
      // baseline starts moving files around.
      const { snapshot } = await snapshotDisk(handle)
      const known = new Set(syncBaseRef.current?.serverPaths || [])
      const overlap = Object.keys(snapshot).filter(p => known.has(p)).length
      const total = Object.keys(snapshot).length
      if (!confirm(`Rebind live sync for “${s.projectId}” to folder “${handle.name}”? ${overlap} of ${total} files match the project. A different folder would upload its files into the project.`)) {
        setStatus('resume cancelled — kept paused')
        return
      }
      try { await saveFolderHandle(s.projectId, handle) } catch { /* optional */ }
      syncHandleRef.current = handle
    }
    if (!(await ensureWritePermission(handle))) {
      setSyncSession({ ...s, status: 'paused', message: 'folder permission denied — press Resume to try again' })
      return
    }
    setSyncSession({ ...s, status: 'live', message: 'live sync resumed', lastAt: Date.now() })
    void runSyncPass()
  }

  function disconnectSync() {
    if (!syncSession) return
    if (!confirm(`Stop live sync for “${syncSession.projectId}”? The project stays as an ordinary copy; your folder keeps its files.`)) return
    clearSyncRecord(syncSession.projectId)
    syncHandleRef.current = null
    syncBaseRef.current = null
    setSyncConflicts(null)
    setSyncSession(null)
    setStatus('sync disconnected — project kept as a copy')
  }

  // Deep-link boot: a new tab opened from an overlay lands here with
  // ?project=&path= and opens straight onto that file. Consumed once
  // so later reloads boot normally.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const deepProject = params.get('project')
    const deepPath = params.get('path')
    if (!deepProject && !deepPath) {
      // A ?file= deep link opens straight onto that file (falling back
      // to the first file when it names nothing on disk); otherwise the
      // boot keeps its long-standing default. Passing it here avoids a
      // race where the default load would clobber the deep-linked file.
      loadFiles(parseRoute(window.location.hash).file)
      refreshConfig(); loadProjects()
      return
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    void (async () => {
      refreshConfig()
      if (deepProject) await handleSelectProject(deepProject)
      else await loadProjects()
      if (deepPath) await loadFiles(deepPath)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restore a sync session when landing on a project that has one.
  useEffect(() => {
    if (!activeProject) return
    if (syncSession?.projectId === activeProject) return
    const rec = loadSyncRecord(activeProject)
    if (!rec) {
      // Switched to an ordinary project: drop the in-memory session
      // (the baseline was already saved after every clean pass).
      if (syncHandleRef.current) {
        syncHandleRef.current = null
        syncBaseRef.current = null
        setSyncConflicts(null)
        setSyncSession(null)
      }
      return
    }
    void (async () => {
      const h = await loadFolderHandle(activeProject)
      if (!h) {
        syncHandleRef.current = null
        syncBaseRef.current = rec.baseline
        setSyncSession({ projectId: activeProject, dirName: rec.dirName, status: 'paused', message: 'folder handle expired — press Resume and pick the folder again', lastAt: null })
        return
      }
      syncHandleRef.current = h
      syncBaseRef.current = rec.baseline
      if (await hasWritePermission(h)) {
        setSyncSession({ projectId: activeProject, dirName: rec.dirName, status: 'live', message: 'live sync resumed', lastAt: Date.now() })
      } else {
        setSyncSession({ projectId: activeProject, dirName: rec.dirName, status: 'paused', message: 'folder permission needs re-grant — press Resume', lastAt: null })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject])

  // Poll loop: runs only for the synced project, never while a decision or
  // an import/upload dialog is open.
  useEffect(() => {
    if (!syncSession || syncSession.projectId !== activeProject) return
    if (syncSession.status === 'paused') return
    if (importProg || overLimit || syncConflicts) return
    const t = setInterval(() => { void runSyncPass() }, SYNC_POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSession, activeProject, importProg, overLimit, syncConflicts])

  useEffect(() => {
    const es = new EventSource('/api/projects/events')
    es.onmessage = () => { void loadProjects() }
    return () => es.close()
  }, [])

  // The one context every action surface reads (slices 1–4): project,
  // open file, feature-graph presence, and whether a page is marked
  // for preview (the mark, or the start page it seeds from).
  const actionCtx = {
    hasProject: !!activeProject,
    activePath,
    hasFeatureGraph,
    hasPage: markedPath === undefined ? null : !!(markedPath ?? startPage),
  }

  function finishSetup() {
    localStorage.setItem(SETUP_DONE_KEY, SETUP_DONE_VALUE)
    setSetupDone(true)
    try { pushAppSettings({ setupDone: true }) } catch { /* offline: local flag still applies */ }
    loadFiles()
    refreshConfig()
    loadProjects()
  }

  function reopenSetup() {
    localStorage.removeItem(SETUP_DONE_KEY)
    closeModal()
    setSetupDone(false)
    try { pushAppSettings({ setupDone: false }) } catch { /* offline: local flag still applies */ }
  }

  function changeTheme(t: string) {
    setEditorTheme(t)
    localStorage.setItem(EDITOR_THEME_KEY, t)
    try { pushAppSettings({ editorTheme: t }) } catch { /* offline: local theme still applies */ }
  }

  const hasKey = Boolean(config?.hasApiKey ?? config?.hasOpenAiKey)
  const keyTone = config === null ? '' : hasKey ? 'good' : 'warn'

  /** The AI connection/model selects. They live in the top bar's AI
   * segment, except in classic-only header mode where the same node
   * renders in the classic strip's trailing slot. */
  function renderAiSelects() {
    const selects = activeConn ? (
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
    )
    // The MCP button rides with the AI selects in every header
    // mode — immediately right of the model chosen, per the MCP
    // manager design.
    return (
      <>
        {selects}
        <McpManager />
        <SkillsPanel />
      </>
    )
  }

  return (
    <div className="deck-app">
      {!setupDone && <SetupWizard onDone={finishSetup} />}

      {uiPrefsState.headerBar !== 'buttons' && (
        <MenuStrip
          ctx={actionCtx}
          route={route}
          leftView={leftView}
          uiTheme={uiPrefsState.uiTheme}
          menuLayout={uiPrefsState.menuLayout}
          headerBar={uiPrefsState.headerBar}
          trailing={uiPrefsState.headerBar === 'classic' ? renderAiSelects() : undefined}
          onNewProject={() => { void handleNewProject() }}
          onImport={() => { void handleOpenFolder() }}
          onOpenSync={() => { void handleOpenSync() }}
          onSave={() => save()}
          hasManifest={files.includes('project.ai.json')}
          onOpenManifest={() => { void loadFile('project.ai.json') }}
          onOpenLibrary={() => setLeftView('library')}
          onOpenSettings={openSettings}
          onOpenWizard={(id) => setWizard(id)}
          onNavigate={navigate}
          onLeftView={setLeftView}
          onOpenCmdk={() => setCmdkOpen(true)}
          onSetTheme={(id) => { saveUiPrefs({ uiTheme: id }) }}
          onSetHeaderBar={(h) => { saveUiPrefs({ headerBar: h }) }}
          onAbout={() => setNotice('AI Live Editor — a local-first editor where the agent builds from menus, wizards and plans, not just chat.')}
        />
      )}
      {uiPrefsState.headerBar !== 'classic' && (
      <header className="topbar">
        <div className="bar-seg" role="group" aria-label="Layout">
          <div className="layout-switch" role="group" aria-label="Layout">
            <button type="button" className={route.kind === 'workbench' ? 'on' : ''} onClick={() => navigate({ kind: 'workbench' })} title="The workbench layout: files, editor, preview"><LayoutDashboard size={13} />Workbench</button>
            <button type="button" className={route.kind === 'facets' ? 'on' : ''} onClick={() => navigate({ kind: 'facets', facet: lastFacet })} title="The facets layout: one screen per facet — state, actions, wizards"><Layers size={13} />Facets</button>
          </div>
        </div>
        <div className="toolbar bar-seg" aria-label="Project and files" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
            <button className="deck-btn" onClick={() => { setSettingsMenuOpen(false); setActionsMenuOpen(false); setWizardsMenuOpen(false); setInsertOpen(false); setHelpOpen(false); setProjectOpen(false); setProjectMenuOpen(o => !o) }} title="Project — new, open, import, save" aria-haspopup="menu" aria-expanded={projectMenuOpen}><ProjectIcon size={13} />Project<CaretIcon size={11} aria-hidden className="deck-caret" /></button>
            {projectMenuOpen && (
              <div className={insertPopClass} role="menu" aria-label="Project">
                <div className="aa-group">Project</div>
                <button type="button" role="menuitem" className="ms-row" onClick={() => { setProjectMenuOpen(false); void handleNewProject() }}>
                  <span className="ms-row-main">
                    <span className="ms-row-title">New project</span>
                    <span className="ms-row-sub">Create a new app under projects/</span>
                  </span>
                </button>
                <button type="button" role="menuitem" className="ms-row" onClick={() => { setProjectMenuOpen(false); void handleOpenSync() }}>
                  <span className="ms-row-main">
                    <span className="ms-row-title">Open…</span>
                    <span className="ms-row-sub">Pick a folder and keep it in live two-way sync</span>
                  </span>
                </button>
                <button type="button" role="menuitem" className="ms-row" onClick={() => { setProjectMenuOpen(false); void handleOpenFolder() }}>
                  <span className="ms-row-main">
                    <span className="ms-row-title">Import…</span>
                    <span className="ms-row-sub">Import a copy of a folder as a new project</span>
                  </span>
                </button>
                <div className="ms-sep" />
                {(() => {
                  const w = wizardById('new-project')
                  if (!w) return null
                  const s = wizardRowState(w)
                  return (
                    <button key={w.id} type="button" role="menuitem" className="ms-row" disabled={s.disabled} title={s.title} onClick={() => { setProjectMenuOpen(false); setWizard(w.id) }}>
                      <span className="ms-row-main">
                        <span className="ms-row-title">{w.title}</span>
                        <span className="ms-row-sub">{s.sub}</span>
                      </span>
                      <span className="ms-tag">wizard</span>
                    </button>
                  )
                })()}
                <button
                  type="button"
                  role="menuitem"
                  className="ms-row"
                  disabled={!files.includes('project.ai.json')}
                  title={!files.includes('project.ai.json') ? `Edit project.ai.json… — ${actionCtx.hasProject ? 'This project has no project.ai.json' : 'Open a project first'}` : 'Edit project.ai.json…'}
                  onClick={() => { setProjectMenuOpen(false); void loadFile('project.ai.json') }}
                >
                  <span className="ms-row-main">
                    <span className="ms-row-title">Edit project.ai.json…</span>
                    <span className="ms-row-sub">{files.includes('project.ai.json') ? 'The project manifest — type, format, targets, style set' : (actionCtx.hasProject ? 'This project has no project.ai.json' : 'Open a project first')}</span>
                  </span>
                </button>
                <div className="ms-sep" />
                <button type="button" role="menuitem" className="ms-row" onClick={() => { setProjectMenuOpen(false); save() }}>
                  <span className="ms-row-main">
                    <span className="ms-row-title">Save</span>
                    <span className="ms-row-sub">The editor autosaves as you type, too</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
            <button
              className="deck-btn"
              style={{ maxWidth: 180 }}
              onClick={() => { setSettingsMenuOpen(false); setActionsMenuOpen(false); setWizardsMenuOpen(false); setInsertOpen(false); setHelpOpen(false); setProjectMenuOpen(false); setProjectOpen(o => !o) }}
              title={activeProject || 'Active project'}
              aria-haspopup="menu"
              aria-expanded={projectOpen}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeProject || 'no projects'}</span>
              <CaretIcon size={11} aria-hidden className="deck-caret" />
            </button>
            {projectOpen && (
              <div className="ms-pop" role="menu" aria-label="Active project">
                {projects.length === 0 && <div className="aa-group">No projects yet</div>}
                {projects.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={p.id === activeProject}
                    className={`ms-row${p.id === activeProject ? ' on' : ''}`}
                    onClick={() => { setProjectOpen(false); void handleSelectProject(p.id) }}
                  >
                    <span className="ms-check" aria-hidden="true">{p.id === activeProject ? '✓' : ''}</span>
                    <span className="ms-row-main">
                      <span className="ms-row-title">{p.id}</span>
                      {p.setup && p.setup.kind !== 'ready' && <span className="ms-row-sub">Not set up</span>}
                    </span>
                  </button>
                ))}
                <div className="ms-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="ms-row"
                  onClick={() => { setProjectOpen(false); void loadProjects(); void loadFiles() }}
                >
                  <span className="ms-row-main">
                    <span className="ms-row-title">Refresh list</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <span className={`pill mono tick ${connTone(status)}`} title={status}>
            <span className="dot" /><TickerText text={status.startsWith('real FS:') ? status.replace(/^real FS: (\d+ files) @ .*$/, '$1') : status.slice(0, 42)} />
          </span>
          <ReimportButton projectId={activeProject} suppress={syncSession?.projectId === activeProject} onPick={(getFolder) => { void handleReimport(getFolder) }} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
            <button className="deck-btn" onClick={() => { setSettingsMenuOpen(false); setWizardsMenuOpen(false); setInsertOpen(false); setHelpOpen(false); setProjectOpen(false); setProjectMenuOpen(false); setActionsMenuOpen(o => !o) }} title="Agent Actions — start work from a menu instead of typing a command" aria-haspopup="menu" aria-expanded={actionsMenuOpen}><Zap size={13} />Agent Actions<CaretIcon size={11} aria-hidden className="deck-caret" /></button>
            {actionsMenuOpen && (
              <AgentActionsMenu
                ctx={actionCtx}
                onOpenLibrary={() => setLeftView('library')}
                onOpenSettings={openSettings}
                onClose={() => setActionsMenuOpen(false)}
              />
            )}
          </div>
          <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
            <button className="deck-btn" onClick={() => { setSettingsMenuOpen(false); setActionsMenuOpen(false); setWizardsMenuOpen(o => !o); setInsertOpen(false); setHelpOpen(false); setProjectOpen(false); setProjectMenuOpen(false) }} title="Wizards — guided changes, grouped by facet" aria-haspopup="menu" aria-expanded={wizardsMenuOpen}><Wand2 size={13} />Wizards<CaretIcon size={11} aria-hidden className="deck-caret" /></button>
            {wizardsMenuOpen && (
              <WizardsMenu
                onOpenWizard={(id) => setWizard(id)}
                onClose={() => setWizardsMenuOpen(false)}
              />
            )}
          </div>
          <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
            <button className="deck-btn" onClick={() => { setSettingsMenuOpen(false); setActionsMenuOpen(false); setWizardsMenuOpen(false); setHelpOpen(false); setProjectOpen(false); setProjectMenuOpen(false); setInsertOpen(o => !o) }} title="Insert — the catalog ladder: component → template → pack" aria-haspopup="menu" aria-expanded={insertOpen}><InsertIcon size={13} />Insert<CaretIcon size={11} aria-hidden className="deck-caret" /></button>
            {insertOpen && (
              <div className={insertPopClass} role="menu" aria-label="Insert">
                <div className="aa-group">The catalog ladder — component → template → pack</div>
                {insertActionRow('add-component')}
                {insertActionRow('install-pack')}
                <div className="ms-sep" />
                {(() => {
                  const w = wizardById('add-feature')
                  if (!w) return null
                  const s = wizardRowState(w)
                  return (
                    <button
                      key={w.id}
                      type="button"
                      role="menuitem"
                      className="ms-row"
                      disabled={s.disabled}
                      title={s.title}
                      onClick={() => { setInsertOpen(false); setWizard(w.id) }}
                    >
                      <span className="ms-row-main">
                        <span className="ms-row-title">{w.title}</span>
                        <span className="ms-row-sub">{s.sub}</span>
                      </span>
                      <span className="ms-tag">wizard</span>
                    </button>
                  )
                })()}
                <button
                  type="button"
                  role="menuitem"
                  className="ms-row"
                  onClick={() => { setInsertOpen(false); navigate({ kind: 'workbench' }); setLeftView('library') }}
                >
                  <span className="ms-row-main">
                    <span className="ms-row-title">Open the Library</span>
                    <span className="ms-row-sub">All three tiers of the catalog</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
            <button className="deck-btn" onClick={() => { setSettingsMenuOpen(false); setActionsMenuOpen(false); setWizardsMenuOpen(false); setInsertOpen(false); setProjectOpen(false); setProjectMenuOpen(false); setHelpOpen(o => !o) }} title="Help — search, shortcuts, about" aria-haspopup="menu" aria-expanded={helpOpen}><HelpIcon size={13} />Help<CaretIcon size={11} aria-hidden className="deck-caret" /></button>
            {helpOpen && (
              <div className={rightPopClass} role="menu" aria-label="Help">
                <button
                  type="button"
                  role="menuitem"
                  className="ms-row"
                  onClick={() => { setHelpOpen(false); setCmdkOpen(true) }}
                >
                  <span className="ms-row-main">
                    <span className="ms-row-title">Search all actions…</span>
                    <span className="ms-row-sub">Every Agent Action, by name</span>
                  </span>
                  <span className="ms-tag">⌘K</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ms-row"
                  onClick={() => { setHelpOpen(false); openSettings('shortcuts') }}
                >
                  <span className="ms-row-main">
                    <span className="ms-row-title">Keyboard shortcuts</span>
                    <span className="ms-row-sub">The shortcut registry, in Settings</span>
                  </span>
                </button>
                <div className="ms-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="ms-row"
                  onClick={() => { setHelpOpen(false); setNotice('AI Live Editor — a local-first editor where the agent builds from menus, wizards and plans, not just chat.') }}
                >
                  <span className="ms-row-main">
                    <span className="ms-row-title">About AI Live Editor</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <div className="bar-seg" role="group" aria-label="AI settings" style={{ marginLeft: 'auto' }}>
            {renderAiSelects()}
          </div>
          <div className="bar-seg" role="group" aria-label="Settings">
            <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
              <button className="deck-btn" onClick={() => { setActionsMenuOpen(false); setWizardsMenuOpen(false); setInsertOpen(false); setHelpOpen(false); setProjectOpen(false); setProjectMenuOpen(false); setSettingsMenuOpen(o => !o) }} title="Settings" aria-haspopup="menu" aria-expanded={settingsMenuOpen}><Settings size={13} />Settings<CaretIcon size={11} aria-hidden className="deck-caret" /></button>
              {settingsMenuOpen && (
                <div className={rightPopClass} role="menu" aria-label="Settings">
                  {SETTING_SECTIONS.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitem"
                      className="ms-row"
                      onClick={() => { setSettingsMenuOpen(false); openSettings(s.id) }}
                    >
                      <span className="ms-row-main">
                        <span className="ms-row-title">{s.title}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      )}
      {syncSession && syncSession.projectId === activeProject && (
        <SyncStatusBar
          dirName={syncSession.dirName}
          status={syncSession.status}
          message={syncSession.message}
          lastAt={syncSession.lastAt}
          onSyncNow={() => { void runSyncPass() }}
          onDisconnect={disconnectSync}
          onResume={() => { void resumeSync() }}
        />
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 10, padding: 12, position: 'relative' }}>
        {planOpen && (
          <PlanOverlay
            key={`${activeProject}-${planOpen.n}`}
            initialLevel={planOpen.level}
            initialGoal={planOpen.goal}
            onClose={() => setPlanOpen(null)}
            onOpenPath={(p) => { void loadFile(p) }}
            style={{ left: 5, top: 5, bottom: 5, right: rightW + 22 }}
          />
        )}
        {graphView && (
          <GraphOverlay
            key={`${activeProject}-graph`}
            view={graphView}
            onClose={closeGraphView}
            onOpenReport={() => openGraph(route.modal)}
            onOpenDiagram={() => openGraphDiagram(route.modal)}
            expanded={graphExpanded}
            onToggleExpand={() => setGraphExpanded(v => !v)}
            onShowLibrary={() => { setLeftView('library'); navigate({ kind: 'workbench', ...(route.modal ? { modal: route.modal } : {}) }) }}
            style={{ left: 5, top: 5, bottom: 5, right: graphExpanded ? 5 : rightW + 22 }}
          />
        )}
        {cmdkOpen && (
          <ActionCommandPalette
            ctx={actionCtx}
            onOpenLibrary={() => setLeftView('library')}
            onOpenSettings={openSettings}
            onClose={() => setCmdkOpen(false)}
          />
        )}
        {wizard === 'add-feature' && (
          <AddFeatureWizard
            onClose={() => setWizard(null)}
            onNotice={setNotice}
          />
        )}
        {/* Workbench panes: display:contents keeps the flex row exact
            in the workbench layout and hides the panes (mounted, state
            intact) in the facets layout. */}
        <div style={{ display: route.kind === 'workbench' ? 'contents' : 'none' }}>
        <div className="panel" style={{ width: leftW, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ButtonGrid className="panel-head" style={{ gap: 6 }}>
            <button type="button" className="deck-btn" style={{ padding: '2px 8px', opacity: leftView === 'files' ? 1 : 0.55 }} onClick={() => setLeftView('files')}><FolderOpen size={13} />Files <span className="sub">{files.length}</span></button>
            <button type="button" className="deck-btn" style={{ padding: '2px 8px', opacity: leftView === 'library' ? 1 : 0.55 }} onClick={() => setLeftView('library')} title="Component catalog + layout templates"><LibraryBig size={13} />Library</button>
            <button type="button" className="deck-btn" style={{ padding: '2px 8px', opacity: leftView === 'actions' ? 1 : 0.55 }} onClick={() => setLeftView('actions')} title="Agent Actions palette — every action, searchable, pinnable (⌘K searches too)"><Zap size={13} />Actions</button>
            <button type="button" className="deck-btn" style={{ padding: '2px 8px', opacity: graphView ? 1 : 0.55 }} onClick={() => openGraph(route.modal)} title="The project's feature graph — regions, features, and build status"><Network size={13} />Graph</button>
          </ButtonGrid>
          {leftView === 'files' ? (
            <FileTree
              key={activeProject}
              files={files}
              dirs={fileDirs}
              mtimes={fileMtimes}
              active={activePath}
              onSelect={loadFile}
              onRefresh={() => void loadFiles()}
              onCreateFile={createFileFromPane}
              onCreateFolder={createFolderFromPane}
              onRename={renameFromPane}
              onDelete={deleteFromPane}
              onDuplicate={duplicateFromPane}
              startPage={startPage}
              onSetStartPage={(p) => { void handleSetStartPage(p) }}
              pins={pins}
              onTogglePin={togglePin}
            />
          ) : leftView === 'library' ? (
            <Library
              key={activeProject}
              onOpenPath={(path) => { void loadFile(path); loadFiles() }}
              onNotice={setNotice}
            />
          ) : (
            <ActionsPalette
              key={activeProject}
              ctx={actionCtx}
              onOpenLibrary={() => setLeftView('library')}
              onOpenSettings={openSettings}
            />
          )}
        </div>
        <VDivider onMouseDown={colDrag(setLeftW, 1)} title="Drag to resize file tree" />

        <div className="panel" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <div className="panel-head">
            <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => toggleCollapse('editor')} title={collapse.editor ? 'Expand editor' : 'Collapse editor'}>
              {collapse.editor ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
            <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => expandOnly('editor')} title="Expand editor and collapse preview">
              <Maximize2 size={12} />
            </button>
            <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => setOverlay('editor')} title="Open editor as overlay">
              <Expand size={12} />
            </button>
            <span className="mono" style={{ fontWeight: 500 }}>{activePath}</span>
            {activePath && (
              <div style={{ position: 'relative' }} onPointerDown={e => e.stopPropagation()}>
                <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => setFileMenuOpen(o => !o)} title="Actions for the open file" aria-haspopup="menu" aria-expanded={fileMenuOpen}><FileCog size={13} />File actions</button>
                {fileMenuOpen && (
                  <FileActionsMenu
                    ctx={actionCtx}
                    onOpenLibrary={() => setLeftView('library')}
                    onOpenSettings={openSettings}
                    onClose={() => setFileMenuOpen(false)}
                  />
                )}
              </div>
            )}
          </div>
          {files.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', padding: 20, textAlign: 'center', minHeight: 0 }}>
              <div style={{ maxWidth: 420 }}>
                <div style={{ fontSize: 'calc(14px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No files in this project yet</div>
                <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6 }}>Create your first file from the file pane — it opens here and in the preview.</div>
              </div>
            </div>
          ) : (
            <OpenTabs
              tabs={pins.filter(p => files.includes(p))}
              active={activePath}
              onActivate={(p) => { void activateFile(p) }}
              onUnpin={unpinTab}
            />
          )}
          {files.length > 0 && !collapse.editor && overlay !== 'editor' && (
            <div style={{ flex: `${Math.max(15, 100 - previewH)} 1 0`, minHeight: 0 }}>
              <MonacoEditor path={activePath} value={content} onChange={setContent} theme={editorTheme} editorPrefs={uiPrefsState} />
            </div>
          )}
          {!collapse.editor && !collapse.preview && (
            <HDivider onMouseDown={rowDrag()} title="Drag to resize preview" />
          )}
          {overlay !== 'preview' && (
          <div style={{ flex: collapse.preview ? '0 0 auto' : collapse.editor ? '1 1 0' : `${previewH} 1 0`, minHeight: 0, borderTop: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column' }}>
            <Preview
              key={activeProject}
              setup={projects.find(p => p.id === activeProject)?.setup}
              startPage={startPage}
              files={files}
              hmrUrl={config?.previewHmrUrl || 'http://localhost:5173'}
              collapsed={collapse.preview}
              onToggleCollapse={() => toggleCollapse('preview')}
              onMaximize={() => expandOnly('preview')}
              onOverlay={() => setOverlay('preview')}
              onChanged={() => { void loadProjects(); loadFiles(); setTimeout(() => loadFile(activePath), 500) }}
              onResult={setNotice}
            />
          </div>
          )}
        </div>
        </div>
        {route.kind === 'workbench' && overlay && (
          <div className="pane-overlay" role="dialog" aria-label={overlay === 'editor' ? `Editor overlay${activePath ? `: ${activePath}` : ''}` : 'Preview overlay'}>
            <div className="panel-head">
              <span className="mono" style={{ fontWeight: 600 }}>{overlay === 'editor' ? (activePath || 'Editor') : 'Preview'}</span>
              <button type="button" className="deck-btn" style={{ padding: '2px 8px', marginLeft: 'auto' }} onClick={() => openOverlayUrl('window')} title="Open this pane in a new window"><AppWindow size={13} />New window</button>
              <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => openOverlayUrl('tab')} title="Open this pane in a new tab"><SquareArrowOutUpRight size={13} />New tab</button>
              <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => setOverlay(null)} title="Close overlay (Esc)"><X size={13} />Close</button>
            </div>
            <div className="pane-overlay-body">
              {overlay === 'editor' ? (
                <MonacoEditor path={activePath} value={content} onChange={setContent} theme={editorTheme} editorPrefs={uiPrefsState} />
              ) : (
                <Preview
                  key={activeProject}
                  setup={projects.find(p => p.id === activeProject)?.setup}
                  startPage={startPage}
                  files={files}
                  hmrUrl={config?.previewHmrUrl || 'http://localhost:5173'}
                  onChanged={() => { void loadProjects(); loadFiles(); setTimeout(() => loadFile(activePath), 500) }}
                  onResult={setNotice}
                />
              )}
            </div>
          </div>
        )}
        {route.kind === 'facets' && (
          <div className="panel" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <FacetView
              key={`${activeProject}-${route.facet}`}
              facet={route.facet}
              projectName={projects.find(p => p.id === activeProject)?.root.split('/').filter(Boolean).pop() ?? activeProject}
              filesCount={files.length}
              startPage={startPage}
              themeLabel={themeById(uiPrefsState.uiTheme)?.label ?? uiPrefsState.uiTheme}
              ctx={actionCtx}
              onNavigateFacet={(f) => navigate({ kind: 'facets', facet: f })}
              onOpenWizard={(id) => setWizard(id)}
              onOpenSettings={openSettings}
              onOpenLibrary={() => { setLeftView('library'); navigate({ kind: 'workbench' }) }}
            />
          </div>
        )}
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
            pricing={activeConn?.pricing}
          />
        </div>
      </div>

      <NoticeDialog notice={notice} onClose={() => setNotice(null)} />
      {overLimit && (
        <OverLimitDialog
          pick={overLimit.pick}
          maxBytes={defaultCaps().maxBytes}
          maxFiles={defaultCaps().maxFiles}
          withinCount={overLimit.plan.within.length}
          withinBytes={overLimit.plan.within.reduce((n, f) => n + f.size, 0)}
          onChoice={handleOverLimitChoice}
        />
      )}
      {importProg && <ImportProgressDialog name={importProg.name} progress={importProg.progress} />}
      {importReport && (
        <ImportReportDialog
          name={importReport.name}
          result={importReport.result}
          skipped={importReport.skipped}
          mode={importReport.mode}
          syncDirName={importReport.syncDirName}
          onClose={() => setImportReport(null)}
        />
      )}
      {syncConflicts && (
        <SyncConflictsDialog
          items={syncConflicts}
          onResolve={(choices) => { void resolveSyncConflicts(choices) }}
          onPostpone={postponeSyncConflicts}
        />
      )}
      {route.modal?.name === 'settings' && (
        <SettingsWindow
          key={route.modal.tab}
          initialSection={route.modal.tab || 'providers'}
          onClose={closeModal}
          config={config}
          editorTheme={editorTheme}
          onTheme={changeTheme}
          onReplayWizard={reopenSetup}
          onConfigSaved={() => { void refreshConfig() }}
        />
      )}
    </div>
  )
}
