/**
 * Page tools as plain host functions (re-platform slice 2).
 *
 * The page senses and page actuation tools — take-snapshot,
 * inspect-dom, page-sections, layout-snapshot, layout-svg,
 * patch-dom, eval-js, run-in-page, pool-open — served to the
 * OpenCode plugin through POST /api/page/tool (registered in both
 * server.ts and apiApp.ts, per the repo's two-server mirroring
 * rule).
 *
 * Each function below is the Mastra tool's execute body
 * (src/mastra/tools/realFsTools.ts + layoutTools.ts) with the
 * wrapper removed: the SAME host functions (liveTarget.ts) and the
 * SAME result shaping (workbench/pageSections.ts,
 * workbench/runInPage.ts, annotateAgentLayoutResult), so an
 * opencode-path call returns exactly what a mastra-path call
 * returns — including the honest failure values when no live page
 * is connected (pageCommand resolves with an error object; the
 * pool tools return their pool-off error object). The Mastra tools
 * themselves are untouched and keep calling the same host plumbing
 * directly.
 *
 * Known slice-2 stance: NO per-turn gating on the opencode path.
 * All ten plugin tools (these nine + slice 1's get-console) are
 * simply available to OpenCode's default build agent, unlike the
 * Mastra path's per-mode tool sets — gating is a later slice.
 */
import {
  annotateAgentLayoutResult, liveLayoutSnapshot, liveLayoutSvg, livePageOp, poolOpen,
} from '../liveTarget.js'
import { normalizePageSections, PAGE_SECTIONS_PROGRAM } from '../workbench/pageSections.js'
import { withDispatchDebugLog } from '../chatDebug.js'
import { buildRunProgram, normalizeRunResult } from '../workbench/runInPage.js'

type Input = Record<string, any>

async function inspectDom(input: Input) {
  const { selector, url } = (input ?? {}) as { selector?: string; url?: string }
  return livePageOp('inspect', { selector, url })
}

async function takeSnapshot(input: Input) {
  return livePageOp('snapshot', (input ?? {}) as Record<string, unknown>)
}

async function pageSections(input: Input) {
  const { url } = (input ?? {}) as { url?: string }
  try {
    const raw = (await livePageOp('eval', { code: PAGE_SECTIONS_PROGRAM, url })) as any
    if (!raw || typeof raw !== 'object' || raw.error || raw.ok === false) {
      return raw && typeof raw === 'object' ? raw : { ok: false, error: 'No live page answered.' }
    }
    const out = normalizePageSections(raw)
    if (!out) return { ok: false, error: 'The page answered, but not with a section map — it may still be loading. Try again, or use take-snapshot.' }
    return { ok: true, via: raw.via, ...out, sectionCount: out.sections.length }
  } catch (e: any) {
    return { error: e.message }
  }
}

async function layoutSnapshot(input: Input) {
  try {
    const { url, ...params } = (input ?? {}) as Input
    // Agent shape: summary + elements + analysis, without the duplicated
    // full snapshot object — and with page-section grouping joined on.
    return annotateAgentLayoutResult(
      await liveLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout', ...params }, url),
      url,
      { documentCoords: params.coordinateSpace === 'document' },
    )
  } catch (e: any) {
    return { error: e.message }
  }
}

async function layoutSvg(input: Input) {
  try {
    const { url, scale, showLabels, showDimensions, showOverlaps, showGaps, showClipping, ...params } = (input ?? {}) as Input
    if (showOverlaps) (params as any).includeOverlapAnalysis = true
    if (showGaps) (params as any).includeGapAnalysis = true
    if (showClipping) (params as any).includeClippingAnalysis = true
    return await liveLayoutSvg(
      { maxTotal: 300, computedStylePreset: 'layout', ...params },
      url,
      { scale, showLabels, showDimensions, showOverlaps, showGaps, showClipping },
    )
  } catch (e: any) {
    return { error: e.message }
  }
}

async function patchDom(input: Input) {
  return livePageOp('patch', (input ?? {}) as Record<string, unknown>)
}

async function evalJs(input: Input) {
  const { code, url } = (input ?? {}) as { code?: string; url?: string }
  return livePageOp('eval', { code, url })
}

async function runInPage(input: Input) {
  const { code, url } = (input ?? {}) as { code: string; url?: string }
  const raw = await livePageOp('eval', { code: buildRunProgram(code), url })
  const rawObj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (rawObj && typeof rawObj.error === 'string') return { error: rawObj.error }
  const result = normalizeRunResult(raw)
  if (!result) return { error: 'run-in-page: the page returned an unreadable result' }
  return result
}

async function poolOpenTool(input: Input) {
  const url = typeof (input ?? {})?.url === 'string' ? (input as { url: string }).url : ''
  return poolOpen(url)
}

/** The nine wave-1 tools by their (Mastra-identical) names. */
export const PAGE_TOOL_HANDLERS: Record<string, (input: Input) => Promise<unknown>> = {
  'take-snapshot': takeSnapshot,
  'inspect-dom': inspectDom,
  'page-sections': pageSections,
  'layout-snapshot': layoutSnapshot,
  'layout-svg': layoutSvg,
  'patch-dom': patchDom,
  'eval-js': evalJs,
  'run-in-page': runInPage,
  'pool-open': poolOpenTool,
}

export const PAGE_TOOL_NAMES = Object.keys(PAGE_TOOL_HANDLERS)

/**
 * Run one page tool by name. Unknown names return an error value
 * (never a throw), matching the tool layer's shape. Handlers that
 * the Mastra original wraps in try/catch do the same here; the
 * unwrapped ones (livePageOp calls) resolve with error objects
 * from the channel rather than throwing — and the endpoint wraps
 * this call so any surprise throw still becomes tool content.
 */
async function runPageToolImpl(name: string, input: Input): Promise<unknown> {
  const handler = PAGE_TOOL_HANDLERS[name]
  if (!handler) {
    return { ok: false, error: `unknown page tool "${name}". Available: ${PAGE_TOOL_NAMES.join(', ')}` }
  }
  return handler(input ?? {})
}

/** The exported dispatch: the impl above, plus its per-tool debug
 * record when chat debug is on (slice 9 — chatDebug.ts). */
export async function runPageTool(name: string, input: Input): Promise<unknown> {
  return withDispatchDebugLog(name, input, () => runPageToolImpl(name, input))
}
