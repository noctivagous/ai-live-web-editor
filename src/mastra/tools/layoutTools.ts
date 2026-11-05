import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  captureLayoutSnapshot,
  renderLayoutSvg,
  summarizeLayoutSnapshot,
} from '../../browserPool.js'

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
  url: z.string().optional().describe('Navigate pool page to this URL first'),
}

export const layoutSnapshotTool = createTool({
  id: 'layout-snapshot',
  description:
    'Capture a layout-rectangle snapshot of the live page: element rects, layout styles, overlap/gap/clipping analysis. Use this to analyze layout instead of screenshots.',
  inputSchema: z.object(snapshotFields),
  execute: async (input: Record<string, any>) => {
    try {
      const { url, ...params } = input
      const snapshot = await captureLayoutSnapshot(
        { maxTotal: 300, computedStylePreset: 'layout', ...params },
        url,
      )
      const summary = summarizeLayoutSnapshot(snapshot)
      return { ...summary, elements: (snapshot as any).elements, analysis: (snapshot as any).analysis, elapsedMs: (snapshot as any).elapsedMs, fallback: (snapshot as any).fallback }
    } catch (e: any) {
      return { error: e.message }
    }
  },
})

export const layoutSvgTool = createTool({
  id: 'layout-svg',
  description:
    'Render an SVG wireframe of the live page layout rectangles (labels, overlap/gap/clipping overlays). Captures a fresh snapshot, then renders SVG. Prefer over screenshots for layout questions.',
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
      const snapshot = await captureLayoutSnapshot(
        { maxTotal: 300, computedStylePreset: 'layout', ...params },
        url,
      )
      const svg = renderLayoutSvg(snapshot as any, {
        scale: scale ?? 1,
        showLabels: showLabels ?? true,
        showDimensions: showDimensions ?? false,
        showOverlaps: showOverlaps ?? false,
        showGaps: showGaps ?? false,
        showClipping: showClipping ?? false,
      } as any)
      const summary = summarizeLayoutSnapshot(snapshot as any)
      return { ...summary, svg, svgLength: svg.length, elapsedMs: (snapshot as any).elapsedMs, fallback: (snapshot as any).fallback }
    } catch (e: any) {
      return { error: e.message }
    }
  },
})
