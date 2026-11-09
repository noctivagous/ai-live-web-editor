/**
 * Evidence gathering for criteria evaluation — the live half.
 *
 * Evaluation itself is pure (criteria.ts). This module collects
 * what it needs from the running app, through the one channel
 * that reaches the page from the editor process in the real
 * two-process topology: pageCommand ops, which the editor
 * forwards to the Vite process's bridge (eval / console /
 * layout-snapshot). Per-frame bridge addressing
 * (pageCommandCheck) only works when editor and Vite share a
 * process, so viewports are NOT measured through frame bridges.
 *
 * Instead: the console is read first (before any frame exists —
 * five app instances booting at once starve the page's main
 * thread and later ops time out), then each declared viewport
 * (width×height — orientation included) is measured in turn:
 * a hidden same-origin iframe at that size is created inside
 * the live page by an eval, and once it has loaded, a second
 * eval measures its document directly (same-origin DOM access)
 * and removes it. Overflow is computed from the measured rects
 * (the same rule the snapshot's layout assertions use),
 * overlaps via the bridge path's own analysis
 * (finishPageLayout), clipping from parent rects + computed
 * overflow. A frame that cannot load — e.g. the project's
 * frame-ancestors CSP blocking it — reports its viewport
 * unavailable, and its criteria answer couldn't-check.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pageCommand } from '../pageBridge.js'
import { getFsRoot } from '../launcher.js'
import { declaredTargets, effectiveFormat, readProjectConfig } from '../projectConfig.js'
import { finishPageLayout } from '../layout/pageLayout.js'
import { toLayoutFindings, type LayoutFinding } from '../verify/gate.js'
import {
  evaluateCriteria,
  loadSkillCriteria,
  viewportsForTargets,
  type Criterion,
  type CriterionResult,
  type El,
  type Evidence,
  type Viewport,
  type ViewportEvidence,
} from './criteria.js'
import { recordSkillCheckRun, type SkillCheckRun } from './skillChecks.js'

/**
 * The full check run for one skill: load its criteria, gather
 * evidence, evaluate, record. Shared by the run-skill-checks
 * agent tool and the panel's Run checks button, so both report
 * the same verdicts. Returns null when the skill carries no
 * (valid) criteria.
 */
export async function runCriteriaForSkill(skillName: string): Promise<{ run: SkillCheckRun, results: CriterionResult[] } | null> {
  const { criteria } = loadSkillCriteria(skillName)
  if (!criteria.length) return null
  const evidence = await gatherEvidence(criteria)
  const results = evaluateCriteria(criteria, evidence)
  const run = recordSkillCheckRun(skillName, results)
  return { run, results }
}

/* ---------------- console (before any frames exist) ---------------- */

async function gatherConsole(): Promise<Evidence['console']> {
  try {
    const raw = await pageCommand('console', { sinceSeq: 0, maxEntries: 100 }, 8000) as any
    if (raw && !raw.error && Array.isArray(raw.entries)) {
      return [{ label: 'page', entries: raw.entries }]
    }
  } catch { /* no live page — criteria will say so */ }
  return []
}

/* ---------------- per-viewport measurement via eval ---------------- */

interface RawEl {
  tag?: string
  id?: string
  parentId?: string
  overflowHidden?: boolean
  rect: { left: number, top: number, width: number, height: number, right: number, bottom: number }
}

const FRAME_ID = (marker: string) => `ai-live-check-${marker}`

/** Create (or find) the frame for one viewport; report its state. */
function frameStateCode(vp: Viewport): string {
  return `(() => {
    const id = ${JSON.stringify(FRAME_ID(vp.marker))};
    let f = document.getElementById(id);
    if (!f) {
      f = document.createElement('iframe');
      f.id = id;
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:${vp.width}px;height:${vp.height}px;visibility:hidden;border:0;';
      f.src = location.href.split('#')[0] + '#ai-check-${vp.marker}';
      (document.body || document.documentElement).appendChild(f);
      return { state: 'created' };
    }
    try {
      const doc = f.contentDocument;
      if (!doc || doc.location.href === 'about:blank') return { state: 'loading' };
      if (doc.readyState !== 'complete' && doc.readyState !== 'interactive') return { state: 'loading' };
      if (!doc.body || doc.body.children.length < 2) return { state: 'loading' };
      return { state: 'ready', href: doc.location.href };
    } catch (e) {
      return { state: 'blocked', error: String(e && e.message ? e.message : e) };
    }
  })()`
}

