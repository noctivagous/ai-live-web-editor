import React, { useEffect, useRef, useState } from 'react'
import { fetchOverlaySource, staticPreviewUrl, submitLiveEdit, type PageNote } from '../lib/api'

const STATIC_URL = '/projects/'
const HMR_URL = 'http://localhost:5173'

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

export function Preview({ onChanged, onResult }: { onChanged: () => void, onResult: (text: string) => void }) {
  const [url, setUrl] = useState(STATIC_URL)
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
    if (next === HMR_URL) {
      setChecking(true)
      setHmr(await probe(next) ? 'up' : 'down')
      setChecking(false)
    }
  }

  const onHmr = url === HMR_URL
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff', borderRadius: '0 0 11px 11px', overflow: 'hidden' }}>
      <div style={{ padding: '5px 10px', fontSize: 11, color: '#666', display: 'flex', gap: 8, alignItems: 'center', background: '#f5f5f5', borderBottom: '1px solid #ddd', flexShrink: 0 }}>
        <span style={{ fontWeight: 600 }}>PREVIEW</span>
        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
        {onHmr && (
          <span className={`pill ${hmr === 'up' ? 'good' : hmr === 'down' ? 'bad' : ''}`} style={{ background: '#fff' }} title="Vite HMR server reachability">
            <span className="dot" />
            {checking ? 'checking…' : hmr === 'up' ? ':5173 up' : hmr === 'down' ? ':5173 unreachable' : ':5173?'}
          </span>
        )}
        {annotating && (
          <span className="pill good" style={{ background: '#fff' }} title="Page annotations collected">
            <span className="dot" />{noteCount} note{noteCount === 1 ? '' : 's'}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button onClick={() => setKey(k => k + 1)} style={{ padding: '2px 8px', fontSize: 11 }}>Reload</button>
          <button onClick={() => void switchUrl(STATIC_URL)} style={{ padding: '2px 8px', fontSize: 11 }}>Static</button>
          <button onClick={() => void switchUrl(HMR_URL)} style={{ padding: '2px 8px', fontSize: 11 }}>Vite HMR :5173</button>
          <button
            onClick={() => void toggleAnnotate()}
            style={{ padding: '2px 8px', fontSize: 11, background: annotating ? '#16a34a' : undefined, color: annotating ? '#fff' : undefined, border: annotating ? 'none' : undefined, borderRadius: 4 }}
            title={onHmr ? 'Annotate works in Static preview only (HMR is cross-origin)' : 'Toggle annotate mode: click page elements to attach notes for the AI'}
            disabled={onHmr}
          >
            {annotating ? 'Annotating…' : 'Annotate'}
          </button>
          {annotating && (
            <button onClick={() => void submitNotes()} style={{ padding: '2px 8px', fontSize: 11 }} disabled={submitting} title="Send page notes to the AI">
              {submitting ? 'Sending…' : 'Submit notes'}
            </button>
          )}
        </span>
      </div>
      {showDown ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#141417', padding: 20, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>Preview server not running</div>
            <div style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.6 }}>
              Nothing is listening on <span className="mono">localhost:5173</span>.
              Start it with <span className="mono">npm run projects:dev</span>, then press Reload —
              or switch back to Static preview, which is served by the launcher itself.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button className="deck-btn" onClick={() => { setKey(k => k + 1); void switchUrl(HMR_URL) }}>Retry :5173</button>
              <button className="deck-btn" onClick={() => void switchUrl(STATIC_URL)}>Use Static</button>
            </div>
          </div>
        </div>
      ) : (
        <iframe ref={frameRef} key={`${url}-${key}`} src={url} style={{ flex: 1, border: 'none', background: 'white', minHeight: 0 }} title="preview" />
      )}
    </div>
  )
}
