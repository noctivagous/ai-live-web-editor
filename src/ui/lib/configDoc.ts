/**
 * Offset-preserving parsers for the config formats beyond JSON —
 * YAML, TOML and .env — producing ONE neutral tree so a single
 * form surface (components/ConfigView) serves all three, the way
 * the base text editor serves markdown and RTF through adapters.
 *
 * Same rule as the JSON and CSS parsers: the file stays canonical.
 * Every scalar node records the exact offsets of its token
 * (including any quotes); an edit serialises the new value in the
 * format's own syntax and splices it into just those offsets —
 * comments, blank lines, ordering and unmodelled content survive
 * byte-identical. Constructs a format's form cannot honestly
 * model (YAML anchors and flow style, TOML inline tables and
 * datetimes, block scalars) become 'raw' nodes: shown, never
 * spliced.
 *
 * The subsets are the ones config files actually use:
 *  - YAML: indentation mappings, scalar lists, lists of maps,
 *    quoted/plain scalars, comments. Not multi-document files,
 *    not tabs, not anchors/flow (those parse as raw or error).
 *  - TOML: [section] and [[array]] headers, dotted keys, strings,
 *    numbers, booleans, single-line scalar arrays.
 *  - ENV: KEY=value lines, optional export prefix, comments.
 */

export type ConfigFormat = 'yaml' | 'toml' | 'env'
export type ScalarKind = 'string' | 'number' | 'boolean' | 'null'

export interface ConfigNode {
  kind: 'object' | 'array' | 'scalar' | 'raw'
  /** Key within the parent object; for array items, the index as text. */
  key: string
  scalarKind?: ScalarKind
  /** Display value for scalars (unquoted, unescaped). */
  value?: string
  /** Source text for raw nodes (shown, never edited). */
  raw?: string
  /** Token range in the source; for scalars this includes quotes. */
  start: number
  end: number
  /** Inserted before the token on edit (a space after `key:`, say). */
  insertPrefix?: string
  children?: ConfigNode[]
}

export type ConfigParse = { ok: true; root: ConfigNode } | { ok: false; error: string }

const NUMBER_RE = /^-?(0|[1-9][0-9_]*)(\.[0-9_]+)?([eE][+-]?[0-9]+)?$/

function typeScalar(text: string): ScalarKind {
  if (text === 'true' || text === 'false' || text === 'True' || text === 'False') return 'boolean'
  if (text === 'null' || text === 'Null' || text === '~' || text === '') return 'null'
  if (NUMBER_RE.test(text)) return 'number'
  return 'string'
}

function unquoteDouble(token: string): string {
  try { return JSON.parse(token) } catch {
    return token.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

/* ── serialisation: a typed value -> the format's token ──────── */

const YAML_RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'])

export function serialiseScalar(format: ConfigFormat, kind: ScalarKind, text: string): string {
  if (kind === 'boolean') return text === 'true' ? 'true' : 'false'
  if (kind === 'null') return format === 'yaml' ? '~' : text
  if (kind === 'number' && NUMBER_RE.test(text.trim())) return text.trim()
  const s = text
  if (format === 'yaml') {
    const plainSafe = /^[A-Za-z0-9_][A-Za-z0-9_.\-/:@ ]*$/.test(s)
      && s === s.trim()
      && !s.includes(': ') && !s.endsWith(':') && !s.includes(' #')
      && !YAML_RESERVED.has(s.toLowerCase())
      && typeScalar(s) === 'string'
    return plainSafe ? s : JSON.stringify(s)
  }
  if (format === 'toml') return JSON.stringify(s)
  // env: bare when safe, else double-quoted with dotenv escapes
  if (/^[A-Za-z0-9_.\-/:@]+$/.test(s)) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/** Splice a new value for a scalar node into the source. */
export function replaceConfigScalar(source: string, format: ConfigFormat, node: ConfigNode, text: string): string {
  if (node.kind !== 'scalar' || !node.scalarKind) return source
  // typing into an empty (null) field makes it a string; clearing a
  // field is not offered, so null only ever serialises from null.
  const kind = node.scalarKind === 'null' && text !== '' ? 'string' : node.scalarKind
  const token = serialiseScalar(format, kind, text)
  return source.slice(0, node.start) + (node.insertPrefix ?? '') + token + source.slice(node.end)
}

export function countConfigNodes(node: ConfigNode): number {
  let n = 1
  for (const c of node.children ?? []) n += countConfigNodes(c)
  return n
}

/* ── shared line table ───────────────────────────────────────── */

interface Line { start: number; end: number; indent: number; content: string; raw: string }

function splitLines(source: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === '\n') {
      const raw = source.slice(start, i)
      const indent = /^ */.exec(raw)![0].length
      lines.push({ start, end: i, indent, content: raw.trim(), raw })
      start = i + 1
    }
  }
  return lines
}

function isSignificant(l: Line): boolean {
  return l.content !== '' && !l.content.startsWith('#')
}

/* ── YAML ────────────────────────────────────────────────────── */

function splitYamlKey(content: string): { key: string; rest: string; restOffset: number } | null {
  let quote = ''
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === ':' && (i === content.length - 1 || content[i + 1] === ' ')) {
      const rawKey = content.slice(0, i).trim()
      const key = (rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'")) ? rawKey.slice(1, -1) : rawKey
      const rest = content.slice(i + 1)
      const lead = rest.length - rest.trimStart().length
      return { key, rest: rest.trim(), restOffset: i + 1 + lead }
    }
  }
  return null
}

