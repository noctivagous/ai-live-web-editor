/**
 * The Agent Action registry (Agent Actions integration, slice 1).
 *
 * One entry per action the user can start without typing a command:
 * the Agent Actions menu reads this list, and later slices (palette,
 * command search, wizards) read the same list, so an action is defined
 * once. An action names its facet (which aspect of the project it works
 * on), its menu group, and how it dispatches:
 *
 * - `prompt`   — a prepared chat turn, sent through the existing
 *                ai-live:ask-ai channel (the Library's Ask AI path).
 *                Prompt texts deliberately name the tools/skills they
 *                want, because per-turn tool groups are chosen from the
 *                words in the user's message; the menu's wording is
 *                what unlocks the right tools.
 * - `plan`     — opens the planner overlay (ai-live:plan-open).
 * - `graph`    — opens the feature graph overlay (ai-live:graph-open).
 * - `library`  — switches the left pane to the Library (catalog/packs).
 * - `settings` — opens the Settings window at a section.
 *
 * Actions that would need a free-text argument before they can start
 * (read a *named* symbol, search for a *named* topic) are deliberately
 * NOT here yet: they arrive with the form dispatch in a later slice.
 * Every card in the menu must do something complete when pressed.
 */

import type { ProjectFacetId } from './facets.js'

/** An action's facet: a project facet, or 'any' (facet-free). */
export type ActionFacet = ProjectFacetId | 'any'

export type ActionGroup = 'Inspect' | 'Build' | 'Fix' | 'Design' | 'Project' | 'Plan'

export const ACTION_GROUPS: ActionGroup[] = ['Inspect', 'Build', 'Fix', 'Design', 'Project', 'Plan']

export type ActionDispatch =
  | { kind: 'prompt', text: string }
  | { kind: 'plan', goal?: string }
  | { kind: 'graph' }
  | { kind: 'library' }
  | { kind: 'settings', section: string }

/** What an action needs from the current context before it can run. */
export type ActionNeed = 'project' | 'codeFile' | 'featureGraph' | 'file' | 'page'

/** The selection an action belongs to, when it has one (slice 4):
 *  actions about the open file, or about the page in the preview.
 *  Context actions surface in the palette's "Right now" section and
 *  the editor's file-actions menu, not in the plain group lists. */
export type ActionContextKind = 'file' | 'page'

export interface AgentAction {
  id: string
  title: string
  /** One line, shown on the menu card under the title. */
  blurb: string
  group: ActionGroup
  facet: ActionFacet
  dispatch: ActionDispatch
  /** Defaults to 'project'. */
  needs?: ActionNeed
  /** The selection this action belongs to, when it has one. */
  context?: ActionContextKind
  /** The dispatched work may write project files (prompt actions only). */
  writes?: boolean
}

export interface ActionContext {
  hasProject: boolean
  /** The file open in the editor, when any (project-relative path). */
  activePath?: string
  /** null = not known yet; the action stays available. */
  hasFeatureGraph?: boolean | null
  /** A file is marked for preview (or is the start page), so there is
   *  a page in the preview. null = not known yet; stays available. */
  hasPage?: boolean | null
}

const CODE_FILE_RE = /\.(?:mjs|cjs|jsx?|tsx?)$/i

export function isCodeFile(path: string | undefined): boolean {
  return !!path && CODE_FILE_RE.test(path)
}

export function actionAvailability(a: AgentAction, ctx: ActionContext): { available: boolean, reason?: string } {
  const need = a.needs ?? 'project'
  if (!ctx.hasProject) return { available: false, reason: 'Open a project first' }
  if (need === 'codeFile' && !isCodeFile(ctx.activePath)) {
    return { available: false, reason: 'Open a JS or TS file first' }
  }
  if (need === 'file' && !ctx.activePath) {
    return { available: false, reason: 'Open a file first' }
  }
  if (need === 'featureGraph' && ctx.hasFeatureGraph === false) {
    return { available: false, reason: 'No feature graph yet — install a feature pack from the Library first' }
  }
  if (need === 'page' && ctx.hasPage === false) {
    return { available: false, reason: 'Mark a file for preview first — the eye button in the file pane' }
  }
  return { available: true }
}

/** Fill the one template slot prompt actions may use: the open file. */
export function promptTextFor(a: AgentAction, ctx: ActionContext): string {
  if (a.dispatch.kind !== 'prompt') return ''
  return a.dispatch.text.replaceAll('{file}', ctx.activePath ?? 'the open file')
}

