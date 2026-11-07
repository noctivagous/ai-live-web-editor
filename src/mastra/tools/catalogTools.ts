import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getComponent, searchSummaries } from '../../catalog/catalog.js'
import { getPack, searchPacks } from '../../catalog/packs.js'

export const findComponentTool = createTool({
  id: 'find-component',
  description:
    'Search the editor\'s catalog BEFORE building common UI from scratch, TOP-DOWN: feature packs first (tier 3 — whole features as portable subgraphs: admin/configuration, settings, printing, auth), then components (tier 1 — ready-made copy-own components in the NoctComponentMeta format), with templates (tier 2) placed via place-template. Buttons, dialogs, tabs, forms, settings pages, app shells, layout primitives, tables, segmented controls and the like live at tier 1. The default component stock is shadcn (React components, vendored at catalog/stock/shadcn). A second stock, the Noct AppKit (Lit elements, noct-* tags), is OFF by default: it is searched only when the project opts in (project.ai.json "appkit": true) or when you pass includeAppkit. Search returns compact summaries; pass a tag for one component\'s full entry (typed props, slots, emits, examples, source file), or a pack id for a pack\'s full subgraph (nodes, edges, parameter schemas, external links). An exact tag lookup resolves entries from either stock, including AppKit while that stock is off. When a pack matches the need, prefer installing the pack (an install plan grafting it into the feature graph) over assembling its pieces; when a component fits, prefer copying it into the project (install-catalog-component) over hand-rolling an equivalent.',
  inputSchema: z.object({
    query: z.string().optional().describe('What you need, in words: "settings panel", "split panes", "data table", "admin configuration"'),
    tag: z.string().optional().describe('Exact component tag for its full catalog entry, e.g. "noct-app-settings" or "Button"'),
    pack: z.string().optional().describe('Exact feature pack id for its full subgraph, e.g. "admin-configuration"'),
    limit: z.number().int().positive().max(12).optional().describe('Max component results (default 6)'),
    includeAppkit: z.boolean().optional().describe('Also search the Noct AppKit (Lit) stock, which is off by default unless the project opts in'),
  }),
  execute: async ({ query, tag, pack, limit, includeAppkit }) => {
    if (pack) {
      const entry = getPack(pack)
      return entry
        ? { ok: true, tier: 'full' as const, pack: entry }
        : { ok: false, error: `No feature pack with id ${pack}` }
    }
    if (tag) {
      const entry = getComponent(tag)
      return entry
        ? { ok: true, tier: 'full' as const, component: entry }
        : { ok: false, error: `No catalog component tagged ${tag}` }
    }
    if (!query) return { ok: false, error: 'Pass a query, a tag, or a pack id' }
    const packs = searchPacks(query)
    const components = searchSummaries(query, limit ?? 6, undefined, { includeAppkit: includeAppkit ?? false })
    return {
      ok: true,
      tier: 'summary' as const,
      ...(packs.length ? { packs } : {}),
      components,
      note: packs.length
        ? 'A feature pack matches — a whole feature, not pieces. Pass its pack id for the full subgraph before deciding; installing it (an install plan) beats assembling the components below one by one. Component summaries carry names + prop names only; pass a tag for one full entry before you use it.'
        : components.length
          ? 'Summaries only (names + prop names). Pass a tag for one full entry (typed props, slots, emits, examples, source file) before you use it.'
          : 'No catalog match — building from scratch is appropriate here.',
    }
  },
})