function yamlScalarNode(key: string, token: string, tokenStart: number): ConfigNode {
  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
    return { kind: 'scalar', key, scalarKind: 'string', value: unquoteDouble(token), start: tokenStart, end: tokenStart + token.length }
  }
  if (token.startsWith("'") && token.endsWith("'") && token.length >= 2) {
    return { kind: 'scalar', key, scalarKind: 'string', value: token.slice(1, -1).replace(/''/g, "'"), start: tokenStart, end: tokenStart + token.length }
  }
  if (token.startsWith('{') || token.startsWith('[') || token.startsWith('&') || token.startsWith('*') || token.startsWith('!')) {
    return { kind: 'raw', key, raw: token, start: tokenStart, end: tokenStart + token.length }
  }
  // plain scalar: a trailing comment is not part of the value
  let end = token.length
  const hash = token.indexOf(' #')
  if (hash >= 0) end = hash
  const text = token.slice(0, end).trimEnd()
  const kind = typeScalar(text)
  return { kind: 'scalar', key, scalarKind: kind, value: kind === 'null' ? '' : text, start: tokenStart, end: tokenStart + text.length }
}

export function parseYamlConfig(source: string): ConfigParse {
  if (source.includes('\t')) {
    const lineNo = source.slice(0, source.indexOf('\t')).split('\n').length
    return { ok: false, error: `Line ${lineNo} uses a tab for indentation — YAML config files indent with spaces, and this form does not rewrite them.` }
  }
  const lines = splitLines(source).filter(isSignificant)
  let pos = 0

  type Block = { nodes: ConfigNode[]; isList: boolean }
  const parseBlock = (indent: number): Block | { error: string } => {
    const first = lines[pos]
    if (!first || first.indent < indent) return { nodes: [], isList: false }
    const isList = first.content === '-' || first.content.startsWith('- ')
    const nodes: ConfigNode[] = []

    if (isList) {
      while (pos < lines.length) {
        const line = lines[pos]
        if (line.indent !== indent || !(line.content === '-' || line.content.startsWith('- '))) break
        const dashContent = line.content === '-' ? '' : line.content.slice(2)
        const itemKey = String(nodes.length)
        if (dashContent === '') {
          pos++
          const nested = parseBlock(indent + 1)
          if ('error' in nested) return nested
          if (nested.nodes.length === 0) {
            nodes.push({ kind: 'scalar', key: itemKey, scalarKind: 'null', value: '', start: line.end, end: line.end, insertPrefix: ' ' })
          } else {
            nodes.push({ kind: nested.isList ? 'array' : 'object', key: itemKey, children: nested.nodes, start: line.start, end: line.end })
          }
          continue
        }
        if (splitYamlKey(dashContent)) {
          // a list of maps: swap this line for a virtual mapping line at
          // the item's indent, then parse the item as a mapping block
          const itemIndent = indent + 2
          const virtual: Line = { start: line.start + line.raw.indexOf(dashContent), end: line.end, indent: itemIndent, content: dashContent, raw: dashContent }
          lines[pos] = virtual
          const obj = parseBlock(itemIndent)
          if ('error' in obj) return obj
          nodes.push({ kind: 'object', key: itemKey, children: obj.nodes, start: line.start, end: line.end })
          continue
        }
        const tokenStart = line.start + line.raw.indexOf(dashContent)
        nodes.push(yamlScalarNode(itemKey, dashContent, tokenStart))
        pos++
      }
      return { nodes, isList: true }
    }

    // mapping block
    while (pos < lines.length) {
      const line = lines[pos]
      if (line.indent !== indent) break
      if (line.content === '---' || line.content === '...') {
        if (nodes.length || indent !== 0) return { error: 'This file holds more than one YAML document — the form edits single-document files.' }
        pos++
        continue
      }
      if (line.content === '-' || line.content.startsWith('- ')) break
      const split = splitYamlKey(line.content)
      if (!split) return { error: `Line "${line.content.slice(0, 40)}" is not a "key: value" pair — the form cannot model this file's structure.` }
      const contentStart = line.start + line.indent
      const valueCol = contentStart + split.restOffset
      pos++
      if (split.rest !== '') {
        if (split.rest.startsWith('|') || split.rest.startsWith('>')) {
          // block scalar: consume deeper lines as one raw node
          let end = line.end
          while (pos < lines.length && lines[pos].indent > indent) { end = lines[pos].end; pos++ }
          nodes.push({ kind: 'raw', key: split.key, raw: split.rest, start: valueCol, end })
          continue
        }
        nodes.push(yamlScalarNode(split.key, split.rest, valueCol))
        continue
      }
      // no value on the line: a nested block, a same-indent list, or null
      const next = lines[pos]
      if (next && next.indent > indent) {
        const nested = parseBlock(next.indent)
        if ('error' in nested) return nested
        nodes.push({ kind: nested.isList ? 'array' : 'object', key: split.key, children: nested.nodes, start: line.start, end: line.end })
        continue
      }
      if (next && next.indent === indent && (next.content === '-' || next.content.startsWith('- '))) {
        const nested = parseBlock(indent)
        if ('error' in nested) return nested
        nodes.push({ kind: 'array', key: split.key, children: nested.nodes, start: line.start, end: line.end })
        continue
      }
      const colonAt = line.start + line.raw.indexOf(':') + 1
      nodes.push({ kind: 'scalar', key: split.key, scalarKind: 'null', value: '', start: colonAt, end: colonAt, insertPrefix: ' ' })
    }
    return { nodes, isList: false }
  }

  const children = parseBlock(0)
  if ('error' in children) return { ok: false, error: children.error }
  return { ok: true, root: { kind: 'object', key: '', start: 0, end: source.length, children: children.nodes } }
}