/** Measure the frame's document and remove the frame. */
function measureFrameCode(vp: Viewport): string {
  return `(() => {
    const id = ${JSON.stringify(FRAME_ID(vp.marker))};
    const f = document.getElementById(id);
    if (!f) return { loaded: false, error: 'frame gone' };
    let doc;
    try { doc = f.contentDocument; } catch (e) { f.remove(); return { loaded: false, error: String(e) }; }
    if (!doc || !doc.body || doc.location.href === 'about:blank') {
      f.remove();
      return { loaded: false, error: 'the page did not load in the check frame (the project frame-ancestors policy may be blocking it)' };
    }
    const cssPath = (el) => {
      const parts = [];
      let n = el;
      while (n && n.nodeType === 1 && parts.length < 8) {
        if (n.id) { parts.unshift('#' + n.id); break; }
        const tag = n.tagName.toLowerCase();
        const parent = n.parentElement;
        if (!parent) { parts.unshift(tag); break; }
        const same = [...parent.children].filter((c) => c.tagName === n.tagName);
        const idx = same.indexOf(n) + 1;
        parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
        n = parent;
      }
      return parts.join('>');
    };
    const sid = (el) => (el.id ? 'id:' + el.id : 'path:' + cssPath(el));
    const elements = [];
    const nodes = [...doc.querySelectorAll('*')];
    for (let i = 0; i < nodes.length && elements.length < 300; i++) {
      const el = nodes[i];
      const r = el.getBoundingClientRect();
      if (!Number.isFinite(r.x) || r.width <= 0 || r.height <= 0) continue;
      let overflowHidden = false;
      try {
        const cs = getComputedStyle(el);
        overflowHidden = ['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflowY);
      } catch { /* ignore */ }
      elements.push({
        tag: el.tagName,
        id: sid(el),
        parentId: el.parentElement ? sid(el.parentElement) : undefined,
        overflowHidden,
        rect: { left: r.x, top: r.y, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height },
      });
    }
    const href = doc.location.href;
    f.remove();
    return { loaded: true, href, elements };
  })()`
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function measureViewport(vp: Viewport): Promise<ViewportEvidence> {
  const unavailable = (note: string): ViewportEvidence => ({ viewport: vp, available: false, note, findings: [], elements: [] })
  // Create the frame and poll until it has loaded (each poll is a
  // fast eval — the op channel times out at ~8s, so a single
  // long-running eval is not an option).
  let state: string | undefined
  let lastError: string | undefined
  const t0 = Date.now()
  while (Date.now() - t0 < 30_000) {
    const raw = await pageCommand('eval', { code: frameStateCode(vp) }, 8000) as any
    if (!raw || raw.error || raw.ok === false) {
      return unavailable(`could not reach the live page: ${raw?.error || 'no answer'}`)
    }
    const result = raw.result ?? raw
    state = result.state
    lastError = result.error
    if (state === 'ready' || state === 'blocked') break
    await sleep(800)
  }
  if (state === 'blocked') return unavailable(`the check frame was blocked: ${lastError || 'cross-origin'}`)
  if (state !== 'ready') return unavailable('the page did not finish loading in the check frame within 30 seconds')
  await sleep(500)
  const raw = await pageCommand('eval', { code: measureFrameCode(vp) }, 8000) as any
  if (!raw || raw.error || raw.ok === false) return unavailable(`measurement failed: ${raw?.error || 'no answer'}`)
  const result = (raw.result ?? raw) as { loaded: boolean, error?: string, elements?: RawEl[] }
  if (!result.loaded) return unavailable(result.error || 'the page did not load in the check frame')
  const rawEls = result.elements ?? []

  // Findings, computed server-side from the measured rects.
  // Overflow reports only the OUTERMOST offenders per axis: when a
  // container spills, everything inside it spills with it, and a
  // finding per child is noise — the container is the fault.
  const findings: LayoutFinding[] = []
  const byIdRaw = new Map(rawEls.map(el => [el.id, el]))
  const spills = (el: RawEl, axis: 'x' | 'y') => axis === 'x' ? el.rect.right > vp.width + 1 : el.rect.bottom > vp.height + 1
  const hasSpillingAncestor = (el: RawEl, axis: 'x' | 'y'): boolean => {
    let p = el.parentId ? byIdRaw.get(el.parentId) : undefined
    while (p) {
      if (spills(p, axis)) return true
      p = p.parentId ? byIdRaw.get(p.parentId) : undefined
    }
    return false
  }
  for (const el of rawEls) {
    if (spills(el, 'x') && !hasSpillingAncestor(el, 'x')) {
      findings.push({ key: `overflow:${el.id}:x @${vp.width}`, kind: 'overflow', axis: 'x', width: vp.width, detail: JSON.stringify({ stableId: el.id, right: Math.round(el.rect.right), excess: Math.round(el.rect.right - vp.width) }) })
    }
    if (spills(el, 'y') && !hasSpillingAncestor(el, 'y')) {
      findings.push({ key: `overflow:${el.id}:y @${vp.width}`, kind: 'overflow', axis: 'y', width: vp.width, detail: JSON.stringify({ stableId: el.id, bottom: Math.round(el.rect.bottom), excess: Math.round(el.rect.bottom - vp.height) }) })
    }
  }
  const finished = finishPageLayout({
    schemaVersion: 2,
    page: { url: '', viewport: { width: vp.width, height: vp.height } },
    elements: rawEls.map(el => ({
      stableId: el.id, parentStableId: el.parentId, tagName: el.tag,
      rect: el.rect,
    })),
  } as any, { includeOverlapAnalysis: true, analysisMaxFindings: 40 }) as any
  findings.push(...toLayoutFindings(finished?.analysis, vp.width))
  for (const el of rawEls) {
    const parent = el.parentId ? byIdRaw.get(el.parentId) : undefined
    if (!parent || !parent.overflowHidden) continue
    const p = parent.rect
    if (el.rect.left < p.left - 1 || el.rect.top < p.top - 1 || el.rect.right > p.right + 1 || el.rect.bottom > p.bottom + 1) {
      findings.push({ key: `clip:${el.id}->${parent.id} @${vp.width}`, kind: 'clipping', width: vp.width, detail: JSON.stringify({ target: el.id, clippedBy: parent.id }) })
    }
  }

  const elements: El[] = rawEls.map(el => ({
    id: el.id, tag: el.tag,
    rect: { left: el.rect.left, top: el.rect.top, width: el.rect.width, height: el.rect.height },
  }))
  return { viewport: vp, available: true, findings, elements }
}

/* ---------------- project check + files ---------------- */

function runProjectCheck(): Promise<Evidence['projectCheck']> {
  const root = getFsRoot()
  const pkgPath = path.join(root, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return Promise.resolve({ status: 'unavailable', tail: 'No package.json in the active project, so there is no project check to run.' })
  }
  let build: unknown
  try {
    build = (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, unknown> })?.scripts?.build
  } catch {
    return Promise.resolve({ status: 'unavailable', tail: 'package.json could not be parsed.' })
  }
  if (typeof build !== 'string' || !build) {
    return Promise.resolve({ status: 'unavailable', tail: 'The project declares no build script to check with.' })
  }
  return new Promise(resolve => {
    const child = spawn('npm', ['run', 'build'], { cwd: root, shell: false })
    let out = ''
    const keep = (d: Buffer) => { out = (out + d.toString()).slice(-4000) }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ status: 'fail', tail: 'The project check timed out after 120 seconds.' })
    }, 120_000)
    child.on('error', e => { clearTimeout(timer); resolve({ status: 'unavailable', tail: `The project check could not start: ${e.message}` }) })
    child.on('close', code => {
      clearTimeout(timer)
      resolve(code === 0 ? { status: 'pass' } : { status: 'fail', tail: out })
    })
  })
}

