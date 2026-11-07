/**
 * CSS boxes model (Open slice D): the box view over a stylesheet.
 * The FILE stays canonical — this module parses just enough structure
 * to locate each declaration's value by exact offsets, and an edit
 * splices the new value into those offsets. Everything the parser
 * doesn't understand (comments, @-blocks like @media, odd segments)
 * is never touched: it isn't shown as boxes and its bytes survive
 * every edit verbatim.
 */

export interface CssDecl {
  property: string
  value: string
  /** Absolute offsets of the trimmed value in the source text. */
  valueStart: number
  valueEnd: number
}

export interface CssRule {
  selector: string
  declarations: CssDecl[]
}

export interface ParsedStylesheet {
  rules: CssRule[]
  /** Top-level @-blocks skipped over (their contents aren't boxed). */
  atBlocks: number
}

function skipString(src: string, i: number): number {
  const q = src[i]
  i++
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === q) return i + 1
    i++
  }
  return i
}

function skipComment(src: string, i: number): number {
  const end = src.indexOf('*/', i + 2)
  return end === -1 ? src.length : end + 2
}

/** Consume a balanced { … } block starting at the '{' at index i. */
function skipBlock(src: string, i: number): number {
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') { i = skipComment(src, i); continue }
    if (c === '"' || c === "'") { i = skipString(src, i); continue }
    if (c === '{') depth++
    if (c === '}') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return i
}

function parseDeclarations(src: string, start: number, end: number, out: CssDecl[]) {
  // Split [start, end) into segments on ';' at paren depth 0,
  // respecting strings and comments.
  let segStart = start
  let depth = 0
  const segments: [number, number][] = []
  let i = start
  while (i < end) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') { i = skipComment(src, i); continue }
    if (c === '"' || c === "'") { i = skipString(src, i); continue }
    if (c === '(') depth++
    if (c === ')') depth = Math.max(0, depth - 1)
    if (c === ';' && depth === 0) { segments.push([segStart, i]); segStart = i + 1 }
    i++
  }
  segments.push([segStart, end])
  for (const [s, e] of segments) {
    const text = src.slice(s, e)
    const m = text.match(/^(\s*)(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:/)
    if (!m) continue // not a declaration — left as text, never boxed
    const colon = s + m[0].length - 1
    let vStart = colon + 1
    while (vStart < e && /\s/.test(src[vStart])) vStart++
    let vEnd = e
    while (vEnd > vStart && /\s/.test(src[vEnd - 1])) vEnd--
    // A trailing !important is not part of the editable value.
    const tail = src.slice(Math.max(vStart, vEnd - 10), vEnd).toLowerCase()
    if (tail.endsWith('!important')) {
      vEnd -= 10
      while (vEnd > vStart && /\s/.test(src[vEnd - 1])) vEnd--
    }
    if (vEnd <= vStart) continue
    out.push({ property: m[2], value: src.slice(vStart, vEnd), valueStart: vStart, valueEnd: vEnd })
  }
}

export function parseStylesheet(src: string): ParsedStylesheet {
  const rules: CssRule[] = []
  let atBlocks = 0
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '/' && src[i + 1] === '*') { i = skipComment(src, i); continue }
    if (c === '@') {
      // At-rule: statement form ends at ';', block form at its '{'.
      let j = i
      while (j < src.length && src[j] !== ';' && src[j] !== '{') {
        if (src[j] === '"' || src[j] === "'") { j = skipString(src, j); continue }
        j++
      }
      if (src[j] === '{') { atBlocks++; i = skipBlock(src, j) } else { atBlocks++; i = j + 1 }
      continue
    }
    // Selector: up to '{' (a '}' or EOF first means unparseable rest).
    let j = i
    while (j < src.length && src[j] !== '{' && src[j] !== '}') {
      if (src[j] === '"' || src[j] === "'") { j = skipString(src, j); continue }
      j++
    }
    if (src[j] !== '{') break
    const selector = src.slice(i, j).trim()
    const blockEnd = skipBlock(src, j) // index just past the matching '}'
    const declarations: CssDecl[] = []
    parseDeclarations(src, j + 1, blockEnd - 1, declarations)
    if (selector) rules.push({ selector, declarations })
    i = blockEnd
  }
  return { rules, atBlocks }
}

