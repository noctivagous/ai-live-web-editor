import React, { useEffect, useRef, useState } from 'react'
import { fetchOverlaySource, staticPreviewUrl, submitLiveEdit, type PageNote } from '../lib/api'

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

export function Preview({ hmrUrl = DEFAULT_HMR, onChanged, onResult, collapsed, onToggleCollapse }: {
  hmrUrl?: string
  onChanged: () => void
  onResult: (text: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const liveUrl = hmrUrl || DEFAULT_HMR
  const [url, setUrl] = useState(liveUrl)
  const [key, setKey] = useState(0)
  const [hmr, setHmr] = useState<'unknown' | 'up' | 'down'>('unknown')
  const [checking, setChecking] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [noteCount, setNoteCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)

  async function switchUrl(next: string) {
    setAnnotating(false)
    setNoteCount(0)
    setUrl(next)
    if (next === liveUrl) {
      setChecking(true)
      setHmr(await probe(next) ? 'up' : 'down')
      setChecking(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setAnnotating(false)
    setNoteCount(0)
    setUrl(liveUrl)
    setChecking(true)
    setHmr('unknown')
    probe(liveUrl).then((up) => {
      if (cancelled) return
      setHmr(up ? 'up' : 'down')
      setChecking(false)
    })
    return () => { cancelled = true }
  }, [liveUrl])

  const onHmr = url === liveUrl
  const showDown = onHmr && hmr === 'down'

  // Poll the in-page note count while annotate mode is on.
  useEffect(() => {
    if (!annotating) return
    const t = setInterval(() => {
      try {
        const api = overlayApi(frameRef.current)
        const n = api?.exportAnnotations?.()?.length ?? 0
        setNoteCount(n)
      } catch { /* cross-origin or unloaded */ }
    }, 1500)
    return () => clearInterval(t)
  }, [annotating, url, key])

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

  const smallBtn = { padding: '2px 8px', fontSize: 11 } as const
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#141417', borderRadius: '0 0 11px 11px', overflow: 'hidden' }}>
      <div style={{ padding: '5px 10px', fontSize: 11, color: '#a1a1aa', display: 'flex', gap: 8, alignItems: 'center', background: '#141417', borderBottom: '1px solid #1e1e23', flexShrink: 0 }}>
        {onToggleCollapse && (
          <button type="button" className="deck-btn" style={smallBtn} onClick={onToggleCollapse} title={collapsed ? 'Expand preview' : 'Collapse preview'}>
            {collapsed ? '▸' : '▾'}
          </button>
        )}
        <span style={{ fontWeight: 600 }}>PREVIEW</span>
        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
        {onHmr && (
          <span className={`pill ${hmr === 'up' ? 'good' : hmr === 'down' ? 'bad' : ''}`} title="Vite HMR server reachability">
            <span className="dot" />
            {checking ? 'checking…' : hmr === 'up' ? ':5173 up' : hmr === 'down' ? ':5173 unreachable' : ':5173?'}
          </span>
        )}
        {annotating && (
          <span className="pill good" title="Page annotations collected">
            <span className="dot" />{noteCount} note{noteCount === 1 ? '' : 's'}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button type="button" className="deck-btn" style={smallBtn} onClick={() => setKey(k => k + 1)}>Reload</button>
          <button type="button" className="deck-btn" style={smallBtn} onClick={() => void switchUrl(STATIC_URL)}>Static</button>
          <button type="button" className="deck-btn" style={smallBtn} onClick={() => void switchUrl(liveUrl)}>Live :5173</button>
          <button
            type="button"
            className="deck-btn"
            style={annotating ? { ...smallBtn, borderColor: 'rgba(34,197,94,.5)', color: '#bbf7d0' } : smallBtn}
            onClick={() => void toggleAnnotate()}
            title={onHmr ? 'On the live Vite app, annotate on the page itself with the Live editing toolbar (bottom right, next to the chat window)' : 'Toggle annotate mode: click page elements to attach notes for the AI'}
            disabled={onHmr}
          >
            {annotating ? 'Annotating…' : 'Annotate'}
          </button>
          {annotating && (
            <button type="button" className="deck-btn primary" style={smallBtn} onClick={() => void submitNotes()} disabled={submitting} title="Send page notes to the AI">
              {submitting ? 'Sending…' : 'Submit notes'}
            </button>
          )}
        </span>
      </div>
      {!collapsed && (showDown ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#141417', padding: 20, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>Preview server not running</div>
            <div style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.6 }}>
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
      ) : (
        <iframe ref={frameRef} key={`${url}-${key}`} src={url} style={{ flex: 1, width: '100%', height: '100%', border: 'none', background: 'white', minHeight: 0 }} title="preview" />
      ))}
    </div>
  )
}
