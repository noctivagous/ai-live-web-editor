/**
 * Server-side error log: gitignored `logs/` at the package root, one JSONL
 * file per UTC day. Failures that today only reach `console.error` (chat
 * errors, gateway failures, missing-usage events, verify-gate findings,
 * pool errors) are persisted so they survive restarts.
 *
 * Redaction is by construction: entries carry only the fixed field set
 * below — callers pass `error.message`, never request/response bodies,
 * keys, or file contents. Every write is guarded: logging can never
 * break the request it records.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(__dirname, '..')

const RETAIN_DAYS = 7
const FIELD_CAP = 2000

export type ServerLogKind =
  | 'server-error'
  | 'chat-error'
  | 'chat-usage'
  | 'verify-gate'
  | 'pool'
  | 'project-check'

export interface ServerLogEntry {
  kind: ServerLogKind
  route?: string
  status?: number
  projectId?: string
  model?: string
  message: string
  detail?: string
}

/** Log home: override with AI_LIVE_LOG_DIR (tests), else `<package>/logs`. */
export function logDir(): string {
  const override = process.env.AI_LIVE_LOG_DIR
  if (override) return path.resolve(override)
  return path.join(PKG_ROOT, 'logs')
}

export function dayFile(dir: string, now: Date = new Date()): string {
  return path.join(dir, `${now.toISOString().slice(0, 10)}.jsonl`)
}

/** Delete day files older than `retainDays` (by mtime). Never throws. */
export function pruneLogs(dir: string = logDir(), retainDays: number = RETAIN_DAYS, nowMs: number = Date.now()): string[] {
  const removed: string[] = []
  try {
    if (!fs.existsSync(dir)) return removed
    const cutoff = nowMs - retainDays * 86_400_000
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
      const full = path.join(dir, name)
      try {
        if (fs.statSync(full).mtimeMs < cutoff) {
          fs.rmSync(full)
          removed.push(name)
        }
      } catch { /* per-file best effort */ }
    }
  } catch { /* logging never breaks the server */ }
  return removed
}

function clipped(value: unknown): string {
  return String(value ?? '').slice(0, FIELD_CAP)
}

/** Append one JSONL line. Never throws. */
export function logServerError(entry: ServerLogEntry): void {
  try {
    const dir = logDir()
    fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      kind: entry.kind,
      ...(entry.route ? { route: entry.route } : null),
      ...(typeof entry.status === 'number' ? { status: entry.status } : null),
      ...(entry.projectId ? { projectId: entry.projectId } : null),
      ...(entry.model ? { model: entry.model } : null),
      message: clipped(entry.message),
      ...(entry.detail ? { detail: clipped(entry.detail) } : null),
    })
    fs.appendFileSync(dayFile(dir), line + '\n', 'utf-8')
    pruneLogs(dir)
  } catch { /* logging never breaks the server */ }
}
