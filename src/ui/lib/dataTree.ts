import { parseJsonDocument, replaceScalarValue, type JsonNode, type JsonScalar } from './jsonDoc'
import { parseConfig, replaceConfigScalar, serialiseScalar, type ConfigFormat, type ConfigNode } from './configDoc'
import { parseXmlConfig, replaceXmlScalar, escapeXmlAttribute, escapeXmlText } from './xmlDoc'

/**
 * The neutral TREE model behind the structured-data core: JSON,
 * YAML, TOML, .env and XML all parse (through their own offset
 * parsers) into this one shape — addressable nodes with dotted
 * paths — so ONE core of operations serves every tree format:
 * outline, get, set, find. The human form surfaces (JsonView,
 * ConfigView) and the agent's data tools both run on it, and a
 * new tree format joins the core by parsing into this shape,
 * nothing more — XML did exactly that (lib/xmlDoc).
 *
 * Addresses are dotted paths; array items are reached by index,
 * written either `steps.0.name` or `steps[0].name`. Setting a
 * scalar splices through the format's own serialiser — the file
 * is never regenerated, and nodes a parser cannot model (raw)
 * refuse with the same honesty the forms show.
 */

export type DataFormat = 'json' | ConfigFormat | 'xml'
export type DataScalarKind = 'string' | 'number' | 'boolean' | 'null'

export interface DataNode {
  /** Address segment within the parent ('' for the root). */
  segment: string
  kind: 'object' | 'array' | 'scalar' | 'raw'
  scalarKind?: DataScalarKind
  /** Scalar display value (numbers as their source text). */
  value?: string
  /** Source text for raw nodes (shown, never edited). */
  raw?: string
  children: DataNode[]
  /** The format parser's own node, for splicing a set. */
  ref: JsonNode | ConfigNode
}

export type DataParse = { ok: true; format: DataFormat; root: DataNode } | { ok: false; error: string }

/** Which tree format a path belongs to, by extension / basename. */
export function dataFormatForPath(path: string): DataFormat | null {
  const base = (path.split('/').pop() ?? path).toLowerCase()
  if (base === '.env' || base.startsWith('.env.') || base.startsWith('.env-')) return 'env'
  if (base.endsWith('.json') || base.endsWith('.jsonc')) return 'json'
  if (base.endsWith('.xml')) return 'xml'
  if (base.endsWith('.yaml') || base.endsWith('.yml')) return 'yaml'
  if (base.endsWith('.toml')) return 'toml'
  if (base === 'env') return 'env'
  return null
}

function fromJson(node: JsonNode, segment: string): DataNode {
  switch (node.kind) {
    case 'object':
      return { segment, kind: 'object', children: node.entries.map((e) => fromJson(e.value, e.key)), ref: node }
    case 'array':
      return { segment, kind: 'array', children: node.items.map((item, i) => fromJson(item, String(i))), ref: node }
    case 'string':
      return { segment, kind: 'scalar', scalarKind: 'string', value: node.value, children: [], ref: node }
    case 'number':
      return { segment, kind: 'scalar', scalarKind: 'number', value: node.raw, children: [], ref: node }
    case 'boolean':
      return { segment, kind: 'scalar', scalarKind: 'boolean', value: String(node.value), children: [], ref: node }
    case 'null':
      return { segment, kind: 'scalar', scalarKind: 'null', value: '', children: [], ref: node }
  }
}

function fromConfig(node: ConfigNode): DataNode {
  return {
    segment: node.key,
    kind: node.kind,
    scalarKind: node.scalarKind,
    value: node.value,
    raw: node.raw,
    children: (node.children ?? []).map(fromConfig),
    ref: node,
  }
}

export function parseDataTree(format: DataFormat, source: string): DataParse {
  if (format === 'json') {
    const parsed = parseJsonDocument(source)
    if (parsed.ok === false) return { ok: false, error: parsed.error }
    return { ok: true, format, root: fromJson(parsed.root, '') }
  }
  if (format === 'xml') {
    const parsed = parseXmlConfig(source)
    if (parsed.ok === false) return { ok: false, error: parsed.error }
    return { ok: true, format, root: fromConfig(parsed.root) }
  }
  const parsed = parseConfig(format, source)
  if (parsed.ok === false) return { ok: false, error: parsed.error }
  return { ok: true, format, root: fromConfig(parsed.root) }
}

