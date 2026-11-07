import fs from 'node:fs'
import path from 'node:path'

/**
 * Filesystem operations behind the file browser pane: rename/move,
 * delete, and create-folder, for paths inside one project root.
 * Same traversal discipline as the folder-import writer in
 * launcher.ts: caller paths are absolute project paths ("/src/a.ts"),
 * resolved under the root, and anything escaping the root is refused.
 * Every refusal is a thrown Error with a user-readable message; the
 * routes turn it into a 400. Nothing here touches the root itself.
 */

function resolveUnder(root: string, p: unknown, label: string): string {
  if (typeof p !== 'string' || !p.startsWith('/')) throw new Error(`${label} must be an absolute project path`)
  const full = path.resolve(root, '.' + p)
  if (full === root) throw new Error(`${label} must name an entry inside the project, not the project root`)
  if (!full.startsWith(root + path.sep)) throw new Error('Path traversal')
  return full
}

function statOrNull(full: string): fs.Stats | null {
  try { return fs.statSync(full) } catch { return null }
}

export interface RenameResult { from: string, to: string, isDir: boolean }

/** Move/rename a file or folder. The target must not exist yet; the
 * target's parent is created when missing (same leniency as write). */
export function renamePath(root: string, from: unknown, to: unknown): RenameResult {
  const fromFull = resolveUnder(root, from, 'from')
  const toFull = resolveUnder(root, to, 'to')
  if (fromFull === toFull) throw new Error('Source and target are the same path')
  const st = statOrNull(fromFull)
  if (!st) throw new Error('Not found: ' + String(from))
  if (statOrNull(toFull)) throw new Error('Already exists: ' + String(to))
  if (st.isDirectory() && (toFull + path.sep).startsWith(fromFull + path.sep)) {
    throw new Error('A folder cannot be moved into itself')
  }
  fs.mkdirSync(path.dirname(toFull), { recursive: true })
  fs.renameSync(fromFull, toFull)
  return { from: String(from), to: String(to), isDir: st.isDirectory() }
}

export interface DeleteResult { path: string, isDir: boolean }

/** Delete a file, an empty folder, or — only with recursive set — a
 * folder with contents. The UI passes recursive only after an explicit
 * confirmation that names the entry count. */
export function deletePath(root: string, p: unknown, recursive = false): DeleteResult {
  const full = resolveUnder(root, p, 'path')
  const st = statOrNull(full)
  if (!st) throw new Error('Not found: ' + String(p))
  if (st.isDirectory()) {
    const entries = fs.readdirSync(full)
    if (entries.length > 0 && !recursive) {
      throw new Error(`Folder is not empty (${entries.length} entries) — recursive delete required`)
    }
    fs.rmSync(full, { recursive: true, force: false })
    return { path: String(p), isDir: true }
  }
  fs.unlinkSync(full)
  return { path: String(p), isDir: false }
}

/** Create a folder (and any missing parents). Refuses when a file or
 * folder already sits at the path. */
export function mkdirPath(root: string, p: unknown): { path: string } {
  const full = resolveUnder(root, p, 'path')
  const st = statOrNull(full)
  if (st) throw new Error(st.isDirectory() ? 'Folder already exists: ' + String(p) : 'A file already exists: ' + String(p))
  fs.mkdirSync(full, { recursive: true })
  return { path: String(p) }
}

/** Number of entries (files + folders) under a project path — the
 * delete confirmation counts with this so it can name a real number. */
export function countEntries(root: string, p: unknown): number {
  const full = resolveUnder(root, p, 'path')
  const st = statOrNull(full)
  if (!st) throw new Error('Not found: ' + String(p))
  if (!st.isDirectory()) return 1
  let n = 0
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      n += 1
      if (e.isDirectory()) walk(path.join(dir, e.name))
    }
  }
  walk(full)
  return n
}
