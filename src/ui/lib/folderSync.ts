/* Folder sync (Open-folder): live two-way sync between the server project
 * and the user's picked folder. Import-a-copy (folderImport.ts) stays
 * untouched; this module is the second button.
 *
 * Model: the server copy stays the source of truth for the agent, watcher,
 * and Vite. The browser holds the directory handle and acts as a sync
 * client: each pass it snapshots the disk (lastModified + size, no content
 * reads), asks the server what changed since the baseline, and uploads or
 * downloads only the diff. Anything ambiguous (both sides changed, either
 * side deleted) becomes a user decision, never a silent overwrite.
 */

import { BATCH_BYTES, BATCH_FILES, classifyPath, type DirHandle, type FileHandle } from './folderImport'

/** Default poll interval: slow enough to stay cheap, fast enough to feel live. */
export const SYNC_POLL_MS = 8000

/** Session state: live (polling), paused (permission lost), error (last pass failed). */
export type SyncStatus = 'live' | 'paused' | 'error'

/* Write-capable handle views. The persisted handle (IndexedDB) is the plain
 * read DirHandle; these structural types only describe the extra methods the
 * bridge calls, so no DOM-lib picker types are needed. */
export interface SyncFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(content: string): Promise<void>; close(): Promise<void> }>
}

export interface SyncDirHandle {
  name: string
  kind: 'directory'
  values(): AsyncIterableIterator<SyncFileHandle | SyncDirHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<SyncFileHandle>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<SyncDirHandle>
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>
  queryPermission(opts?: { mode: string }): Promise<string>
  requestPermission(opts?: { mode: string }): Promise<string>
}

/** Open the native picker asking for read+write up front (sync writes back). */
export async function pickSyncFolder(): Promise<DirHandle> {
  const picker = (window as unknown as {
    showDirectoryPicker(opts?: { mode: string }): Promise<DirHandle>
  }).showDirectoryPicker
  if (typeof picker !== 'function') throw new Error('Live sync needs Chrome, Edge, or Opera on desktop (File System Access). Use Import for a copy instead.')
  return picker.call(window, { mode: 'readwrite' })
}

/** True when the stored handle already has readwrite permission (no prompt). */
export async function hasWritePermission(handle: DirHandle): Promise<boolean> {
  try {
    const q = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt')
    return q === 'granted'
  } catch {
    return false
  }
}

/** Ask for readwrite permission (must run in a user gesture). */
export async function ensureWritePermission(handle: DirHandle): Promise<boolean> {
  try {
    if (await hasWritePermission(handle)) return true
    const r = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')
    return r === 'granted'
  } catch {
    return false
  }
}

/* ── Baseline record (localStorage per project; handle stays in IndexedDB) ── */

export interface SnapEntry { mtime: number; size: number }
export type Snapshot = Record<string, SnapEntry>

export interface SyncBaseline {
  disk: Snapshot
  serverPaths: string[]
  at: number
}

export interface SyncRecord {
  dirName: string
  baseline: SyncBaseline
}

const LS_PREFIX = 'folderSync:'

export function loadSyncRecord(projectId: string): SyncRecord | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + projectId)
    if (!raw) return null
    const rec = JSON.parse(raw) as SyncRecord
    if (!rec || typeof rec.dirName !== 'string' || !rec.baseline) return null
    return rec
  } catch {
    return null
  }
}

export function saveSyncRecord(projectId: string, rec: SyncRecord): void {
  try {
    localStorage.setItem(LS_PREFIX + projectId, JSON.stringify(rec))
  } catch { /* quota — sync still works until reload */ }
}

export function clearSyncRecord(projectId: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + projectId)
  } catch { /* ignore */ }
}

/* ── Pure sync core (tested in node) ── */

export interface SnapshotDiff {
  created: string[]
  modified: string[]
  deleted: string[]
}

/** Diff two disk snapshots (lastModified + size). Sorted for determinism. */
export function diffSnapshots(base: Snapshot, cur: Snapshot): SnapshotDiff {
  const created: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  for (const p of Object.keys(cur)) {
    const b = base[p]
    if (!b) created.push(p)
    else if (b.mtime !== cur[p].mtime || b.size !== cur[p].size) modified.push(p)
  }
  for (const p of Object.keys(base)) {
    if (!cur[p]) deleted.push(p)
  }
  created.sort()
  modified.sort()
  deleted.sort()
  return { created, modified, deleted }
}

export interface ServerChange { path: string; mtimeMs: number; size: number }

export interface SyncPlan {
  /** Changed on disk only → read disk, POST to server. */
  upload: string[]
  /** Changed on server only → GET from server, write to disk. */
  download: string[]
  /** Changed on both sides, or edit-vs-delete → user decides per path. */
  conflicts: string[]
  /** Gone on disk, still on server → user decides (delete there / restore). */
  diskDeleted: string[]
  /** Gone on server, still on disk → user decides (re-upload / delete here). */
  serverDeleted: string[]
}

/**
 * Plan one sync pass. `baseDisk` is the disk snapshot at the last clean pass,
 * `baseServerPaths` the server file list then, `disk` the disk now,
 * `serverChanged`/`serverDeleted` what the server reports since baseline.
 * Deleted-on-both-sides converges silently; everything ambiguous lands in
 * conflicts / diskDeleted / serverDeleted.
 */
