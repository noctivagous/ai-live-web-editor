/* Folder import (Step 10): pick a local directory via the File System Access
 * API (Chromium-only `showDirectoryPicker`) and import it as a copy into a
 * new `projects/<name>` project. The browser handle never becomes the agent
 * root; this is import-a-copy, honestly labelled.
 *
 * Sources (checked 2026-11-06):
 * - MDN `Window.showDirectoryPicker()` — secure context + user gesture,
 *   returns a FileSystemDirectoryHandle; Chromium-only pickers.
 * - openpwa.net file-system-access capability — pickers Chromium-only
 *   (Chrome 86+/Edge 86+/Opera 72+ desktop); OPFS is cross-browser but is
 *   the sandboxed FS, not the user's disk.
 * - Field pattern: handles are structured-cloneable → persist in IndexedDB;
 *   permissions do NOT survive reload → queryPermission/requestPermission
 *   on restore (read mode here; we only read the picked folder).
 */

/** Default cap: warn + confirm dialog above this many import bytes. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
/** Default cap: warn + confirm dialog above this many files. */
export const DEFAULT_MAX_FILES = 2000
/** Per-batch upload budget (well under the server's 20mb JSON limit). */
export const BATCH_BYTES = 1.5 * 1024 * 1024
export const BATCH_FILES = 25

/** Directory names never imported (deps, VCS, build output, caches). */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', '.vite', '.chrome-data', 'coverage', '__pycache__',
  '.next', '.nuxt', '.cache',
])
/** File names never imported. */
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])
/** Binary extensions skipped: /api/fs/write is a UTF-8 text path. */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'avif',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'ogg', 'wav', 'flac',
  'zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'dmg',
  'exe', 'dll', 'so', 'dylib', 'node', 'wasm', 'pdf',
  'sqlite', 'db',
])

export type SkipReason = 'skip-dir' | 'skip-binary' | 'skip-name'
export interface SkippedEntry { path: string; reason: SkipReason; size: number }
export interface FileEntry { path: string; size: number }

/** Pure: classify a '/'-separated relative path. Tested in node. */
export function classifyPath(relPath: string): 'keep' | SkipReason {
  const parts = relPath.split('/')
  const name = parts[parts.length - 1] || ''
  if (SKIP_FILES.has(name)) return 'skip-name'
  for (const seg of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(seg)) return 'skip-dir'
  }
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (ext && BINARY_EXT.has(ext)) return 'skip-binary'
  return 'keep'
}

export interface Caps { maxBytes: number; maxFiles: number }
export interface CapPlan {
  within: FileEntry[]
  overCap: FileEntry[]
  totalBytes: number
  totalFiles: number
  over: boolean
}

/** Pure: sort by path, take what fits both caps. Tested in node. */
export function applyCaps(files: FileEntry[], caps: Caps): CapPlan {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const within: FileEntry[] = []
  const overCap: FileEntry[] = []
  let bytes = 0
  for (const f of sorted) {
    if (within.length < caps.maxFiles && bytes + f.size <= caps.maxBytes) {
      within.push(f)
      bytes += f.size
    } else {
      overCap.push(f)
    }
  }
  const totalBytes = files.reduce((n, f) => n + f.size, 0)
  return { within, overCap, totalBytes, totalFiles: files.length, over: overCap.length > 0 }
}

export function defaultCaps(): Caps {
  return { maxBytes: DEFAULT_MAX_BYTES, maxFiles: DEFAULT_MAX_FILES }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Pure: turn a picked folder name into a valid project id. Tested in node. */
export function sanitizeProjectName(name: string): string {
  const clean = name.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return clean || 'imported-folder'
}

export function isFolderImportSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/* Minimal structural types so we don't depend on TS DOM-lib picker types. */
export interface DirHandle {
  name: string
  kind: 'directory'
  values(): AsyncIterableIterator<FileHandle | DirHandle>
  queryPermission(opts?: { mode: string }): Promise<string>
  requestPermission(opts?: { mode: string }): Promise<string>
}
export interface FileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

export interface PickedFolder {
  dirName: string
  dirHandle: DirHandle
  files: { path: string; file: File }[]
  skipped: SkippedEntry[]
  totalBytes: number
}

async function walkDir(handle: DirHandle, base: string, out: PickedFolder): Promise<void> {
  for await (const entry of handle.values()) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      const verdict = classifyPath(rel + '/x')
      if (verdict === 'skip-dir') {
        out.skipped.push({ path: rel + '/', reason: 'skip-dir', size: 0 })
        continue
      }
      await walkDir(entry as DirHandle, rel, out)
    } else {
      const verdict = classifyPath(rel)
      const file = await (entry as FileHandle).getFile()
      if (verdict !== 'keep') {
        out.skipped.push({ path: rel, reason: verdict as SkipReason, size: file.size })
        continue
      }
      out.files.push({ path: rel, file })
      out.totalBytes += file.size
    }
  }
}