/** Splice a new value into the declaration's exact offsets. The rest
 * of the file — formatting, comments, @-blocks — is byte-identical. */
export function replaceDeclValue(src: string, decl: CssDecl, newValue: string): string {
  return src.slice(0, decl.valueStart) + newValue + src.slice(decl.valueEnd)
}

/* ── Control classification ──────────────────────────────────── */

export type CssControl =
  | { kind: 'color'; hex: string }
  | { kind: 'length'; amount: number; unit: string; min: number; max: number; step: number }
  | { kind: 'keyword'; options: string[] }
  | { kind: 'text' }

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
  lime: '#00ff00', teal: '#008080', navy: '#000080', aqua: '#00ffff', cyan: '#00ffff',
  magenta: '#ff00ff', fuchsia: '#ff00ff', coral: '#ff7f50', salmon: '#fa8072', khaki: '#f0e68c',
  beige: '#f5f5dc', ivory: '#fffff0', lavender: '#e6e6fa', turquoise: '#40e0d0', gold: '#ffd700',
  indigo: '#4b0082', violet: '#ee82ee', crimson: '#dc143c', tomato: '#ff6347', steelblue: '#4682b4',
  seagreen: '#2e8b57', skyblue: '#87ceeb', slategray: '#708090', darkgray: '#a9a9a9', lightgray: '#d3d3d3',
}

const KEYWORD_SETS: Record<string, string[]> = {
  'display': ['none', 'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents'],
  'position': ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'border-style': ['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'],
  'outline-style': ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'],
  'text-align': ['left', 'right', 'center', 'justify', 'start', 'end'],
  'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
  'justify-content': ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end', 'stretch'],
  'align-items': ['stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end'],
  'align-content': ['stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'start', 'end'],
  'overflow': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
  'overflow-x': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
  'overflow-y': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
  'cursor': ['default', 'pointer', 'move', 'text', 'wait', 'not-allowed', 'grab', 'grabbing', 'crosshair'],
  'font-style': ['normal', 'italic', 'oblique'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
  'visibility': ['visible', 'hidden', 'collapse'],
  'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'],
  'box-sizing': ['content-box', 'border-box'],
  'float': ['none', 'left', 'right'],
  'clear': ['none', 'left', 'right', 'both'],
  'list-style-type': ['none', 'disc', 'circle', 'square', 'decimal'],
}

function hexFromRgb(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function colorHex(value: string): string | null {
  const v = value.trim().toLowerCase()
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('')
    if (h.length === 8) h = h.slice(0, 6) // alpha dropped by the picker
    return `#${h}`
  }
  if (NAMED_COLORS[v]) return NAMED_COLORS[v]
  const rgb = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
  if (rgb) return hexFromRgb(+rgb[1], +rgb[2], +rgb[3])
  return null
}

export function controlFor(decl: { property: string; value: string }): CssControl {
  const value = decl.value.trim()
  const property = decl.property.toLowerCase()
  if (value.includes('var(') || value.includes('calc(')) return { kind: 'text' }

  const hex = colorHex(value)
  if (hex) return { kind: 'color', hex }

  const len = value.match(/^(-?\d*\.?\d+)(px|rem|em|%)$/)
  if (len || value === '0') {
    const amount = len ? parseFloat(len[1]) : 0
    const unit = len ? len[2] : 'px'
    const base = unit === '%' ? 100 : unit === 'px' ? Math.max(100, Math.ceil(Math.abs(amount) * 2)) : 10
    const allowNeg = /^(margin|top|left|right|bottom|inset)/.test(property)
    return { kind: 'length', amount, unit, min: allowNeg ? -base : 0, max: base, step: unit === 'px' || unit === '%' ? 1 : 0.25 }
  }

  if (property === 'font-weight') {
    if (/^\d+$/.test(value) || ['normal', 'bold', 'bolder', 'lighter'].includes(value)) {
      return { kind: 'keyword', options: ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'] }
    }
    return { kind: 'text' }
  }

  const set = KEYWORD_SETS[property]
  if (set && /^[a-z-]+$/.test(value)) {
    return { kind: 'keyword', options: set.includes(value) ? set : [value, ...set] }
  }
  return { kind: 'text' }
}
