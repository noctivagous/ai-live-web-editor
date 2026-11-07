import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getComponent, searchSummaries } from '../../catalog/catalog.js'

export const findComponentTool = createTool({
  id: 'find-component',
  description:
    'Search the editor\'s component catalog (ready-made copy-own components in the NoctComponentMeta format) BEFORE building common UI from scratch — buttons, dialogs, tabs, forms, settings pages, app shells, layout primitives, tables, segmented controls and the like. The default stock is shadcn (React components, vendored at catalog/stock/shadcn). A second stock, the Noct AppKit (Lit elements, noct-* tags), is OFF by default: it is searched only when the project opts in (project.ai.json "appkit": true) or when you pass includeAppkit. Search returns compact summaries (tag, category, one-line description, prop names — about 300 tokens total); pass a tag for one component\'s full entry (typed props, slots, emits, examples, source file). An exact tag lookup resolves entries from either stock, including AppKit while that stock is off. When a match fits, prefer copying that component into the project (install-catalog-component) over hand-rolling an equivalent.',
  inputSchema: z.object({
    query: z.string().optional().describe('What you need, in words: "settings panel", "split panes", "data table"'),
    tag: z.string().optional().describe('Exact component tag for its full catalog entry, e.g. "noct-app-settings" or "Button"'),
    limit: z.number().int().positive().max(12).optional().describe('Max results (default 6)'),
    includeAppkit: z.boolean().optional().describe('Also search the Noct AppKit (Lit) stock, which is off by default unless the project opts in'),
  }),
  execute: async ({ query, tag, limit, includeAppkit }) => {
    if (tag) {
      const entry = getComponent(tag)
      return entry
        ? { ok: true, tier: 'full' as const, component: entry }
        : { ok: false, error: `No catalog component tagged ${tag}` }
    }
    if (!query) return { ok: false, error: 'Pass a query or a tag' }
    const components = searchSummaries(query, limit ?? 6, undefined, { includeAppkit: includeAppkit ?? false })
    return {
      ok: true,
      tier: 'summary' as const,
      components,
      note: components.length
        ? 'Summaries only (names + prop names). Pass a tag for one full entry (typed props, slots, emits, examples, source file) before you use it.'
        : 'No catalog match — building from scratch is appropriate here.',
    }
  },
})
