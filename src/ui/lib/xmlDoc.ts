import type { ConfigNode, ConfigParse, ScalarKind } from './configDoc.ts'

/**
 * An offset XML parser that lands on the same neutral tree shape
 * as the config parsers (ConfigNode), so XML joins the
 * structured-data core (lib/dataTree) — and with it the data
 * tools — by parsing, nothing more.
 *
 * The mapping: an element with element children is an object
 * node; its attributes are scalar children named `@name`; an
 * element holding only text is a scalar whose token range is the
 * text itself; mixed text becomes a `#text` scalar child. The
 * prolog, comments and doctype are raw nodes (shown, never
 * edited). Every scalar records its exact source range, and
 * replaceXmlScalar splices a re-escaped value into just that
 * range — the rest of the document survives byte-identical.
 *
 * Conventions the ConfigNode shape has no field for ride in
 * `raw` on scalar nodes: 'self-closing' (an empty element whose
 * set expands it to a paired tag), 'cdata' (the value stays
 * CDATA-wrapped), 'attribute' (quote with attribute rules).
 */

const NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/

function typeXmlScalar(text: string): ScalarKind {
  if (text === 'true' || text === 'false') return 'boolean'
  if (text === '') return 'null'
  if (NUMBER_RE.test(text)) return 'number'
  return 'string'
}

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return "'"
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    return whole
  })
}

export function escapeXmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function escapeXmlAttribute(text: string): string {
  return escapeXmlText(text).replaceAll('"', '&quot;')
}

/** Repeated sibling elements share a tag; give the second and
 * later ones an [n] segment suffix so every node keeps a unique
 * address (dep, dep[1], dep[2]…) — lib/dataTree resolves it. */
function dedupeSiblings(children: ConfigNode[]): ConfigNode[] {
  const seen = new Map<string, number>()
  return children.map((child) => {
    const count = seen.get(child.key) ?? 0
    seen.set(child.key, count + 1)
    return count === 0 ? child : { ...child, key: `${child.key}[${count}]` }
  })
}

interface XmlFrame {
  node: ConfigNode
  tag: string
  /** Offset just past the open tag's `>` — where content begins. */
  contentStart: number
  textStart: number
  textParts: { start: number; end: number; cdata: boolean }[]
}

export function parseXmlConfig(source: string): ConfigParse {
  const root: ConfigNode = { kind: 'object', key: '', start: 0, end: source.length, children: [] }
  const stack: XmlFrame[] = []
  const parent = (): ConfigNode => (stack.length > 0 ? stack[stack.length - 1].node : root)

  let i = 0
  const fail = (error: string): ConfigParse => ({ ok: false, error })

  while (i < source.length) {
    const lt = source.indexOf('<', i)
    // Text run before the next tag (or EOF).
    const textEnd = lt === -1 ? source.length : lt
    if (textEnd > i && stack.length > 0) {
      const frame = stack[stack.length - 1]
      frame.textParts.push({ start: i, end: textEnd, cdata: false })
    } else if (textEnd > i && source.slice(i, textEnd).trim() !== '') {
      return fail(`Text outside any element at offset ${i}.`)
    }
    if (lt === -1) break
    i = lt

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      if (end === -1) return fail('Unterminated comment.')
      parent().children!.push({ kind: 'raw', key: '#comment', raw: source.slice(i, end + 3), start: i, end: end + 3 })
      i = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9)
      if (end === -1) return fail('Unterminated CDATA section.')
      if (stack.length === 0) return fail('CDATA outside any element.')
      stack[stack.length - 1].textParts.push({ start: i + 9, end, cdata: true })
      i = end + 3
      continue
    }
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i + 2)
      if (end === -1) return fail('Unterminated processing instruction.')
      parent().children!.push({ kind: 'raw', key: '#pi', raw: source.slice(i, end + 2), start: i, end: end + 2 })
      i = end + 2
      continue
    }
    if (source.startsWith('<!', i)) {
      const end = source.indexOf('>', i + 2)
      if (end === -1) return fail('Unterminated declaration.')
      parent().children!.push({ kind: 'raw', key: '#doctype', raw: source.slice(i, end + 1), start: i, end: end + 1 })
      i = end + 1
      continue
    }
    if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i + 2)
      if (end === -1) return fail('Unterminated close tag.')
      const tag = source.slice(i + 2, end).trim()
      const frame = stack.pop()
      if (!frame) return fail(`Close tag </${tag}> with nothing open.`)
      if (frame.tag !== tag) return fail(`Close tag </${tag}> does not match <${frame.tag}>.`)
      finishElement(frame, i, source)
      parent().children!.push(frame.node)
      i = end + 1
      continue
    }

    // Open tag: name, then attributes until > or />.
    const nameMatch = /^<([A-Za-z_][\w:.-]*)/.exec(source.slice(i))
    if (!nameMatch) return fail(`Malformed tag at offset ${i}.`)
    const tag = nameMatch[1]
    let j = i + nameMatch[0].length
    const attrs: ConfigNode[] = []
    let selfClosing = false
    for (;;) {
      while (j < source.length && /\s/.test(source[j])) j++
      if (source.startsWith('/>', j)) { selfClosing = true; j += 2; break }
      if (source[j] === '>') { j += 1; break }
      if (j >= source.length) return fail(`Unterminated tag <${tag}>.`)
      const attrMatch = /^([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(source.slice(j))
      if (!attrMatch) return fail(`Malformed attribute in <${tag}> at offset ${j}.`)
      const tokenStart = j + attrMatch[0].indexOf(attrMatch[2])
      attrs.push({
        kind: 'scalar',
        key: `@${attrMatch[1]}`,
        scalarKind: typeXmlScalar(decodeXmlEntities(attrMatch[3] ?? attrMatch[4] ?? '')),
        value: decodeXmlEntities(attrMatch[3] ?? attrMatch[4] ?? ''),
        start: tokenStart,
        end: tokenStart + attrMatch[2].length,
        raw: 'attribute',
      })
      j += attrMatch[0].length
    }
    const node: ConfigNode = { kind: 'object', key: tag, start: i, end: j, children: [...attrs] }
    if (selfClosing) {
      if (attrs.length > 0) {
        // Attributes would be unreachable on a scalar node — the
        // whole element stays a shown-but-unedited raw node.
        parent().children!.push({ kind: 'raw', key: tag, raw: source.slice(i, j), start: i, end: j })
      } else {
        node.kind = 'scalar'
        node.scalarKind = 'null'
        node.value = ''
        node.raw = 'self-closing'
        node.start = j - 2 // the '/>' token: a set expands it
        node.end = j
        delete node.children
        parent().children!.push(node)
      }
    } else {
      stack.push({ node, tag, contentStart: j, textStart: j, textParts: [] })
    }
    i = j
  }
  if (stack.length > 0) return fail(`Unclosed element <${stack[stack.length - 1].tag}>.`)
  root.children = dedupeSiblings(root.children ?? [])
  return { ok: true, root }
}

