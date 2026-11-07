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
  consoleFindings,
  diffFindings,
  formatGatePrompt,
  toLayoutFindings,
  type ConsoleEntry,
  type LayoutFinding,
} from './gate.js'
import { effectiveFormat, readProjectConfig } from '../projectConfig.js'

export type GateBaseline = {
  at: number
  bridgeSeq: number
  bridgeWidth?: number
  bridgeLayout: LayoutFinding[]
  frames: Array<{ width: number, findings: LayoutFinding[], seq: number }>
  poolSeq: number
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

async function bridgeSeq(): Promise<number> {
  try {
    const raw = await pageCommand('console', { maxEntries: 1 }) as any
    return Number(raw?.latestSeq || 0)
  } catch {
    return 0
  }
}

/** Pool counterpart of bridgeSeq: the pool console ring's current
 * sequence, so the post-turn diff reports only entries newer than the
 * baseline. Without it poolSeq stayed 0 and every pre-existing pool
 * console error counted as a new finding (slice 5a). */
export async function poolSeq(): Promise<number> {
  try {
    const { playwrightPoolEnabled, liveTarget } = await import('../env.js')
    if (!playwrightPoolEnabled() || liveTarget() !== 'pool') return 0
    const { liveConsole } = await import('../liveTarget.js')
    const raw = await liveConsole({ maxEntries: 1 }, undefined) as any
    if (raw?.error) return 0
    return Number(raw?.latestSeq || 0)
  } catch {
    return 0
  }
}

/** Pre-stream baseline. Cheap parts always run on Files turns; frames cost ~2 page loads. */
export async function captureBaseline(): Promise<GateBaseline | null> {
  if (!verifyGateEnabled()) return null
  const base: GateBaseline = { at: Date.now(), bridgeSeq: 0, bridgeLayout: [], frames: [], poolSeq: 0 }
  const [layout, seq, pseq] = await Promise.all([bridgeLayout(), bridgeSeq(), poolSeq()])
  base.bridgeLayout = layout.findings
  base.bridgeWidth = layout.width
  base.bridgeSeq = seq
  base.poolSeq = pseq
  const markers = await ensureCheckFrames(currentCheckWidths())
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
  const unverified: string[] = []

  // Bridge current width.
  const post = await bridgeLayout()
  if (post.findings.length || baseline.bridgeLayout.length) {
    layout.push(...diffFindings(baseline.bridgeLayout, post.findings))
  }
  try {
    const raw = await pageCommand('console', { sinceSeq: baseline.bridgeSeq, maxEntries: 100 }) as any
    if (raw?.error) unverified.push(`bridge console: ${raw.error}`)
    else consoleOut.push(...consoleFindings(((raw?.entries || []) as ConsoleEntry[]), baseline.bridgeSeq))
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
  try {
    const { playwrightPoolEnabled, liveTarget } = await import('../env.js')
    if (playwrightPoolEnabled() && liveTarget() === 'pool') {
      const raw = await liveConsole({ sinceSeq: baseline.poolSeq, maxEntries: 100 }, undefined) as any
      if (!raw?.error) consoleOut.push(...consoleFindings(((raw?.entries || []) as ConsoleEntry[]), baseline.poolSeq))
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
