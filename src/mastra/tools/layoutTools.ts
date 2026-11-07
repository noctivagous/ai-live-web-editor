import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { annotateAgentLayoutResult, liveLayoutSnapshot, liveLayoutSvg, livePageOp } from '../../liveTarget.js'
import { normalizePageSections, PAGE_SECTIONS_PROGRAM } from '../../workbench/pageSections.js'
import { buildRunProgram, normalizeRunResult } from '../../workbench/runInPage.js'

const presetEnum = z.enum(['minimal', 'layout', 'standard', 'debug', 'typography', 'paint'])
const coordinateEnum = z.enum(['viewport', 'document'])

const snapshotFields = {
  selectors: z.array(z.string()).optional().describe('CSS selectors to include; omit for page-wide snapshot'),
  scopeSelector: z.string().optional().describe('Only include elements under this selector'),
  maxTotal: z.number().int().positive().max(2000).optional().describe('Max elements returned (default 300)'),
  includeComputedStyles: z.boolean().optional().describe('Include layout computed styles (default true when clipping analysis is on)'),
  computedStylePreset: presetEnum.optional().describe('Style preset; default layout'),
  coordinateSpace: coordinateEnum.optional().describe('viewport (default) or document rects'),
  includeTextSnippets: z.boolean().optional().describe('Include short text snippets per element'),
  includeOverlapAnalysis: z.boolean().optional().describe('Detect overlapping rectangles (default true)'),
  includeGapAnalysis: z.boolean().optional().describe('Detect gaps between siblings (default false)'),
  includeClippingAnalysis: z.boolean().optional().describe('Detect overflow clipping (default true)'),
  analysisMaxFindings: z.number().int().positive().max(100).optional().describe('Max findings per analysis type'),
  url: z.string().optional().describe('Another origin: use the Playwright pool. Omit for the Vite app page bridge.'),
}

export const layoutSnapshotTool = createTool({
  id: 'layout-snapshot',
  description:
    'Capture a layout-rectangle snapshot of the live Vite app (page bridge): element rects, layout styles, overlap analysis. This is the heavyweight page sense — for the geometry of ONE region, pass scopeSelector with a selector from page-sections instead of snapshotting the whole page; for structure and names rather than geometry, page-sections is cheaper. Pass url (another origin) to use the Playwright pool.',
  inputSchema: z.object(snapshotFields),
  execute: async (input: Record<string, any>) => {
    try {
      const { url, ...params } = input
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
  },
})

export const pageSectionsTool = createTool({
  id: 'page-sections',
  description:
    'Map the live page\'s semantic sections in one call: landmark regions (header/nav/main/section/article/aside/footer + ARIA roles) with names (heading or aria-label), rects, short text digests, element/interactive counts, and drill-in handles (selector, plus the data-ai-loc source stamp when present). Pages without landmarks fall back to structural chunks of the body\'s large children, and the result says so in its mode. Run this BEFORE layout-snapshot or inspect-dom when you need to find a named part of the page ("the pricing section") — then drill into that one section. Read-only; runs on the page bridge, or in the Playwright pool when url is another origin.',
  inputSchema: z.object({
    url: z.string().optional().describe('Another origin: use the Playwright pool. Omit for the Vite app page bridge.'),
  }),
  execute: async ({ url }) => {
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
  },
})

export const runInPageTool = createTool({
  id: 'run-in-page',
  description:
    'Run JavaScript IN the live page to VERIFY a fact at runtime, and get a structured result back: {ok, value, console, error, elapsedMs}. The code is the body of an async function — use return to send a value back; await works; console output during the run is captured. Use it to check instead of inferring: what a module actually exports (await import(...)), what a function really returns for an input, live app state, whether an element is truly overflowing (el.scrollWidth > el.clientWidth). Unlike the other page senses this EXECUTES — it runs with the app\'s own powers in the app\'s own page (unsandboxed on purpose; a sandbox could not see the app) and it can change page state, so use it to check, never to edit (edits go through str-replace / patch-dom). A run that times out (10s) may keep running in the page. Values come back serialized safely: elements, functions and circular structures arrive as descriptions. Default: the Vite app; pass url for the Playwright pool.',
  inputSchema: z.object({
    code: z.string().describe('JavaScript statements; return the value to send back. Top-level await is available.'),
    url: z.string().optional(),
  }),
  execute: async ({ code, url }) => {
    const raw = await livePageOp('eval', { code: buildRunProgram(code), url })
    const rawObj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
    if (rawObj && typeof rawObj.error === 'string') return { error: rawObj.error }
    const result = normalizeRunResult(raw)
    if (!result) return { error: 'run-in-page: the page returned an unreadable result' }
    return result
  },
})

export const layoutSvgTool = createTool({
  id: 'layout-svg',
  description:
    'Render an SVG wireframe of the live Vite app layout (page bridge). Pass url (another origin) to use the Playwright pool.',
  inputSchema: z.object({
    ...snapshotFields,
    scale: z.number().min(0.1).max(4).optional().describe('SVG scale (default 1)'),
    showLabels: z.boolean().optional().describe('Label each rect (default true)'),
    showDimensions: z.boolean().optional().describe('Show width x height on rects'),
    showOverlaps: z.boolean().optional().describe('Overlay overlap analysis (also enables it)'),
    showGaps: z.boolean().optional().describe('Overlay gap analysis (also enables it)'),
    showClipping: z.boolean().optional().describe('Overlay clipping analysis (also enables it)'),
  }),
  execute: async (input: Record<string, any>) => {
    try {
      const { url, scale, showLabels, showDimensions, showOverlaps, showGaps, showClipping, ...params } = input
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
  },
})