export const AGENT_ACTIONS: AgentAction[] = [
  /* ── Inspect ─────────────────────────────────────────────── */
  {
    id: 'map-codebase', title: 'Map the codebase', group: 'Inspect', facet: 'any',
    blurb: 'How the project is organised: entry points, main files, dependencies',
    dispatch: { kind: 'prompt', text: 'Map this project with codebase-map and summarise how it is organised: the entry points, the main files, and what depends on what.' },
  },
  {
    id: 'explain-file', title: 'Explain the open file', group: 'Inspect', facet: 'any', needs: 'file', context: 'file',
    blurb: 'What this file is for, its main parts, and what depends on it',
    dispatch: { kind: 'prompt', text: 'Explain the file {file}: what it is for, its main sections or exports, and what else in this project depends on it.' },
  },
  {
    id: 'page-sections', title: 'Map page sections', group: 'Inspect', facet: 'graphic-design', needs: 'page', context: 'page',
    blurb: 'The live page as sections: their order and what each contains',
    dispatch: { kind: 'prompt', text: 'Map the live page with page-sections and summarise its layout: the sections, their order, and what each one contains.' },
  },
  {
    id: 'layout-snapshot', title: 'Check the layout', group: 'Inspect', facet: 'graphic-design', needs: 'page', context: 'page',
    blurb: 'Overlaps, overflow, and clipped or misaligned elements on the live page',
    dispatch: { kind: 'prompt', text: 'Take a layout-snapshot of the live page and report any layout problems you find: overlaps, overflow, clipped or misaligned elements.' },
  },
  {
    id: 'console-errors', title: 'Show console errors', group: 'Inspect', facet: 'any', needs: 'page', context: 'page',
    blurb: 'Errors and warnings from the live page, with file and line where known',
    dispatch: { kind: 'prompt', text: 'Check the live page\u2019s console output and list every error and warning, with the file and line each one points to where you can tell.' },
  },
  {
    id: 'network-failures', title: 'Show failed requests', group: 'Inspect', facet: 'any', needs: 'page', context: 'page',
    blurb: 'Network requests that failed on the live page, and what each one breaks',
    dispatch: { kind: 'prompt', text: 'Check for failed network requests on the live page and explain what each failure would break.' },
  },
  {
    id: 'unpack-open-file', title: 'Unpack the open file', group: 'Inspect', facet: 'any', needs: 'codeFile', context: 'file',
    blurb: 'De-minify a dense or bundled file into a readable section map',
    dispatch: { kind: 'prompt', text: 'Unpack the file {file} with unpack-code and walk me through its section map: what each top-level section is for.' },
  },

  /* ── Build ───────────────────────────────────────────────── */
  {
    id: 'add-component', title: 'Add a component or template…', group: 'Build', facet: 'features',
    blurb: 'Browse the Library and place one into the project',
    dispatch: { kind: 'library' },
  },
  {
    id: 'install-pack', title: 'Install a feature pack…', group: 'Build', facet: 'features',
    blurb: 'Settings, Printing, Auth, or Admin/Configuration — from the Library\u2019s packs',
    dispatch: { kind: 'library' },
  },
  {
    id: 'open-graph', title: 'Open the feature graph', group: 'Build', facet: 'features',
    blurb: 'The map of the whole app: regions, features, and build status',
    dispatch: { kind: 'graph' },
  },
  {
    id: 'plan-from-graph', title: 'Plan from the feature graph', group: 'Build', facet: 'features', needs: 'featureGraph',
    blurb: 'Generate a plan from a region or an installed pack, in the graph view',
    dispatch: { kind: 'graph' },
  },
  {
    id: 'check-graph', title: 'Check the feature graph', group: 'Build', facet: 'features', needs: 'featureGraph',
    blurb: 'Lint the graph and reconcile it against the files on disk',
    dispatch: { kind: 'prompt', text: 'Run feature-lint and the drift check (feature-reconcile) on this project\u2019s feature graph and report anything broken, missing, or out of date.' },
  },

  /* ── Fix ─────────────────────────────────────────────────── */
  {
    id: 'check-file', title: 'Check the open file', group: 'Fix', facet: 'any', needs: 'file', context: 'file',
    blurb: 'Read this file closely for bugs and inconsistencies — a report, no changes',
    dispatch: { kind: 'prompt', text: 'Check the file {file} for problems: read it closely for bugs, inconsistencies, and type errors, and report what you find with line references. Do not change anything yet.' },
  },
  {
    id: 'run-checks', title: 'Run project checks', group: 'Fix', facet: 'any',
    blurb: 'What passes, what fails, and the first thing to fix',
    dispatch: { kind: 'prompt', text: 'Run the project checks now and summarise the results: what passed, what failed, and the first thing to fix.' },
  },
  {
    id: 'diagnose', title: 'Diagnose what\u2019s not working', group: 'Fix', facet: 'any',
    blurb: 'Checks, console, and failed requests, read together',
    dispatch: { kind: 'prompt', text: 'Something may not be working in this app. Check the project checks, the console, and failed network requests, then tell me what is broken and what you would fix first.' },
  },

  /* ── Design ──────────────────────────────────────────────── */
  {
    id: 'make-layout', title: 'Design a layout', group: 'Design', facet: 'graphic-design', writes: true,
    blurb: 'Lay out the main page with the making-layouts skill',
    dispatch: { kind: 'prompt', text: 'Design work: use the making-layouts skill to lay out the main page of this app properly — choose a layout structure, apply it, and show me the result in the preview.' },
  },
  {
    id: 'make-responsive', title: 'Make it responsive', group: 'Design', facet: 'graphic-design', needs: 'page', context: 'page', writes: true,
    blurb: 'Phone, tablet, and desktop widths checked and fixed',
    dispatch: { kind: 'prompt', text: 'Make the main page responsive: check the layout at phone, tablet, and desktop widths and fix anything that overflows, clips, or stacks badly.' },
  },
  {
    id: 'restyle-page', title: 'Restyle the page', group: 'Design', facet: 'graphic-design', writes: true,
    blurb: 'Colours, type sizes, and spacing applied consistently from the design system',
    dispatch: { kind: 'prompt', text: 'Restyle the main page: pick a coherent set of colours, type sizes, and spacing from the project\u2019s design system (its design guide and tokens) and apply it consistently across the page.' },
  },

  /* ── Project ─────────────────────────────────────────────── */
  {
    id: 'project-type', title: 'Project type & targets…', group: 'Project', facet: 'architecture',
    blurb: 'What kind of project this is, its format, and its device targets',
    dispatch: { kind: 'settings', section: 'project' },
  },

  /* ── Plan ────────────────────────────────────────────────── */
  {
    id: 'new-plan', title: 'New plan…', group: 'Plan', facet: 'any',
    blurb: 'Questions first, then a plan, before any building starts',
    dispatch: { kind: 'plan' },
  },
]

