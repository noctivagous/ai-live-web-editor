/**
 * Layout templates (phase-11-05 §3, TASKS-token-efficiency §3):
 * named, previewable arrangements that live alongside the component
 * catalog in the same manifest style (`catalog/templates.json`,
 * sources in `catalog/templates/`). A template install is one file
 * write; customisation after that is str-replace on the constants
 * at the top of the file, never a layout generated from scratch.
 *
 * Kinds: module (one self-contained section), compound (a section
 * composed of repeated parts), multi-column (a column arrangement).
 * The codebase map (§1) already names templates in its vocabulary,
 * e.g. `<PricingGrid (template multi-column-3)>`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAndPersistMap } from '../codebaseMap/mapStore.js'
import { getFsRoot } from '../launcher.js'

export interface TemplateEntry {
  id: string
  name: string
  kind: 'module' | 'compound' | 'multi-column'
  description: string
  /** Source file inside catalog/templates/. */
  sourceFile: string
  /** Where the template lands in a project, e.g. /src/sections/PricingSection.jsx. */
  target: string
}

export interface TemplatesFile {
  version: number
  templates: TemplateEntry[]
}

const CATALOG_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'catalog',
)
const TEMPLATES_PATH = path.join(CATALOG_DIR, 'templates.json')
export const EDITOR_ROOT = path.join(CATALOG_DIR, '..')

let cached: TemplatesFile | null = null

export function loadTemplates(filePath: string = TEMPLATES_PATH): TemplatesFile {
  if (cached && filePath === TEMPLATES_PATH) return cached
  let parsed: TemplatesFile = { version: 1, templates: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TemplatesFile
    if (Array.isArray(raw.templates)) parsed = { version: raw.version || 1, templates: raw.templates }
  } catch { /* no manifest: no templates */ }
  if (filePath === TEMPLATES_PATH) cached = parsed
  return parsed
}

/** Test hook: forget the cached manifest. */
export function resetTemplatesCache(): void {
  cached = null
}

export function getTemplate(id: string, file: TemplatesFile = loadTemplates()): TemplateEntry | undefined {
  return file.templates.find(t => t.id === id)
}

/** One line for the project brief: what arrangements exist, by id. */
export function templateSummary(file: TemplatesFile = loadTemplates()): string {
  if (!file.templates.length) return ''
  const list = file.templates.map(t => `${t.id} (${t.kind})`).join(', ')
  return `Layout templates: ${list}. To use one, call place-template with its id — it writes the arrangement into the project as one file; customise its top-of-file constants with str-replace instead of generating a layout from scratch.`
}

/**
 * Place a template into a project: one copy to its target path.
 * Never replaces an existing file. The project map is rebuilt so
 * the new file (and its component) shows up immediately.
 */
export function placeTemplate(
  id: string,
  root: string = getFsRoot(),
  file: TemplatesFile = loadTemplates(),
): { ok: boolean, id: string, dest?: string, error?: string } {
  const entry = getTemplate(id, file)
  if (!entry) return { ok: false, id, error: `No template with id ${id}` }
  const src = path.join(CATALOG_DIR, 'templates', entry.sourceFile)
  if (!fs.existsSync(src)) return { ok: false, id, error: `Template source missing on disk: catalog/templates/${entry.sourceFile}` }
  const dest = path.join(root, '.' + entry.target)
  if (fs.existsSync(dest)) return { ok: false, id, error: `Already present at ${entry.target} — placing never replaces a project file` }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  buildAndPersistMap(root)
  return { ok: true, id, dest: entry.target }
}
