/** Sync page annotations across both Chat instances (sidebar + /chat-embed).
 *
 * The `:5173` page posts annotation state to the embed iframe via
 * `postMessage`; only the embed can hear it (cross-origin). The embed then
 * re-publishes a small digest on this same-origin channel so the sidebar
 * renders identical chips. The digest is also persisted so a late-joining
 * Chat reads it on mount. Hover/selection preview stays page-local by
 * design; only committed chips sync.
 */

export type AnnotationDigestItem = { id: string, selector: string, abbr: string, text: string, component?: string }
export type AnnotationDigestNote = { present: boolean, len: number, abbr: string }

export type AnnotationDigest = {
  v: 1
  at: number
  selection: string | null
  annotations: AnnotationDigestItem[]
  pageNote: AnnotationDigestNote
}

export const ANNOTATIONS_CHANNEL = 'ai-live-editor.annotations'
export const ANNOTATIONS_STORAGE_KEY = 'ai-live-editor.annotations'

export function emptyAnnotationDigest(): AnnotationDigest {
  return { v: 1, at: 0, selection: null, annotations: [], pageNote: { present: false, len: 0, abbr: '' } }
}

export function parseAnnotationDigest(raw: unknown): AnnotationDigest | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (row.v !== 1 || !Array.isArray(row.annotations)) return null
  const note = (row.pageNote && typeof row.pageNote === 'object' ? row.pageNote : {}) as Record<string, unknown>
  return {
    v: 1,
    at: typeof row.at === 'number' ? row.at : 0,
    selection: typeof row.selection === 'string' && row.selection ? row.selection : null,
    annotations: row.annotations.map((a) => {
      const item = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
      const selector = typeof item.selector === 'string' ? item.selector : 'body'
      const parsed: AnnotationDigestItem = {
        id: typeof item.id === 'string' ? item.id : '',
        selector,
        abbr: typeof item.abbr === 'string' && item.abbr ? item.abbr : selector,
        text: typeof item.text === 'string' ? item.text : '',
      }
      if (typeof item.component === 'string' && item.component) parsed.component = item.component
      return parsed
    }),
    pageNote: {
      present: Boolean(note.present),
      len: typeof note.len === 'number' ? note.len : 0,
      abbr: typeof note.abbr === 'string' ? note.abbr : '',
    },
  }
}

export function annotationDigestsEqual(a: AnnotationDigest, b: AnnotationDigest): boolean {
  if ((a.selection || null) !== (b.selection || null)) return false
  if (a.annotations.length !== b.annotations.length) return false
  for (let i = 0; i < a.annotations.length; i++) {
    const x = a.annotations[i]
    const y = b.annotations[i]
    if (x.id !== y.id || x.selector !== y.selector || x.abbr !== y.abbr || x.text !== y.text || (x.component || '') !== (y.component || '')) return false
  }
  return a.pageNote.present === b.pageNote.present
    && a.pageNote.len === b.pageNote.len
    && a.pageNote.abbr === b.pageNote.abbr
}

// In-memory fallback so late joiners converge even where localStorage is
// unavailable (tests, private mode); localStorage stays the cross-context path.
let memoryDigest: AnnotationDigest | null = null

function saveDigest(digest: AnnotationDigest): void {
  memoryDigest = digest
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ANNOTATIONS_STORAGE_KEY, JSON.stringify(digest))
    }
  } catch { /* quota / private mode */ }
}

export function loadAnnotationDigest(): AnnotationDigest | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(ANNOTATIONS_STORAGE_KEY)
      if (raw) return parseAnnotationDigest(JSON.parse(raw))
    }
  } catch { /* fall through to memory */ }
  return memoryDigest
}

/** Called by the embed Chat when the page pushes new annotation state. */
export function publishAnnotations(digest: AnnotationDigest): void {
  saveDigest({ ...digest, at: Date.now() })
  try {
    const ch = new BroadcastChannel(ANNOTATIONS_CHANNEL)
    ch.postMessage({ ...digest, at: Date.now() })
    ch.close()
  } catch { /* unsupported */ }
  try {
    // Storage-event fallback for contexts without BroadcastChannel.
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`${ANNOTATIONS_STORAGE_KEY}.signal`, String(Date.now()))
    }
  } catch { /* ignore */ }
}

export function subscribeAnnotations(onChange: (digest: AnnotationDigest) => void): () => void {
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(ANNOTATIONS_CHANNEL)
    ch.onmessage = (ev) => {
      const parsed = parseAnnotationDigest(ev.data)
      if (parsed) onChange(parsed)
    }
  } catch { /* unsupported */ }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== ANNOTATIONS_STORAGE_KEY && e.key !== `${ANNOTATIONS_STORAGE_KEY}.signal`) return
    const digest = loadAnnotationDigest()
    if (digest) onChange(digest)
  }
  try {
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  } catch { /* non-browser */ }
  return () => {
    try {
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    } catch { /* non-browser */ }
    try { ch?.close() } catch { /* ignore */ }
  }
}
