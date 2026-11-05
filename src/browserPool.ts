import path from 'path'
import fs from 'fs'
import { getFsRoot } from './launcher.js'
import { playwrightPoolEnabled } from './env.js'
import {
  captureWireframeSnapshot,
  renderSvgWireframe,
  summarizeWireframeSnapshot,
  type WireframeSnapshotOutput,
} from './layout/layoutSnapshot.js'

export type LayoutSnapshotParams = Parameters<typeof captureWireframeSnapshot>[0]['params']
export type LayoutSvgOptions = Parameters<typeof renderSvgWireframe>[1]
export type { WireframeSnapshotOutput }

let browser: any = null
let context: any = null
let activeExecutable: string | undefined

export interface PoolActivity { kind: string; summary: string; at: string }
export const poolActivity: PoolActivity[] = []

function recordActivity(kind: string, summary: string) {
  poolActivity.unshift({ kind, summary, at: new Date().toLocaleTimeString() })
  if (poolActivity.length > 5) poolActivity.length = 5
}

export function getPoolInfo() {
  return {
    userDataDir: path.join(getFsRoot(), '.chrome-data'),
    executable: activeExecutable || 'playwright bundled chromium',
    pages: context ? context.pages().length : 0,
    activity: poolActivity,
  }
}

async function openPoolPage(ctx: any, url: string, tries = 8) {
  try {
    let page = ctx.pages()[0]
    if (!page) page = await ctx.newPage()
    for (let i = 0; i < tries; i++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 })
        console.log('[browser] pool landing page open at', url)
        return
      } catch { await new Promise(r => setTimeout(r, 1000)) }
    }
    console.log('[browser] pool landing page unreachable, leaving blank tab')
  } catch (e) { console.log('[browser] pool landing page failed', e) }
}

const DARWIN_DEFAULTS = [
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  `${process.env.HOME || ''}/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
]

const WIN32_DEFAULTS = [
  `${process.env.PROGRAMFILES || ''}/Google/Chrome for Testing/chrome.exe`,
  `${process.env['PROGRAMFILES(X86)'] || ''}/Google/Chrome for Testing/chrome.exe`,
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome for Testing/chrome.exe`,
]

const LINUX_DEFAULTS = [
  '/opt/google/chrome-for-testing/chrome',
  '/usr/bin/google-chrome-for-testing',
  '/usr/local/bin/chrome-for-testing',
]

function defaultCandidates(): string[] {
  if (process.platform === 'win32') return WIN32_DEFAULTS
  if (process.platform === 'linux') return LINUX_DEFAULTS
  return DARWIN_DEFAULTS
}

export function resolveBrowserExecutable(): string | undefined {
  const candidates = process.env.CHROME_FOR_TESTING_PATH
    ? [process.env.CHROME_FOR_TESTING_PATH]
    : defaultCandidates()
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return undefined
}

export async function closePool() {
  const ctx = context
  browser = null
  context = null
  if (!ctx) return
  try { await ctx.close() } catch { /* already closed */ }
  console.log('[browser] pool closed')
}

export async function getBrowser(initialUrl?: string) {
  if (!playwrightPoolEnabled()) {
    throw new Error('Playwright pool is off. Enable it in Settings (or set PLAYWRIGHT_POOL=1).')
  }
  if (context) return context
  try {
    const { chromium } = await import('playwright')
    const userDataDir = path.join(getFsRoot(), '.chrome-data')
    fs.mkdirSync(userDataDir, { recursive: true })
    const executablePath = resolveBrowserExecutable()
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ...(executablePath ? { executablePath } : {}),
      args: ['--disable-blink-features=AutomationControlled'],
      viewport: { width: 1280, height: 800 }
    })
    activeExecutable = executablePath
    console.log('[browser] pool ready at', userDataDir, 'using', executablePath || 'playwright bundled chromium')
    if (initialUrl) void openPoolPage(context, initialUrl)
    return context
  } catch (e: any) {
    context = null
    console.log('[browser] playwright not installed or failed', e)
    throw new Error(e?.message ? `Playwright failed: ${e.message}` : 'Playwright failed')
  }
}

export async function getPage(url?: string) {
  const ctx = await getBrowser()
  if (!ctx) throw new Error('No browser context')
  let page = ctx.pages()[0]
  if (!page) page = await ctx.newPage()
  if (url) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 }) } catch {}
  }
  return page
}

export async function patchDOM(selector: string, html: string, url?: string) {
  const page = await getPage(url)
  const t0 = Date.now()
  const result = await page.$eval(selector, (el: any, html: string) => {
    if (html !== undefined) el.innerHTML = html
    el.setAttribute('data-ai-patched', 'true')
    const r = el.getBoundingClientRect()
    return { ok: true, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, htmlLen: el.innerHTML.length }
  }, html)
  const out = { ...result, elapsedMs: Date.now() - t0 }
  recordActivity('patch', `${selector} ${out.elapsedMs}ms`)
  return out
}

export async function evalJS(js: string, url?: string) {
  const page = await getPage(url)
  const t0 = Date.now()
  const result = await page.evaluate(js)
  const out = { result, elapsedMs: Date.now() - t0 }
  recordActivity('eval', `${String(js).slice(0, 60)} ${out.elapsedMs}ms`)
  return out
}