export function actionsForGroup(group: ActionGroup): AgentAction[] {
  return AGENT_ACTIONS.filter(a => a.group === group)
}

/** The facets a palette can filter by ('any' actions belong everywhere). */
/** Palette facet filters, from the facet registry (lib/facets). */
export const ACTION_FACETS: { id: ProjectFacetId, title: string }[] = [
  { id: 'features', title: 'Features' },
  { id: 'architecture', title: 'Architecture' },
  { id: 'graphic-design', title: 'Graphic Design' },
]

/** Actions belonging to a facet: its own plus the facet-free ones. */
export function actionsForFacet(facet: ActionFacet | null, list: AgentAction[] = AGENT_ACTIONS): AgentAction[] {
  if (!facet || facet === 'any') return list
  return list.filter(a => a.facet === facet || a.facet === 'any')
}

/** Extra search words per action, so ⌘K finds actions by what the user
 *  calls them, not only by their exact titles. */
const ACTION_KEYWORDS: Record<string, string> = {
  'explain-file': 'explain understand walkthrough overview file purpose',
  'check-file': 'review audit lint problems bugs file',
  'map-codebase': 'structure overview files organisation organize',
  'page-sections': 'structure landmarks page map sections',
  'layout-snapshot': 'overlap overflow alignment visual check screenshot',
  'console-errors': 'bugs errors logs debug',
  'network-failures': '404 fetch api requests debug offline',
  'unpack-open-file': 'minified bundle beautify deminify vendor obfuscated',
  'add-component': 'catalog insert widget button template library',
  'install-pack': 'feature pack install settings printing auth admin graft',
  'open-graph': 'feature graph map regions status territory',
  'plan-from-graph': 'plan generate region pack install route',
  'check-graph': 'lint drift reconcile verify graph',
  'run-checks': 'test verify gate build pass fail',
  'diagnose': 'broken bug fix debug troubleshoot wrong',
  'make-layout': 'design arrange page skill',
  'make-responsive': 'mobile tablet desktop breakpoints widths',
  'restyle-page': 'theme colors fonts appearance css design system tokens',
  'project-type': 'architecture manifest format device targets settings',
  'new-plan': 'plan questions planning goal rillan',
}

function searchHaystack(a: AgentAction): string {
  return `${a.title} ${a.blurb} ${a.group} ${a.facet} ${ACTION_KEYWORDS[a.id] ?? ''}`.toLowerCase()
}

/**
 * ⌘K / palette search: every word in the query must appear somewhere
 * in the action's haystack. Title matches rank first, then blurb
 * matches, so the obvious hit leads. Empty query returns the list as-is.
 */
export function searchActions(query: string, list: AgentAction[] = AGENT_ACTIONS): AgentAction[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return list
  const q = query.toLowerCase().trim()
  const scored: { a: AgentAction, score: number }[] = []
  for (const a of list) {
    const hay = searchHaystack(a)
    if (!tokens.every(t => hay.includes(t))) continue
    let score = 2
    if (a.title.toLowerCase().includes(q)) score = 0
    else if (a.blurb.toLowerCase().includes(q)) score = 1
    scored.push({ a, score })
  }
  return scored.sort((x, y) => x.score - y.score).map(s => s.a)
}

export function actionById(id: string): AgentAction | undefined {
  return AGENT_ACTIONS.find(a => a.id === id)
}

/** The actions belonging to a selection kind (slice 4). */
export function actionsForContext(kind: ActionContextKind, list: AgentAction[] = AGENT_ACTIONS): AgentAction[] {
  return list.filter(a => a.context === kind)
}
