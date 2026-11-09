/**
 * Format toolbar registry: the AI actions for the file the preview
 * is showing, grouped into menus by what makes sense for THAT file
 * format — Page actions for an HTML page, Component actions for a
 * .tsx shown through its host page, Config actions for JSON, and so
 * on. This is the per-file companion to the app-wide Agent Actions
 * registry: same idea (agent capabilities as clickable commands,
 * defined once as data), scoped to one file and its format.
 *
 * An action is a prepared chat turn: pressing it sends its prompt
 * through the existing askAi channel, with {file} replaced by the
 * marked file's path. Prompt texts deliberately name the tools and
 * skills they want, because per-turn tool groups are chosen from
 * the words in the message — the menu's wording unlocks the tools,
 * exactly as in the Agent Actions registry.
 *
 * Every renderer gets a toolbar. A format with no specific actions
 * yet falls back to the generic File menus, so the toolbar's place
 * in the preview is the same whatever is marked — and the preview
 * bar's "AI toolbar" checkbox hides the whole row.
 *
 * JSON inherits further: a recognised config file adds its own
 * menus on top of the generic JSON ones (package.json gets a
 * Dependencies menu, tsconfig.json a Compiler menu), in the same
 * inherited way its form profile works (lib/jsonProfiles).
 */

import type { PreviewRenderer } from './previewRender'
import { profileForJsonPath } from './jsonProfiles'
import { profileForConfigPath } from './configProfiles'

export interface FormatAction {
  id: string
  title: string
  /** One line under the title in the menu. */
  blurb: string
  /** Prepared chat turn; {file} is replaced with the marked path. */
  prompt: string
  /** The action may write project files. Display only in this slice. */
  writes?: boolean
}

export interface FormatMenu {
  title: string
  actions: FormatAction[]
}

export interface FormatToolbar {
  /** What the marked file is, e.g. 'HTML page', 'package.json — npm package'. */
  formatLabel: string
  menus: FormatMenu[]
}

function act(id: string, title: string, blurb: string, prompt: string, writes?: boolean): FormatAction {
  return { id, title, blurb, prompt, writes }
}

const GENERIC_MENUS: FormatMenu[] = [
  {
    title: 'File',
    actions: [
      act('explain-file', 'Explain this file', 'What it is, what it does, and how it fits the project', 'Explain the file {file}: what it is, what it does, and how the rest of the project uses it. Read the file first.'),
      act('check-file', 'Check for problems', 'Errors, inconsistencies and anything out of place', 'Check the file {file} for problems: errors, inconsistencies, stale or duplicated content. Run the project checks if they cover it, and report what you find first.'),
    ],
  },
]

const PAGE_MENUS: FormatMenu[] = [
  {
    title: 'Page',
    actions: [
      act('page-sections', 'Map page sections', 'The live page as sections: order and contents', 'Map the live page with page-sections and summarise its layout: the sections, their order, and what each one contains. The page comes from {file}.'),
      act('check-layout', 'Check the layout', 'Overlaps, overflow and misaligned elements', 'Take a layout-snapshot of the live page for {file} and report any layout problems: overlaps, overflow, clipped or misaligned elements.'),
      act('make-responsive', 'Make it responsive', 'Phone, tablet and desktop widths checked and fixed', 'Make the page in {file} responsive: check the layout at phone, tablet and desktop widths and fix anything that overflows, clips, or stacks badly.', true),
      act('improve-page', 'Improve this page', 'Design and content pass over the whole page', 'Improve the page in {file}: use the making-layouts skill for its structure, tighten the copy, spacing and colours, and show me the result in the preview.', true),
    ],
  },
  {
    title: 'Verify',
    actions: [
      act('console-errors', 'Show console errors', 'Errors and warnings from the live page', 'Check the live page’s console output and list every error and warning, with the file and line each one points to where you can tell.'),
      act('failed-requests', 'Show failed requests', 'Network requests that failed on this page', 'Check for failed network requests on the live page and explain what each failure would break.'),
      act('run-checks', 'Run project checks', 'What passes, what fails, first thing to fix', 'Run the project checks now and summarise the results: what passed, what failed, and the first thing to fix.'),
    ],
  },
]

const HOST_MENUS: FormatMenu[] = [
  {
    title: 'Component',
    actions: [
      act('explain-component', 'Explain this component', 'What it renders, its props and its state', 'Explain the component in {file}: what it renders, its props and state, and where it is used. Read the file with read-symbol if it is large.'),
      act('unpack-component', 'Unpack this file', 'A readable section map of a dense file', 'Unpack the file {file} with unpack-code and walk me through its section map: what each top-level section is for.'),
      act('component-responsive', 'Make it responsive', 'Check this component at phone and desktop widths', 'Check how the component in {file} renders at phone and desktop widths in its host page, and fix anything that overflows or stacks badly.', true),
      act('component-variants', 'Add a variant', 'A second presentation of the same component', 'Add a variant to the component in {file}: a second presentation (for example compact or highlighted) chosen by a prop, keeping the current look as the default.', true),
    ],
  },
  {
    title: 'Verify',
    actions: [
      act('diagnose-component', 'Diagnose rendering', 'Checks, console and layout read together', 'The component in {file} may not be rendering right. Check the project checks, the live page’s console, and a layout-snapshot, then tell me what is broken and what you would fix first.'),
      act('run-checks', 'Run project checks', 'What passes, what fails, first thing to fix', 'Run the project checks now and summarise the results: what passed, what failed, and the first thing to fix.'),
    ],
  },
]