export async function inspectDOM(selector: string, url?: string) {
  const page = await getPage(url)
  const data = await page.$eval(selector, (el: any) => ({
    tag: el.tagName,
    html: el.outerHTML.slice(0, 8000),
    text: el.innerText.slice(0, 4000),
    rect: el.getBoundingClientRect()
  })).catch((e: any) => ({ error: e.message }))
  recordActivity('inspect', selector)
  return data
}

function toLayoutPage(page: any) {
  return {
    url: () => String(page.url()),
    evaluate: (fn: (...args: any[]) => any, arg?: any): Promise<any> => page.evaluate(fn, arg),
    createCDPSession: async () => {
      const session = await page.context().newCDPSession(page)
      return {
        send: (method: string, params?: any) => session.send(method as any, params),
        detach: async () => { await session.detach().catch(() => {}) },
      }
    },
  }
}

export async function captureLayoutSnapshot(params: LayoutSnapshotParams = {}, url?: string) {
  const page = await getPage(url)
  const t0 = Date.now()
  try {
    const layoutPage = toLayoutPage(page)
    const { output } = await captureWireframeSnapshot({ params }, { getSelectedPage: () => layoutPage })
    recordActivity('layout-snapshot', `${output.elements.length} els ${Date.now() - t0}ms`)
    return { ...output, elapsedMs: Date.now() - t0, fallback: false }
  } catch (e: any) {
    const fallback = await evaluateLayoutFallback(page, params)
    recordActivity('layout-snapshot', `fallback ${fallback.elements.length} els (${e?.message || e})`)
    return { ...fallback, elapsedMs: Date.now() - t0, fallback: true, fallbackError: String(e?.message || e) }
  }
}

async function evaluateLayoutFallback(page: any, params: LayoutSnapshotParams): Promise<WireframeSnapshotOutput> {
  const maxTotal = Math.max(1, Math.floor(Number(params.maxTotal ?? params.maxElements ?? 300)))
  const raw = await page.evaluate((opts: any) => {
    const scopeRoot = opts.scopeSelector
      ? document.querySelector(opts.scopeSelector) || document.documentElement
      : document.documentElement
    let nodes: any[] = []
    if (opts.selectors?.length) {
      for (const sel of opts.selectors) {
        try { nodes.push(...Array.from(scopeRoot.querySelectorAll(sel))) } catch {}
      }
    } else {
      nodes = Array.from(scopeRoot.querySelectorAll('*'))
    }
    const out: any[] = []
    const limit = Math.min(nodes.length, opts.maxTotal)
    for (let i = 0; i < limit; i++) {
      const el = nodes[i] as HTMLElement
      const r = el.getBoundingClientRect()
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || r.width <= 0 || r.height <= 0) continue
      const id = (el as HTMLElement).id || undefined
      const classList = el.className && typeof el.className === 'string'
        ? el.className.split(/\s+/).filter(Boolean).slice(0, 8)
        : undefined
      let textSnippet: string | undefined
      if (opts.includeTextSnippets) {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ')
        if (t) textSnippet = t.slice(0, opts.textSnippetMaxLength)
      }
      out.push({
        tagName: el.tagName,
        id,
        classList,
        textSnippet,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        stableId: id ? `id:${id}` : `path:${el.tagName.toLowerCase()}[${i}]`,
      })
    }
    return {
      elements: out,
      truncated: nodes.length > opts.maxTotal,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      scroll: { x: window.scrollX, y: window.scrollY },
      url: location.href,
    }
  }, {
    selectors: params.selectors,
    scopeSelector: params.scopeSelector,
    maxTotal,
    includeTextSnippets: params.includeTextSnippets ?? false,
    textSnippetMaxLength: params.textSnippetMaxLength ?? 80,
  })
  return {
    schemaVersion: 2,
    coordinateSpace: params.coordinateSpace ?? 'viewport',
    page: { url: raw.url, viewport: raw.viewport, scroll: raw.scroll },
    computedStyleWhitelist: [],
    elements: raw.elements,
    truncated: raw.truncated,
  }
}

export function renderLayoutSvg(
  snapshot: WireframeSnapshotOutput,
  options: Partial<LayoutSvgOptions> = {},
) {
  return renderSvgWireframe(snapshot, {
    scale: options.scale ?? 1,
    background: options.background ?? 'transparent',
    showLabels: options.showLabels ?? true,
    showDimensions: options.showDimensions ?? false,
    showSpacing: options.showSpacing ?? false,
    showOverlaps: options.showOverlaps ?? false,
    showGaps: options.showGaps ?? false,
    showClipping: options.showClipping ?? false,
    strokeWidth: options.strokeWidth ?? 1,
    fillOpacity: options.fillOpacity ?? 0.08,
    highlightChanged: options.highlightChanged ?? false,
    previous: options.previous,
  })
}

export function summarizeLayoutSnapshot(output: WireframeSnapshotOutput) {
  return summarizeWireframeSnapshot(output)
}
