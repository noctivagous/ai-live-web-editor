/** Mastra `activeTools` keys (must match editorAgent.tools object keys). */

import type { SketchMode } from './sketchSession.js'

/**
 * Files tools, grouped. The full set costs ~5,100 tokens of schema on every
 * step of every turn, and most turns use a fraction of it: a copy fix never
 * calls a plan tool, a plan turn never searches the web. fileToolsForTurn
 * sends the core set always and adds a group only when the turn shows
 * evidence for it — the trigger philosophy skill loading (§4) already uses.
 * A group the triggers miss is not lost for good: the instructions tell the
 * agent to say what it needs, and the next turn's set can include it.
 */
export const FILE_CORE_TOOLS = [
  'list-real-files',
  'grep',
  'read-real-file',
  'str-replace',
  'write-real-file',
  'delete-file',
  'rename-file',
  'make-dir',
  'take-snapshot',
  'inspect-dom',
  'run-project-check',
  'resolve-source',
  'codebase-map',
  'read-skill',
  'get-console',
  'get-network-failures',
] as const

/** Page/layout work: rects, wireframes, opening another origin. */
export const FILE_LAYOUT_TOOLS = [
  'layout-snapshot',
  'layout-svg',
  'pool-open',
] as const

/** Workbench code programs — dense/minified/generated file work. */
export const FILE_CODE_TOOLS = [
  'unpack-code',
] as const

/** Component catalog + templates. */
export const FILE_CATALOG_TOOLS = [
  'find-component',
  'adopt-registry',
  'install-catalog-component',
  'place-template',
] as const

/** Web research — only useful when a search backend is actually available. */
export const FILE_RESEARCH_TOOLS = [
  'web-search',
  'fetch-page',
  'research',
] as const

/** Plan editing — only meaningful while a plan exists or is being discussed. */
export const FILE_PLAN_TOOLS = [
  'plan-add-question',
  'plan-remove-question',
  'plan-revise-question',
  'plan-update-task',
  'plan-finish',
] as const

export const FILE_ACTIVE_TOOLS = [
  'list-real-files',
  'grep',
  'read-real-file',
  'str-replace',
  'write-real-file',
  'delete-file',
  'rename-file',
  'make-dir',
  'take-snapshot',
  'inspect-dom',
  'layout-snapshot',
  'layout-svg',
  'pool-open',
  'run-project-check',
  'resolve-source',
  'find-component',
  'codebase-map',
  'unpack-code',
  'adopt-registry',
  'install-catalog-component',
  'place-template',
  'read-skill',
  'web-search',
  'fetch-page',
  'research',
  'plan-add-question',
  'plan-remove-question',
  'plan-revise-question',
  'plan-update-task',
  'plan-finish',
  'get-console',
  'get-network-failures',
] as const

export const SKETCH_ACTIVE_TOOLS = [
  'take-snapshot',
  'inspect-dom',
  'patch-dom',
  'eval-js',
  'layout-snapshot',
  'layout-svg',
  'pool-open',
  'get-console',
  'get-network-failures',
] as const

export function activeToolsForMode(mode: SketchMode): string[] {
  return mode === 'sketch' ? [...SKETCH_ACTIVE_TOOLS] : [...FILE_ACTIVE_TOOLS]
}

/**
 * The one list of tools that write project files (basics audit
 * slice 3). The verify gate's trigger, the self-check trigger, the
 * Deck's edit grouping, and Chat's post-turn refresh all read this
 * set — before it existed, each hard-coded {str-replace,
 * write-real-file} and catalog/template installs (which copy real
 * files into the project) were invisible to all four.
 *
 * Name-level by necessity: consumers see tool names, not arguments.
 * `research` is deliberately absent — it writes only when a turn
 * passes saveTo, and what it writes is a document, not app code;
 * `adopt-registry` writes editor config (.ai-live/), not project
 * files. Both still surface in the Deck's per-turn file list, which
 * is extracted from result text.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'str-replace',
  'write-real-file',
  'delete-file',
  'rename-file',
  'make-dir',
  'place-template',
  'install-catalog-component',
])

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name)
}

const LAYOUT_RE = /\b(layout|wireframe|overlap|spacing|responsive|breakpoint|viewport|align|alignment|centered|centred|screenshot|visual|look|looks|styling|styles?|css|margin|padding|width|height|mobile|desktop|clipped|overflow)\b|https?:\/\//i
const CATALOG_RE = /\b(components?|templates?|catalog|library|install|buttons?|dialogs?|modals?|dropdowns?|tooltips?|accordion|tabs?|forms?|inputs?|tables?|cards?|pricing|hero|navbar|navigation|sidebar|headers?|footers?|dashboard|widgets?|icons?|charts?|menus?|pages?|sections?|landing)\b/i
const RESEARCH_RE = /\b(web|internet|online|search|research|lookup|google|docs?|documentation|latest|changelog|version of)\b|\blook up\b/i
const PLAN_RE = /\bplans?\b|\/plan\b/i
const CODE_RE = /\b(unpack\w*|unminif\w*|de-?minif\w*|minified|beautif\w*|prettif\w*|bundles?|bundled|vendor|obfuscat\w*)\b|\.min\.(?:js|mjs|cjs|ts)\b/i

export interface FilesTurnSignals {
  /** The newest user message's text (trigger evidence). */
  userText?: string
  /** A plan is active in this project (state evidence, beats text). */
  hasActivePlan?: boolean
  /** A web search backend is available this turn. */
  searchAvailable?: boolean
}

/** The Files tool set for one turn: core always, groups on evidence. */
export function fileToolsForTurn(signals: FilesTurnSignals): string[] {
  const text = signals.userText || ''
  const wanted = new Set<string>(FILE_CORE_TOOLS)
  if (LAYOUT_RE.test(text)) for (const t of FILE_LAYOUT_TOOLS) wanted.add(t)
  if (CATALOG_RE.test(text)) for (const t of FILE_CATALOG_TOOLS) wanted.add(t)
  if (CODE_RE.test(text)) for (const t of FILE_CODE_TOOLS) wanted.add(t)
  if (signals.searchAvailable && RESEARCH_RE.test(text)) for (const t of FILE_RESEARCH_TOOLS) wanted.add(t)
  if (signals.hasActivePlan || PLAN_RE.test(text)) for (const t of FILE_PLAN_TOOLS) wanted.add(t)
  return FILE_ACTIVE_TOOLS.filter((t) => wanted.has(t))
}