/* ── TOML ────────────────────────────────────────────────────── */

function findOrCreateObject(root: ConfigNode, pathKeys: string[]): ConfigNode | null {
  let node = root
  for (const k of pathKeys) {
    if (node.kind !== 'object') return null
    node.children ??= []
    let next = node.children.find((c) => c.key === k && (c.kind === 'object' || c.kind === 'array'))
    if (!next) {
      next = { kind: 'object', key: k, start: 0, end: 0, children: [] }
      node.children.push(next)
    }
    if (next.kind === 'array') {
      // descend into the latest array item
      next.children ??= []
      let item = next.children[next.children.length - 1]
      if (!item || item.kind !== 'object') {
        item = { kind: 'object', key: String(next.children.length), start: 0, end: 0, children: [] }
        next.children.push(item)
      }
      node = item
    } else {
      node = next
    }
  }
  return node
}

function tomlValueNode(key: string, token: string, tokenStart: number, source: string, lineEnd: number): ConfigNode | { error: string } {
  const base: ConfigNode = { kind: 'scalar', key, start: tokenStart, end: tokenStart + token.length }
  if (token.startsWith('"""') || token.startsWith("'''")) {
    const closer = token.slice(0, 3)
    const closeIdx = source.indexOf(closer, tokenStart + 3)
    return { kind: 'raw', key, raw: 'multi-line string', start: tokenStart, end: closeIdx >= 0 ? closeIdx + 3 : lineEnd }
  }
  if (token.startsWith('"')) return { ...base, scalarKind: 'string', value: unquoteDouble(token) }
  if (token.startsWith("'")) return { ...base, scalarKind: 'string', value: token.slice(1, -1) }
  if (token === 'true' || token === 'false') return { ...base, scalarKind: 'boolean', value: token }
  if (/^-?(0|[1-9][0-9_]*)(\.[0-9_]+)?([eE][+-]?[0-9]+)?$/.test(token) || /^0x[0-9a-fA-F_]+$/.test(token)) {
    return { ...base, scalarKind: 'number', value: token }
  }
  if (token.startsWith('[')) {
    // single-line array of scalars
    const inner = token.slice(1, token.endsWith(']') ? -1 : undefined)
    if (inner.includes('{') || inner.includes('[')) return { kind: 'raw', key, raw: token, start: tokenStart, end: tokenStart + token.length }
    const children: ConfigNode[] = []
    let searchFrom = tokenStart + 1
    for (const part of inner.split(',')) {
      const text = part.trim()
      if (text === '') continue
      const at = source.indexOf(text, searchFrom)
      const child = tomlValueNode(String(children.length), text, at, source, lineEnd)
      if ('error' in child) return child
      children.push(child)
      searchFrom = at + text.length
    }
    return { kind: 'array', key, children, start: tokenStart, end: tokenStart + token.length }
  }
  // datetimes, inline tables, anything else: shown, never spliced
  return { kind: 'raw', key, raw: token, start: tokenStart, end: tokenStart + token.length }
}