/** Open the native picker and enumerate (reads metadata only, no contents). */
export async function pickFolder(): Promise<PickedFolder> {
  const picker = (window as unknown as {
    showDirectoryPicker(opts?: { mode: string }): Promise<DirHandle>
  }).showDirectoryPicker
  if (typeof picker !== 'function') throw new Error('Folder picker needs Chrome, Edge, or Opera (desktop).')
  const dirHandle = await picker.call(window, { mode: 'read' })
  const out: PickedFolder = { dirName: dirHandle.name, dirHandle, files: [], skipped: [], totalBytes: 0 }
  await walkDir(dirHandle, '', out)
  out.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}

export interface ImportBatchResult {
  ok: boolean
  active?: string
  root?: string
  projects?: { id: string; root: string }[]
  received?: number
  installed?: boolean
  installError?: string
  writeErrors?: { path: string; error: string }[]
  error?: string
}

async function postImportBatch(body: {
  name: string
  files: { path: string; content: string }[]
  done: boolean
  first: boolean
  overwrite: boolean
}): Promise<ImportBatchResult> {
  const r = await fetch('/api/projects/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await r.json()) as ImportBatchResult
  if (!r.ok || data.ok === false) throw new Error(data.error || `Import failed (${r.status})`)
  return data
}

export interface ImportProgress {
  sentFiles: number
  totalFiles: number
  sentBytes: number
  totalBytes: number
  phase: 'uploading' | 'installing'
}

/**
 * Upload picked files in small batches; the final batch (done:true) makes
 * the server run npm install (when package.json arrived) and select the
 * project. Text-only: binaries were filtered at pick time.
 */
export async function uploadImport(
  name: string,
  picked: { path: string; file: File }[],
  opts: { overwrite?: boolean; onProgress?: (p: ImportProgress) => void } = {},
): Promise<ImportBatchResult> {
  const totalBytes = picked.reduce((n, f) => n + f.file.size, 0)
  let sentFiles = 0
  let sentBytes = 0
  let batch: { path: string; content: string }[] = []
  let batchBytes = 0
  let last: ImportBatchResult = { ok: true }
  let first = true
  const report = (phase: ImportProgress['phase']) =>
    opts.onProgress?.({ sentFiles, totalFiles: picked.length, sentBytes, totalBytes, phase })

  async function flush(done: boolean) {
    last = await postImportBatch({
      name,
      files: batch,
      done,
      first,
      overwrite: Boolean(opts.overwrite),
    })
    first = false
    batch = []
    batchBytes = 0
    report(done ? 'installing' : 'uploading')
  }

  for (const entry of picked) {
    const content = await entry.file.text()
    const size = content.length
    if (batch.length >= BATCH_FILES || batchBytes + size > BATCH_BYTES) {
      await flush(false)
    }
    batch.push({ path: '/' + entry.path, content })
    batchBytes += size
    sentFiles += 1
    sentBytes += entry.file.size
  }
  await flush(true)
  report('installing')
  return last
}

/* ── Persisted folder handles (IndexedDB) for one-click re-import ── */

const IDB_DB = 'ai-live-editor'
const IDB_STORE = 'folder-handles'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveFolderHandle(projectId: string, handle: DirHandle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(handle, `folder:${projectId}`)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadFolderHandle(projectId: string): Promise<DirHandle | null> {
  try {
    const db = await openDb()
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(`folder:${projectId}`)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (!value || typeof value !== 'object') return null
    const handle = value as DirHandle
    if (typeof (handle as unknown as { values?: unknown }).values !== 'function') return null
    const q = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt')
    if (q !== 'granted') {
      const r = await handle.requestPermission({ mode: 'read' }).catch(() => 'denied')
      if (r !== 'granted') return null
    }
    return handle
  } catch {
    return null
  }
}

/** Re-enumerate a previously saved handle (no picker needed). */
export async function repickFolder(dirHandle: DirHandle): Promise<Omit<PickedFolder, 'dirHandle'>> {
  const out: PickedFolder = { dirName: dirHandle.name, dirHandle, files: [], skipped: [], totalBytes: 0 }
  await walkDir(dirHandle, '', out)
  out.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}
