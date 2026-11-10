/**
 * P0-b verify gate: pure decision logic (host gate, not model memory).
 * After a Files turn that wrote files, the host re-checks layout geometry
 * and console errors itself and folds NEW findings back into the turn.
 */
import { isWriteTool } from '../agentTools.js'
import { dedupeConsoleEntries, isAppEntry, type ConsoleSrc } from './consoleSource.js'

export type LayoutFinding = {
  key: string
  kind: string
  detail: string
  width?: number
  /** Overflow findings carry the axis the offender spills on. */
  axis?: 'x' | 'y'
}

export type ConsoleEntry = {
  seq: number
  level: string
  text: string
  stack?: string
  url?: string
  ts?: number
  /** Source attribution (slice C): whose code produced the entry.
   * Absent on pre-slice-C entries, where it means 'app'. */
  src?: ConsoleSrc
  /** Repeat count when a read window was deduped (slice C). */
  count?: number
}

/** Gate trigger: a Files-mode turn whose tool trace wrote files.
 * The write list is the shared WRITE_TOOLS set (agentTools.ts). */
export function shouldTriggerGate(mode: string, toolNames: string[]): boolean {
  if (mode !== 'files') return false
  return toolNames.some((n) => isWriteTool(n))
}

/** Console levels that count as failures. Warnings are reported on
 * the turn (footer/summary) but never chased (slice B). */
export function isErrorLevel(level: string): boolean {
  return level === 'error' || level === 'pageerror'
}

/** The error-level subset of a console entry list, app entries
 * only: an editor-injected client's error (or an agent probe's) is
 * not an app error, however loud it is (slice C). */
export function consoleErrorEntries<T extends { level: string, src?: ConsoleSrc }>(entries: T[]): T[] {
  return entries.filter((e) => isErrorLevel(e.level) && isAppEntry(e))
}

/**
 * Follow-up decision: the gate's model stream exists to fix findings,
 * so it runs only when the gate produced something fixable — a new
 * layout finding, a new console ERROR (warnings are reported, never
 * chased), or a console expectation the agent declared this turn that
 * did not appear (the agent explicitly asked for that signal, so its
 * absence is fixable context). An unverified-only result means
 * nothing failed; some checks could not run (no live page, a frame
 * gone). A blind model pass cannot check what the host itself could
 * not, and it used to re-read — sometimes re-write — the turn's
 * files. The unverified notes still reach the client in the verify
 * summary.
 */
export function gateNeedsFollowUp(
  result: { layout: unknown[]; console: ConsoleEntry[] },
  missingExpectations = 0,
): boolean {
  return result.layout.length > 0
    || result.console.some((e) => isErrorLevel(e.level) && isAppEntry(e))
    || missingExpectations > 0
}

/**
 * Key a layout overlap/clipping finding from the snapshot analysis shape.
 * Overlap pairs carry a/b stableIds; clipping carries target/clippedBy;
 * overflow offenders carry stableId + axis.
 */
export function findingKey(f: Record<string, unknown>, width?: number): string {
  const parts: string[] = []
  const a = f.a
  const b = f.b
  if (typeof a === 'string' && typeof b === 'string') parts.push(`overlap:${[a, b].sort().join('|')}`)
  if (typeof f.target === 'string') parts.push(`clip:${f.target}->${String(f.clippedBy || '?')}`)
  if (typeof f.stableId === 'string' && (f.axis || f.right !== undefined || f.bottom !== undefined)) {
    parts.push(`overflow:${f.stableId}:${String(f.axis || (f.right !== undefined ? 'x' : 'y'))}`)
  }
  if (!parts.length) parts.push(`misc:${JSON.stringify(f).slice(0, 120)}`)
  if (width !== undefined) parts.push(`@${width}`)
  return parts.join(' ')
}

export function toLayoutFindings(
  analysis: Record<string, unknown> | null | undefined,
  width?: number,
): LayoutFinding[] {
  if (!analysis || typeof analysis !== 'object') return []
  const out: LayoutFinding[] = []
  const push = (kind: string, list: unknown) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const f = item as Record<string, unknown>
      const axis = kind === 'overflow'
        ? (f.axis === 'x' || f.axis === 'y' ? f.axis : f.right !== undefined ? 'x' : f.bottom !== undefined ? 'y' : undefined)
        : undefined
      out.push({ key: findingKey(f, width), kind, detail: JSON.stringify(f).slice(0, 300), width, axis })
    }
  }
  push('overlap', analysis.overlaps ?? analysis.overlapping)
  push('clipping', analysis.clippings ?? analysis.clipped)
  push('overflow', analysis.overflowXOffenders ?? analysis.overflow)
  return out
}

/** New-only diff: findings whose key was absent at baseline. */
export function diffFindings(before: LayoutFinding[], after: LayoutFinding[]): LayoutFinding[] {
  const base = new Set(before.map((f) => f.key))
  return after.filter((f) => !base.has(f.key))
}

/**
 * Identifies one console buffer's lifetime: the bridge page instance
 * (a string minted per document) or the pool ring generation (a number,
 * bumped when the pool page object is replaced). Seq numbers are only
 * comparable within one instance — a reload restarts the bridge seq
 * at 1, so diffing a new page's entries against the old page's
 * watermark would suppress exactly the errors the gate exists to catch.
 */
export type ConsoleInstance = string | number

export type ConsoleWatermark = { seq: number, instance?: ConsoleInstance }

/** A watermark probe result: `connected` says the channel answered at
 * all (a disconnected bridge also reports seq 0, so seq alone cannot
 * distinguish "quiet page" from "no page"). */