/* ── addressing ─────────────────────────────────────────────── */

/** Split an address into steps; a step keeps its [index] suffix
 * (steps[0], dep[1]) so it can name one of several same-named
 * siblings, as XML repeated elements produce. */
export function parseAddress(address: string): string[] {
  const steps: string[] = []
  const re = /([^.[\]]+(?:\[\d+\])*)|\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(address)) !== null) steps.push(m[1] ?? m[2])
  return steps
}

export function findDataNode(root: DataNode, address: string): DataNode | null {
  let node = root
  for (const step of parseAddress(address)) {
    let next = node.children.find((c) => c.segment === step)
    if (!next) {
      const indexed = /^(.+)\[(\d+)\]$/.exec(step)
      if (indexed) {
        const siblings = node.children.filter((c) => c.segment === indexed[1])
        // name[n] indexes INTO an array child (steps[0]); for
        // repeated same-named siblings (XML elements) it picks
        // the n-th sibling instead.
        next = siblings.length === 1 && siblings[0].kind === 'array'
          ? siblings[0].children[Number(indexed[2])]
          : siblings[Number(indexed[2])]
      } else if (/^\d+$/.test(step)) {
        next = node.children[Number(step)]
      }
    }
    if (!next) return null
    node = next
  }
  return node
}

/** Render the address of a child, given its parent's address and kind. */
export function childAddress(parentAddress: string, parentKind: DataNode['kind'], child: DataNode): string {
  if (parentKind === 'array') return `${parentAddress}[${child.segment}]`
  return parentAddress === '' ? child.segment : `${parentAddress}.${child.segment}`
}

/* ── operations ─────────────────────────────────────────────── */

export interface DataOutline {
  segment: string
  kind: DataNode['kind']
  scalarKind?: DataScalarKind
  value?: string
  childCount?: number
  children?: DataOutline[]
  truncated?: boolean
}

export function outlineData(node: DataNode, maxDepth = 3, budget = { left: 250 }): DataOutline {
  const out: DataOutline = { segment: node.segment, kind: node.kind }
  if (node.kind === 'scalar') { out.scalarKind = node.scalarKind; out.value = node.value }
  if (node.kind === 'raw') out.value = '(not a plain value in this format)'
  if (node.children.length > 0) {
    out.childCount = node.children.length
    if (maxDepth > 0 && budget.left > 0) {
      out.children = []
      for (const child of node.children) {
        if (budget.left <= 0) { out.truncated = true; break }
        budget.left--
        out.children.push(outlineData(child, maxDepth - 1, budget))
      }
    }
  }
  return out
}

export function countDataNodes(node: DataNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countDataNodes(c), 0)
}

export interface DataMatch { address: string; kind: DataNode['kind']; value?: string }

export function findInData(root: DataNode, query: string, limit = 50): { matches: DataMatch[]; total: number } {
  const needle = query.toLowerCase()
  const matches: DataMatch[] = []
  let total = 0
  const walk = (node: DataNode, address: string) => {
    for (const child of node.children) {
      const addr = childAddress(address, node.kind, child)
      const hit = child.segment.toLowerCase().includes(needle)
        || (child.kind === 'scalar' && (child.value ?? '').toLowerCase().includes(needle))
      if (hit) {
        total++
        if (matches.length < limit) matches.push({ address: addr, kind: child.kind, value: child.kind === 'scalar' ? child.value : undefined })
      }
      walk(child, addr)
    }
  }
  walk(root, '')
  return { matches, total }
}

/**
 * Splice a new scalar value at a node, through the format's own
 * serialiser. The caller checks the node is an editable scalar;
 * type rules: booleans take true/false, numbers must parse,
 * strings and nulls take the text as a string.
 */
