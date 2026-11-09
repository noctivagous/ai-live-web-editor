/**
 * Result-verify criteria — ALE's own schema for "did it work?"
 *
 * A skill (or later, any declarer: a project, a feature, a plan)
 * carries a verify.json of CRITERIA: plain-words claims paired
 * with how ALE's tooling judges them. Two families:
 *
 * - Exact checks — layout geometry (overflow / overlap / clipping
 *   / touch-target size, from the same snapshot analysis the
 *   verify gate uses), console errors, the project's own check,
 *   file contents.
 * - Heuristic measures — soft qualities operationalized: a named
 *   measure over real data (layout geometry today) plus a
 *   threshold. The verdict reports the score AND its inputs, so a
 *   heuristic never asks to be trusted blindly.
 *
 * Every criterion yields pass, fail, or couldn't-check — nothing
 * is ever silently skipped. This module is the pure core: schema,
 * validation, viewport derivation, and evaluation over an
 * Evidence value. Gathering the evidence from a live page lives
 * in criteriaGather.ts, so the evaluator is fully testable with
 * synthetic snapshots.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { DeviceTarget } from '../deviceSession.js'
import { applyFormatToFindings, type LayoutFinding } from '../verify/gate.js'
import { SKILLS_DIR } from './skills.js'

/** A skill's declared criteria: its verify.json, parsed + validated.
 *  No file → empty criteria, no errors (most skills carry none). */
export function loadSkillCriteria(skillName: string): CriteriaFile {
  const file = path.join(SKILLS_DIR, skillName, 'verify.json')
  let text: string
  try { text = fs.readFileSync(file, 'utf-8') } catch { return { criteria: [], errors: [] } }
  return parseCriteriaFile(text)
}

export type CriterionCheck = 'layout' | 'console' | 'project-check' | 'file' | 'heuristic'
export type Orientation = 'portrait' | 'landscape'

export interface Criterion {
  id: string
  /** The claim, in plain words — this is what the panel shows. */
  say: string
  check: CriterionCheck
  /** layout: no-overflow | no-overlap | no-clipping | min-touch-target.
   *  console: no-errors. file: exists | contains | not-contains. */
  expect?: string
  axis?: 'x' | 'y'
  /** min-touch-target: the minimum width AND height, in px. */
  px?: number
  /** Device targets the criterion applies to; default: all declared. */
  at?: DeviceTarget[]
  /** Default: both orientations. */
  orientation?: 'portrait' | 'landscape' | 'both'
  /** file checks: path relative to the project root. */
  path?: string
  /** file contains / not-contains: the text to look for. */
  text?: string
  /** heuristic: visual-weight-evenness | alignment-consistency |
   *  spacing-rhythm | whitespace-share. */
  measure?: string
  /** heuristic: the passing threshold, e.g. ">= 0.7". */
  pass?: string
}

export interface CriteriaFile {
  criteria: Criterion[]
  /** Human-readable problems with entries that were rejected. */
  errors: string[]
}

const CHECKS: CriterionCheck[] = ['layout', 'console', 'project-check', 'file', 'heuristic']
const LAYOUT_EXPECTS = ['no-overflow', 'no-overlap', 'no-clipping', 'min-touch-target']
const FILE_EXPECTS = ['exists', 'contains', 'not-contains']
export const HEURISTIC_MEASURES = ['visual-weight-evenness', 'alignment-consistency', 'spacing-rhythm', 'whitespace-share']

const isTarget = (v: unknown): v is DeviceTarget => v === 'phone' || v === 'tablet' || v === 'desktop'

/**
 * Parse + validate a verify.json. Bad entries are rejected with a
 * named error (never silently dropped); valid siblings survive.
 */
