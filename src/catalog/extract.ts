/**
 * Catalog extractor: generate catalog entries from component
 * sources that export NoctComponentMeta objects (the appkit
 * contract: `export const XxxMeta: NoctComponentMeta = { ... }`).
 * This is what makes the catalog *generated, not hand-written*:
 * point it at the noct-code-appkit `src/lib/` tree and it emits
 * catalog/components.json entries with origin 'extracted'.
 *
 * The parser is deliberately tolerant and conservative: it reads
 * the meta object literal with a string-aware brace scanner and
 * pulls the documented fields. Anything it cannot parse is
 * omitted — never guessed.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { CatalogEntry, CatalogProp } from './catalog.js'

/** Slice the object literal starting at `start` (index of '{'), string-aware. */
export function sliceObjectLiteral(src: string, start: number): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

function stringField(lit: string, key: string): string | undefined {
  const m = lit.match(new RegExp(`${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`))
  return m ? m[2].replace(/\\(.)/g, '$1') : undefined
}

function stringArrayField(lit: string, key: string): string[] {
  const m = lit.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`))
  if (!m) return []
  return [...m[1].matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map(x => x[2])
}

function propsField(lit: string): CatalogProp[] {
  const m = lit.match(/props\s*:\s*(\[|\{)/)
  if (!m) return []
  const start = lit.indexOf(m[1], m.index)
  const isArray = m[1] === '['
  const slice = isArray ? sliceArrayLiteral(lit, start) : sliceObjectLiteral(lit, start)
  if (!slice) return []
  const out: CatalogProp[] = []
  if (isArray) {
    for (const obj of topLevelObjects(slice)) {
      const name = stringField(obj, 'name')
      if (name) out.push({ name, type: stringField(obj, 'type'), description: stringField(obj, 'description') })
    }
  } else {
    // Object map: top-level keys are prop names; values may carry type/description.
    for (const [name, obj] of topLevelEntries(slice)) {
      out.push({ name, type: stringField(obj, 'type'), description: stringField(obj, 'description') })
    }
  }
  return out
}

function sliceArrayLiteral(src: string, start: number): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  return null
}

function topLevelObjects(arrayLiteral: string): string[] {
  const out: string[] = []
  for (let i = 0; i < arrayLiteral.length; i++) {
    if (arrayLiteral[i] === '{') {
      const obj = sliceObjectLiteral(arrayLiteral, i)
      if (obj) { out.push(obj); i += obj.length - 1 }
    }
  }
  return out
}

function topLevelEntries(objectLiteral: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const body = objectLiteral.slice(1, -1)
  let i = 0
  while (i < body.length) {
    const km = body.slice(i).match(/^\s*(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$-]*))\s*:/)
    if (!km) { i++; continue }
    const name = km[1] || km[2]
    i += km[0].length
    while (i < body.length && /\s/.test(body[i])) i++
    let value = ''
    if (body[i] === '{') {
      const obj = sliceObjectLiteral(body, i)
      value = obj || ''
      i += value.length
    } else {
      const vm = body.slice(i).match(/^[^,]*/)
      value = vm ? vm[0] : ''
      i += value.length
    }
    out.push([name, value])
    if (body[i] === ',') i++
  }
  return out
}

function slotsField(lit: string): CatalogEntry['slots'] {
  // Real appkit shape: Record<string, string> — slot name -> description.
  const objMatch = lit.match(/slots\s*:\s*\{/)
  if (objMatch && objMatch.index !== undefined) {
    const slice = sliceObjectLiteral(lit, lit.indexOf('{', objMatch.index))
    if (slice) {
      return topLevelEntries(slice).map(([name, raw]) => {
        const desc = raw.trim().match(/^(['"])((?:\\.|(?!\1).)*)\1/)
        return desc ? { name, description: desc[2] } : { name }
      })
    }
  }
  const m = lit.match(/slots\s*:\s*\[/)
  if (!m) return []
  const slice = sliceArrayLiteral(lit, lit.indexOf('[', m.index))
  if (!slice) return []
  if (slice.includes('{')) {
    return topLevelObjects(slice)
      .map(obj => stringField(obj, 'name'))
      .filter((n): n is string => Boolean(n))
      .map(name => ({ name }))
  }
  return stringArrayField(lit, 'slots')
}

/** Extract one entry from a component source file's text. */
export function extractEntryFromSource(src: string, sourceFile: string): CatalogEntry | null {
  const metaHead = src.match(/export\s+const\s+\w+Meta\b[^=]*=\s*\{/)
  if (!metaHead || metaHead.index === undefined) return null
  const lit = sliceObjectLiteral(src, metaHead.index + metaHead[0].length - 1)
  if (!lit) return null
  const tag = stringField(lit, 'tag') || stringField(lit, 'name')
  if (!tag) return null
  const dirCategory = sourceFile.split('/').slice(-2, -1)[0]
  return {
    tag,
    category: stringField(lit, 'category') || dirCategory || 'misc',
    description: stringField(lit, 'description') || '',
    props: propsField(lit),
    slots: slotsField(lit),
    emits: stringArrayField(lit, 'emits').length ? stringArrayField(lit, 'emits') : stringArrayField(lit, 'events'),
    dependencies: stringArrayField(lit, 'dependencies'),
    examples: stringArrayField(lit, 'examples'),
    sourceFile,
    origin: 'extracted',
  }
}

/** Walk a source tree (appkit `src/lib/`) and extract every entry. */
export function extractCatalog(root: string): CatalogEntry[] {
  const out: CatalogEntry[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        const entry = extractEntryFromSource(fs.readFileSync(full, 'utf-8'), path.relative(root, full))
        if (entry) out.push(entry)
      }
    }
  }
  walk(root)
  return out.sort((a, b) => a.tag.localeCompare(b.tag))
}