export function setDataScalar(format: DataFormat, source: string, node: DataNode, text: string): { ok: true; source: string } | { ok: false; error: string } {
  if (node.kind === 'raw') return { ok: false, error: 'That value is not a plain value in this format — it is shown read-only in the form too. Edit the file as text instead.' }
  if (node.kind !== 'scalar') return { ok: false, error: 'That address is a whole section, not a single value — set one of its values, or wait for structural editing (add/remove) which is not built yet.' }
  if (node.scalarKind === 'boolean' && text !== 'true' && text !== 'false') {
    return { ok: false, error: `That value is a boolean — the new value must be true or false, not "${text}".` }
  }
  if (node.scalarKind === 'number' && !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text.trim())) {
    return { ok: false, error: `That value is a number — "${text}" does not parse as one.` }
  }
  if (format === 'json') {
    const value: JsonScalar = node.scalarKind === 'boolean' ? text === 'true'
      : node.scalarKind === 'number' ? Number(text)
        : text
    return { ok: true, source: replaceScalarValue(source, node.ref as JsonNode, value) }
  }
  if (format === 'xml') {
    return { ok: true, source: replaceXmlScalar(source, node.ref as ConfigNode, text) }
  }
  return { ok: true, source: replaceConfigScalar(source, format, node.ref as ConfigNode, text) }
}

/* ── structural edits: add and remove ─────────────────────────
 * The second half of the core: adding a value to a section and
 * removing a node, per format, always by insertion/deletion of
 * the node's own lines or span — the surrounding file is never
 * regenerated. The agent's data-add/data-remove tools and the
 * form surfaces' add/remove controls call these same functions.
 */

export type DataOpResult = { ok: true; source: string } | { ok: false; error: string }

function inferScalarKind(text: string): DataScalarKind {
  if (text === 'true' || text === 'false') return 'boolean'
  if (text === 'null' || text === '~' || text === '') return 'null'
  if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text.trim())) return 'number'
  return 'string'
}

function lineStartOf(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
}

/** End of the line containing offset, newline included if present. */
function lineEndOf(source: string, offset: number): number {
  const nl = source.indexOf('\n', offset)
  return nl === -1 ? source.length : nl + 1
}

