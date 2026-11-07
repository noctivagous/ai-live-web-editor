/**
 * Rung 1 extractor (phase-11-05 §8, TASKS-token-efficiency §1):
 * regex-lite parse of one .js/.jsx/.ts/.tsx file into
 * imports / exports / components / renders. Pure (no fs) — the
 * caller supplies { path, content }, same contract as
 * sourceMap/resolveSource.
 *
 * Conservative by design: anything it cannot parse is reported
 * as unknown (props: null), never guessed. No AST, no deps.
 */

export interface SourceInput { path: string, content: string }

export interface ImportInfo {
  /** Raw module specifier, e.g. 'react' or './components/Button'. */
  source: string
  /** Local names bound by the import (default import included, aliases resolved to the local name). */
  names: string[]
  /** Imported (pre-alias) names, parallel-ish to names for default/named; '*' for namespace. */
  imported: string[]
  isDefault: boolean
  /** True for `export ... from '...'` re-exports surfaced as imports. */
  reExport?: boolean
}

export interface ComponentInfo {
  name: string
  /** Destructured / typed prop names, or null when the signature could not be parsed. */
  props: string[] | null
  exported: boolean
  defaultExport: boolean
  /** 1-based line of the definition. */
  line: number
}

export interface FileInfo {
  path: string
  imports: ImportInfo[]
  /** Exported names (components and non-components), deduped, source order. */
  exports: string[]
  hasDefaultExport: boolean
  components: ComponentInfo[]
  /** Capitalised JSX tags this file renders (other components it uses), deduped. */
  renders: string[]
}

function uniq(xs: string[]): string[] { return [...new Set(xs)] }

function lineOf(content: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') n++
  return n
}

/** Split a brace list `{ a, b as c, type D }` into cleaned items. */
function braceItems(inner: string): string[] {
  return inner.split(',').map(s => s.trim()).filter(Boolean)
}

/** Parse the binding clause of an import (the part before `from`). */
function parseImportClause(clause: string): { names: string[], imported: string[], isDefault: boolean } {
  const names: string[] = []
  const imported: string[] = []
  let isDefault = false
  const trimmed = clause.trim()
  const ns = trimmed.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/)
  if (ns) return { names: [ns[1]], imported: ['*'], isDefault: false }
  const braceAt = trimmed.indexOf('{')
  let head = braceAt >= 0 ? trimmed.slice(0, braceAt).replace(/,\s*$/, '').trim() : trimmed
  if (head.startsWith('type ')) head = head.slice(5).trim()
  if (head && /^[A-Za-z_$][\w$]*$/.test(head)) { names.push(head); imported.push('default'); isDefault = true }
  if (braceAt >= 0) {
    const close = trimmed.indexOf('}', braceAt)
    const inner = trimmed.slice(braceAt + 1, close >= 0 ? close : undefined)
    for (const item of braceItems(inner)) {
      const clean = item.replace(/^type\s+/, '')
      const as = clean.match(/^([A-Za-z_$][\w$-]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (as) { imported.push(as[1]); names.push(as[2]) }
      else if (/^[A-Za-z_$][\w$-]*$/.test(clean)) { imported.push(clean); names.push(clean) }
    }
  }
  return { names, imported, isDefault }
}

/** All import + re-export statements in the file. */
export function parseImports(content: string): ImportInfo[] {
  const out: ImportInfo[] = []
  for (const m of content.matchAll(/import\s+([^;'"]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = parseImportClause(m[1])
    out.push({ source: m[2], names: clause.names, imported: clause.imported, isDefault: clause.isDefault })
  }
  for (const m of content.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    out.push({ source: m[1], names: [], imported: [], isDefault: false })
  }
  for (const m of content.matchAll(/export\s+(?:\{([^}]*)\}|\*)\s+from\s+['"]([^'"]+)['"]/g)) {
    const inner = m[1] || ''
    const imported = inner ? braceItems(inner).map(s => s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()) : ['*']
    const names = inner ? braceItems(inner).map(s => { const p = s.replace(/^type\s+/, '').split(/\s+as\s+/); return (p[1] || p[0]).trim() }) : []
    out.push({ source: m[2], names, imported, isDefault: false, reExport: true })
  }
  return out
}

/** Exported names + whether a default export exists. */
export function parseExports(content: string): { exports: string[], hasDefaultExport: boolean } {
  const names: string[] = []
  let hasDefaultExport = /export\s+default\b/.test(content)
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1])
  for (const m of content.matchAll(/export\s+(?:const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1])
  for (const m of content.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const item of braceItems(m[1])) {
      const clean = item.replace(/^type\s+/, '')
      const as = clean.match(/^([A-Za-z_$][\w$-]*)\s+as\s+([A-Za-z_$][\w$-]*|default)$/)
      if (as) { if (as[2] === 'default') hasDefaultExport = true; else names.push(as[2]) }
      else if (/^[A-Za-z_$][\w$-]*$/.test(clean)) names.push(clean)
    }
  }
  // Re-exported names are this file's exports too (the barrel case).
  for (const m of content.matchAll(/export\s*\{([^}]*)\}\s*from\s+['"][^'"]+['"]/g)) {
    for (const item of braceItems(m[1])) {
      const clean = item.replace(/^type\s+/, '')
      const as = clean.match(/^([A-Za-z_$][\w$-]*)\s+as\s+([A-Za-z_$][\w$-]*)$/)
      names.push(as ? as[2] : clean)
    }
  }
  const defNamed = content.match(/export\s+default\s+(?:function\s+|class\s+)?([A-Z][\w$]*)/)
  if (defNamed) names.push(defNamed[1])
  return { exports: uniq(names), hasDefaultExport }
}

