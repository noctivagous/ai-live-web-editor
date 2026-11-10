/**
 * Persisted per-project console watermarks — the baseline for the
 * turn footer's "Since your last chat" group. Editor-owned state:
 * one JSON file beside agent-settings.json, keyed by project root.
 * Each project keeps the last observed console position per channel
 * ({seq, instance, at}); seq numbers are only meaningful inside one
 * page instance (see gate.ts's epoch types), so the instance travels
 * with the seq.
 *
 * Advance rules:
 * - A turn's post-turn console read advances each channel it actually
 *   observed to the latest observed position. Channels never observed
 *   this turn keep their old mark.
 * - Advancing clears the stale flag (below).
 * - Turns that run while "Check console errors" is OFF do not advance
 *   anything; they only mark the project stale. The next checked turn
 *   then treats the stored marks as unusable — its since-last-chat
 *   window starts from that turn's own start, so console output from
 *   across an off period is never silently swallowed into a group the
 *   user did not ask to see, nor blamed on the new turn.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getEnvPath } from '../env.js'
import type { ConsoleInstance, ConsoleWatermark } from './gate.js'

export type ConsoleMark = { seq: number, instance?: ConsoleInstance, at: number }

export interface ProjectConsoleMarks {
  bridge?: ConsoleMark
  pool?: ConsoleMark
  /** Set by a turn that ran with console checking off: the stored
   * marks predate an unchecked gap and must not anchor a window. */
  stale?: boolean
}

export interface ConsoleWatermarkStore {
  projects: Record<string, ProjectConsoleMarks>
}

let storePath = path.join(path.dirname(getEnvPath()), 'console-watermarks.json')
let cache: ConsoleWatermarkStore | null = null

export function getConsoleWatermarksPath(): string { return storePath }

/** Test hook, mirroring agentSettings' setAgentSettingsPath. */
export function setConsoleWatermarksPath(file: string): void {
  storePath = path.resolve(file)
  cache = null
}

function sanitizeMark(value: unknown): ConsoleMark | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (typeof v.seq !== 'number' || !Number.isFinite(v.seq)) return undefined
  const mark: ConsoleMark = { seq: v.seq, at: typeof v.at === 'number' ? v.at : 0 }
  if ((typeof v.instance === 'string' && v.instance) || (typeof v.instance === 'number' && Number.isFinite(v.instance))) {
    mark.instance = v.instance as ConsoleInstance
  }
  return mark
}

export function sanitizeConsoleWatermarkStore(value: unknown): ConsoleWatermarkStore {
  const projects: Record<string, ProjectConsoleMarks> = {}
  const raw = (value && typeof value === 'object') ? (value as Record<string, unknown>).projects : null
  if (raw && typeof raw === 'object') {
    for (const [root, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const marks: ProjectConsoleMarks = {}
      const bridge = sanitizeMark(e.bridge)
      const pool = sanitizeMark(e.pool)
      if (bridge) marks.bridge = bridge
      if (pool) marks.pool = pool
      if (e.stale === true) marks.stale = true
      projects[root] = marks
    }
  }
  return { projects }
}

export function loadConsoleWatermarks(): ConsoleWatermarkStore {
  if (cache) return cache
  let parsed: unknown = null
  try { parsed = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch { /* absent or unreadable → empty */ }
  cache = sanitizeConsoleWatermarkStore(parsed)
  return cache
}

function saveConsoleWatermarks(store: ConsoleWatermarkStore): void {
  cache = store
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8')
  } catch { /* persistence is best-effort; the in-memory value still applies */ }
}

/** The stored marks for one project root (undefined = never seen). */
export function getProjectConsoleMarks(root: string): ProjectConsoleMarks | undefined {
  if (!root) return undefined
  return loadConsoleWatermarks().projects[root]
}

/**
 * Advance a project's marks to the positions a turn's post-turn read
 * observed. Only channels present in `observed` move; advancing
 * clears the stale flag (the window is anchored again).
 */
export function advanceConsoleWatermarks(
  root: string,
  observed: { bridge?: ConsoleWatermark, pool?: ConsoleWatermark },
  at = Date.now(),
): void {
  if (!root) return
  if (!observed.bridge && !observed.pool) return
  const store = loadConsoleWatermarks()
  const prev = store.projects[root] ?? {}
  const next: ProjectConsoleMarks = { ...prev }
  delete next.stale
  if (observed.bridge) next.bridge = { seq: observed.bridge.seq, instance: observed.bridge.instance, at }
  if (observed.pool) next.pool = { seq: observed.pool.seq, instance: observed.pool.instance, at }
  saveConsoleWatermarks({ projects: { ...store.projects, [root]: next } })
}

/**
 * Mark a project's marks stale because a chat turn ran with console
 * checking off. The marks themselves are left untouched (nothing is
 * advanced); the next checked turn discards them as a window anchor.
 * No-op when the project has no marks or is already stale.
 */
export function markConsoleWatermarksStale(root: string): void {
  if (!root) return
  const store = loadConsoleWatermarks()
  const prev = store.projects[root]
  if (!prev || prev.stale) return
  saveConsoleWatermarks({ projects: { ...store.projects, [root]: { ...prev, stale: true } } })
}

/**
 * The since-last-chat window for one channel, or null when no window
 * can be claimed honestly:
 * - no stored mark, a stale mark set, or a disconnected start → null
 *   (first-ever turn: the watermark is born at this turn's start);
 * - a different page instance than the stored mark → null (the old
 *   page's history is unattributable — report nothing, never guess);
 * - start seq at or below the stored seq → null (nothing in between).
 * When either side predates instance reporting, plain seq semantics
 * apply, mirroring consoleEpochPlan's old-client rule.
 */
export function sinceWindow(
  marks: ProjectConsoleMarks | undefined,
  channel: 'bridge' | 'pool',
  start: ConsoleWatermark & { connected: boolean },
): { sinceSeq: number } | null {
  if (!marks || marks.stale) return null
  const mark = marks[channel]
  if (!mark || !start.connected) return null
  if (mark.instance !== undefined && start.instance !== undefined
    && String(mark.instance) !== String(start.instance)) return null
  if (start.seq <= mark.seq) return null
  return { sinceSeq: mark.seq }
}