function deleteRanges(source: string, ranges: { start: number; end: number }[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  let out = source
  for (let i = merged.length - 1; i >= 0; i--) {
    out = out.slice(0, merged[i].start) + out.slice(merged[i].end)
  }
  return out
}

/* JSON */

function jsonScalarRaw(text: string, forceKind?: DataScalarKind): string {
  const kind = forceKind ?? inferScalarKind(text)
  if (kind === 'boolean') return text
  if (kind === 'number') return text.trim()
  if (kind === 'null') return 'null'
  return JSON.stringify(text)
}

function addJson(source: string, parent: JsonNode, key: string | null, text: string, forceKind?: DataScalarKind): DataOpResult {
  const raw = jsonScalarRaw(text, forceKind)
  if (parent.kind === 'object') {
    if (key === null) return { ok: false, error: 'Adding to an object needs a key.' }
    if (parent.entries.some((e) => e.key === key)) return { ok: false, error: `There is already a "${key}" there — set it instead, or pick another key.` }
    const member = `${JSON.stringify(key)}: ${raw}`
    if (parent.entries.length === 0) {
      return { ok: true, source: source.slice(0, parent.start + 1) + member + source.slice(parent.start + 1) }
    }
    const last = parent.entries[parent.entries.length - 1]
    const multiline = source.slice(parent.start, parent.end).includes('\n')
    if (!multiline) return { ok: true, source: source.slice(0, last.value.end) + `, ${member}` + source.slice(last.value.end) }
    const indent = source.slice(lineStartOf(source, last.keyStart), last.keyStart)
    return { ok: true, source: source.slice(0, last.value.end) + `,\n${indent}${member}` + source.slice(last.value.end) }
  }
  if (parent.kind === 'array') {
    if (parent.items.length === 0) {
      return { ok: true, source: source.slice(0, parent.start + 1) + raw + source.slice(parent.start + 1) }
    }
    const last = parent.items[parent.items.length - 1]
    const multiline = source.slice(parent.start, parent.end).includes('\n')
    if (!multiline) return { ok: true, source: source.slice(0, last.end) + `, ${raw}` + source.slice(last.end) }
    const indent = source.slice(lineStartOf(source, last.start), last.start)
    return { ok: true, source: source.slice(0, last.end) + `,\n${indent}${raw}` + source.slice(last.end) }
  }
  return { ok: false, error: 'That address is a single value, not a section — values are added to objects and lists.' }
}

function removeJson(source: string, parent: JsonNode, target: JsonNode): DataOpResult {
  if (parent.kind === 'object') {
    const idx = parent.entries.findIndex((e) => e.value === target)
    if (idx === -1) return { ok: false, error: 'That value is not in this object.' }
    const entry = parent.entries[idx]
    if (parent.entries.length === 1) {
      return { ok: true, source: source.slice(0, parent.start + 1) + source.slice(parent.end - 1) }
    }
    if (idx < parent.entries.length - 1) {
      const next = parent.entries[idx + 1]
      return { ok: true, source: source.slice(0, entry.keyStart) + source.slice(next.keyStart) }
    }
    const prev = parent.entries[idx - 1]
    return { ok: true, source: source.slice(0, prev.value.end) + source.slice(entry.value.end) }
  }
  if (parent.kind === 'array') {
    const idx = parent.items.findIndex((it) => it === target)
    if (idx === -1) return { ok: false, error: 'That item is not in this list.' }
    if (parent.items.length === 1) {
      return { ok: true, source: source.slice(0, parent.start + 1) + source.slice(parent.end - 1) }
    }
    if (idx < parent.items.length - 1) {
      const next = parent.items[idx + 1]
      return { ok: true, source: source.slice(0, target.start) + source.slice(next.start) }
    }
    const prev = parent.items[idx - 1]
    return { ok: true, source: source.slice(0, prev.end) + source.slice(target.end) }
  }
  return { ok: false, error: 'That value has no section to remove it from.' }
}

/* YAML / TOML / ENV (line-based) */

/** The full lines a config node occupies: its header line (for
 * sections) plus every leaf line under it. */
function configLineRanges(source: string, node: ConfigNode, out: { start: number; end: number }[]): void {
  if (node.kind === 'scalar' || node.kind === 'raw') {
    out.push({ start: lineStartOf(source, node.start), end: lineEndOf(source, node.end) })
    return
  }
  if (!(node.start === 0 && node.end === 0)) {
    out.push({ start: lineStartOf(source, node.start), end: lineEndOf(source, node.start) })
  }
  for (const child of node.children ?? []) configLineRanges(source, child, out)
}

function lastLineEnd(source: string, node: ConfigNode): number {
  let end = node.end
  for (const child of node.children ?? []) end = Math.max(end, lastLineEnd(source, child))
  return lineEndOf(source, Math.max(end, node.start))
}

function lineIndentAt(source: string, offset: number): string {
  const start = lineStartOf(source, offset)
  return /^ */.exec(source.slice(start))![0]
}

function insertAtLineEnd(source: string, lineEnd: number, line: string): string {
  // lineEnd is just past the newline (or EOF): the new line goes there.
  if (lineEnd >= source.length && source.length > 0 && !source.endsWith('\n')) {
    return `${source}\n${line}\n`
  }
  return source.slice(0, lineEnd) + `${line}\n` + source.slice(lineEnd)
}

const PLAIN_KEY_RE = /^[A-Za-z0-9_.-]+$/

function addConfig(format: ConfigFormat, source: string, parent: ConfigNode, isRoot: boolean, key: string | null, text: string, forceKind?: DataScalarKind): DataOpResult {
  const kind = forceKind ?? inferScalarKind(text)
  if (format === 'env') {
    if (!isRoot) return { ok: false, error: 'An .env file is flat — new variables go at the top level.' }
    if (key === null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { ok: false, error: 'A variable name is needed (letters, digits, underscores).' }
    if ((parent.children ?? []).some((c) => c.key === key)) return { ok: false, error: `There is already a ${key} — set it instead.` }
    const token = serialiseScalar('env', kind === 'string' || kind === 'null' ? 'string' : kind, text)
    const line = `${key}=${token}`
    return { ok: true, source: source === '' || source.endsWith('\n') ? source + `${line}\n` : `${source}\n${line}\n` }
  }
  if (parent.kind === 'array') {
    if (format === 'toml') return { ok: false, error: 'TOML lists are written on one line — append the whole list with data-set on the list itself is not supported either; edit this one as text.' }
    const items = parent.children ?? []
    if (items.some((c) => c.kind !== 'scalar')) return { ok: false, error: 'This list holds sections, not plain values — adding a section is not supported yet.' }
    const token = serialiseScalar('yaml', kind, text)
    if (items.length === 0) return { ok: false, error: 'This list is empty in a form the editor cannot extend in place — edit it as text.' }
    const first = items[0]
    const indent = lineIndentAt(source, first.start)
    return { ok: true, source: insertAtLineEnd(source, lastLineEnd(source, parent), `${indent}- ${token}`) }
  }
  if (parent.kind !== 'object') return { ok: false, error: 'That address is a single value, not a section — values are added to sections.' }
  if (key === null) return { ok: false, error: 'Adding to a section needs a key.' }
  if (!PLAIN_KEY_RE.test(key)) return { ok: false, error: `"${key}" is not a plain key — keys with spaces or special characters need text editing.` }
  if ((parent.children ?? []).some((c) => c.key === key)) return { ok: false, error: `There is already a "${key}" there — set it instead, or pick another key.` }
  const token = serialiseScalar(format, kind, text)
  if (format === 'yaml') {
    const kids = parent.children ?? []
    if (kids.length === 0) return { ok: false, error: 'That section is empty — there is no line to anchor a new entry to. Edit it as text first.' }
    const indent = isRoot ? '' : lineIndentAt(source, kids[0].start) || '  '
    return { ok: true, source: insertAtLineEnd(source, lastLineEnd(source, parent), `${indent}${key}: ${token}`) }
  }
  // TOML
  const kids = parent.children ?? []
  const anchor = kids.length > 0 ? lastLineEnd(source, parent) : lineEndOf(source, parent.start)
  return { ok: true, source: insertAtLineEnd(source, anchor, `${key} = ${token}`) }
}

/* XML */

function xmlElementStart(source: string, node: ConfigNode): number {
  if (node.kind === 'object') return node.start
  return source.lastIndexOf('<', node.start)
}

function scanTagEnd(source: string, from: number): number {
  let quote: string | null = null
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '>') return i
  }
  return -1
}

