/**
 * P0-b verify gate orchestration: pre-edit baseline → post-edit re-check →
 * new-only findings. Hidden check-frames give deterministic widths on the
 * bridge path; the pool (setViewportSize) is the fallback for non-Vite pages.
 */
import { pageCommand } from '../pageBridge.js'
import { liveConsole } from '../liveTarget.js'
import { verifyGateEnabled } from '../env.js'
import {
  currentCheckWidths,
  consoleCheckFrames,
  destroyCheckFrames,
  ensureCheckFrames,
  snapshotCheckFrames,
} from './checkFrames.js'
import {
  applyFormatToFindings,
  consoleEpochPlan,
  consoleFindings,
  consoleInstanceOf,
  diffFindings,
  formatGatePrompt,
  PAGE_RELOADED_NOTE,
  POOL_PAGE_REPLACED_NOTE,
  toLayoutFindings,
  type ConsoleChannelMark,
  type ConsoleEntry,
  type ConsoleInstance,
  type ConsoleWatermark,
  type LayoutFinding,
} from './gate.js'
import { effectiveFormat, readProjectConfig } from '../projectConfig.js'

export type GateBaseline = {
  at: number
  bridgeSeq: number
  /** Bridge page instance the seq watermark belongs to (epoch guard). */
  bridgeInstance?: ConsoleInstance
  bridgeWidth?: number
  bridgeLayout: LayoutFinding[]
  frames: Array<{ width: number, findings: LayoutFinding[], seq: number }>
  poolSeq: number
  /** Pool ring generation the pool seq watermark belongs to. */
  poolInstance?: ConsoleInstance
  /** Notes recorded while baselining (e.g. checks that could not run),
   * carried into the gate result's unverified list so they surface in
   * the turn's verify summary instead of degrading silently. */
  unverified: string[]
}

export type GateResult = {
  ran: boolean
  layout: LayoutFinding[]
  /** Findings the project format expects (page-format y-overflow); not issues. */
  expected: LayoutFinding[]
  console: ConsoleEntry[]
  unverified: string[]
  skipped?: string
}

/** Bridge current-width layout findings (pre or post). */
async function bridgeLayout(): Promise<{ findings: LayoutFinding[], width?: number }> {
  try {
    const { liveLayoutSnapshot } = await import('../liveTarget.js')
    const shot = await liveLayoutSnapshot({
      maxTotal: 300,
      computedStylePreset: 'layout',
      includeOverlapAnalysis: true,
      analysisMaxFindings: 40,
    }) as any
    if (!shot || shot.error || shot.ok === false) return { findings: [] }
    const snap = shot.snapshot || shot
    const width = Number(snap?.page?.viewport?.width) || undefined
    return { findings: toLayoutFindings(snap?.analysis, width), width }
  } catch {
    return { findings: [] }
  }
}

/** Bridge console watermark: the ring's current seq plus the page
 * instance it belongs to, so a post-reload read can detect the epoch
 * change instead of diffing against a dead page's seq space. */
async function bridgeWatermark(): Promise<ConsoleChannelMark> {
  try {
    const raw = await pageCommand('console', { maxEntries: 1 }) as any
    if (raw?.error) return { seq: 0, connected: false }
    return { seq: Number(raw?.latestSeq || 0), instance: consoleInstanceOf(raw), connected: true }
  } catch {
    return { seq: 0, connected: false }
  }
}

/** Pool counterpart of bridgeWatermark: the pool console ring's current
 * sequence (plus its generation), so the post-turn diff reports only
 * entries newer than the baseline. Without it poolSeq stayed 0 and
 * every pre-existing pool console error counted as a new finding
 * (slice 5a). */
async function poolProbe(): Promise<ConsoleChannelMark> {
  try {
    const { playwrightPoolEnabled, liveTarget } = await import('../env.js')
    if (!playwrightPoolEnabled() || liveTarget() !== 'pool') return { seq: 0, connected: false }
    const { liveConsole } = await import('../liveTarget.js')
    const raw = await liveConsole({ maxEntries: 1 }, undefined) as any
    if (raw?.error) return { seq: 0, connected: false }
    return { seq: Number(raw?.latestSeq || 0), instance: consoleInstanceOf(raw), connected: true }
  } catch {
    return { seq: 0, connected: false }
  }
}

export async function poolSeq(): Promise<number> {
  return (await poolProbe()).seq
}

