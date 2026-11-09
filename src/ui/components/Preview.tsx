import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Expand, Maximize2, Monitor, MousePointerClick, SendHorizontal, Smartphone, StickyNote, Tablet, Trash2, X } from 'lucide-react'
import { fetchOverlaySource, getPageStatus, getPluginEnsure, getProjectConfig, getWorkflow, postPluginEnsureEnable, postPluginEnsureRemove, postProjectConfig, postWorkflow, readFile, staticPreviewUrl, submitLiveEdit, type DeviceTarget, type PageNote, type PluginEnsureInfo, type ProjectSetupInfo } from '../lib/api'
import { pollUntilUp } from '../lib/previewProbe'
import { parseAnnotationDigest, type AnnotationDigest } from '../lib/annotationSync'
import { annotateUnavailableReason, digestToAnnotateMenu } from '../lib/previewAnnotate'
import { deriveBridgeChip } from '../lib/bridgeChip'
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
  // Plugin auto-ensure (bridge guarantee): the launcher adds the
  // editor's plugin line to the project's vite config when missing.
  // The notice is the visible half of that edit — what changed, and
  // the way back. Dismissing hides it for the session only.
  const [ensure, setEnsure] = useState<PluginEnsureInfo | null>(null)
  const [ensureDismissed, setEnsureDismissed] = useState(false)
  const [ensureBusy, setEnsureBusy] = useState(false)
  const [ensureCopied, setEnsureCopied] = useState(false)
  async function refreshEnsure() {
    setEnsure(await getPluginEnsure())
  }
  useEffect(() => {
    setEnsureDismissed(false)
    setEnsureCopied(false)
    void refreshEnsure()
  }, [setup])
  async function removeEnsurePlugin() {
    setEnsureBusy(true)
    try {
      const data = await postPluginEnsureRemove()
      if (data.ensure) setEnsure(data.ensure)
      setKey(k => k + 1)
    } finally { setEnsureBusy(false) }
  }
  async function enableEnsurePlugin() {
    setEnsureBusy(true)
    try {
      const data = await postPluginEnsureEnable()
      if (data.ensure) setEnsure(data.ensure)
      setKey(k => k + 1)
    } finally { setEnsureBusy(false) }
  }
  async function copyEnsureSnippet() {
    if (!ensure?.snippet) return
    try {
      await navigator.clipboard.writeText(ensure.snippet)
      setEnsureCopied(true)
      setTimeout(() => setEnsureCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }
  const showEnsureNotice = !collapsed && ensure !== null && !ensureDismissed
    && (ensure.state === 'added' || ensure.state === 'cannot' || ensure.state === 'missing-declined')
  // Bridge chip (bridge guarantee, slice 3): is the live page
  // actually connected? Fed only by launcher-origin data — the
  // ensure state above plus the launcher's page-status count —
  // polled on the pane's usual 5s cadence. The page's own server is
  // never asked: when it is down or unbridged is exactly when the
  // chip has to say so.
  const [pageClients, setPageClients] = useState<number | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (collapsed) return
    let live = true
    const tick = async () => {
      const [ens, st] = await Promise.all([getPluginEnsure(), getPageStatus()])
      if (!live) return
      if (ens) setEnsure(ens)
      setPageClients(st.clients)
    }
    void tick()
    const t = setInterval(() => { void tick() }, 5000)
    return () => { live = false; clearInterval(t) }
  }, [collapsed, setup])
  const bridgeChip = deriveBridgeChip(ensure, pageClients)
  function focusEnsureNotice() {
    setEnsureDismissed(false)
    setTimeout(() => { noticeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 60)
  }
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

  // ── Driving the overlay in the LIVE page ───────────────────────
  // The live iframe is cross-origin: the overlay there can't be read
  // or called directly. It does understand postMessage commands
  // (the same 'ai-live-chat-cmd' channel the chat uses) and answers
  // 'ai-live-chat-hello' with its annotation digest — the channel
  // annotationSync is built on. These helpers are that bridge.
  function postFrameCommand(cmd: string) {
    try { frameRef.current?.contentWindow?.postMessage({ ns: 'ai-live-chat-cmd', cmd }, '*') } catch { /* unloaded frame */ }
  }

  /** Ask the in-frame overlay for its digest; resolves null when no
   * overlay answers within the beat (page not bridged, still loading). */
  function requestFrameDigest(timeoutMs = 2000): Promise<AnnotationDigest | null> {
    return new Promise((resolve) => {
      const win = frameRef.current?.contentWindow
      if (!win) { resolve(null); return }
      let settled = false
      let retry: ReturnType<typeof setInterval> | undefined
      let deadline: ReturnType<typeof setTimeout> | undefined
      const finish = (digest: AnnotationDigest | null) => {
        if (settled) return
        settled = true
        window.removeEventListener('message', onMsg)
        if (retry) clearInterval(retry)
        if (deadline) clearTimeout(deadline)
        resolve(digest)
      }
      const onMsg = (ev: MessageEvent) => {
        if (ev.source !== win) return
        const parsed = parseAnnotationDigest(ev.data)
        if (parsed) finish(parsed)
      }
      const ask = () => { try { win.postMessage({ ns: 'ai-live-chat-hello' }, '*') } catch { /* frame gone */ } }
      window.addEventListener('message', onMsg)
      ask()
      retry = setInterval(ask, 400)
      deadline = setTimeout(() => finish(null), timeoutMs)
    })
  }

  function applyDigestToMenu(digest: AnnotationDigest) {
    const menu = digestToAnnotateMenu(digest)
    setMenuAnns(menu.anns)
    // Display text only: the digest abbreviates the page notes. The
    // full text stays in the page, and submitting there delegates
    // to the overlay itself (see submitNotes).
    setMenuPageNotes(menu.pageNoteAbbr)
    setNoteCount(menu.count)
  }

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
    if (onHmr) {
      void requestFrameDigest(1200).then((digest) => { if (digest) applyDigestToMenu(digest) })
      return
    }
    const { anns, pageNotes } = readAnnotState()
    setMenuAnns(anns)
    setMenuPageNotes(pageNotes)
    setNoteCount(anns.length)
  }

  // Poll the in-page note count while annotate mode is on; when the
  // annotate menu is open, refresh its snapshot too so picks made in
  // the page land in the list without reopening the menu. Static
  // preview reads the overlay directly; the live page is asked for
  // its digest instead (same data, cross-origin channel).
  useEffect(() => {
    if (!annotating && !annotateMenuOpen) return
    if (onHmr) {
      let live = true
      const tick = async () => {
        const digest = await requestFrameDigest(1200)
        if (!live || !digest) return
        if (annotateMenuOpen) applyDigestToMenu(digest)
        else setNoteCount(digest.annotations.length)
      }
      void tick()
      const t = setInterval(() => { void tick() }, 1500)
      return () => { live = false; clearInterval(t) }
    }
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
      if (onHmr) postFrameCommand('unpick')
      else { try { overlayApi(frameRef.current)?.disableSelectMode?.() } catch {} }
      setAnnotating(false)
      return
    }
    if (onHmr) {
      // Live page: the plugin's annotate starter has already put the
      // overlay in the frame. Drive it by postMessage, and only call
      // annotate mode on once the overlay answers — otherwise say
      // why, using the plugin-ensure state, instead of doing nothing.
      postFrameCommand('pick')
      const digest = await requestFrameDigest()
      if (!digest) {
        const fresh = await getPluginEnsure()
        if (fresh) setEnsure(fresh)
        onResult(`Annotate is not available: ${annotateUnavailableReason(fresh ?? ensure, hmr)}`)
        return
      }
      setNoteCount(digest.annotations.length)
      setAnnotating(true)
      return
    }
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
    if (onHmr) {
      // The annotations live in the page, unreadable from here. The
      // overlay's own submit posts them to /api/live-edit/submit —
      // the same request its toolbar Submit button makes.
      const digest = await requestFrameDigest(1200)
      const hasNotes = digest ? digest.annotations.length > 0 || digest.pageNote.present : noteCount > 0
      if (!hasNotes) {
        onResult('No notes yet. Click Annotate, click a page element, add a note, then Submit.')
        return
      }
      postFrameCommand('submit')
      onResult("Notes sent from the preview page — the result shows in the page's Annotate toolbar.")
      setTimeout(() => {
        void requestFrameDigest(1200).then((d) => { if (d) setNoteCount(d.annotations.length) })
      }, 1500)
      return
    }
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
    if (onHmr) { postFrameCommand('notes'); return }
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
    // No postMessage verb removes a single annotation; on the live
    // page the note's own tag in the page is the way to delete it.
    if (onHmr) return
    try {
      const api = overlayApi(frameRef.current)
      const anns = api?.exportAnnotations?.() ?? []
      if (!Array.isArray(anns) || !api?.importAnnotations) return
      api.importAnnotations(anns.filter((_: unknown, i: number) => i !== idx))
      refreshAnnotMenu()
    } catch { /* cross-origin or unloaded */ }
  }

  function clearAnnotationsMenu() {
    if (onHmr) return // the page's Annotate toolbar owns clearing there
    try { overlayApi(frameRef.current)?.clearAnnotations?.() } catch { /* cross-origin or unloaded */ }
    refreshAnnotMenu()
  }

  function clearPageNotesMenu() {
    if (onHmr) return // the page's notes panel owns clearing there
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
        {onHmr && !noSetup && bridgeChip.state === 'plugin-missing' && (
          <button type="button" className={`pill ${bridgeChip.tone}`} data-testid="bridge-chip" title={bridgeChip.tooltip} onClick={focusEnsureNotice} style={{ cursor: 'pointer', fontFamily: 'inherit' }}>
            <span className="dot" />{bridgeChip.label}
          </button>
        )}
        {onHmr && !noSetup && bridgeChip.state !== 'none' && bridgeChip.state !== 'plugin-missing' && (
          <span className={`pill ${bridgeChip.tone}`} data-testid="bridge-chip" title={bridgeChip.tooltip}>
            <span className="dot" />{bridgeChip.label}
          </span>
        )}
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
              title={onHmr ? 'Annotate the live page: click page elements in the preview to attach notes for the AI' : 'Toggle annotate mode: click page elements to attach notes for the AI'}
            >
              {annotating ? 'Annotating…' : 'Annotate'}
            </button>
            <button
              type="button"
              className="deck-btn"
              style={{ ...smallBtn, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--border-soft)', padding: '2px 5px' }}
              onClick={() => (annotateMenuOpen ? setAnnotateMenuOpen(false) : openAnnotMenu())}
              title="Annotation menu — pick, page notes, submit, and the current annotations"
              aria-haspopup="menu"
              aria-expanded={annotateMenuOpen}
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
                        {!onHmr && <button type="button" className="deck-btn" style={{ padding: '0 6px' }} onClick={() => removeAnnotation(i)} title={`Remove the note on ${a.selector}`}><X size={12} /></button>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--text-soft)', marginBottom: 6 }}>No annotations yet — Pick an element on the page.</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="deck-btn" style={smallBtn} disabled={onHmr || !menuAnns.length} onClick={clearAnnotationsMenu} title={onHmr ? "Clear annotations from the page's Annotate toolbar" : 'Delete all element annotations'}><Trash2 size={12} />Clear annotations</button>
                  <button type="button" className="deck-btn" style={smallBtn} disabled={onHmr || !menuPageNotes} onClick={clearPageNotesMenu} title={onHmr ? "Clear page notes from the page's notes panel" : 'Delete the page notes'}>Clear page notes</button>
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
      {showEnsureNotice && ensure && (
        <div
          ref={noticeRef}
          data-testid="plugin-ensure-notice"
          style={{ padding: '6px 10px', fontSize: 'calc(11.5px * var(--ui-scale, 1))', lineHeight: 1.5, color: 'var(--text)', background: 'var(--panel-2, var(--panel))', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {ensure.state === 'added' && (
              <>Live plugin added to <span className="mono">{ensure.configFile ?? 'vite.config'}</span> — the editor put its plugin line in this config so the page can connect live. The added lines are marked in the file.</>
            )}
            {ensure.state === 'cannot' && (
              <>
                <div>The editor could not add its live plugin to <span className="mono">{ensure.configFile ?? 'the vite config'}</span> automatically{ensure.detail ? <> — {ensure.detail}</> : null}. To connect this page live, add:</div>
                {ensure.snippet && <pre className="mono" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 'calc(10.5px * var(--ui-scale, 1))' }}>{ensure.snippet}</pre>}
              </>
            )}
            {ensure.state === 'missing-declined' && (
              <>The editor&rsquo;s live plugin is off for this project, so the page cannot connect live.</>
            )}
          </div>
          {ensure.state === 'added' && (
            <button type="button" className="deck-btn" style={smallBtn} disabled={ensureBusy} onClick={() => void removeEnsurePlugin()} title="Remove the plugin lines the editor added and don't add them again">Remove plugin</button>
          )}
          {ensure.state === 'cannot' && ensure.snippet && (
            <button type="button" className="deck-btn" style={smallBtn} onClick={() => void copyEnsureSnippet()} title="Copy the plugin lines">{ensureCopied ? 'Copied' : 'Copy'}</button>
          )}
          {ensure.state === 'missing-declined' && (
            <button type="button" className="deck-btn" style={smallBtn} disabled={ensureBusy} onClick={() => void enableEnsurePlugin()} title="Add the plugin line to the vite config again">Re-enable</button>
          )}
          <button type="button" className="deck-btn" style={smallBtn} onClick={() => setEnsureDismissed(true)} title="Hide this notice for now"><X size={12} /></button>
        </div>
      )}
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
