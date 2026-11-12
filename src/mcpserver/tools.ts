/**
 * The ALE MCP server's tool registry (Muse Code design §7,
 * slice 5). This module is the inventory: every tool ALE offers a
 * Muse Code session, `ale_`-prefixed so a session's tool list
 * reads clearly next to the harness's native tools (on the wire
 * they surface as `mcp__ale__ale_…`).
 *
 * The server is a WRAPPER, not a second implementation: page
 * tools run through the same host dispatch behind
 * POST /api/page/tool (opencode/pageTools.ts + verifyTools.ts —
 * the Mastra tools' execute bodies with the wrapper removed),
 * and the gate runs through verify/runGate.ts, the host verify
 * entry every engine's turn arc uses. No new edit logic lives
 * here; a result a Mastra or OpenCode call would produce is the
 * result a Muse Code call produces.
 *
 * Slices add families to this one registry: graphs + brief
 * reads (slice 6), plans (slice 7), wizards (slice 8). Tool use
 * on this path is unmanaged by design (§2 principle 3): the
 * whole inventory is offered all the time.
 */
import { liveConsole } from '../liveTarget.js'
import { runPageTool } from '../opencode/pageTools.js'
import { runVerifyTool } from '../opencode/verifyTools.js'
import { runGateVerdict } from './gateVerdict.js'

export interface AleToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** The facet that gates this tool, when it belongs to one
   * (Facets design §10.2): while the facet is off, the tool is
   * neither listed nor callable. Untagged tools are always on. */
  facet?: import('../ui/lib/facets.js').ProjectFacetId
  run: (input: Record<string, any>) => Promise<unknown>
}

/** Schema helpers, shared by every family module in this
 * package. The composed registry lives in registry.ts. */
export const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: true,
})
export const str = (description: string) => ({ type: 'string', description })
export const num = (description: string) => ({ type: 'number', description })
export const bool = (description: string) => ({ type: 'boolean', description })

/** One page tool riding the /api/page/tool dispatch by its host
 * name: the wrapper is the naming + description layer only. */
function pageTool(name: string, hostName: string, description: string, inputSchema: Record<string, unknown>): AleToolDef {
  return { name, description, inputSchema, run: (input) => runPageTool(hostName, input ?? {}) }
}

/** The gate as a standalone tool (§7): the shared verdict in
 * gateVerdict.ts, which the Stop hook's re-check also uses. */
async function verifyGateRun(): Promise<unknown> {
  return runGateVerdict()
}

/** Slice 5's inventory: the live-page family + the verify
 * family. registry.ts composes this with the later slices'
 * families (graphs, plans, wizards) into the full ALE_TOOLS. */