export function parseCriteriaFile(text: string): CriteriaFile {
  let raw: unknown
  try { raw = JSON.parse(text) } catch (e) {
    return { criteria: [], errors: [`verify.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] }
  }
  const list = (raw as { criteria?: unknown })?.criteria
  if (!Array.isArray(list)) return { criteria: [], errors: ['verify.json must carry a "criteria" array'] }
  const criteria: Criterion[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  list.forEach((entry, i) => {
    const at = `criteria[${i}]`
    if (!entry || typeof entry !== 'object') { errors.push(`${at}: not an object`); return }
    const c = entry as Record<string, unknown>
    const id = typeof c.id === 'string' ? c.id.trim() : ''
    const say = typeof c.say === 'string' ? c.say.trim() : ''
    const check = c.check as CriterionCheck
    if (!id) { errors.push(`${at}: missing id`); return }
    if (seen.has(id)) { errors.push(`${at}: duplicate id "${id}"`); return }
    if (!say) { errors.push(`${at} (${id}): missing say — the plain-words claim`); return }
    if (!CHECKS.includes(check)) { errors.push(`${at} (${id}): unknown check "${String(c.check)}"`); return }
    const crit: Criterion = { id, say, check }
    if (check === 'layout') {
      if (!LAYOUT_EXPECTS.includes(String(c.expect))) { errors.push(`${at} (${id}): layout expect must be one of ${LAYOUT_EXPECTS.join(', ')}`); return }
      crit.expect = String(c.expect)
      if (c.axis === 'x' || c.axis === 'y') crit.axis = c.axis
      if (crit.expect === 'min-touch-target') {
        if (typeof c.px !== 'number' || c.px <= 0) { errors.push(`${at} (${id}): min-touch-target needs a positive px`); return }
        crit.px = c.px
      }
    } else if (check === 'console') {
      crit.expect = 'no-errors'
    } else if (check === 'file') {
      if (!FILE_EXPECTS.includes(String(c.expect))) { errors.push(`${at} (${id}): file expect must be one of ${FILE_EXPECTS.join(', ')}`); return }
      crit.expect = String(c.expect)
      if (typeof c.path !== 'string' || !c.path.trim()) { errors.push(`${at} (${id}): file checks need a path`); return }
      crit.path = c.path.trim()
      if (crit.expect !== 'exists') {
        if (typeof c.text !== 'string' || !c.text) { errors.push(`${at} (${id}): ${crit.expect} needs the text to look for`); return }
        crit.text = c.text
      }
    } else if (check === 'heuristic') {
      if (!HEURISTIC_MEASURES.includes(String(c.measure))) { errors.push(`${at} (${id}): unknown measure "${String(c.measure)}" — one of ${HEURISTIC_MEASURES.join(', ')}`); return }
      crit.measure = String(c.measure)
      if (parseThreshold(c.pass) === null) { errors.push(`${at} (${id}): pass must be a threshold like ">= 0.7"`); return }
      crit.pass = String(c.pass)
    }
    if (Array.isArray(c.at)) {
      const targets = c.at.filter(isTarget)
      if (targets.length) crit.at = targets
    }
    if (c.orientation === 'portrait' || c.orientation === 'landscape' || c.orientation === 'both') crit.orientation = c.orientation
    seen.add(id)
    criteria.push(crit)
  })
  return { criteria, errors }
}

/** ">= 0.7" → { op, value }; null when malformed. */
export function parseThreshold(raw: unknown): { op: '>=' | '<=' | '>' | '<', value: number } | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(>=|<=|>|<)\s*(0?\.\d+|1(?:\.0+)?|0)$/)
  if (!m) return null
  return { op: m[1] as '>=' | '<=' | '>' | '<', value: Number(m[2]) }
}

function meetsThreshold(score: number, t: { op: string, value: number }): boolean {
  switch (t.op) {
    case '>=': return score >= t.value
    case '<=': return score <= t.value
    case '>': return score > t.value
    default: return score < t.value
  }
}

/* ---------------- Viewports ---------------- */

export interface Viewport {
  target: DeviceTarget
  orientation: Orientation
  width: number
  height: number
  /** Check-frame marker, `<w>x<h>` (the bridge hash accepts it as-is). */
  marker: string
}

const VIEWPORT_SIZES: Record<DeviceTarget, { portrait: [number, number], landscape: [number, number] | null }> = {
  phone: { portrait: [375, 800], landscape: [800, 375] },
  tablet: { portrait: [768, 1024], landscape: [1024, 768] },
  desktop: { portrait: null as never, landscape: [1280, 800] },
}

/** The viewports a set of device targets implies — desktops don't rotate. */
export function viewportsForTargets(targets: DeviceTarget[]): Viewport[] {
  const out: Viewport[] = []
  for (const target of targets) {
    const sizes = VIEWPORT_SIZES[target]
    if (sizes.portrait) out.push(mkViewport(target, 'portrait', sizes.portrait))
    if (sizes.landscape) out.push(mkViewport(target, 'landscape', sizes.landscape))
  }
  return out
}

function mkViewport(target: DeviceTarget, orientation: Orientation, [width, height]: [number, number]): Viewport {
  return { target, orientation, width, height, marker: `${width}x${height}` }
}

function applicableViewports(c: Criterion, all: Viewport[]): Viewport[] {
  return all.filter(v =>
    (!c.at || c.at.includes(v.target)) &&
    (!c.orientation || c.orientation === 'both' || c.orientation === v.orientation))
}

/* ---------------- Evidence + evaluation ---------------- */

export interface El {
  id?: string
  tag?: string
  rect: { left: number, top: number, width: number, height: number }
}

export interface ViewportEvidence {
  viewport: Viewport
  available: boolean
  note?: string
  findings: LayoutFinding[]
  elements: El[]
}

export interface ConsoleSource {
  /** Where the entries were heard (a viewport label or 'page'). */
  label: string
  entries: { level: string, text: string }[]
}

export interface Evidence {
  viewports: ViewportEvidence[]
  console: ConsoleSource[]
  readFile: (relPath: string) => string | null
  projectCheck: { status: 'pass' | 'fail' | 'unavailable', tail?: string }
  /** Project format: in a 'page' project, y-overflow is the document growing. */
  format?: 'app' | 'page'
}

export type Verdict = 'pass' | 'fail' | 'couldnt-check'

export interface CriterionResult {
  id: string
  say: string
  check: CriterionCheck
  verdict: Verdict
  /** One line of evidence — always present, on every verdict. */
  evidence: string
  /** Heuristics: the measured score (worst applicable viewport). */
  score?: number
  /** Per-viewport breakdown lines, when more than one applied. */
  details?: string[]
}

const label = (v: Viewport) => `${v.target} ${v.orientation} (${v.width}×${v.height})`

function liveViewports(c: Criterion, ev: Evidence): { live: ViewportEvidence[], wanted: Viewport[], note?: string } {
  const wanted = applicableViewports(c, ev.viewports.map(v => v.viewport))
  const matching = ev.viewports.filter(ve => wanted.some(w => w.marker === ve.viewport.marker))
  const live = matching.filter(ve => ve.available)
  const note = matching.find(ve => !ve.available && ve.note)?.note
  return { live, wanted, note }
}

function evalLayout(c: Criterion, ev: Evidence): CriterionResult {
  const base = { id: c.id, say: c.say, check: c.check }
  const { live, wanted, note } = liveViewports(c, ev)
  if (!live.length) {
    return { ...base, verdict: 'couldnt-check', evidence: `No live page to measure at ${wanted.map(label).join(', ') || 'any viewport'}${note ? ` — ${note}` : ''}.` }
  }
  if (c.expect === 'min-touch-target') {
    const px = c.px ?? 44
    const interactive = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'])
    const bad: string[] = []
    let counted = 0
    for (const ve of live) {
      for (const el of ve.elements) {
        if (!el.tag || !interactive.has(el.tag.toUpperCase())) continue
        if (el.rect.width <= 0 || el.rect.height <= 0) continue
        counted++
        if (el.rect.width < px || el.rect.height < px) {
          bad.push(`${el.tag.toLowerCase()}${el.id ? `#${el.id}` : ''} is ${Math.round(el.rect.width)}×${Math.round(el.rect.height)} at ${label(ve.viewport)}`)
        }
      }
    }
    if (!counted) return { ...base, verdict: 'couldnt-check', evidence: 'No interactive elements (links, buttons, inputs) found to measure.' }
    if (bad.length) return { ...base, verdict: 'fail', evidence: `${bad.length} interactive element${bad.length === 1 ? ' is' : 's are'} under ${px}px — first: ${bad[0]}.`, details: bad.slice(0, 6) }
    return { ...base, verdict: 'pass', evidence: `All ${counted} interactive elements are at least ${px}px at ${live.map(v => label(v.viewport)).join(', ')}.` }
  }
  const kind = c.expect === 'no-overflow' ? 'overflow' : c.expect === 'no-overlap' ? 'overlap' : 'clipping'
  const hits: string[] = []
  for (const ve of live) {
    let findings = ve.findings.filter(f => f.kind === kind)
    if (kind === 'overflow') {
      findings = applyFormatToFindings(findings, ev.format).issues
      if (c.axis) findings = findings.filter(f => !f.axis || f.axis === c.axis)
    }
    for (const f of findings) hits.push(`${label(ve.viewport)}: ${f.detail.slice(0, 140)}`)
  }
  if (hits.length) {
    return { ...base, verdict: 'fail', evidence: `${hits.length} ${kind} finding${hits.length === 1 ? '' : 's'} — first: ${hits[0]}`, details: hits.slice(0, 6) }
  }
  return { ...base, verdict: 'pass', evidence: `No ${kind} findings at ${live.map(v => label(v.viewport)).join(', ')}.` }
}

function evalConsole(c: Criterion, ev: Evidence): CriterionResult {
  const base = { id: c.id, say: c.say, check: c.check }
  if (!ev.console.length) {
    return { ...base, verdict: 'couldnt-check', evidence: 'No console to listen to — no live page connected.' }
  }
  const errors: string[] = []
  let warnings = 0
  for (const src of ev.console) {
    for (const e of src.entries) {
      if (e.level === 'error' || e.level === 'pageerror') errors.push(`${src.label}: ${(e.text || '').slice(0, 140)}`)
      else if (e.level === 'warn') warnings++
    }
  }
  if (errors.length) {
    return { ...base, verdict: 'fail', evidence: `${errors.length} console error${errors.length === 1 ? '' : 's'} — first: ${errors[0]}`, details: errors.slice(0, 6) }
  }
  return { ...base, verdict: 'pass', evidence: `No console errors heard (${ev.console.map(s => s.label).join(', ')})${warnings ? `; ${warnings} warning${warnings === 1 ? '' : 's'} noted, not counted` : ''}.` }
}

function evalFile(c: Criterion, ev: Evidence): CriterionResult {
  const base = { id: c.id, say: c.say, check: c.check }
  const content = ev.readFile(c.path ?? '')
  if (c.expect === 'exists') {
    return content !== null
      ? { ...base, verdict: 'pass', evidence: `${c.path} exists.` }
      : { ...base, verdict: 'fail', evidence: `${c.path} does not exist.` }
  }
  if (content === null) return { ...base, verdict: 'fail', evidence: `${c.path} does not exist, so it cannot ${c.expect === 'contains' ? 'contain' : 'avoid'} the text.` }
  const found = content.includes(c.text ?? '')
  if (c.expect === 'contains') {
    return found
      ? { ...base, verdict: 'pass', evidence: `${c.path} contains "${(c.text ?? '').slice(0, 60)}".` }
      : { ...base, verdict: 'fail', evidence: `${c.path} does not contain "${(c.text ?? '').slice(0, 60)}".` }
  }
  return found
    ? { ...base, verdict: 'fail', evidence: `${c.path} still contains "${(c.text ?? '').slice(0, 60)}".` }
    : { ...base, verdict: 'pass', evidence: `${c.path} does not contain "${(c.text ?? '').slice(0, 60)}".` }
}

function evalProjectCheck(c: Criterion, ev: Evidence): CriterionResult {
  const base = { id: c.id, say: c.say, check: c.check }
  if (ev.projectCheck.status === 'unavailable') {
    return { ...base, verdict: 'couldnt-check', evidence: ev.projectCheck.tail || 'The project declares no check to run.' }
  }
  return ev.projectCheck.status === 'pass'
    ? { ...base, verdict: 'pass', evidence: 'The project check passed.' }
    : { ...base, verdict: 'fail', evidence: `The project check failed${ev.projectCheck.tail ? ` — tail: ${ev.projectCheck.tail.slice(-200)}` : ''}` }
}

/* ---------------- Heuristic measures ---------------- */

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Elements worth judging: real area, at least partly in the viewport. */
function judgeable(els: El[], vp: Viewport): El[] {
  return els.filter(e =>
    e.rect.width >= 4 && e.rect.height >= 4 &&
    e.rect.left < vp.width && e.rect.top < vp.height &&
    e.rect.left + e.rect.width > 0 && e.rect.top + e.rect.height > 0)
}

export interface MeasureResult { score: number, note: string }

export function measureVisualWeightEvenness(els: El[], vp: Viewport): MeasureResult | null {
  const js = judgeable(els, vp)
  if (js.length < 4) return null
  const quads = [0, 0, 0, 0]
  for (const e of js) {
    const cx = e.rect.left + e.rect.width / 2
    const cy = e.rect.top + e.rect.height / 2
    const q = (cx >= vp.width / 2 ? 1 : 0) + (cy >= vp.height / 2 ? 2 : 0)
    quads[q] += e.rect.width * e.rect.height
  }
  const total = quads.reduce((a, b) => a + b, 0)
  if (!total) return null
  const shares = quads.map(q => q / total)
  const score = clamp01(1 - (Math.max(...shares) - 0.25) / 0.75)
  return { score, note: `quadrant weight ${shares.map(s => Math.round(s * 100)).join('/')}%` }
}

export function measureAlignmentConsistency(els: El[], vp: Viewport): MeasureResult | null {
  const js = judgeable(els, vp)
  if (js.length < 4) return null
  const lefts = js.map(e => Math.round(e.rect.left))
  const tops = js.map(e => Math.round(e.rect.top))
  const shared = (values: number[], i: number) => values.some((o, j) => j !== i && Math.abs(o - values[i]) <= 2)
  let aligned = 0
  js.forEach((e, i) => {
    if (shared(lefts, i)) aligned++
    if (shared(tops, i)) aligned++
  })
  const score = aligned / (js.length * 2)
  return { score, note: `${aligned} of ${js.length * 2} element edges line up with another element's edge` }
}

export function measureSpacingRhythm(els: El[], vp: Viewport): MeasureResult | null {
  const js = judgeable(els, vp)
  const tops = [...new Set(js.map(e => Math.round(e.rect.top)))].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < tops.length; i++) {
    const g = tops[i] - tops[i - 1]
    if (g > 0 && g <= 240) gaps.push(g)
  }
  if (gaps.length < 3) return null
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (!mean) return null
  const std = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length)
  return { score: clamp01(1 - std / mean), note: `row gaps average ${Math.round(mean)}px with ${Math.round(std)}px spread` }
}

export function measureWhitespaceShare(els: El[], vp: Viewport): MeasureResult | null {
  const js = judgeable(els, vp)
  if (!js.length) return null
  const N = 24
  const covered = new Set<number>()
  for (const e of js) {
    const x0 = Math.max(0, Math.floor((e.rect.left / vp.width) * N))
    const x1 = Math.min(N - 1, Math.floor(((e.rect.left + e.rect.width) / vp.width) * N))
    const y0 = Math.max(0, Math.floor((e.rect.top / vp.height) * N))
    const y1 = Math.min(N - 1, Math.floor(((e.rect.top + e.rect.height) / vp.height) * N))
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) covered.add(y * N + x)
  }
  const score = 1 - covered.size / (N * N)
  return { score, note: `${covered.size} of ${N * N} grid cells are covered by content` }
}

