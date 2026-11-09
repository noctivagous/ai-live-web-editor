import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Expand, Maximize2, Monitor, MousePointerClick, SendHorizontal, Smartphone, StickyNote, Tablet, Trash2, X } from 'lucide-react'
import { fetchOverlaySource, getProjectConfig, getWorkflow, postProjectConfig, postWorkflow, readFile, staticPreviewUrl, submitLiveEdit, type DeviceTarget, type PageNote, type ProjectSetupInfo } from '../lib/api'
import { pollUntilUp } from '../lib/previewProbe'
import { publishWorkflowChanged, subscribeWorkflow } from '../lib/workflowSync'
import { describeRenderer, isScriptFile, looksLikeComponent, rendererFor } from '../lib/previewRender'
import { Markdown } from './Markdown'
import { FolderSetupWizard } from './FolderSetupWizard'
import { loadUiPrefs, saveUiPrefs, UI_PREFS_CHANGED_EVENT } from '../lib/uiPrefs'
import { CssBoxes } from './CssBoxes'
import { FormatToolbar } from './FormatToolbar'
import { JsonView } from './JsonView'
import { JsxView } from './JsxView'
import { ConfigView } from './ConfigView'
import { MarkdownEditor } from './MarkdownEditor'
import { RichTextEditor } from './RichTextEditor'
import { SpreadsheetView } from './SpreadsheetView'
import { FormatStub } from './FormatStub'
import { BaseImageEditor } from './BaseImageEditor'

const PROJECT_TYPES = ['web-app', 'canvas-tool', 'game', 'dashboard', 'content-site']
const TARGET_WIDTHS: Record<DeviceTarget, number | null> = { phone: 375, tablet: 768, desktop: null }

const STATIC_URL = '/projects/'
const DEFAULT_HMR = 'http://localhost:5173'

async function probe(url: string, timeoutMs = 4000): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

function overlayApi(iframe: HTMLIFrameElement | null): any {
  try {
    const win = iframe?.contentWindow as any
    return win?.__AI_LIVE_EDIT__ || null
  } catch { return null }
}

async function ensureOverlay(iframe: HTMLIFrameElement | null): Promise<boolean> {
  if (!iframe) return false
  if (overlayApi(iframe)) return true
  try {
    const doc = iframe.contentDocument
    if (!doc) return false
    const src = await fetchOverlaySource()
    const script = doc.createElement('script')
    script.textContent = src
    doc.documentElement.appendChild(script)
    return Boolean(overlayApi(iframe))
  } catch { return false }
}

