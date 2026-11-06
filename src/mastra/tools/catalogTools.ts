import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { findComponents, getComponent, loadCatalog } from '../../catalog/catalog.js'

export const findComponentTool = createTool({
  id: 'find-component',
  description:
    'Search the editor\'s component catalog (ready-made copy-own components in the NoctComponentMeta format) BEFORE building common UI from scratch — buttons, dialogs, tabs, forms, settings pages, app shells, layout primitives, tables, segmented controls and the like. The default stock is shadcn (React components, vendored at catalog/stock/shadcn). A second stock, the Noct AppKit (Lit elements, noct-* tags), is OFF by default: it is searched only when the project opts in (project.ai.json "appkit": true) or when you pass includeAppkit. Returns matching components with their props, slots and dependencies. When a match fits, prefer copying that component into the project over hand-rolling an equivalent. Pass a tag for one component\'s full entry — an exact tag lookup resolves entries from either stock, including AppKit while that stock is off.',
  inputSchema: z.object({
    query: z.string().optional().describe('What you need, in words: "settings panel", "split panes", "data table"'),
    tag: z.string().optional().describe('Exact component tag for its full catalog entry, e.g. "noct-app-settings" or "Button"'),
    limit: z.number().int().positive().max(12).optional().describe('Max results (default 6)'),
    includeAppkit: z.boolean().optional().describe('Also search the Noct AppKit (Lit) stock, which is off by default unless the project opts in'),
  }),
  execute: async ({ query, tag, limit, includeAppkit }) => {
    if (tag) {
      const entry = getComponent(tag)
      return entry ? { ok: true, components: [entry] } : { ok: false, error: `No catalog component tagged ${tag}` }
    }
    if (!query) return { ok: false, error: 'Pass a query or a tag' }
    const components = findComponents(query, limit ?? 6, loadCatalog(), { includeAppkit: includeAppkit ?? false })
    return { ok: true, components, note: components.length ? undefined : 'No catalog match — building from scratch is appropriate here.' }
  },
})