export const MEASURES: Record<string, (els: El[], vp: Viewport) => MeasureResult | null> = {
  'visual-weight-evenness': measureVisualWeightEvenness,
  'alignment-consistency': measureAlignmentConsistency,
  'spacing-rhythm': measureSpacingRhythm,
  'whitespace-share': measureWhitespaceShare,
}

function evalHeuristic(c: Criterion, ev: Evidence): CriterionResult {
  const base = { id: c.id, say: c.say, check: c.check }
  const { live, wanted, note } = liveViewports(c, ev)
  if (!live.length) {
    return { ...base, verdict: 'couldnt-check', evidence: `No live page to measure at ${wanted.map(label).join(', ') || 'any viewport'}${note ? ` — ${note}` : ''}.` }
  }
  const measure = MEASURES[c.measure ?? '']
  const threshold = parseThreshold(c.pass)
  if (!measure || !threshold) return { ...base, verdict: 'couldnt-check', evidence: 'The criterion names a measure or threshold the tooling does not know.' }
  const per: { ve: ViewportEvidence, r: MeasureResult }[] = []
  for (const ve of live) {
    const r = measure(ve.elements, ve.viewport)
    if (r) per.push({ ve, r })
  }
  if (!per.length) {
    return { ...base, verdict: 'couldnt-check', evidence: 'Too little on the page to judge — fewer than a handful of elements at every applicable size.' }
  }
  per.sort((a, b) => a.r.score - b.r.score)
  const worst = per[0]
  const ok = meetsThreshold(worst.r.score, threshold)
  return {
    ...base,
    verdict: ok ? 'pass' : 'fail',
    score: Math.round(worst.r.score * 100) / 100,
    evidence: `${c.measure} scores ${worst.r.score.toFixed(2)} (needs ${c.pass}) at ${label(worst.ve.viewport)} — ${worst.r.note}.`,
    details: per.length > 1 ? per.map(p => `${label(p.ve.viewport)}: ${p.r.score.toFixed(2)} — ${p.r.note}`) : undefined,
  }
}

/** Judge every criterion against the evidence. Pure — no I/O. */
export function evaluateCriteria(criteria: Criterion[], ev: Evidence): CriterionResult[] {
  return criteria.map(c => {
    switch (c.check) {
      case 'layout': return evalLayout(c, ev)
      case 'console': return evalConsole(c, ev)
      case 'file': return evalFile(c, ev)
      case 'project-check': return evalProjectCheck(c, ev)
      case 'heuristic': return evalHeuristic(c, ev)
    }
  })
}