export function planSync(args: {
  baseDisk: Snapshot
  baseServerPaths: string[]
  disk: Snapshot
  serverChanged: string[]
  serverDeleted: string[]
}): SyncPlan {
  const d = diffSnapshots(args.baseDisk, args.disk)
  const diskChanged = new Set([...d.created, ...d.modified])
  const diskGone = new Set(d.deleted)
  const srvChanged = new Set(args.serverChanged)
  const srvGone = new Set(args.serverDeleted)
  const baseServer = new Set(args.baseServerPaths)

  const upload: string[] = []
  const download: string[] = []
  const conflicts: string[] = []
  const diskDeleted: string[] = []
  const serverDeleted: string[] = []

  const all = new Set([...diskChanged, ...diskGone, ...srvChanged, ...srvGone])
  for (const p of [...all].sort()) {
    const dc = diskChanged.has(p)
    const dg = diskGone.has(p)
    const sc = srvChanged.has(p)
    const sg = srvGone.has(p)
    if ((dc && sc) || (dc && sg) || (dg && sc)) { conflicts.push(p); continue }
    if (dg && sg) continue // deleted on both sides: already converged
    if (dg) { if (baseServer.has(p)) diskDeleted.push(p); continue }
    if (sg) { if (args.disk[p]) serverDeleted.push(p); continue }
    if (dc) { upload.push(p); continue }
    if (sc) { download.push(p); continue }
  }
  return { upload, download, conflicts, diskDeleted, serverDeleted }
}

/* ── Disk IO through the retained directory handle ── */

function asSyncDir(handle: DirHandle): SyncDirHandle {
  return handle as unknown as SyncDirHandle
}

/** Metadata-only walk (lastModified + size, no content reads). Text files
 * only — binaries and skipped dirs are reported, never synced. */
export async function snapshotDisk(dirHandle: DirHandle): Promise<{
  snapshot: Snapshot
  skipped: { path: string; reason: string }[]
}> {
  const snapshot: Snapshot = {}
  const skipped: { path: string; reason: string }[] = []
  async function walk(handle: SyncDirHandle, base: string): Promise<void> {
    for await (const entry of handle.values()) {
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        if (classifyPath(rel + '/x') === 'skip-dir') continue
        await walk(entry as SyncDirHandle, rel)
      } else {
        const verdict = classifyPath(rel)
        const file = await (entry as SyncFileHandle).getFile()
        if (verdict !== 'keep') {
          skipped.push({ path: rel, reason: verdict })
          continue
        }
        snapshot['/' + rel] = { mtime: file.lastModified, size: file.size }
      }
    }
  }
  await walk(asSyncDir(dirHandle), '')
  return { snapshot, skipped }
}

async function resolveFile(dirHandle: DirHandle, filePath: string): Promise<SyncFileHandle> {
  const segs = filePath.replace(/^\//, '').split('/')
  let dir = asSyncDir(dirHandle)
  for (const s of segs.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(s)
  }
  return dir.getFileHandle(segs[segs.length - 1])
}

/** Read one synced text file from disk. */
export async function readDiskText(dirHandle: DirHandle, filePath: string): Promise<string> {
  const fh = await resolveFile(dirHandle, filePath)
  return (await fh.getFile()).text()
}

/** Write one text file to disk, creating parent folders as needed. */
export async function writeDiskText(dirHandle: DirHandle, filePath: string, content: string): Promise<void> {
  const segs = filePath.replace(/^\//, '').split('/')
  let dir = asSyncDir(dirHandle)
  for (const s of segs.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(s, { create: true })
  }
  const fh = await dir.getFileHandle(segs[segs.length - 1], { create: true })
  const writable = await fh.createWritable()
  await writable.write(content)
  await writable.close()
}

/** Delete one file from disk (never recursive). */
export async function deleteDiskEntry(dirHandle: DirHandle, filePath: string): Promise<void> {
  const segs = filePath.replace(/^\//, '').split('/')
  let dir = asSyncDir(dirHandle)
  for (const s of segs.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(s)
  }
  await dir.removeEntry(segs[segs.length - 1])
}

export interface SyncBatch { path: string; content: string }

/**
 * Upload files to POST /api/projects/sync in small batches (same budgets as
 * the import uploader). Deletes ride along on the final batch.
 */
export async function uploadSyncBatches(
  files: SyncBatch[],
  deletes: string[] = [],
): Promise<{ received: number; deleted: number; errors: { path: string; error: string }[] }> {
  let received = 0
  let deleted = 0
  const errors: { path: string; error: string }[] = []
  let batch: SyncBatch[] = []
  let batchBytes = 0
  async function flush(done: boolean) {
    const r = await fetch('/api/projects/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: batch, deletes: done ? deletes : [] }),
    })
    const data = await r.json() as {
      ok?: boolean; error?: string; received?: number; deleted?: number
      writeErrors?: { path: string; error: string }[]
      deleteErrors?: { path: string; error: string }[]
    }
    if (!r.ok || data.ok === false) throw new Error(data.error || `Sync upload failed (${r.status})`)
    received += data.received || 0
    deleted += data.deleted || 0
    errors.push(...(data.writeErrors || []), ...(data.deleteErrors || []))
    batch = []
    batchBytes = 0
  }
  for (const f of files) {
    const size = f.content.length
    if (batch.length >= BATCH_FILES || batchBytes + size > BATCH_BYTES) {
      await flush(false)
    }
    batch.push(f)
    batchBytes += size
  }
  await flush(true)
  return { received, deleted, errors }
}

export { BATCH_BYTES, BATCH_FILES }