function addXml(source: string, parent: ConfigNode, isRoot: boolean, key: string | null, text: string): DataOpResult {
  if (key === null) return { ok: false, error: 'Adding to XML needs a name — an element name, or @name for an attribute.' }
  if (key.startsWith('@')) {
    const name = key.slice(1)
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) return { ok: false, error: `"${key}" is not a valid attribute name.` }
    if (parent.kind === 'raw') return { ok: false, error: 'Attributes cannot be added to that node.' }
    if ((parent.children ?? []).some((c) => c.key === key)) return { ok: false, error: `There is already an attribute ${key} — set it instead.` }
    const elStart = isRoot ? -1 : xmlElementStart(source, parent)
    if (elStart < 0) return { ok: false, error: 'Attributes belong on an element, not the document root.' }
    const tagEnd = scanTagEnd(source, elStart)
    if (tagEnd === -1) return { ok: false, error: 'Could not find the end of that element’s open tag.' }
    const at = source[tagEnd - 1] === '/' ? tagEnd - 1 : tagEnd
    return { ok: true, source: `${source.slice(0, at)} ${name}="${escapeXmlAttribute(text)}"${source.slice(at)}` }
  }
  if (!/^[A-Za-z_][\w:.-]*$/.test(key)) return { ok: false, error: `"${key}" is not a valid element name.` }
  const element = `<${key}>${escapeXmlText(text)}</${key}>`
  if (isRoot) {
    return { ok: true, source: source === '' || source.endsWith('\n') ? source + `${element}\n` : `${source}\n${element}\n` }
  }
  if (parent.kind !== 'object') return { ok: false, error: 'That address is a text value, not an element that can hold children.' }
  if ((parent.children ?? []).some((c) => c.key === key)) return { ok: false, error: `There is already a <${key}> there — a second one is fine in XML, but add it as text for now.` }
  const parentIndent = lineIndentAt(source, parent.start)
  const indent = `${parentIndent}  `
  const insertion = source[parent.end - 1] === '\n'
    ? `${indent}${element}\n`
    : `\n${indent}${element}\n${parentIndent}`
  return { ok: true, source: source.slice(0, parent.end) + insertion + source.slice(parent.end) }
}