const CSS_MENUS: FormatMenu[] = [
  {
    title: 'Styles',
    actions: [
      act('explain-css', 'Explain this stylesheet', 'Which rules style which parts of the page', 'Explain the stylesheet {file}: which selectors carry the layout, which carry colour and type, and which pages or components use it.'),
      act('css-conflicts', 'Find conflicts & dead rules', 'Overridden declarations and selectors nothing uses', 'Review the stylesheet {file} for conflicts and dead rules: declarations overridden later in the file, and selectors that match nothing in the project’s pages. Report them; do not change the file yet.'),
      act('css-responsive', 'Make it responsive', 'Breakpoints for phone and tablet widths', 'Make the styles in {file} responsive: add or adjust breakpoints so the page lays out well at phone and tablet widths as well as desktop.', true),
      act('css-restyle', 'Restyle from the style set', 'Colours, type and spacing applied consistently', 'Restyle using {file}: pick a coherent set of colours, type sizes and spacing from the project’s style set and apply it consistently through this stylesheet.', true),
    ],
  },
]

const JSON_MENUS: FormatMenu[] = [
  {
    title: 'Config',
    actions: [
      act('explain-json', 'Explain this config', 'What each field does in this project', 'Explain the config file {file}: go through its fields and say what each one controls in this project, and which tools read it.'),
      act('validate-json', 'Validate & check', 'Invalid values, typos and settings that clash', 'Validate the config file {file}: check for invalid values, misspelled field names, and settings that clash with each other or with the rest of the project. Report what you find; do not change the file yet.'),
      act('json-cleanup', 'Tidy this file', 'Remove dead fields, keep every live value', 'Tidy the config file {file}: remove fields that nothing reads and duplicated entries, keeping every live value exactly as it is, and tell me what you removed and why.', true),
    ],
  },
]

const PACKAGE_MENUS: FormatMenu[] = [
  {
    title: 'Dependencies',
    actions: [
      act('pkg-explain-deps', 'Explain the dependencies', 'What each package is here for', 'Go through the dependencies in {file} and explain what each package is used for in this project, and which are only for building and testing.'),
      act('pkg-check-deps', 'Check the dependencies', 'Outdated, unused or risky entries', 'Check the dependencies in {file}: look for packages nothing imports, version ranges that are unusually loose, and duplicates between dependencies and devDependencies. Report what you find; do not change the file yet.'),
      act('pkg-scripts', 'Review the scripts', 'What each npm script does; what is missing', 'Review the scripts in {file}: explain what each one does, and point out standard scripts this project is missing (for example test or typecheck) without adding them yet.'),
    ],
  },
]

const TSCONFIG_MENUS: FormatMenu[] = [
  {
    title: 'Compiler',
    actions: [
      act('ts-explain-options', 'Explain the compiler options', 'What each chosen option changes', 'Explain the compilerOptions in {file}: what each set option changes about checking and emit for this project, in plain terms.'),
      act('ts-tighten', 'Tighten strictness', 'What turning strict checks on would surface', 'Assess {file} for stricter checking: list which strict compiler options are off, run the project checks to see what turning them on would surface, and recommend which to enable first. Do not change the file yet.'),
    ],
  },
]

const WORKFLOW_MENUS: FormatMenu[] = [
  {
    title: 'Workflow',
    actions: [
      act('wf-explain', 'Explain this workflow', 'What triggers it, the jobs, and their order', 'Explain the workflow {file}: what triggers it, what each job does and in what order, and which actions it pins.'),
      act('wf-validate', 'Validate the workflow', 'Trigger, job and action-reference problems', 'Validate the workflow {file} against the GitHub Actions rules: trigger events, job structure, needs references, action versions and expression syntax. Report problems; do not change the file yet.'),
    ],
  },
]

const COMPOSE_MENUS: FormatMenu[] = [
  {
    title: 'Services',
    actions: [
      act('compose-explain', 'Explain the services', 'What each service runs and how they connect', 'Explain the services in {file}: what each one runs, which ports it exposes, and how the services reach each other.'),
      act('compose-check', 'Check the services', 'Port clashes, missing images, env gaps', 'Check the services in {file} for problems: host port clashes, services with neither image nor build, referenced volumes or env files that do not exist. Report what you find; do not change the file yet.'),
    ],
  },
]

