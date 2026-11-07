import { liveTarget, playwrightPoolEnabled } from './env.js'
import { pageCommand, type PageOp } from './pageBridge.js'
import { isSketchMode, recordLiveSketchPatch } from './sketchSession.js'

const VITE_ORIGIN = process.env.VITE_ORIGIN || 'http://localhost:5173'
const LAUNCHER_ORIGIN = `http://localhost:${process.env.LAUNCHER_PORT || 4112}`

let launcherOwner = false
export function markLauncherOwner() { launcherOwner = true }

const POOL_OFF = { error: 'Playwright pool is off. Enable it in Settings (or set PLAYWRIGHT_POOL=1).' }

export function requirePlaywrightPool() {
  if (playwrightPoolEnabled()) return null
  return POOL_OFF
}

export function isViteAppUrl(url?: string | null) {
  if (!url || !String(url).trim()) return true
  try {
    return new URL(url).origin === new URL(VITE_ORIGIN).origin
  } catch {
    return true
  }
}

function usePlaywrightLive(url?: string) {
  if (liveTarget() === 'pool') return true
  return Boolean(url && !isViteAppUrl(url))
}

export async function runPoolOp(op: 'inspect' | 'patch' | 'eval' | 'open' | 'snapshot', payload: Record<string, unknown>) {
  const denied = requirePlaywrightPool()
  if (denied) return denied
  if (launcherOwner) return localPool(op, payload)
  try {
    const r = await fetch(`${LAUNCHER_ORIGIN}/api/browser/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) return await r.json()
    const data = await r.json().catch(() => ({}))
    if (data && (data.error || data.ok === false)) return data
  } catch { /* 4112 down — Path 2 runs pool locally */ }
  return localPool(op, payload)
}

async function localPool(op: 'inspect' | 'patch' | 'eval' | 'open' | 'snapshot', payload: Record<string, unknown>) {
  try {
    const { inspectDOM, patchDOM, evalJS, getPage, snapshotPage } = await import('./browserPool.js')
    const url = typeof payload.url === 'string' ? payload.url : undefined
    if (op === 'open') {
      const page = await getPage(url)
      return { ok: true, url: page.url(), via: 'playwright' }
    }
    if (op === 'inspect') return { via: 'playwright', ...(await inspectDOM(String(payload.selector || 'body'), url)) }
    if (op === 'patch') return { via: 'playwright', ...(await patchDOM(payload)) }
    if (op === 'snapshot') return { via: 'playwright', ...(await snapshotPage(payload)) }
    return { via: 'playwright', ...(await evalJS(String(payload.code || ''), url)) }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message, via: 'playwright' }
  }
}

/**
 * Agent-facing shape of a layout snapshot result. The summary already carries
 * viewport/scroll/counts and elements + analysis ride at the top level, so the
 * full `snapshot` object — the single largest tool result in a Files turn —
 * only repeats them (page url/title and the style whitelist are the only
 * losses). Internal callers that need the whole object (verify gate, SVG
 * render, /api/layout/snapshot) call liveLayoutSnapshot directly.
 */
export function agentLayoutSnapshotResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const r = result as Record<string, unknown>
  if (!('snapshot' in r)) return result
  const { snapshot: _snapshot, ...rest } = r
  return rest
}

/** inspect/patch/eval: Vite page bridge unless LIVE_TARGET=pool or `url` is another origin. */
export async function livePageOp(op: PageOp, payload: Record<string, unknown> = {}) {
  const url = typeof payload.url === 'string' ? payload.url : undefined
  const sketchOnVite = isSketchMode() && isViteAppUrl(url)
  let result: unknown
  if (usePlaywrightLive(url) && !sketchOnVite) {
    if (op === 'layout-snapshot') return agentLayoutSnapshotResult(await liveLayoutSnapshot(payload, url))
    if (op === 'console') return liveConsole(payload, url)
    result = await runPoolOp(op, payload)
  } else if (op === 'layout-snapshot') {
    result = agentLayoutSnapshotResult(await liveLayoutSnapshot(payload, url))
  } else if (op === 'console') {
    result = await liveConsole(payload, url)
  } else {
    const raw = await pageCommand(op, payload)
    result = raw && typeof raw === 'object' ? { via: 'vite-page', ...(raw as object) } : raw
  }
  if (op === 'patch') recordLiveSketchPatch(payload, result)
  return result
}

export async function poolOpen(url: string) {
  return runPoolOp('open', { url })
}

/** P0-b console signal: bridge ring buffer, or pool page listeners. */
export async function liveConsole(params: Record<string, unknown> = {}, url?: string) {
  if (usePlaywrightLive(url)) {
    const denied = requirePlaywrightPool()
    if (denied) return denied
    const { getPage, readPoolConsole } = await import('./browserPool.js')
    /* getPage can fail (browser launch, navigation) — return the same
     * error-object shape as every sibling path instead of throwing
     * through the get-console tool (slice 5a). */
    let page: Awaited<ReturnType<typeof getPage>>
    try {
      page = await getPage(typeof params.url === 'string' ? params.url : url)
    } catch (e: unknown) {
      return { ok: false, via: 'playwright', error: e instanceof Error ? e.message : String(e) }
    }
    return { via: 'playwright', ...readPoolConsole(page, params as any) }
  }
  const raw = await pageCommand('console', params) as any
  if (raw?.error || raw?.ok === false) return raw
  return { via: 'vite-page', ...raw }
}

/**
 * P0-b network signal: pool returns request-level failures; the bridge can
 * only list resource timing (no status), labelled honestly.
 */
export async function liveNetworkFailures(params: Record<string, unknown> = {}, url?: string) {
  if (usePlaywrightLive(url)) {
    const denied = requirePlaywrightPool()
    if (denied) return denied
    const { getPage, readPoolNetwork } = await import('./browserPool.js')
    const page = await getPage(typeof params.url === 'string' ? params.url : url)
    return { via: 'playwright', ...readPoolNetwork(page, params as any) }
  }
  return {
    via: 'vite-page',
    ok: true,
    failures: [],
    note: 'bridge resource timing has no HTTP status — timing-level list only; request-level failures need the pool',
  }
}

export async function liveLayoutSnapshot(params: Record<string, unknown> = {}, url?: string) {
  if (usePlaywrightLive(url)) {
    const denied = requirePlaywrightPool()
    if (denied) return denied
    const { captureLayoutSnapshot, summarizeLayoutSnapshot } = await import('./browserPool.js')
    const snapshot = await captureLayoutSnapshot(
      { maxTotal: 300, computedStylePreset: 'layout', ...params } as any,
      url,
    )
    const summary = summarizeLayoutSnapshot(snapshot as any)
    return { via: 'playwright', ...summary, elements: (snapshot as any).elements, analysis: (snapshot as any).analysis, elapsedMs: (snapshot as any).elapsedMs, fallback: (snapshot as any).fallback, snapshot }
  }
  const raw = await pageCommand('layout-snapshot', params, 15000) as any
  if (raw?.error || raw?.ok === false) return raw
  const { finishPageLayout } = await import('./layout/pageLayout.js')
  const { summarizeLayoutSnapshot } = await import('./browserPool.js')
  const snapshot = finishPageLayout(raw, {
    includeOverlapAnalysis: params.includeOverlapAnalysis !== false,
    analysisMaxFindings: typeof params.analysisMaxFindings === 'number' ? params.analysisMaxFindings : 40,
  })
  if ((snapshot as any)?.error) return snapshot
  const summary = summarizeLayoutSnapshot(snapshot as any)
  return {
    via: 'vite-page',
    ...summary,
    elements: (snapshot as any).elements,
    analysis: (snapshot as any).analysis,
    elapsedMs: raw.elapsedMs,
    fallback: false,
    snapshot,
  }
}

export async function liveLayoutSvg(params: Record<string, unknown> = {}, url?: string, svgOpts: Record<string, unknown> = {}) {
  const shot = await liveLayoutSnapshot(params, url)
  if ((shot as any)?.error) return shot
  const { renderLayoutSvg, summarizeLayoutSnapshot } = await import('./browserPool.js')
  const snapshot = (shot as any).snapshot || shot
  const svg = renderLayoutSvg(snapshot as any, {
    scale: (svgOpts.scale as number) ?? 1,
    showLabels: svgOpts.showLabels ?? true,
    showDimensions: svgOpts.showDimensions ?? false,
    showOverlaps: svgOpts.showOverlaps ?? false,
    showGaps: svgOpts.showGaps ?? false,
    showClipping: svgOpts.showClipping ?? false,
  } as any)
  const summary = summarizeLayoutSnapshot(snapshot as any)
  return {
    via: (shot as any).via,
    ...summary,
    svg,
    svgLength: svg.length,
    elapsedMs: (shot as any).elapsedMs,
    fallback: (shot as any).fallback,
  }
}
