/**
 * Preview renderer registry: how the preview pane shows the marked
 * file, by type — one descriptor per renderer, and every dispatch
 * (the file pane's markability check, the Preview's surface choice)
 * reads this table. A descriptor is the renderer described as data:
 * which extensions it claims, what surface it presents, how the file
 * is encoded, and how an edit writes back ('in-place' splices into
 * the file text like the CSS boxes; 'whole-file' replaces the bytes,
 * the image-editing shape; 'none' is read-only). The summaries are
 * written to be lifted into other contexts (the agent's brief, a
 * settings list) without the code.
 *
 *   page        — an HTML file, served and shown as itself
 *   markdown    — markdown as editable blocks over its rendered
 *                 form, with a whole-document preview mode
 *   reading     — plain text, rendered as a readable document
 *   image       — shown as an image
 *   css         — a stylesheet, shown as editable boxes over its
 *                 declarations (slice D; the file text stays canonical)
 *   json        — JSON as a form over its tree (typed controls by
 *                 value shape, in-place splices like CSS); recognised
 *                 config filenames (package.json, tsconfig…) inherit
 *                 a specialised profile from lib/jsonProfiles
 *   yaml/toml/  — the other config formats, as forms over the same
 *   env           kind of tree (lib/configDoc parsers, in-place
 *                 splices), with profiles from lib/configProfiles
 *                 (GitHub Actions, Compose, Cargo, pyproject…)
 *
 * A descriptor may also name the renderer's AGENT TOOL SET
 * (descriptor.tools): renderers, bases and adapters ship with
 * tools the AI agent can inspect and edit the format through,
 * running on the same libraries the human surface uses.
 *   spreadsheet — CSV/TSV as a grid (read-only stub; cell editing
 *                 lands in this slot later)
 *   richtext    — an RTF document in the base text editor (whole-file
 *                 writes: RTF is regenerated from the document model)
 *   document    — a .docx file (stub: joins the base text editor
 *                 when its adapter lands)
 *   workbook    — an xlsx workbook (stub: not readable yet)
 *   host        — a component file: shown through the page that
 *                 renders it (the start page), never as raw code
 *   none        — no rendering; the preview stays where it is
 */

export type PreviewRenderer = 'page' | 'markdown' | 'reading' | 'image' | 'css' | 'json' | 'yaml' | 'toml' | 'env' | 'xml' | 'spreadsheet' | 'richtext' | 'document' | 'workbook' | 'host' | 'none'

export type RendererWrite = 'in-place' | 'whole-file' | 'none'
export type RendererEncoding = 'text' | 'binary' | 'none'

export interface RendererDescriptor {
  id: PreviewRenderer
  /** Extensions this renderer claims (lowercase, no dot). */
  extensions: string[]
  /** Short name of the surface it presents. */
  surface: string
  encoding: RendererEncoding
  /** How an edit writes back; 'none' = the surface is read-only. */
  write: RendererWrite
  /** One plain sentence describing the surface. */
  summary: string
  /** The agent tool set this renderer ships with (tool ids in
   * src/mastra/tools): renderers and their bases come WITH tools
   * the agent can inspect and edit the format through, running on
   * the same libraries the human surface uses. */
  tools?: string[]
}

