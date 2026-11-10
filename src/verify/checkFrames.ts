/**
 * Hidden check-frames: deterministic layout widths on the bridge path.
 * The host cannot resize the user's window, so the gate asks a normal
 * bridge client (via eval) to mount hidden same-origin iframes at the
 * check widths. Each frame's bridge identifies itself with #ai-check-<w>
 * and is excluded from normal dispatch — the gate addresses frames directly.
 */
import { canRegisterLocalClients, checkClients, pageCommand, pageCommandCheck } from '../pageBridge.js'
import { toLayoutFindings, type LayoutFinding } from './gate.js'
import { readProjectConfig, targetWidths } from '../projectConfig.js'

/** Every target width (phone / tablet / desktop); the fallback set. */
export const CHECK_WIDTHS = [375, 768, 1280]

/**
 * Widths the gate must verify for the active project: the manifest's
 * declared device targets (phase-11-06 §B). Undesignated projects
 * declare nothing, so all three widths are checked — the app always
 * works on every target until the user narrows it.
 */
export function currentCheckWidths(): number[] {
  return targetWidths(readProjectConfig())
}
const FRAME_HEIGHT = 800

function ensureCode(widths: number[]): string {
  return `(() => {
    const widths = ${JSON.stringify(widths)};
    for (const w of widths) {
      const id = 'ai-live-check-' + w;
      if (document.getElementById(id)) continue;
      const f = document.createElement('iframe');
      f.id = id;
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + w + 'px;height:${FRAME_HEIGHT}px;visibility:hidden;border:0;';
      f.src = location.href.split('#')[0] + '#ai-check-' + w;
      (document.body || document.documentElement).appendChild(f);
    }
    return { ok: true, ensured: widths };
  })()`
}

const DESTROY_CODE = `(() => {
  const gone = [];
  for (const el of Array.from(document.querySelectorAll('iframe[id^="ai-live-check-"]'))) {
    gone.push(el.id);
    el.remove();
  }
  return { ok: true, removed: gone };
})()`

/** Unverified note for the cross-process topology: the frames mount in
 * the page, but their bridges register with the page's own server, so
 * this process can never address them. Recorded instead of silently
 * skipping the per-width checks. */
export const FRAMES_REMOTE_NOTE = "per-width checks unavailable — check frames register with the page's own server"

/**
 * Fail-fast decision, made before any waiting: the mount eval reached
 * a page, but if no bridge client can register with this process the
 * frames will never appear in the local registry — waiting out the
 * full timeout would only tax the turn. Returns the note to record,
 * or null when frames genuinely can register and waiting is honest.
 */
export function framesSkipNote(evalReachedPage: boolean, canRegister: boolean): string | null {
  if (!evalReachedPage || canRegister) return null
  return FRAMES_REMOTE_NOTE
}

export type EnsureCheckFramesResult = { markers: string[], skipped?: string }

export async function ensureCheckFrames(widths: number[] = CHECK_WIDTHS, timeoutMs = 15000): Promise<EnsureCheckFramesResult> {
  const raw = await pageCommand('eval', { code: ensureCode(widths) }, timeoutMs) as any
  if (!raw || raw.ok === false || raw.error) return { markers: [] }
  const skip = framesSkipNote(true, canRegisterLocalClients())
  if (skip) return { markers: [], skipped: skip }
  const t0 = Date.now()
  const want = new Set(widths.map(String))
  while (Date.now() - t0 < timeoutMs) {
    const have = new Set(checkClients().map((c) => String(c.check)))
    if (widths.every((w) => have.has(String(w)))) return { markers: [...want] }
    if (!have.size && !want.size) return { markers: [] }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { markers: checkClients().map((c) => String(c.check)).filter((m) => want.has(m)) }
}

export async function destroyCheckFrames(): Promise<void> {
  try {
    await pageCommand('eval', { code: DESTROY_CODE }, 8000)
  } catch { /* best effort */ }
}

export type WidthSnapshot = {
  width: number
  findings: LayoutFinding[]
  consoleSeq: number
  viewport?: { width: number, height: number }
  error?: string
}

/** Snapshot every connected check frame, grouped by marker. */
export async function snapshotCheckFrames(): Promise<WidthSnapshot[]> {
  const results = await pageCommandCheck('layout-snapshot', {
    maxTotal: 300,
    computedStylePreset: 'layout',
    includeOverlapAnalysis: true,
    analysisMaxFindings: 40,
  }, 15000)
  const out: WidthSnapshot[] = []
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const rec = r as Record<string, unknown>
    const width = Number(rec.check)
    if (!width) continue
    if (rec.error || rec.ok === false) {
      out.push({ width, findings: [], consoleSeq: 0, error: String(rec.error || 'snapshot failed') })
      continue
    }
    const analysis = (rec.analysis ?? rec.summary) as Record<string, unknown> | undefined
    const page = rec.page as { viewport?: { width: number, height: number } } | undefined
    out.push({
      width,
      findings: toLayoutFindings(analysis, width),
      consoleSeq: 0,
      viewport: page?.viewport,
    })
  }
  return out
}

/** Console entries since seq from every check frame. */
export async function consoleCheckFrames(sinceSeq = 0): Promise<Array<{ width: number, entries: unknown[], latestSeq: number }>> {
  const results = await pageCommandCheck('console', { sinceSeq, maxEntries: 100 }, 8000)
  const out: Array<{ width: number, entries: unknown[], latestSeq: number }> = []
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const rec = r as Record<string, unknown>
    const width = Number(rec.check)
    if (!width || rec.error || rec.ok === false) continue
    out.push({
      width,
      entries: Array.isArray(rec.entries) ? rec.entries : [],
      latestSeq: Number(rec.latestSeq || sinceSeq),
    })
  }
  return out
}
