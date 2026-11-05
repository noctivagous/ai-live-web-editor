import { playwrightPoolEnabled } from './env.js'
import { pageCommand, type PageOp } from './pageBridge.js'

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

export async function runPoolOp(op: 'inspect' | 'patch' | 'eval' | 'open', payload: Record<string, unknown>) {
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

async function localPool(op: 'inspect' | 'patch' | 'eval' | 'open', payload: Record<string, unknown>) {
  const { inspectDOM, patchDOM, evalJS, getPage } = await import('./browserPool.js')
  const url = typeof payload.url === 'string' ? payload.url : undefined
  if (op === 'open') {
    const page = await getPage(url)
    return { ok: true, url: page.url(), via: 'playwright' }
  }
  if (op === 'inspect') return { via: 'playwright', ...(await inspectDOM(String(payload.selector || 'body'), url)) }
  if (op === 'patch') return { via: 'playwright', ...(await patchDOM(String(payload.selector || 'body'), String(payload.html ?? ''), url)) }
  return { via: 'playwright', ...(await evalJS(String(payload.code || ''), url)) }
}

/** inspect/patch/eval: Vite page bridge unless `url` is another origin and the pool is on. */
export async function livePageOp(op: PageOp, payload: Record<string, unknown> = {}) {
  const url = typeof payload.url === 'string' ? payload.url : undefined
  if (url && !isViteAppUrl(url)) {
    if (op === 'layout-snapshot') return liveLayoutSnapshot(payload, url)
    return runPoolOp(op, payload)
  }
  if (op === 'layout-snapshot') return liveLayoutSnapshot(payload, url)
  const result = await pageCommand(op, payload)
  if (result && typeof result === 'object') return { via: 'vite-page', ...(result as object) }
  return result
}

export async function poolOpen(url: string) {
  return runPoolOp('open', { url })
}

export async function liveLayoutSnapshot(params: Record<string, unknown> = {}, url?: string) {
  if (url && !isViteAppUrl(url)) {
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