/** The cheap console-only capture (slice B): both channels' watermarks
 * and nothing else — no layout snapshot, no check frames. This is
 * what every chat turn takes at its start when console checking is
 * on; the gate baseline below reuses it instead of re-probing. */
export async function captureConsoleMarks(): Promise<{ bridge: ConsoleChannelMark, pool: ConsoleChannelMark }> {
  const [bridge, pool] = await Promise.all([bridgeWatermark(), poolProbe()])
  return { bridge, pool }
}

/** Pre-stream baseline. Cheap parts always run on Files turns; frames cost ~2 page loads.
 * `pre` carries a console capture already taken at this turn's start
 * (slice B's cheap capture) — its watermarks are reused verbatim so
 * the turn probes each channel once, not twice. */
export async function captureBaseline(pre?: { bridge: ConsoleWatermark, pool: ConsoleWatermark }): Promise<GateBaseline | null> {
  if (!verifyGateEnabled()) return null
  const base: GateBaseline = { at: Date.now(), bridgeSeq: 0, bridgeLayout: [], frames: [], poolSeq: 0, unverified: [] }
  const [layout, mark, pmark] = pre
    ? [await bridgeLayout(), pre.bridge, pre.pool]
    : await Promise.all([bridgeLayout(), bridgeWatermark(), poolProbe()])
  base.bridgeLayout = layout.findings
  base.bridgeWidth = layout.width
  base.bridgeSeq = mark.seq
  base.bridgeInstance = mark.instance
  base.poolSeq = pmark.seq
  base.poolInstance = pmark.instance
  const frames = await ensureCheckFrames(currentCheckWidths())
  if (frames.skipped) base.unverified.push(frames.skipped)
  const markers = frames.markers
  if (markers.length) {
    const snaps = await snapshotCheckFrames()
    const consoles = await consoleCheckFrames(0)
    const seqByWidth = new Map(consoles.map((c) => [c.width, c.latestSeq]))
    base.frames = snaps
      .filter((s) => !s.error)
      .map((s) => ({ width: s.width, findings: s.findings, seq: seqByWidth.get(s.width) || 0 }))
  }
  return base
}

