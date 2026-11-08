/**
 * JSON document model for the JSON renderer — the CSS-boxes pattern
 * applied to JSON. The FILE stays canonical: this module parses just
 * enough structure to locate every value by exact offsets, and an
 * edit splices the replacement into those offsets. Formatting,
 * ordering, comments and everything else survive byte-identical
 * because the file is never regenerated from the parsed tree.
 *
 * The parser accepts strict JSON plus the JSONC trivia real config
 * files carry — `//` and block comments, and trailing commas
 * (tsconfig.json, .vscode/settings.json and friends). Comments are
 * trivia: they are skipped over, never shown as fields and never
 * touched by an edit.
 *
 * A parse failure is a result, not an exception the caller hides:
 * the view shows the error and the offset, offers the plain text
 * editor, and writes nothing.
 */

export type JsonScalar = string | number | boolean | null

export type JsonNode =
  | { kind: 'object'; start: number; end: number; entries: JsonEntry[] }
  | { kind: 'array'; start: number; end: number; items: JsonNode[] }
  | { kind: 'string'; start: number; end: number; value: string }
  | { kind: 'number'; start: number; end: number; value: number; raw: string }
  | { kind: 'boolean'; start: number; end: number; value: boolean }
  | { kind: 'null'; start: number; end: number; value: null }

export interface JsonEntry {
  key: string
  /** Absolute offsets of the key's string token (quotes included). */
  keyStart: number
  keyEnd: number
  value: JsonNode
}

export type ParseJsonResult =
  | { ok: true; root: JsonNode; comments: number }
  | { ok: false; error: string; offset: number }

class ParseError extends Error {
  offset: number
  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

export function parseJsonDocument(src: string): ParseJsonResult {
  let i = 0
  let comments = 0

  function skipTrivia() {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (src[i] === '/' && src[i + 1] === '/') {
        comments++
        const end = src.indexOf('\n', i + 2)
        i = end === -1 ? src.length : end + 1
        continue
      }
      if (src[i] === '/' && src[i + 1] === '*') {
        comments++
        const end = src.indexOf('*/', i + 2)
        if (end === -1) throw new ParseError('Unterminated block comment', i)
        i = end + 2
        continue
      }
      return
    }
  }

  function parseString(): { value: string; start: number; end: number } {
    const start = i
    if (src[i] !== '"') throw new ParseError('Expected a string', i)
    i++
    let out = ''
    while (i < src.length) {
      const c = src[i]
      if (c === '"') {
        i++
        return { value: out, start, end: i }
      }
      if (c === '\\') {
        const esc = src[i + 1]
        if (esc === 'u') {
          const hex = src.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ParseError('Invalid \\u escape in string', i)
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (esc in simple) {
          out += simple[esc]
          i += 2
          continue
        }
        throw new ParseError(`Invalid escape \\${esc ?? ''} in string`, i)
      }
      if (c < ' ') throw new ParseError('Control character in string', i)
      out += c
      i++
    }
    throw new ParseError('Unterminated string', start)
  }

  function parseValue(): JsonNode {
    skipTrivia()
    const start = i
    const c = src[i]
    if (c === '{') {
      i++
      const entries: JsonEntry[] = []
      skipTrivia()
      if (src[i] === '}') { i++; return { kind: 'object', start, end: i, entries } }
      for (;;) {
        skipTrivia()
        const key = parseString()
        skipTrivia()
        if (src[i] !== ':') throw new ParseError(`Expected ':' after key "${key.value}"`, i)
        i++
        const value = parseValue()
        entries.push({ key: key.value, keyStart: key.start, keyEnd: key.end, value })
        skipTrivia()
        if (src[i] === ',') {
          i++
          skipTrivia()
          if (src[i] === '}') { i++; return { kind: 'object', start, end: i, entries } } // trailing comma (JSONC)
          continue
        }
        if (src[i] === '}') { i++; return { kind: 'object', start, end: i, entries } }
        throw new ParseError("Expected ',' or '}' in object", i)
      }
    }
    if (c === '[') {
      i++
      const items: JsonNode[] = []
      skipTrivia()
      if (src[i] === ']') { i++; return { kind: 'array', start, end: i, items } }
      for (;;) {
        items.push(parseValue())
        skipTrivia()
        if (src[i] === ',') {
          i++
          skipTrivia()
          if (src[i] === ']') { i++; return { kind: 'array', start, end: i, items } } // trailing comma (JSONC)
          continue
        }
        if (src[i] === ']') { i++; return { kind: 'array', start, end: i, items } }
        throw new ParseError("Expected ',' or ']' in array", i)
      }
    }
    if (c === '"') {
      const s = parseString()
      return { kind: 'string', start: s.start, end: s.end, value: s.value }
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i))
      if (!m) throw new ParseError('Invalid number', i)
      i += m[0].length
      return { kind: 'number', start, end: i, value: Number(m[0]), raw: m[0] }
    }
    if (src.startsWith('true', i)) { i += 4; return { kind: 'boolean', start, end: i, value: true } }
    if (src.startsWith('false', i)) { i += 5; return { kind: 'boolean', start, end: i, value: false } }
    if (src.startsWith('null', i)) { i += 4; return { kind: 'null', start, end: i, value: null } }
    throw new ParseError(c === undefined ? 'Unexpected end of file' : `Unexpected character '${c}'`, i)
  }

  try {
    const root = parseValue()
    skipTrivia()
    if (i < src.length) throw new ParseError('Unexpected content after the JSON value', i)
    return { ok: true, root, comments }
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message, offset: e.offset }
    return { ok: false, error: e instanceof Error ? e.message : String(e), offset: 0 }
  }
}

export function isScalarNode(node: JsonNode): node is Extract<JsonNode, { value: JsonScalar }> {
  return node.kind === 'string' || node.kind === 'number' || node.kind === 'boolean' || node.kind === 'null'
}

/** The JSON text for a scalar value, as it should appear in the file. */
export function rawForScalar(value: JsonScalar): string {
  return JSON.stringify(value)
}

/**
 * Splice a new scalar into the node's exact offsets — the JSON
 * equivalent of replaceDeclValue for CSS. Only scalar nodes are
 * editable this way in this slice; structural edits (add / remove /
 * retype a field) are a later slice and never implied by this one.
 */
export function replaceScalarValue(src: string, node: JsonNode, value: JsonScalar): string {
  if (!isScalarNode(node)) throw new Error(`replaceScalarValue: ${node.kind} is not a scalar`)
  return src.slice(0, node.start) + rawForScalar(value) + src.slice(node.end)
}

/** Count every node in the tree (the view uses it to spot files too
 * large to render as a form, e.g. a lockfile's thousands of entries). */
export function countNodes(node: JsonNode): number {
  if (node.kind === 'object') return 1 + node.entries.reduce((n, e) => n + countNodes(e.value), 0)
  if (node.kind === 'array') return 1 + node.items.reduce((n, it) => n + countNodes(it), 0)
  return 1
}

/** Line/column (1-based) for an absolute offset, for error display. */
export function lineColAt(src: string, offset: number): { line: number; col: number } {
  const before = src.slice(0, Math.max(0, Math.min(offset, src.length)))
  const lines = before.split('\n')
  return { line: lines.length, col: lines[lines.length - 1].length + 1 }
}