/** Named type/interface bodies in the file, for TS prop resolution: name -> field names. */
function typeFields(content: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of content.matchAll(/(?:interface|type)\s+([A-Za-z_$][\w$]*)[^={]*=?\s*\{([\s\S]*?)\n\}/g)) {
    const fields: string[] = []
    for (const line of m[2].split('\n')) {
      const f = line.trim().match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??:/)
      if (f) fields.push(f[1])
    }
    if (fields.length) out.set(m[1], fields)
  }
  return out
}

/** Props from a parameter-list string: destructured names, or a named/inline TS type's fields. */
function propsFromParams(params: string, types: Map<string, string[]>): string[] | null {
  const p = params.trim()
  if (!p) return []
  if (p.startsWith('{')) {
    // Destructured props object: { a, b = 1, c: renamed, ...rest }
    let depth = 0
    let end = -1
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '{') depth++
      else if (p[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) return null
    const inner = p.slice(1, end)
    const names: string[] = []
    for (const item of inner.split(',')) {
      const t = item.trim()
      if (!t || t.startsWith('...')) continue
      const name = t.split(/[:=]/)[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
    }
    // Inline TS type after the destructure: ({ a }: { a: string; b?: number })
    const rest = p.slice(end + 1)
    const inline = rest.match(/:\s*\{([\s\S]*)\}\s*$/)
    if (inline && !names.length) {
      for (const part of inline[1].split(/[;\n]/)) {
        const f = part.trim().match(/^([A-Za-z_$][\w$]*)\??:/)
        if (f) names.push(f[1])
      }
    }
    return names
  }
  // Single identifier param: (props) or (props: SomeProps)
  const id = p.match(/^([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$.]*))?/)
  if (id) {
    if (id[2] && types.has(id[2])) return [...types.get(id[2])!]
    // Untyped `props` object — props are used as props.x, collected by the caller fallback below.
    return null
  }
  return null
}