function removeXml(source: string, node: ConfigNode): DataOpResult {
  if (node.raw === 'attribute') {
    // The node spans the value token; the attribute's name sits
    // before the '=' — scan back over it, and over the space
    // before the name, so the whole attribute goes.
    let p = node.start - 1
    while (source[p] === ' ') p--
    if (source[p] === '=') p--
    while (source[p] === ' ') p--
    while (p >= 0 && /[\w:.-]/.test(source[p])) p--
    let start = p + 1
    if (source[start - 1] === ' ') start--
    return { ok: true, source: source.slice(0, start) + source.slice(node.end) }
  }
  if (node.kind === 'raw' || node.key === '#text') {
    return { ok: true, source: deleteRanges(source, [{ start: node.start, end: node.end }]) }
  }
  const elStart = xmlElementStart(source, node)
  if (elStart < 0) return { ok: false, error: 'Could not locate that element in the file.' }
  let closeEnd: number
  if (node.raw === 'self-closing') {
    closeEnd = node.end
  } else {
    const closeStart = node.kind === 'object' ? node.end : source.indexOf('</', node.end)
    if (closeStart < 0) return { ok: false, error: 'Could not find that element’s close tag.' }
    const gt = source.indexOf('>', closeStart)
    if (gt === -1) return { ok: false, error: 'Could not find that element’s close tag.' }
    closeEnd = gt + 1
  }
  // Whole-line tidy: expand over surrounding whitespace on the line.
  let start = elStart
  const ls = lineStartOf(source, elStart)
  if (source.slice(ls, elStart).trim() === '') start = ls
  let end = closeEnd
  const le = lineEndOf(source, closeEnd)
  if (source.slice(closeEnd, le).trim() === '') end = le
  return { ok: true, source: deleteRanges(source, [{ start, end }]) }
}

/* ── the core verbs ─────────────────────────────────────────── */

export function addDataValue(format: DataFormat, source: string, root: DataNode, parentAddress: string, key: string | null, text: string, forceKind?: DataScalarKind): DataOpResult {
  const parent = parentAddress === '' ? root : findDataNode(root, parentAddress)
  if (!parent) return { ok: false, error: `No section at "${parentAddress}". Inspect the file to see its addresses.` }
  if (parent.kind === 'raw') return { ok: false, error: 'That part of the file is not a plain structure in this format — it cannot take new values here.' }
  if (format === 'json') return addJson(source, parent.ref as JsonNode, key, text, forceKind)
  if (format === 'xml') return addXml(source, parent.ref as ConfigNode, parentAddress === '', key, text)
  return addConfig(format, source, parent.ref as ConfigNode, parentAddress === '', key, text, forceKind)
}

/** Resolve an address to the chain of nodes from the root down
 * to the target (a name[n] step into an array contributes two
 * chain entries: the array, then the item). */
export function resolveChain(root: DataNode, address: string): DataNode[] | null {
  const chain: DataNode[] = [root]
  let node = root
  for (const step of parseAddress(address)) {
    const exact = node.children.find((c) => c.segment === step)
    if (exact) { chain.push(exact); node = exact; continue }
    const indexed = /^(.+)\[(\d+)\]$/.exec(step)
    if (indexed) {
      const siblings = node.children.filter((c) => c.segment === indexed[1])
      if (siblings.length === 1 && siblings[0].kind === 'array') {
        const item = siblings[0].children[Number(indexed[2])]
        if (!item) return null
        chain.push(siblings[0], item)
        node = item
        continue
      }
      const picked = siblings[Number(indexed[2])]
      if (!picked) return null
      chain.push(picked)
      node = picked
      continue
    }
    if (/^\d+$/.test(step) && node.children[Number(step)]) {
      node = node.children[Number(step)]
      chain.push(node)
      continue
    }
    return null
  }
  return chain
}

export function removeDataNode(format: DataFormat, source: string, root: DataNode, address: string): DataOpResult {
  if (address === '') return { ok: false, error: 'The whole file cannot be removed — name a value inside it.' }
  const chain = resolveChain(root, address)
  if (!chain || chain.length < 2) return { ok: false, error: `No value at "${address}". Inspect the file to see its addresses.` }
  const node = chain[chain.length - 1]
  const parent = chain[chain.length - 2]
  if (format === 'json') return removeJson(source, parent.ref as JsonNode, node.ref as JsonNode)
  if (format === 'xml') return removeXml(source, node.ref as ConfigNode)
  const ranges: { start: number; end: number }[] = []
  configLineRanges(source, node.ref as ConfigNode, ranges)
  if (ranges.length === 0) return { ok: false, error: 'That value occupies no lines the editor can remove safely — edit it as text.' }
  return { ok: true, source: deleteRanges(source, ranges) }
}