export type ConsoleChannelMark = ConsoleWatermark & { connected: boolean }

function isInstance(v: unknown): v is ConsoleInstance {
  return (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v))
}

/** Pull a console response's instance token, tolerating old clients
 * (pre-epoch bridge pages report none — seq semantics then apply). */
export function consoleInstanceOf(raw: unknown): ConsoleInstance | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = (raw as Record<string, unknown>).instance
  return isInstance(v) ? v : undefined
}

/**
 * Epoch decision for a post-turn console read. Same instance → the
 * baseline watermark still means something: read after it. A different
 * instance (or a baseline that predates any instance while the page
 * now reports one — the page that answered at baseline is gone either
 * way) → the page reloaded: read from seq 0 and say so. No instance
 * from the current page (old client) → fall back to seq semantics.
 */
export function consoleEpochPlan(
  baseline: ConsoleWatermark,
  currentInstance: ConsoleInstance | undefined,
): { sinceSeq: number, reloaded: boolean } {
  if (currentInstance === undefined) return { sinceSeq: baseline.seq, reloaded: false }
  if (baseline.instance !== undefined && String(baseline.instance) === String(currentInstance)) {
    return { sinceSeq: baseline.seq, reloaded: false }
  }
  return { sinceSeq: 0, reloaded: true }
}

/** Unverified note recorded when the bridge page reloaded mid-turn. */
export const PAGE_RELOADED_NOTE = 'page reloaded during the turn — console read from the new page load'

/** Unverified note recorded when the pool page object was replaced mid-turn. */
export const POOL_PAGE_REPLACED_NOTE = 'pool page replaced during the turn — pool console read from the new page'

/** Console signal: entries at/after the baseline seq that look like failures.
 * App entries only (slice C): the editor's own injected clients must
 * never surface as the app's findings. Probe entries are tagged at
 * read time in the chat stream, after the gate has read; the entries
 * the gate itself produces can therefore only carry capture-time
 * tags — but the app-only rule is stated here so no caller can
 * re-introduce editor noise by feeding pre-tagged entries back in. */
export function consoleFindings(entries: ConsoleEntry[], sinceSeq: number): ConsoleEntry[] {
  return entries.filter(
    (e) =>
      e.seq > sinceSeq &&
      (e.level === 'error' || e.level === 'pageerror' || e.level === 'warn') &&
      isAppEntry(e) &&
      !/^\s*$/.test(e.text || ''),
  )
}

/**
 * Format interpretation (§B2): the same overflow finding means
 * different things in the two project formats. In a `page` project
 * the document grows vertically by design, so y-axis overflow is
 * expected, not an issue; in an `app` project the shell must fit
 * the viewport, so overflow on either axis is an issue. No format
 * (undesignated) keeps every finding an issue.
 */
export function applyFormatToFindings(
  findings: LayoutFinding[],
  format: 'app' | 'page' | undefined,
): { issues: LayoutFinding[], expected: LayoutFinding[] } {
  if (format !== 'page') return { issues: findings, expected: [] }
  const issues: LayoutFinding[] = []
  const expected: LayoutFinding[] = []
  for (const f of findings) {
    if (f.kind === 'overflow' && f.axis === 'y') expected.push(f)
    else issues.push(f)
  }
  return { issues, expected }
}

export function formatGatePrompt(args: {
  layout: LayoutFinding[]
  console: ConsoleEntry[]
  unverified: string[]
  expected?: LayoutFinding[]
  /** Console expectations the agent declared this turn that never
   * appeared — the code path they probe may not have run. */
  missingExpectations?: string[]
}): string {
  const lines = [
    'Automatic verification found new issues after your edits. Fix each one or explicitly waive it with a one-line reason.',
  ]
  if (args.layout.length) {
    lines.push('Layout (new since before your edits):')
    for (const f of args.layout.slice(0, 12)) {
      lines.push(`- [${f.kind}${f.width ? ` @${f.width}px` : ''}] ${f.detail}`)
    }
    if (args.layout.length > 12) lines.push(`- …and ${args.layout.length - 12} more (see layout-snapshot)`)
  }
  if (args.console.length) {
    // Identical repeats collapse to one line with a ×N suffix
    // (slice C) — the fixing model needs the signal, not seven
    // copies of it. The cap applies after dedupe.
    const deduped = dedupeConsoleEntries(args.console)
    lines.push('Console (new since before your edits):')
    for (const e of deduped.slice(0, 12)) {
      lines.push(`- [${e.level}] ${e.text.slice(0, 220)}${e.count > 1 ? ` ×${e.count}` : ''}`)
    }
    if (deduped.length > 12) lines.push(`- …and ${deduped.length - 12} more (see get-console)`)
  }
  if (args.missingExpectations?.length) {
    lines.push('Expected in console (you declared these with console-expect; none appeared — the code path they probe may not have run):')
    for (const m of args.missingExpectations.slice(0, 12)) lines.push(`- "${m}"`)
  }
  if (args.unverified.length) {
    lines.push('Could not verify (treat as unverified, not clean):')
    for (const u of args.unverified) lines.push(`- ${u}`)
  }
  if (args.expected?.length) {
    lines.push(`Not issues: ${args.expected.length} vertical-overflow finding(s) are expected in this project's page format (the document grows) and were not counted.`)
  }
  lines.push('Use resolve-source / layout-snapshot / get-console to investigate, then str-replace the fix.')
  return lines.join('\n')
}