export function Preview({ hmrUrl = DEFAULT_HMR, onChanged, onResult, collapsed, onToggleCollapse, onMaximize, onOverlay, setup, startPage, files = [] }: {
  hmrUrl?: string
  onChanged: () => void
  onResult: (text: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  onMaximize?: () => void
  onOverlay?: () => void
  /** The project's file list, for the setup wizard's conversions. */
  files?: string[]
  /** Folder classification from the launcher; 'loose'/'empty' folders
   * have no page to serve, so the pane states that plainly instead of
   * polling a dead port. 'html' folders are served by the launcher's
   * standalone Vite on the same :5173 the ready projects use. */
  setup?: ProjectSetupInfo
  /** The designated start page (project.ai.json entry, root-relative):
   * the host page for component files. */
  startPage?: string | null
}) {
  const noSetup = setup != null && (setup.kind === 'loose' || setup.kind === 'empty')
  // Setup wizard dismissal (slice C): per project mount; the plain
  // panels keep a Set up preview button to reopen it. Whether the
  // wizard is needed is computed with the mark, further down.
  const [wizardDismissed, setWizardDismissed] = useState(false)
  // Format toolbar visibility (device pref): the bar's own checkbox is
  // the switch, Settings → Files mirrors it. Default on.
  const [showFormatToolbar, setShowFormatToolbarState] = useState(() => loadUiPrefs().formatToolbar)
  useEffect(() => {
    const onPrefs = () => setShowFormatToolbarState(loadUiPrefs().formatToolbar)
    window.addEventListener(UI_PREFS_CHANGED_EVENT, onPrefs)
    return () => window.removeEventListener(UI_PREFS_CHANGED_EVENT, onPrefs)
  }, [])
  const setShowFormatToolbar = (next: boolean) => { setShowFormatToolbarState(next); saveUiPrefs({ formatToolbar: next }) }
  const liveUrl = hmrUrl || DEFAULT_HMR
  const [url, setUrl] = useState(liveUrl)
  const [key, setKey] = useState(0)
  const [hmr, setHmr] = useState<'unknown' | 'up' | 'down'>('unknown')
  const [checking, setChecking] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [noteCount, setNoteCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  // Project foundation (phase-11-06): the device control reflects the
  // shared workflow state; the type select writes project.ai.json.
  const [deviceTarget, setDeviceTargetState] = useState<DeviceTarget>('desktop')
  const [projectType, setProjectType] = useState('')
  const [projectFormat, setProjectFormat] = useState('')
  // Preview mark + drift (slice B): the file the preview is of, and
  // the page it has followed links to. Both ride the workflow snapshot.
  const [mark, setMark] = useState<string | null>(null)
  const [location, setLocation] = useState<string | null>(null)
  const [readContent, setReadContent] = useState<string | null>(null)
  const [readFailed, setReadFailed] = useState(false)

  async function refreshFoundation() {
    try {
      const wf = await getWorkflow()
      if (wf?.deviceTarget) setDeviceTargetState(wf.deviceTarget)
      if (wf) {
        setMark(wf.previewMark ?? null)
        setLocation(wf.previewLocation ?? null)
      }
    } catch { /* ignore */ }
    try {
      const pc = await getProjectConfig()
      setProjectType(pc?.config?.type || '')
      setProjectFormat(pc?.config?.format || '')
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refreshFoundation()
    const off = subscribeWorkflow(() => { void refreshFoundation() })
    const timer = setInterval(() => { void refreshFoundation() }, 5000)
    return () => { off(); clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  async function chooseDevice(target: DeviceTarget) {
    setDeviceTargetState(target)
    try {
      const data = await postWorkflow({ deviceTarget: target })
      if (data?.deviceTarget) setDeviceTargetState(data.deviceTarget)
    } catch { /* ignore */ }
  }

  async function chooseType(type: string) {
    setProjectType(type)
    try {
      const data = await postProjectConfig({ type })
      setProjectType(data?.config?.type || '')
    } catch { /* ignore */ }
  }

  async function chooseFormat(format: string) {
    setProjectFormat(format)
    try {
      const data = await postProjectConfig({ format })
      setProjectFormat(data?.config?.format || '')
    } catch { /* ignore */ }
  }

  async function switchUrl(next: string) {
    setAnnotating(false)
    setNoteCount(0)
    setUrl(next)
    if (next === liveUrl) {
      setChecking(true)
      setHmr(await pollUntilUp(() => probe(next)) ? 'up' : 'down')
      setChecking(false)
    }
  }

  // After a project switch the launcher restarts :5173, so the first probe
  // can land in the dead window. Keep polling with backoff until the new
  // server answers instead of sticking on "not running".
  useEffect(() => {
    const ctrl = new AbortController()
    setAnnotating(false)
    setNoteCount(0)
    setUrl(liveUrl)
    setChecking(true)
    setHmr('unknown')
    void pollUntilUp(() => probe(liveUrl), { signal: ctrl.signal }).then((up) => {
      if (ctrl.signal.aborted) return
      setHmr(up ? 'up' : 'down')
      setChecking(false)
    })
    return () => { ctrl.abort() }
  }, [liveUrl])

  const onHmr = url === liveUrl
  const showDown = onHmr && hmr === 'down'
  const showWaiting = onHmr && hmr === 'unknown'

  // ── Mark-driven rendering (slice B) ────────────────────────────
  const baseRenderer = mark ? rendererFor(mark) : null
  // A marked script file whose name says nothing may still be a
  // component (Lit element in .ts): sniff the content once per mark.
  const [hostOverride, setHostOverride] = useState(false)
  useEffect(() => {
    setHostOverride(false)
    if (!mark || baseRenderer !== 'none' || !isScriptFile(mark)) return
    let live = true
    void (async () => {
      try {
        const data = await readFile(mark) as { content?: string }
        if (live && typeof data?.content === 'string' && looksLikeComponent(data.content)) setHostOverride(true)
      } catch { /* stays 'none' */ }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark, baseRenderer])
  const renderer = hostOverride ? 'host' : baseRenderer
  // The wizard is needed when there is nothing to preview: a
  // loose/empty folder, or a multi-page site with no start page
  // designated and nothing marked (slice C).
  const needsWizard = noSetup || (setup?.kind === 'html' && !startPage && !mark)
  const showWizard = needsWizard && !wizardDismissed
  const hostPath = startPage ? `/${startPage}` : '/index.html'
  const pagePath = renderer === 'host' ? hostPath : (location ?? mark ?? '/index.html')
  const frameSrc = url === STATIC_URL
    ? `${STATIC_URL.replace(/\/$/, '')}${pagePath}`
    : pagePath === '/index.html' ? `${liveUrl}/` : `${liveUrl}${pagePath}`
  const isReading = renderer === 'reading' || renderer === 'xml'
  const displayUrl = isReading || renderer === 'markdown' || renderer === 'richtext' || renderer === 'image' || renderer === 'json' || renderer === 'yaml' || renderer === 'toml' || renderer === 'env' || renderer === 'spreadsheet' || renderer === 'document' || renderer === 'workbook' || renderer === 'jsx' ? (mark ?? '') : frameSrc
  const frameMode = renderer === 'page' || renderer === 'host'

  // A new mark restarts the frame on the live server for that file.
  const prevMark = useRef<string | null>(null)
  useEffect(() => {
    if (prevMark.current === mark) return
    prevMark.current = mark
    setUrl(liveUrl)
    setKey(k => k + 1)
    setReadContent(null)
    setReadFailed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark])

  // Reading view: fetch the marked document's text.
  useEffect(() => {
    if (!isReading || !mark) return
    let live = true
    void (async () => {
      try {
        const data = await readFile(mark) as { content?: string }
        if (live) setReadContent(typeof data?.content === 'string' ? data.content : '')
      } catch { if (live) setReadFailed(true) }
    })()
    return () => { live = false }
  }, [renderer, mark])

  /** Same-origin (static) frames only: watch where links take the
   * page and record it as drift, so the bar can offer the way back. */
  function onFrameLoad() {
    if (renderer !== 'page' || url !== STATIC_URL) return
    try {
      const p = frameRef.current?.contentWindow?.location?.pathname || ''
      const rel = p.startsWith('/projects') ? p.slice('/projects'.length) : ''
      if (rel && rel !== pagePath && /\.html?$/i.test(rel)) {
        void postWorkflow({ previewLocation: rel }).then(() => { setLocation(rel); publishWorkflowChanged() })
      }
    } catch { /* cross-origin: the location is not observable */ }
  }

  async function returnToMark() {
    try { await postWorkflow({ previewLocation: null }); publishWorkflowChanged() } catch { /* ignore */ }
    setLocation(null)
    setKey(k => k + 1)
  }

  // Annotate dropdown: the in-page toolbar's elements, driven from the
  // preview bar so annotation never requires reaching into the page.
  // (Declared before the polling effect below, which refreshes it.)
  const [annotateMenuOpen, setAnnotateMenuOpen] = useState(false)
  const [menuAnns, setMenuAnns] = useState<(PageNote & { id?: string })[]>([])
  const [menuPageNotes, setMenuPageNotes] = useState('')

  function readAnnotState(): { anns: (PageNote & { id?: string })[], pageNotes: string } {
    try {
      const api = overlayApi(frameRef.current)
      if (!api) return { anns: [], pageNotes: '' }
      const anns = api.exportAnnotations?.() ?? []
      const pageNotes = api.getPageNotes?.() ?? ''
      return { anns: Array.isArray(anns) ? anns : [], pageNotes: typeof pageNotes === 'string' ? pageNotes : '' }
    } catch { return { anns: [], pageNotes: '' } }
  }

  function refreshAnnotMenu() {
    const { anns, pageNotes } = readAnnotState()
    setMenuAnns(anns)
    setMenuPageNotes(pageNotes)
    setNoteCount(anns.length)
  }

  // Poll the in-page note count while annotate mode is on; when the
  // annotate menu is open, refresh its snapshot too so picks made in
  // the page land in the list without reopening the menu.
  useEffect(() => {
    if (!annotating && !annotateMenuOpen) return
    const t = setInterval(() => {
      try {
        if (annotateMenuOpen) { refreshAnnotMenu(); return }
        const api = overlayApi(frameRef.current)
        const n = api?.exportAnnotations?.()?.length ?? 0
        setNoteCount(n)
      } catch { /* cross-origin or unloaded */ }
    }, 1500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotating, annotateMenuOpen, url, key])

  async function toggleAnnotate() {
    if (annotating) {
      try { overlayApi(frameRef.current)?.disableSelectMode?.() } catch {}
      setAnnotating(false)
      return
    }
    if (onHmr) return // cross-origin: cannot inject into :5173
    const ok = await ensureOverlay(frameRef.current)
    if (!ok) {
      onResult('Annotate mode failed: could not inject the overlay into the preview. Reload and try Static preview.')
      return
    }
    try {
      overlayApi(frameRef.current)?.enableSelectMode?.()
      setNoteCount(overlayApi(frameRef.current)?.exportAnnotations?.()?.length ?? 0)
      setAnnotating(true)
    } catch {
      onResult('Annotate mode failed: preview is not same-origin. Use Static preview.')
    }
  }

  async function submitNotes() {
    const api = overlayApi(frameRef.current)
    if (!api) {
      onResult('Nothing to submit: annotate mode is not active in the preview.')
      return
    }
    let annotations: PageNote[] = []
    let pageNotes = ''
    try {
      annotations = api.exportAnnotations?.() ?? []
      pageNotes = api.getPageNotes?.() ?? ''
    } catch {
      onResult('Could not read notes from the preview. Use Static preview.')
      return
    }
    if (!annotations.length && !pageNotes) {
      onResult('No notes yet. Click Annotate, click a page element, add a note, then Submit.')
      return
    }
    setSubmitting(true)
    try {
      const res = await submitLiveEdit(annotations, pageNotes, onHmr ? undefined : staticPreviewUrl())
      if (res.ok === false || res.error) {
        onResult(`Live-edit failed: ${String(res.error || 'unknown').slice(0, 2000)}`)
      } else {
        try { api.clearAll?.() } catch {}
        setNoteCount(0)
        setAnnotating(false)
        onResult(`Live-edit applied ${res.annotationCount} note(s).\n\n${String(res.text || '').slice(0, 3000)}`)
        onChanged()
      }
    } catch (e: unknown) {
      onResult(`Live-edit failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  function openAnnotMenu() {
    refreshAnnotMenu()
    setAnnotateMenuOpen(true)
  }

  // The overlay listens for these chat commands (same handler the chat
  // pane's Annotate chips use): postMessage works same-origin here, and
  // the overlay applies save + re-render itself.
  async function toggleNotesPanel() {
    try {
      if (!overlayApi(frameRef.current)) {
        const ok = await ensureOverlay(frameRef.current)
        if (!ok) {
          onResult('Page-notes panel failed: could not inject the overlay into the preview. Reload and try Static preview.')
          return
        }
      }
      frameRef.current?.contentWindow?.postMessage({ ns: 'ai-live-chat-cmd', cmd: 'notes' }, '*')
    } catch { /* unloaded frame */ }
  }

  function removeAnnotation(idx: number) {
    try {
      const api = overlayApi(frameRef.current)
      const anns = api?.exportAnnotations?.() ?? []
      if (!Array.isArray(anns) || !api?.importAnnotations) return
      api.importAnnotations(anns.filter((_: unknown, i: number) => i !== idx))
      refreshAnnotMenu()
    } catch { /* cross-origin or unloaded */ }
  }

  function clearAnnotationsMenu() {
    try { overlayApi(frameRef.current)?.clearAnnotations?.() } catch { /* cross-origin or unloaded */ }
    refreshAnnotMenu()
  }

  function clearPageNotesMenu() {
    try { overlayApi(frameRef.current)?.setPageNotes?.('') } catch { /* cross-origin or unloaded */ }
    refreshAnnotMenu()
  }

  // Outside click closes the annotate menu (same pattern as the App menus).
  useEffect(() => {
    if (!annotateMenuOpen) return
    const close = () => setAnnotateMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [annotateMenuOpen])

  const smallBtn = { padding: '2px 8px', fontSize: 'calc(11px * var(--ui-scale, 1))' } as const
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--panel)', borderRadius: '0 0 11px 11px', overflow: 'hidden' }}>
      <div style={{ padding: '5px 10px', fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--panel)', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        {onToggleCollapse && (
          <button type="button" className="deck-btn" style={smallBtn} onClick={onToggleCollapse} title={collapsed ? 'Expand preview' : 'Collapse preview'}>
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
        {onMaximize && (
          <button type="button" className="deck-btn" style={smallBtn} onClick={onMaximize} title="Expand preview and collapse editor">
            <Maximize2 size={12} />
          </button>
        )}
        {onOverlay && (
          <button type="button" className="deck-btn" style={smallBtn} onClick={onOverlay} title="Open preview as overlay">
            <Expand size={12} />
          </button>
        )}
        <span style={{ fontWeight: 600 }}>PREVIEW</span>
        <span className="mono" title={displayUrl} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayUrl}</span>
        {renderer === 'page' && location && mark && location !== mark && (
          <span className="pill" title="You followed a link inside the preview">
            viewing {location}
            <button type="button" className="deck-btn" style={{ marginLeft: 6, padding: '0 6px', fontSize: 'calc(10.5px * var(--ui-scale, 1))' }} onClick={() => void returnToMark()}>Return to {mark}</button>
          </span>
        )}
        {onHmr && (noSetup ? (
          <span className="pill" title="This folder has no preview set up">
            <span className="dot" />
            no preview
          </span>
        ) : (
          <span className={`pill ${hmr === 'up' ? 'good' : hmr === 'down' ? 'bad' : ''}`} title="Vite HMR server reachability">
            <span className="dot" />
            {checking ? 'checking…' : hmr === 'up' ? ':5173 up' : hmr === 'down' ? ':5173 unreachable' : ':5173?'}
          </span>
        ))}
        {annotating && (
          <span className="pill good" title="Page annotations collected">
            <span className="dot" />{noteCount} note{noteCount === 1 ? '' : 's'}
          </span>
        )}
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }} title="Show the toolbar with AI actions for the previewed file's format">
          <input type="checkbox" checked={showFormatToolbar} onChange={(e) => setShowFormatToolbar(e.target.checked)} />
          AI toolbar
        </label>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            value={projectType}
            onChange={(e) => void chooseType(e.target.value)}
            title="Project type (project.ai.json). Undesignated projects build generically."
            style={{ fontSize: 'calc(11px * var(--ui-scale, 1))', background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '2px 4px' }}
          >
            <option value="">No type</option>
            {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            {projectType && !PROJECT_TYPES.includes(projectType) && <option value={projectType}>{projectType}</option>}
          </select>
          <select
            value={projectFormat}
            onChange={(e) => void chooseFormat(e.target.value)}
            title="Project format: App shell = viewport-fit SPA (page never scrolls). Page flow = document that scrolls and grows. Default follows the project type."
            style={{ fontSize: 'calc(11px * var(--ui-scale, 1))', background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '2px 4px' }}
          >
            <option value="">Format: type default</option>
            <option value="app">App shell</option>
            <option value="page">Page flow</option>
          </select>
          <span className="seg" role="group" aria-label="Device target" title="Device target: the design surface. The app must still work at every declared target.">
            <button type="button" className={deviceTarget === 'phone' ? 'on' : ''} style={smallBtn} onClick={() => void chooseDevice('phone')} title="Phone (375px)"><Smartphone size={12} />Phone</button>
            <button type="button" className={deviceTarget === 'tablet' ? 'on' : ''} style={smallBtn} onClick={() => void chooseDevice('tablet')} title="Tablet (768px)"><Tablet size={12} />Tablet</button>
            <button type="button" className={deviceTarget === 'desktop' ? 'on' : ''} style={smallBtn} onClick={() => void chooseDevice('desktop')} title="Desktop (1280px)"><Monitor size={12} />Desktop</button>
          </span>
          <button type="button" className="deck-btn" style={smallBtn} onClick={() => setKey(k => k + 1)}>Reload</button>
          <button type="button" className="deck-btn" style={smallBtn} onClick={() => void switchUrl(STATIC_URL)}>Static</button>
          <button type="button" className="deck-btn" style={smallBtn} onClick={() => void switchUrl(liveUrl)}>Live :5173</button>
          <div style={{ position: 'relative', display: 'flex' }} onPointerDown={e => e.stopPropagation()}>
            <button
              type="button"
              className="deck-btn"
              style={annotating ? { ...smallBtn, borderColor: 'rgba(34,197,94,.5)', color: 'var(--green-text)', borderTopRightRadius: 0, borderBottomRightRadius: 0 } : { ...smallBtn, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              onClick={() => void toggleAnnotate()}
              title={onHmr ? 'On the live Vite app, annotate on the page itself with the Live editing toolbar (bottom right, next to the chat window)' : 'Toggle annotate mode: click page elements to attach notes for the AI'}
              disabled={onHmr}
            >
              {annotating ? 'Annotating…' : 'Annotate'}
            </button>
            <button
              type="button"
              className="deck-btn"
              style={{ ...smallBtn, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--border-soft)', padding: '2px 5px' }}
              onClick={() => (annotateMenuOpen ? setAnnotateMenuOpen(false) : openAnnotMenu())}
              title={onHmr ? 'On the live Vite app, annotate on the page itself with the Live editing toolbar (bottom right, next to the chat window)' : 'Annotation menu — pick, notes, submit, and the current annotations'}
              aria-haspopup="menu"
              aria-expanded={annotateMenuOpen}
              disabled={onHmr}
            >
              <ChevronDown size={12} />
            </button>
            {annotateMenuOpen && (
              <div className="aa-menu narrow" role="menu" aria-label="Annotation" style={{ left: 'auto', right: 0 }}>
                <div className="aa-group">Annotate this preview</div>
                <div className="aa-grid" style={{ gridTemplateColumns: '1fr' }}>
                  <button type="button" role="menuitem" className="aa-card" onClick={() => void toggleAnnotate()}>
                    <b><MousePointerClick size={12} style={{ verticalAlign: -2 }} /> {annotating ? 'Stop picking' : 'Pick element'}</b>
                    <span>{annotating ? 'Picking — click a page element to attach a note.' : 'Click page elements to attach notes for the AI.'}</span>
                    {annotating && <span className="aa-tag">active</span>}
                  </button>
                  <button type="button" role="menuitem" className="aa-card" onClick={() => { void toggleNotesPanel(); setAnnotateMenuOpen(false) }}>
                    <b><StickyNote size={12} style={{ verticalAlign: -2 }} /> Page notes</b>
                    <span>{menuPageNotes ? menuPageNotes.slice(0, 120) : 'Show or hide the page-notes panel in the preview.'}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="aa-card"
                    disabled={(menuAnns.length + (menuPageNotes ? 1 : 0)) === 0 || submitting}
                    onClick={() => { setAnnotateMenuOpen(false); void submitNotes() }}
                  >
                    <b><SendHorizontal size={12} style={{ verticalAlign: -2 }} /> Submit notes to the AI</b>
                    <span>{menuAnns.length || menuPageNotes ? `Send ${menuAnns.length} annotation${menuAnns.length === 1 ? '' : 's'}${menuPageNotes ? ' + page notes' : ''} to the AI.` : 'Nothing to submit yet — pick an element first.'}</span>
                  </button>
                </div>
                <div className="aa-group">Annotations ({menuAnns.length})</div>
                {menuAnns.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                    {menuAnns.map((a, i) => (
                      <div key={a.id || `${a.selector}-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--card)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '6px 8px' }}>
                        <span className="mono" title={a.selector} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%', flexShrink: 0 }}>{a.selector}</span>
                        <span title={a.text} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-soft)', fontSize: 'calc(11.5px * var(--ui-scale, 1))' }}>{a.text || '—'}</span>
                        <button type="button" className="deck-btn" style={{ padding: '0 6px' }} onClick={() => removeAnnotation(i)} title={`Remove the note on ${a.selector}`}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--text-soft)', marginBottom: 6 }}>No annotations yet — Pick an element on the page.</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="deck-btn" style={smallBtn} disabled={!menuAnns.length} onClick={clearAnnotationsMenu} title="Delete all element annotations"><Trash2 size={12} />Clear annotations</button>
                  <button type="button" className="deck-btn" style={smallBtn} disabled={!menuPageNotes} onClick={clearPageNotesMenu} title="Delete the page notes">Clear page notes</button>
                </div>
              </div>
            )}
          </div>
          {annotating && (
            <button type="button" className="deck-btn primary" style={smallBtn} onClick={() => void submitNotes()} disabled={submitting} title="Send page notes to the AI">
              {submitting ? 'Sending…' : 'Submit notes'}
            </button>
          )}
        </span>
      </div>
      {!collapsed && showFormatToolbar && !noSetup && (mark || frameMode) && renderer !== 'markdown' && renderer !== 'richtext' && renderer !== 'image' && (
        <FormatToolbar
          renderer={renderer ?? 'page'}
          path={mark ?? startPage ?? 'index.html'}
          onDispatched={(title) => onResult(`Sent to the AI: ${title} — watch the chat pane for the result.`)}
        />
      )}
      {!collapsed && (showWizard && setup ? (
        <FolderSetupWizard
          setup={setup}
          files={files}
          onApplied={() => { void refreshFoundation(); onChanged() }}
          onDismiss={() => setWizardDismissed(true)}
        />
      ) : noSetup ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', padding: 20, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 'calc(14px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No preview set up yet</div>
            <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6 }}>
              {setup.kind === 'loose'
                ? <>This folder has no HTML page, so there is nothing to preview yet. Its files are open in the editor.</>
                : <>This folder is empty, so there is nothing to preview yet.</>}
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="deck-btn" onClick={() => setWizardDismissed(false)}>Set up preview</button>
            </div>
          </div>
        </div>
      ) : !frameMode ? (
        renderer === 'css' && mark ? (
          <CssBoxes key={mark} path={mark} onSaved={onChanged} />
        ) : renderer === 'json' && mark ? (
          <JsonView key={mark} path={mark} onSaved={onChanged} />
        ) : (renderer === 'yaml' || renderer === 'toml' || renderer === 'env') && mark ? (
          <ConfigView key={mark} path={mark} format={renderer} onSaved={onChanged} />
        ) : renderer === 'markdown' && mark ? (
          <MarkdownEditor key={mark} path={mark} onSaved={onChanged} showAi={showFormatToolbar} onDispatched={(title) => onResult(`Sent to the AI: ${title} — watch the chat pane for the result.`)} />
        ) : renderer === 'richtext' && mark ? (
          <RichTextEditor key={mark} path={mark} onSaved={onChanged} showAi={showFormatToolbar} onDispatched={(title) => onResult(`Sent to the AI: ${title} — watch the chat pane for the result.`)} />
        ) : renderer === 'spreadsheet' && mark ? (
          <SpreadsheetView key={mark} path={mark} onSaved={onChanged} />
        ) : renderer === 'jsx' && mark ? (
          <JsxView key={mark} path={mark} onSaved={onChanged} />
        ) : (renderer === 'document' || renderer === 'workbook') && mark ? (
          <FormatStub key={mark} path={mark} descriptor={describeRenderer(renderer)} />
        ) : isReading ? (
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--panel)', padding: '18px 22px', minHeight: 0 }}>
            <div style={{ maxWidth: 680, margin: '0 auto', color: 'var(--text)', fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.65 }}>
              {readFailed
                ? <div style={{ color: 'var(--muted)' }}>Could not read {mark}.</div>
                : readContent === null
                  ? <div style={{ color: 'var(--muted)' }}>Loading {mark}…</div>
                  : /\.md$/i.test(mark || '')
                    ? <Markdown text={readContent} />
                    : <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{readContent}</div>}
            </div>
          </div>
        ) : renderer === 'image' && mark ? (
          <BaseImageEditor key={mark} path={mark} showAi={showFormatToolbar} onSaved={onChanged} onDispatched={(title) => onResult(`Sent to the AI: ${title} — watch the chat pane for the result.`)} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', padding: 20, textAlign: 'center' }}>
            <div style={{ maxWidth: 420 }}>
              <div style={{ fontSize: 'calc(14px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{mark ? 'No rendering for this file' : 'No file marked for preview'}</div>
              <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6 }}>
                {mark
                  ? <><span className="mono">{mark}</span> has no preview rendering. Mark a page, document or image in the file pane instead.</>
                  : setup?.kind === 'html'
                    ? <>This folder has more than one HTML file ({setup.htmlFiles.join(', ')}) and none is marked. Use the eye button on a file in the file pane to preview it.</>
                    : <>Use the eye button on a file in the file pane to preview it here.</>}
              </div>
              {needsWizard && wizardDismissed && (
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="deck-btn" onClick={() => setWizardDismissed(false)}>Set up preview</button>
                </div>
              )}
            </div>
          </div>
        )
      ) : showDown ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', padding: 20, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 'calc(14px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Preview server not running</div>
            <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6 }}>
              Nothing is listening on <span className="mono">{liveUrl.replace(/^https?:\/\//, '')}</span>.
              Start the launcher with <span className="mono">npm run dev</span>, then press Reload —
              or switch to Static, which is only raw files (a Vite app will be blank).
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button className="deck-btn" onClick={() => { setKey(k => k + 1); void switchUrl(liveUrl) }}>Retry live</button>
              <button className="deck-btn" onClick={() => void switchUrl(STATIC_URL)}>Use Static</button>
            </div>
          </div>
        </div>
      ) : showWaiting ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', padding: 20, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 'calc(14px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Starting preview server…</div>
            <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6 }}>
              Waiting for <span className="mono">{liveUrl.replace(/^https?:\/\//, '')}</span> to
              answer (the server restarts when you switch projects). The preview loads on its own.
            </div>
          </div>
        </div>
      ) : (
        <>
          {renderer === 'host' && (
            <div style={{ padding: '5px 10px', fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', background: 'var(--card)', borderBottom: '1px solid var(--border-soft)' }}>
              <span className="mono">{mark}</span> is shown in <span className="mono">{hostPath}</span>, the page that renders it.
            </div>
          )}
        <iframe
          ref={frameRef}
          key={`${frameSrc}-${key}`}
          src={frameSrc}
          onLoad={onFrameLoad}
          style={{
            flex: 1,
            width: TARGET_WIDTHS[deviceTarget] ? `${TARGET_WIDTHS[deviceTarget]}px` : '100%',
            height: '100%',
            border: 'none',
            background: 'white',
            minHeight: 0,
            alignSelf: 'center',
            boxShadow: TARGET_WIDTHS[deviceTarget] ? '0 0 0 1px var(--border-strong)' : undefined,
            transition: 'width 200ms ease',
          }}
          title="preview"
        />
        </>
      ))}
    </div>
  )
}