async function settleHmr(maxMs = 8000): Promise<void> {
  const t0 = Date.now()
  let last = -1
  let stable = 0
  while (Date.now() - t0 < maxMs) {
    try {
      const { liveLayoutSnapshot } = await import('../liveTarget.js')
      const shot = await liveLayoutSnapshot({ maxTotal: 60, includeComputedStyles: false, includeTextSnippets: false }) as any
      const snap = shot?.snapshot || shot
      const n = Array.isArray(snap?.elements) ? snap.elements.length : -1
      if (n === last && n >= 0) {
        stable += 1
        if (stable >= 2) return
      } else {
        stable = 0
        last = n
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

async function poolWidths(widths: number[]): Promise<{ findings: LayoutFinding[], unverified: string[] }> {
  const findings: LayoutFinding[] = []
  const unverified: string[] = []
  try {
    const { getPage, captureLayoutSnapshot, summarizeLayoutSnapshot } = await import('../browserPool.js') as any
    const page = await getPage()
    const orig = { width: 1280, height: 800 }
    try {
      const vp = page.viewportSize?.()
      if (vp) {
        orig.width = vp.width
        orig.height = vp.height
      }
    } catch { /* ignore */ }
    for (const w of widths) {
      try {
        await page.setViewportSize({ width: w, height: 800 })
        await new Promise((r) => setTimeout(r, 800))
        const snapshot = await captureLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout', includeOverlapAnalysis: true, analysisMaxFindings: 40 })
        summarizeLayoutSnapshot(snapshot)
        findings.push(...toLayoutFindings(snapshot?.analysis, w))
      } catch (e: any) {
        unverified.push(`${w}px via pool: ${e?.message || e}`)
      }
    }
    try {
      await page.setViewportSize(orig)
    } catch { /* ignore */ }
  } catch (e: any) {
    unverified.push(`pool widths unavailable: ${e?.message || e}`)
  }
  return { findings, unverified }
}

/** Post-stream gate: settle, re-check every baselined width, diff to new-only findings. */
export async function runVerifyGate(baseline: GateBaseline | null): Promise<GateResult> {
  if (!baseline) return { ran: false, layout: [], expected: [], console: [], unverified: [], skipped: 'gate disabled or no baseline' }
  await settleHmr()
  const layout: LayoutFinding[] = []
  const consoleOut: ConsoleEntry[] = []
  const unverified: string[] = [...(baseline.unverified ?? [])]

  // Bridge current width.
  const post = await bridgeLayout()
  if (post.findings.length || baseline.bridgeLayout.length) {
    layout.push(...diffFindings(baseline.bridgeLayout, post.findings))
  }
  try {
    // Probe the instance first: if the page reloaded during the turn,
    // its seq restarted at 1 and the baseline watermark would suppress
    // the new page's errors — read from its load instead, and say so.
    const probe = await pageCommand('console', { maxEntries: 1 }) as any
    if (probe?.error) {
      unverified.push(`bridge console: ${probe.error}`)
    } else {
      const plan = consoleEpochPlan(
        { seq: baseline.bridgeSeq, instance: baseline.bridgeInstance },
        consoleInstanceOf(probe),
      )
      const raw = await pageCommand('console', { sinceSeq: plan.sinceSeq, maxEntries: 100 }) as any
      if (raw?.error) unverified.push(`bridge console: ${raw.error}`)
      else {
        if (plan.reloaded) unverified.push(PAGE_RELOADED_NOTE)
        consoleOut.push(...consoleFindings(((raw?.entries || []) as ConsoleEntry[]), plan.sinceSeq))
      }
    }
  } catch (e: any) {
    unverified.push(`bridge console: ${e?.message || e}`)
  }

  if (baseline.frames.length) {
    const snaps = await snapshotCheckFrames()
    const byWidth = new Map(snaps.map((s) => [s.width, s]))
    const consoles = await consoleCheckFrames(0)
    const entriesByWidth = new Map<number, ConsoleEntry[]>()
    for (const c of consoles) entriesByWidth.set(c.width, (c.entries as ConsoleEntry[]))
    for (const f of baseline.frames) {
      const s = byWidth.get(f.width)
      if (!s || s.error) {
        unverified.push(`${f.width}px check frame: ${s?.error || 'frame gone'}`)
        continue
      }
      layout.push(...diffFindings(f.findings, s.findings))
      consoleOut.push(...consoleFindings(entriesByWidth.get(f.width) || [], f.seq))
    }
    await destroyCheckFrames()
  } else if (baseline.bridgeWidth === undefined) {
    // No bridge at all (no live page to host frames): pool fallback widths.
    const { findings, unverified: poolUn } = await poolWidths(currentCheckWidths())
    const baseKeys = new Set([...baseline.bridgeLayout.map((f) => f.key)])
    layout.push(...findings.filter((f) => !baseKeys.has(f.key)))
    unverified.push(...poolUn)
  }

  // Pool console — only when the pool is the live target, never fatal.
  // Same epoch guard as the bridge: if the pool page object was
  // replaced mid-turn, its ring restarted and the baseline seq would
  // suppress the new page's entries.
  try {
    const { playwrightPoolEnabled, liveTarget } = await import('../env.js')
    if (playwrightPoolEnabled() && liveTarget() === 'pool') {
      const probe = await liveConsole({ maxEntries: 1 }, undefined) as any
      if (!probe?.error) {
        const plan = consoleEpochPlan(
          { seq: baseline.poolSeq, instance: baseline.poolInstance },
          consoleInstanceOf(probe),
        )
        const raw = await liveConsole({ sinceSeq: plan.sinceSeq, maxEntries: 100 }, undefined) as any
        if (!raw?.error) {
          if (plan.reloaded) unverified.push(POOL_PAGE_REPLACED_NOTE)
          consoleOut.push(...consoleFindings(((raw?.entries || []) as ConsoleEntry[]), plan.sinceSeq))
        }
      }
    }
  } catch { /* best effort */ }

  // Interpret findings through the project format (§B2): in a page
  // project, vertical overflow is the document growing, not an issue.
  const { issues, expected } = applyFormatToFindings(layout, effectiveFormat(readProjectConfig()))
  return { ran: true, layout: issues, expected, console: consoleOut, unverified }
}

export function gatePrompt(result: GateResult): string | null {
  if (!result.ran) return null
  if (!result.layout.length && !result.console.length && !result.unverified.length) return null
  return formatGatePrompt(result)
}

export { formatGatePrompt }