function projectReadFile(relPath: string): string | null {
  const root = getFsRoot()
  const resolved = path.resolve(root, relPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  try {
    return fs.readFileSync(resolved, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Collect the evidence for one criteria run. Only gathers what
 * the criteria actually need: page evidence when any criterion
 * looks at the page, the project check only when asked.
 */
export async function gatherEvidence(criteria: Criterion[]): Promise<Evidence> {
  const config = readProjectConfig()
  const targets = declaredTargets(config)
  const allViewports = viewportsForTargets(targets)
  const needsPage = criteria.some(c => c.check === 'layout' || c.check === 'console' || c.check === 'heuristic')
  const needsCheck = criteria.some(c => c.check === 'project-check')

  let viewportEvidence: ViewportEvidence[] = allViewports.map(viewport => ({
    viewport, available: false, note: 'not gathered', findings: [], elements: [],
  }))
  let consoleSources: Evidence['console'] = []

  if (needsPage) {
    // Console FIRST, while the page is undisturbed — frames
    // booting afterwards cannot starve this read.
    consoleSources = await gatherConsole()
    viewportEvidence = []
    for (const vp of allViewports) {
      viewportEvidence.push(await measureViewport(vp))
    }
  }

  return {
    viewports: viewportEvidence,
    console: consoleSources,
    readFile: projectReadFile,
    projectCheck: needsCheck ? await runProjectCheck() : { status: 'unavailable', tail: 'not requested' },
    format: effectiveFormat(config),
  }
}