export const RENDERERS: RendererDescriptor[] = [
  { id: 'page', extensions: ['html', 'htm'], surface: 'served page', encoding: 'none', write: 'none', summary: 'A web page, served and shown as itself.' },
  { id: 'markdown', extensions: ['md', 'markdown'], surface: 'block editor', encoding: 'text', write: 'in-place', summary: 'Markdown as editable blocks over its rendered form; an edit rewrites that block in the file.', tools: ['doc-inspect', 'doc-get', 'doc-find', 'doc-set-text', 'doc-set-item', 'doc-set-style', 'doc-add-block', 'doc-remove-block'] },
  { id: 'reading', extensions: ['txt', 'text'], surface: 'reading view', encoding: 'text', write: 'none', summary: 'Plain text shown as a readable document.' },
  { id: 'image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'], surface: 'image editor', encoding: 'binary', write: 'whole-file', summary: 'An image in the base image editor (rotate, flip, adjustments, resize); saving re-encodes png/jpeg/webp in place. SVG is shown, not raster-edited.' },
  { id: 'css', extensions: ['css'], surface: 'box editor', encoding: 'text', write: 'in-place', summary: 'A stylesheet as editable boxes; an edit rewrites that value in the file.' },
  { id: 'json', extensions: ['json', 'jsonc'], surface: 'form editor', encoding: 'text', write: 'in-place', summary: 'JSON as a form over its fields; recognised config files (package.json, tsconfig) get their own sections and controls, and an edit rewrites that value in the file.', tools: ['data-inspect', 'data-get', 'data-set', 'data-find', 'data-add', 'data-remove'] },
  { id: 'yaml', extensions: ['yaml', 'yml'], surface: 'form editor', encoding: 'text', write: 'in-place', summary: 'YAML as a form over its fields; recognised files (GitHub Actions workflows, Docker Compose) get their own sections, and an edit rewrites that value in the file.', tools: ['data-inspect', 'data-get', 'data-set', 'data-find', 'data-add', 'data-remove'] },
  { id: 'toml', extensions: ['toml'], surface: 'form editor', encoding: 'text', write: 'in-place', summary: 'TOML as a form over its fields; recognised files (Cargo.toml, pyproject.toml) get their own sections, and an edit rewrites that value in the file.', tools: ['data-inspect', 'data-get', 'data-set', 'data-find', 'data-add', 'data-remove'] },
  { id: 'env', extensions: ['env'], surface: 'form editor', encoding: 'text', write: 'in-place', summary: 'Environment variables as a form, one row per key; an edit rewrites that line in the file.', tools: ['data-inspect', 'data-get', 'data-set', 'data-find', 'data-add', 'data-remove'] },
  { id: 'xml', extensions: ['xml'], surface: 'reading view', encoding: 'text', write: 'in-place', summary: 'XML shown as text here; it parses into the same neutral tree as the config formats, so the data tools can inspect and edit its element text and attribute values in place.', tools: ['data-inspect', 'data-get', 'data-set', 'data-find', 'data-add', 'data-remove'] },
  { id: 'spreadsheet', extensions: ['csv', 'tsv'], surface: 'grid editor', encoding: 'text', write: 'in-place', summary: 'Rows and columns as an editable grid; an edit rewrites that cell in the file, keeping the other cells and quoting as they are.', tools: ['spreadsheet-inspect', 'spreadsheet-find', 'spreadsheet-set-cell', 'spreadsheet-add-row'] },
  { id: 'richtext', extensions: ['rtf'], surface: 'document editor', encoding: 'text', write: 'whole-file', summary: 'A rich-text document in the base text editor (font size, weight, alignment); edits rewrite the file from the document model.', tools: ['doc-inspect', 'doc-get', 'doc-find', 'doc-set-text', 'doc-set-item', 'doc-set-style', 'doc-add-block', 'doc-remove-block'] },
  { id: 'document', extensions: ['docx'], surface: 'document placeholder', encoding: 'binary', write: 'none', summary: 'A Word document. Reading and editing are not built yet — it joins the base text editor when its adapter lands.' },
  { id: 'workbook', extensions: ['xlsx'], surface: 'workbook placeholder', encoding: 'binary', write: 'none', summary: 'A spreadsheet workbook. Reading and editing are not built yet.' },
  { id: 'host', extensions: ['tsx', 'jsx', 'vue', 'svelte'], surface: 'host page', encoding: 'none', write: 'none', summary: 'A component shown through the page that renders it.' },
  { id: 'none', extensions: [], surface: 'none', encoding: 'none', write: 'none', summary: 'No rendering for this file type.' },
]

const BY_ID = new Map<PreviewRenderer, RendererDescriptor>(RENDERERS.map((r) => [r.id, r]))
const BY_EXT = new Map<string, PreviewRenderer>()
for (const r of RENDERERS) for (const ext of r.extensions) if (!BY_EXT.has(ext)) BY_EXT.set(ext, r.id)

export function describeRenderer(id: PreviewRenderer): RendererDescriptor {
  return BY_ID.get(id) ?? BY_ID.get('none')!
}

function extension(path: string): string {
  const base = path.split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function rendererFor(path: string): PreviewRenderer {
  // .env and its variants (.env.local, .env.production) have no
  // usable extension — the basename IS the recognition.
  const base = (path.split('/').pop() || '').toLowerCase()
  if (base === '.env' || base.startsWith('.env.') || base.startsWith('.env-')) return 'env'
  const ext = extension(path)
  const claimed = BY_EXT.get(ext)
  if (claimed) return claimed
  // Plain script files count as components when their name or folder
  // says so (a Lit element like fancy-button.ts, anything under a
  // components folder); other logic files have no rendering.
  if (ext === 'ts' || ext === 'js' || ext === 'mts' || ext === 'mjs') {
    const lower = path.toLowerCase()
    if (lower.includes('/components/') || /(^|\/)[\w-]*(-element|\.element|component)[\w-]*\.[tj]s$/.test(lower)) return 'host'
    return 'none'
  }
  return 'none'
}

export function isRenderable(path: string): boolean {
  return rendererFor(path) !== 'none'
}

const COMPONENT_MARKERS = [
  /customElements\.define\(/,
  /extends\s+LitElement/,
  /from\s+['"]lit(\/[^'"]*)?['"]/,
  /export\s+default\s+function\s+[A-Z]/,
]

/**
 * Content sniff for plain script files whose name gives nothing away:
 * a .ts file that defines a custom element or a Lit component IS a
 * component (shown through its host page); a logic module is not.
 * Used by the file pane before marking and by the Preview when a
 * marked script file's name-based renderer says 'none'.
 */
export function looksLikeComponent(content: string): boolean {
  return COMPONENT_MARKERS.some((re) => re.test(content))
}

export function isScriptFile(path: string): boolean {
  return /\.(ts|js|mts|mjs)$/i.test(path)
}