export const ALE_PAGE_VERIFY_TOOLS: AleToolDef[] = [
  pageTool(
    'ale_page_patch', 'patch-dom',
    'Patch one element on the live page directly (the fastest way to make a small visual change). Ops: text (set textContent), html (set innerHTML), style (CSS text), class (set class), attr (needs attr {name, value}), insert (needs html with exactly one root element + position before|after|prepend|append), move (needs target selector + position), remove. Prefer editing project files for durable changes; use this for immediate, visible iteration.',
    obj({
      selector: str('CSS selector of the element to patch'),
      op: { type: 'string', enum: ['html', 'text', 'style', 'attr', 'class', 'remove', 'insert', 'move'], description: 'The patch operation' },
      text: str('For op text: the new text content'),
      html: str('For op html/insert: the HTML fragment'),
      style: str('For op style: CSS declarations'),
      className: str('For op class: the new class list'),
      attr: { type: 'object', description: 'For op attr: { name, value }', properties: { name: { type: 'string' }, value: { type: 'string' } } },
      target: str('For op move: destination selector'),
      position: { type: 'string', enum: ['before', 'after', 'prepend', 'append'], description: 'insert/move placement; default append' },
      url: str('Pool page URL (Playwright pool only); omit for the preview bridge page'),
    }, ['selector']),
  ),
  pageTool(
    'ale_page_eval', 'eval-js',
    'Evaluate a JavaScript expression in the live preview page and return its JSON-serializable result. Use for quick questions about the rendered page (computed values, element state) that the snapshot tools don’t answer.',
    obj({ code: str('The expression or program to evaluate in the page'), url: str('Pool page URL; omit for the bridge page') }, ['code']),
  ),
  pageTool(
    'ale_page_snapshot', 'take-snapshot',
    'Accessibility-style text snapshot of the live page (roles, names, CSS selectors) — the selector harvest for ale_page_patch. Scope it with scopeSelector when you only need one region; verbose includes generic nodes. For page structure use ale_page_sections first (cheaper, semantic).',
    obj({ verbose: bool('Include generic nodes, not only landmarks/controls/headings'), scopeSelector: str('Only snapshot under this selector'), url: str('Pool page URL; omit for the bridge page') }),
  ),
  pageTool(
    'ale_page_inspect', 'inspect-dom',
    'Inspect one element of the live page in depth by CSS selector: its box, styles, attributes and children summary.',
    obj({ selector: str('CSS selector of the element to inspect'), url: str('Pool page URL; omit for the bridge page') }, ['selector']),
  ),
  pageTool(
    'ale_page_sections', 'page-sections',
    'List the live page’s sections (header, main regions, cards, footer…) with their geometry — the map to read before a layout change.',
    obj({ url: str('Pool page URL; omit for the bridge page') }),
  ),
  pageTool(
    'ale_page_layout', 'layout-snapshot',
    'Layout snapshot of the live page with overlap / clipping / overflow analysis joined to page sections. Use its findings (not guesses) when fixing layout problems.',
    obj({ url: str('Pool page URL; omit for the bridge page'), coordinateSpace: str('"document" for document coordinates; default viewport') }),
  ),
  pageTool(
    'ale_page_layout_svg', 'layout-svg',
    'Render the live page’s layout as an SVG diagram (boxes, labels, dimensions, overlaps) — useful to reason about spatial relationships.',
    obj({ url: str('Pool page URL; omit for the bridge page'), scale: num('Diagram scale'), showLabels: bool('Label elements') }),
  ),
  pageTool(
    'ale_page_run', 'run-in-page',
    'Run a small program in the live page (statements, can read and mutate the DOM) and return its result value. For interactions a single expression can’t express.',
    obj({ code: str('The program to run in the page'), url: str('Pool page URL; omit for the bridge page') }, ['code']),
  ),
  pageTool(
    'ale_page_open', 'pool-open',
    'Open a URL in the Playwright browser pool (a real browser page ALE can inspect), for pages outside the preview bridge.',
    obj({ url: str('The URL to open in the pool') }, ['url']),
  ),
  {
    name: 'ale_page_console',
    description: 'Read recent console output and page errors from the live page (ring buffer, newest last). Filter by level or read since a sequence number. This is how you check whether the page is erroring right now.',
    inputSchema: obj({
      levels: { type: 'array', items: { type: 'string' }, description: 'Only these levels (log, info, warn, error, debug, pageerror); default all' },
      maxEntries: num('Max entries (default 100)'),
      sinceSeq: num('Only entries after this sequence number'),
      url: str('Pool page URL; omit for the bridge page'),
    }),
    run: async (input) => {
      const { url, ...rest } = (input ?? {}) as Record<string, any>
      return liveConsole(rest, url)
    },
  },
  {
    name: 'ale_verify_gate',
    description: 'Run ALE’s verify gate on the current project tree and live page NOW: layout findings (overlap, clipping, overflow), console errors, and the checks that could not run. Returns the structured verdict — ok:true means the page is clean. Run this after making changes; exit-clean from your own tools says nothing about correctness, this verdict is the acceptance state.',
    inputSchema: obj({}),
    run: () => verifyGateRun(),
  },
  {
    name: 'ale_verify_network',
    description: 'List failed network requests from the live page. The Playwright pool returns request-level failures; the preview bridge only has timing-level data and says so.',
    inputSchema: obj({ maxEntries: num('Max entries (default 100)'), sinceSeq: num('Only entries after this sequence number'), url: str('Pool page URL; omit for the bridge page') }),
    run: (input) => runVerifyTool('get-network-failures', input ?? {}),
  },
  {
    name: 'ale_verify_resolve_source',
    description: 'Resolve a live-page element back to the project source that produced it (selector / stable id / text snippet / source location). Use before editing files in response to something seen on the page.',
    inputSchema: obj({
      selector: str('CSS selector of the element'),
      stableId: str('Stable element id from a snapshot'),
      textSnippet: str('Visible text of the element'),
      sourceLoc: str('Source location hint (file:line)'),
    }),
    run: (input) => runVerifyTool('resolve-source', input ?? {}),
  },
]