const KEYS_MENUS: FormatMenu[] = [
  {
    title: 'Keys',
    actions: [
      act('env-audit', 'Audit the keys', 'Names grouped by purpose — values never shown', 'Audit {file}: list the variable NAMES only — never print any values — grouped by purpose (app, database, third-party keys), and flag names that look misspelled, duplicated, or in the wrong case convention.'),
      act('env-missing', 'Find keys the code expects', 'Variables the code reads but this file lacks', 'Search this project’s code for environment variables it reads (process.env, import.meta.env, os.environ and similar) and compare them with the names defined in {file}. List the missing NAMES only — never invent values.'),
      act('env-unused', 'Find unused keys', 'Defined here, read nowhere in the code', 'Find variables defined in {file} that no code in this project reads. List names only, with where you searched.'),
    ],
  },
]

const MARKDOWN_MENUS: FormatMenu[] = [
  {
    title: 'Document',
    actions: [
      act('md-proofread', 'Proofread', 'Spelling, grammar and unclear sentences', 'Proofread the document {file}: fix spelling and grammar, and flag sentences that are hard to follow. Show me the fixes you made.', true),
      act('md-structure', 'Improve the structure', 'Headings, order and flow', 'Improve the structure of {file}: headings that say what each section does, a logical order, and an opening that states the point. Keep the content itself intact.', true),
      act('md-summarise', 'Summarise it', 'A short summary at the top', 'Write a short summary of {file} — three to five lines — and add it at the top of the document under its title.', true),
    ],
  },
]

const SPREADSHEET_MENUS: FormatMenu[] = [
  {
    title: 'Data',
    actions: [
      act('csv-summarise', 'Summarise this data', 'Columns, ranges and the shape of the data', 'Summarise the data in {file}: what each column holds, how many rows there are, and the ranges or totals that stand out.'),
      act('csv-anomalies', 'Find anomalies', 'Outliers, gaps and inconsistent rows', 'Check the data in {file} for anomalies: outlier values, missing cells, duplicated rows and rows whose shape differs from the rest. Report them by row number.'),
    ],
  },
]

const IMAGE_MENUS: FormatMenu[] = [
  {
    title: 'Image',
    actions: [
      act('img-describe', 'Describe & place this image', 'What it shows and where the project uses it', 'Describe the image {file} and tell me where this project uses it, and whether its size and format fit that use.'),
      act('img-alt', 'Write alt text', 'Alt text for every use of this image', 'Write alt text for the image {file} based on what it shows and how the project uses it, and add it where the image is referenced.', true),
    ],
  },
]

const LABELS: Partial<Record<PreviewRenderer, string>> = {
  page: 'HTML page',
  host: 'Component (shown through its host page)',
  jsx: 'Component (rendered live in isolation)',
  css: 'Stylesheet',
  markdown: 'Markdown document',
  reading: 'Text file',
  spreadsheet: 'Spreadsheet',
  image: 'Image',
  yaml: 'YAML file',
  xml: 'XML document',
  toml: 'TOML file',
  env: 'Environment variables',
  richtext: 'RTF document',
  document: 'Document',
  workbook: 'Workbook',
  none: 'File',
}

const MENUS: Partial<Record<PreviewRenderer, FormatMenu[]>> = {
  page: PAGE_MENUS,
  host: HOST_MENUS,
  jsx: HOST_MENUS,
  css: CSS_MENUS,
  json: JSON_MENUS,
  markdown: MARKDOWN_MENUS,
  xml: JSON_MENUS,
  richtext: MARKDOWN_MENUS,
  reading: MARKDOWN_MENUS,
  spreadsheet: SPREADSHEET_MENUS,
  image: IMAGE_MENUS,
}

/** The toolbar for a marked file: its format's menus, with the
 * recognised-JSON additions layered over the generic JSON menus. */
export function toolbarFor(renderer: PreviewRenderer, path: string): FormatToolbar {
  if (renderer === 'json') {
    const profile = profileForJsonPath(path)
    const extra = profile.id === 'package' ? PACKAGE_MENUS : profile.id === 'tsconfig' ? TSCONFIG_MENUS : []
    return { formatLabel: profile.title, menus: [...JSON_MENUS, ...extra] }
  }
  if (renderer === 'yaml' || renderer === 'toml' || renderer === 'env') {
    const profile = profileForConfigPath(path, renderer)
    const extra = profile.id === 'github-workflow' ? WORKFLOW_MENUS
      : profile.id === 'docker-compose' ? COMPOSE_MENUS
        : profile.id === 'cargo' || profile.id === 'pyproject' ? PACKAGE_MENUS
          : profile.id === 'env-generic' ? KEYS_MENUS
            : []
    return { formatLabel: profile.title, menus: [...JSON_MENUS, ...extra] }
  }
  return {
    formatLabel: LABELS[renderer] ?? 'File',
    menus: MENUS[renderer] ?? GENERIC_MENUS,
  }
}

export function promptForFormatAction(a: FormatAction, path: string): string {
  return a.prompt.replaceAll('{file}', path)
}