export function parseTomlConfig(source: string): ConfigParse {
  const root: ConfigNode = { kind: 'object', key: '', start: 0, end: source.length, children: [] }
  let current = root
  const lines = splitLines(source)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    i++
    const content = line.content
    if (content === '' || content.startsWith('#')) continue
    const header = /^(\[\[?)([^\]]+)\]\]?$/.exec(content)
    if (header) {
      const isArray = header[1] === '[['
      const pathKeys = header[2].split('.').map((s) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
      if (isArray) {
        const parent = findOrCreateObject(root, pathKeys.slice(0, -1))
        if (!parent) return { ok: false, error: `Section [[${header[2]}]] conflicts with an earlier value.` }
        parent.children ??= []
        let arr = parent.children.find((c) => c.key === pathKeys[pathKeys.length - 1] && c.kind === 'array')
        if (!arr) {
          arr = { kind: 'array', key: pathKeys[pathKeys.length - 1], start: line.start, end: line.end, children: [] }
          parent.children.push(arr)
        }
        const item: ConfigNode = { kind: 'object', key: String(arr.children!.length), start: line.start, end: line.end, children: [] }
        arr.children!.push(item)
        current = item
      } else {
        const obj = findOrCreateObject(root, pathKeys)
        if (!obj) return { ok: false, error: `Section [${header[2]}] conflicts with an earlier value.` }
        obj.start = line.start
        obj.end = line.end
        current = obj
      }
      continue
    }
    const eq = content.indexOf('=')
    if (eq < 0) return { ok: false, error: `Line "${content.slice(0, 40)}" is not a "key = value" pair or a [section] header.` }
    const keyPart = content.slice(0, eq).trim()
    const valueToken = content.slice(eq + 1).trim()
    const valueStart = line.start + line.raw.indexOf(valueToken, line.raw.indexOf('='))
    const keys = keyPart.split('.').map((s) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
    const parent = keys.length > 1 ? findOrCreateObject(current, keys.slice(0, -1)) : current
    if (!parent) return { ok: false, error: `Key "${keyPart}" conflicts with an earlier value.` }
    parent.children ??= []
    const node = tomlValueNode(keys[keys.length - 1], valueToken, valueStart, source, line.end)
    if ('error' in node) return { ok: false, error: node.error }
    // a multi-line string continues past this line: skip its lines
    if (node.kind === 'raw' && node.end > line.end) {
      while (i < lines.length && lines[i].start < node.end) i++
    }
    parent.children.push(node)
  }
  return { ok: true, root }
}

/* ── ENV ─────────────────────────────────────────────────────── */

export function parseEnvConfig(source: string): ConfigParse {
  const root: ConfigNode = { kind: 'object', key: '', start: 0, end: source.length, children: [] }
  for (const line of splitLines(source)) {
    const content = line.content
    if (content === '' || content.startsWith('#')) continue
    const m = /^(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(=(.*))?$/.exec(content)
    if (!m) {
      root.children!.push({ kind: 'raw', key: '', raw: content, start: line.start, end: line.end })
      continue
    }
    const key = m[2]
    if (m[3] === undefined) {
      const keyEnd = line.start + line.raw.indexOf(key) + key.length
      root.children!.push({ kind: 'scalar', key, scalarKind: 'string', value: '', start: keyEnd, end: keyEnd, insertPrefix: '=' })
      continue
    }
    let token = (m[4] ?? '').trim()
    const tokenStart = line.start + line.raw.indexOf(token, line.raw.indexOf('='))
    if ((token.startsWith('"') && token.endsWith('"') && token.length >= 2) || (token.startsWith("'") && token.endsWith("'") && token.length >= 2)) {
      const value = token.startsWith('"') ? unquoteDouble(token) : token.slice(1, -1)
      root.children!.push({ kind: 'scalar', key, scalarKind: 'string', value, start: tokenStart, end: tokenStart + token.length })
      continue
    }
    const hash = token.indexOf(' #')
    if (hash >= 0) token = token.slice(0, hash).trimEnd()
    root.children!.push({ kind: 'scalar', key, scalarKind: 'string', value: token, start: tokenStart, end: tokenStart + token.length })
  }
  return { ok: true, root }
}

export function parseConfig(format: ConfigFormat, source: string): ConfigParse {
  return format === 'yaml' ? parseYamlConfig(source) : format === 'toml' ? parseTomlConfig(source) : parseEnvConfig(source)
}