/** `props.foo` accesses in a body, used only when the signature itself carries no prop info. */
function propsFromBody(body: string, paramName: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(new RegExp(`\\b${paramName}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** Capitalised component definitions in the file. */
export function parseComponents(content: string, exportedNames: Set<string>, hasDefaultExport: boolean): ComponentInfo[] {
  const types = typeFields(content)
  const out: ComponentInfo[] = []
  const seen = new Set<string>()
  const push = (c: ComponentInfo) => { if (!seen.has(c.name)) { seen.add(c.name); out.push(c) } }

  // function Name(params) / export function Name(params)
  for (const m of content.matchAll(/(export\s+)?(default\s+)?(?:async\s+)?function\s+([A-Z][\w$]*)\s*\(([^)]*)\)/g)) {
    const name = m[3]
    let props = propsFromParams(m[4], types)
    if (props === null) {
      const paramName = m[4].trim().match(/^([A-Za-z_$][\w$]*)/)?.[1]
      if (paramName && !m[4].includes('{')) props = propsFromBody(content.slice(m.index), paramName).slice(0, 20)
    }
    push({ name, props, exported: Boolean(m[1]) || exportedNames.has(name), defaultExport: Boolean(m[2]), line: lineOf(content, m.index ?? 0) })
  }
  // const Name = (params) => / const Name = function / const Name = memo( / forwardRef(
  for (const m of content.matchAll(/(export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)\s*=>|function\b|memo\s*\(|forwardRef\s*\()/g)) {
    const name = m[2]
    if (seen.has(name)) continue
    // Try to recover a destructured param from an arrow just after '='.
    const tail = content.slice((m.index ?? 0), (m.index ?? 0) + 400)
    const arrow = tail.match(/=\s*\(\s*(\{[\s\S]*?\})\s*(?::[^)]*)?\)\s*=>/)
    let props: string[] | null = null
    if (arrow) props = propsFromParams(arrow[1], types)
    else if (/=\s*\([^)]*\)\s*=>/.test(tail) || /memo|forwardRef/.test(tail.slice(0, 60))) props = null
    push({ name, props, exported: Boolean(m[1]) || exportedNames.has(name), defaultExport: false, line: lineOf(content, m.index ?? 0) })
  }
  // Default-exported named component: export default Name
  const def = content.match(/export\s+default\s+([A-Z][\w$]*)\s*;?\s*(?:\n|$)/)
  if (def && !seen.has(def[1])) {
    push({ name: def[1], props: null, exported: true, defaultExport: true, line: lineOf(content, def.index ?? 0) })
  } else if (def && seen.has(def[1])) {
    const c = out.find(x => x.name === def[1])
    if (c) { c.defaultExport = true; c.exported = true }
  }
  void hasDefaultExport
  return out.sort((a, b) => a.line - b.line)
}

/** Capitalised JSX tags rendered by this file. A `<` glued to a
 * word character is a TS generic (`Array<Button>`, `useState<T>`),
 * not JSX — JSX tags follow whitespace, `(`, `>`, `=`, `{` etc. */
export function parseRenders(content: string, selfNames: Set<string>): string[] {
  const out: string[] = []
  for (const m of content.matchAll(/<([A-Z][\w$]*)(?=[\s>/])/g)) {
    const prev = m.index ? content[m.index - 1] : ''
    if (/[\w$]/.test(prev)) continue
    if (m[1].length === 1) continue
    if (!selfNames.has(m[1]) && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

const SOURCE_EXT = /\.(?:js|jsx|ts|tsx|mjs)$/i

export function isSourceFile(p: string): boolean { return SOURCE_EXT.test(p) }

/** Parse one source file. Non-source paths return an empty FileInfo. */
export function parseFile(input: SourceInput): FileInfo {
  if (!isSourceFile(input.path)) {
    return { path: input.path, imports: [], exports: [], hasDefaultExport: false, components: [], renders: [] }
  }
  const { exports: exp, hasDefaultExport } = parseExports(input.content)
  const exportedNames = new Set(exp)
  const components = parseComponents(input.content, exportedNames, hasDefaultExport)
  return {
    path: input.path,
    imports: parseImports(input.content),
    exports: exp,
    hasDefaultExport,
    components,
    renders: parseRenders(input.content, new Set(components.map(c => c.name))),
  }
}