/** Turn a closed element frame into its final node shape. */
function finishElement(frame: XmlFrame, closeStart: number, source: string) {
  const node = frame.node
  const elementStart = node.start
  node.end = closeStart
  const elementChildren = (node.children ?? []).filter((c) => !c.key.startsWith('@'))
  const attrs = (node.children ?? []).filter((c) => c.key.startsWith('@'))
  const texts = frame.textParts.filter((p) => source.slice(p.start, p.end).trim() !== '' || p.cdata)

  if (elementChildren.length === 0 && texts.length <= 1) {
    // Leaf: the element IS a scalar (its text), or null when empty.
    const text = texts[0]
    delete node.children
    node.kind = 'scalar'
    if (!text) {
      node.scalarKind = 'null'
      node.value = ''
      node.start = frame.contentStart
      node.end = frame.contentStart
      if (attrs.length > 0) {
        // Empty but attributed: keep the attributes reachable —
        // the element is an object holding them plus a #text.
        node.kind = 'object'
        delete node.scalarKind
        delete node.value
        node.start = elementStart
        node.children = [...attrs, {
          kind: 'scalar', key: '#text', scalarKind: 'null', value: '',
          start: frame.contentStart, end: frame.contentStart,
        }]
      }
      return
    }
    const rawText = source.slice(text.start, text.end)
    node.scalarKind = typeXmlScalar(text.cdata ? rawText : decodeXmlEntities(rawText.trim()))
    node.value = text.cdata ? rawText : decodeXmlEntities(rawText.trim())
    node.start = text.start
    node.end = text.end
    if (text.cdata) node.raw = 'cdata'
    if (attrs.length > 0) {
      // Attributes on a text-bearing element: keep them reachable —
      // the element becomes an object holding @attrs and #text.
      node.kind = 'object'
      const textNode: ConfigNode = {
        kind: 'scalar', key: '#text', scalarKind: node.scalarKind, value: node.value,
        start: node.start, end: node.end, raw: node.raw,
      }
      delete node.scalarKind
      delete node.value
      delete node.raw
      node.start = elementStart
      node.children = [...attrs, textNode]
    }
    return
  }

  // Object element: attributes, child elements, and any mixed
  // text runs as #text children in source order (approximately —
  // text runs keep their own offsets and sort back into place).
  const mixed: ConfigNode[] = texts.map((p) => ({
    kind: 'scalar' as const,
    key: '#text',
    scalarKind: typeXmlScalar(p.cdata ? source.slice(p.start, p.end) : decodeXmlEntities(source.slice(p.start, p.end).trim())),
    value: p.cdata ? source.slice(p.start, p.end) : decodeXmlEntities(source.slice(p.start, p.end).trim()),
    start: p.start,
    end: p.end,
    raw: p.cdata ? 'cdata' : undefined,
  }))
  const all = [...elementChildren, ...mixed].sort((a, b) => a.start - b.start)
  node.children = [...attrs, ...dedupeSiblings(all)]
}

/**
 * Splice a new value for an XML scalar node: text is re-escaped
 * (attribute rules for attributes), CDATA nodes stay wrapped,
 * and a self-closing element expands to a paired tag.
 */
export function replaceXmlScalar(source: string, node: ConfigNode, text: string): string {
  if (node.raw === 'self-closing') {
    const tag = node.key.replace(/\[\d+\]$/, '')
    return `${source.slice(0, node.start)}>${escapeXmlText(text)}</${tag}>${source.slice(node.end)}`
  }
  if (node.raw === 'cdata') {
    return source.slice(0, node.start) + text + source.slice(node.end)
  }
  if (node.raw === 'attribute') {
    const quote = source[node.start] ?? '"'
    const inner = quote === "'" ? escapeXmlText(text).replaceAll('"', '&quot;') : escapeXmlAttribute(text)
    return source.slice(0, node.start) + quote + inner + quote + source.slice(node.end)
  }
  return source.slice(0, node.start) + escapeXmlText(text) + source.slice(node.end)
}
