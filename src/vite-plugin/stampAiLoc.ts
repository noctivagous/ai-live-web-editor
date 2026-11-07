/**
 * Dev-only JSX `data-ai-loc` stamping (exact DOM→file join).
 *
 * The Vite plugin runs this `transform` on project source in dev. Each JSX
 * opening tag gets `data-ai-loc="/rel/path.jsx:LINE"` on the SAME line, so
 * reported line numbers do not shift. The page bridge reads the attribute
 * back and the resolver short-circuits to `confidence: "exact"`.
 *
 * Deliberately dependency-free (no Babel in this repo): a conservative
 * scanner, not a parser. It stamps `<Tag`, `<div`, `<Foo.Bar` opening tags
 * and skips closing tags, fragments, comments, and TS generics (which have
 * an identifier immediately before `<`, e.g. `foo<Bar>`). Unstamped code
 * keeps working through the heuristic resolver.
 */

const STAMP_ATTR = 'data-ai-loc'

const TAG_RE = /<([A-Za-z][\w.-]*)(?=[\s/>\n\r])/g

/** Chars that may legally precede a JSX `<` (excludes `foo<Bar>` generics). */
const OK_BEFORE = new Set(['', ' ', '\t', '(', '{', '[', '>', '=', ':', ',', ';', '!', '&', '|', '?', '+', '*', '\n', '\r'])

function tagHasStampAfter(code: string, tagEnd: number): boolean {
  const window = code.slice(tagEnd, tagEnd + 200)
  const gt = window.indexOf('>')
  const slice = gt < 0 ? window : window.slice(0, gt)
  return slice.includes(STAMP_ATTR)
}

/**
 * Stamp every JSX opening tag on its own line. Pure: input code in,
 * stamped code out. Idempotent — already-stamped tags are left alone.
 */
export function stampAiLoc(code: string, relPath: string): string {
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('import ')
    ) {
      continue
    }
    let out = ''
    let last = 0
    TAG_RE.lastIndex = 0
    let m: RegExpExecArray | null
    let changed = false
    while ((m = TAG_RE.exec(line)) !== null) {
      const lt = m.index
      const before = lt === 0 ? '' : line[lt - 1]
      if (!OK_BEFORE.has(before)) continue
      const tagEnd = lt + 1 + m[1].length
      if (tagHasStampAfter(line.slice(lt), m[0].length - 1)) continue
      out += line.slice(last, tagEnd) + ` ${STAMP_ATTR}="${relPath}:${i + 1}"`
      last = tagEnd
      changed = true
    }
    if (changed) lines[i] = out + line.slice(last)
  }
  return lines.join('\n')
}

const STAMPABLE_EXT = new Set(['.jsx', '.tsx'])

function hasStampableExt(id: string): boolean {
  const clean = id.split('?')[0]
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return false
  return STAMPABLE_EXT.has(clean.slice(dot))
}

/**
 * Decide whether a Vite module id gets stamped. Returns the
 * project-relative stamp path (`/src/App.jsx`) or null to skip.
 */
export function stampTarget(id: string, fsRoot: string): string | null {
  const clean = id.split('?')[0]
  if (!hasStampableExt(clean)) return null
  if (clean.includes('node_modules')) return null
  if (clean.includes('/dist/') || clean.endsWith('/dist')) return null
  let rel: string
  if (clean.startsWith(fsRoot)) {
    rel = '/' + clean.slice(fsRoot.length).replace(/^\/+/, '').replace(/\\/g, '/')
  } else {
    return null
  }
  if (rel.includes('node_modules')) return null
  return rel
}
