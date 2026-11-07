/**
 * Preview renderers (Open slice B): how the preview pane shows the
 * marked file, by type. The file pane consults the same table before
 * marking — a file with no renderer refuses the mark with a notice
 * instead of leaving the preview on a dead view.
 *
 *   page    — an HTML file, served and shown as itself
 *   reading — markdown / plain text, rendered as a readable document
 *   image   — shown as an image
 *   css     — a stylesheet, shown as editable boxes over its
 *             declarations (slice D; the file text stays canonical)
 *   host    — a component file: shown through the page that renders
 *             it (the start page), never as raw code
 *   none    — no rendering; the preview stays where it is
 */

export type PreviewRenderer = 'page' | 'reading' | 'image' | 'css' | 'host' | 'none'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'])
const READING_EXTS = new Set(['md', 'markdown', 'txt', 'text'])
const VIEW_EXTS = new Set(['tsx', 'jsx', 'vue', 'svelte'])

function extension(path: string): string {
  const base = path.split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function rendererFor(path: string): PreviewRenderer {
  const ext = extension(path)
  if (ext === 'html' || ext === 'htm') return 'page'
  if (ext === 'css') return 'css'
  if (READING_EXTS.has(ext)) return 'reading'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIEW_EXTS.has(ext)) return 'host'
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
