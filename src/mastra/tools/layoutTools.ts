import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { agentLayoutSnapshotResult, liveLayoutSnapshot, liveLayoutSvg } from '../../liveTarget.js'

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
    'Capture a layout-rectangle snapshot of the live Vite app (page bridge): element rects, layout styles, overlap analysis. Pass url (another origin) to use the Playwright pool.',
  inputSchema: z.object(snapshotFields),
  execute: async (input: Record<string, any>) => {
    try {
      const { url, ...params } = input
      // Agent shape: summary + elements + analysis, without the duplicated full snapshot object.
      return agentLayoutSnapshotResult(await liveLayoutSnapshot({ maxTotal: 300, computedStylePreset: 'layout', ...params }, url))
    } catch (e: any) {
      return { error: e.message }
    }
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
