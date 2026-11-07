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
 *   markdown    — markdown rendered as a document (reading view for
 *                 now; its own entry so a markdown editor can grow
 *                 here without disturbing plain text)
 *   reading     — plain text, rendered as a readable document
 *   image       — shown as an image
 *   css         — a stylesheet, shown as editable boxes over its
 *                 declarations (slice D; the file text stays canonical)
 *   spreadsheet — CSV/TSV as a grid (read-only stub; cell editing
 *                 lands in this slot later)
 *   document    — a word-processing file (stub: not readable yet)
 *   workbook    — an xlsx workbook (stub: not readable yet)
 *   host        — a component file: shown through the page that
 *                 renders it (the start page), never as raw code
 *   none        — no rendering; the preview stays where it is
 */

export type PreviewRenderer = 'page' | 'markdown' | 'reading' | 'image' | 'css' | 'spreadsheet' | 'document' | 'workbook' | 'host' | 'none'

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
}

export const RENDERERS: RendererDescriptor[] = [
  { id: 'page', extensions: ['html', 'htm'], surface: 'served page', encoding: 'none', write: 'none', summary: 'A web page, served and shown as itself.' },
  { id: 'markdown', extensions: ['md', 'markdown'], surface: 'reading view', encoding: 'text', write: 'none', summary: 'Markdown rendered as a document. Editing is not built yet.' },
  { id: 'reading', extensions: ['txt', 'text'], surface: 'reading view', encoding: 'text', write: 'none', summary: 'Plain text shown as a readable document.' },
  { id: 'image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'], surface: 'image view', encoding: 'binary', write: 'none', summary: 'An image shown as itself. Editing tools are not built yet.' },
  { id: 'css', extensions: ['css'], surface: 'box editor', encoding: 'text', write: 'in-place', summary: 'A stylesheet as editable boxes; an edit rewrites that value in the file.' },
  { id: 'spreadsheet', extensions: ['csv', 'tsv'], surface: 'grid', encoding: 'text', write: 'none', summary: 'Rows and columns as a grid. Read-only for now; cell editing is not built yet.' },
  { id: 'document', extensions: ['docx', 'rtf'], surface: 'document placeholder', encoding: 'binary', write: 'none', summary: 'A word-processing document. Reading and editing are not built yet.' },
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
