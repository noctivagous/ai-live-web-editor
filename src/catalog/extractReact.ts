/**
 * React catalog extractor: generate catalog entries from shadcn
 * (React + Radix + Tailwind) component sources, into the same
 * NoctComponentMeta-shaped entries the AppKit extractor produces
 * (extract.ts), so one catalog and one find-component tool serve
 * both stocks. The registry unit is the FILE (shadcn installs per
 * file): one entry per ui/*.tsx, with the file's component
 * exports listed and the root component's props extracted —
 * cva variant options, inline `& { ... }` prop types, and
 * destructured props. Descriptions are registry curation (the
 * CURATED map below); everything structural is parsed, and
 * anything unparseable is omitted, never guessed.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { CatalogEntry, CatalogProp } from './catalog.js'
import { sliceObjectLiteral } from './extract.js'

/** One-line registry descriptions for the vendored shadcn starter set. */
export const SHADCN_CURATED: Record<string, string> = {
  button: 'Clickable button in several visual variants and sizes; asChild applies the button styling to a child element such as a link.',
  card: 'Card container for grouped content, with header, title, description, content, action and footer parts.',
  checkbox: 'Checkbox input with a checked state, built on the Radix checkbox primitive.',
  dialog: 'Modal dialog on the Radix dialog primitive: overlay, content panel, title, description and close, composed from the exported parts.',
  input: 'Single-line text input with the stock styling.',
  label: 'Form label on the Radix label primitive; associates with a control through htmlFor.',
  separator: 'Horizontal or vertical separator line (Radix separator), decorative or semantic.',
  switch: 'On/off switch toggle on the Radix switch primitive, in two sizes.',
  tabs: 'Tabbed interface on the Radix tabs primitive: a list of triggers switching content panes.',
  textarea: 'Multi-line text input with the stock styling.',
}

/** Split a literal's inner text on top-level commas (string- and depth-aware). */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts.map(p => p.trim()).filter(Boolean)
}

/** Keys at the top level of an object literal (the slice includes its braces). */
function topLevelKeys(lit: string): string[] {
  return splitTopLevel(lit.slice(1, -1))
    .map(part => {
      const m = part.match(/^(?:["']([^"']+)["']|([A-Za-z_$][\w$-]*))\s*:/)
      return m ? (m[1] ?? m[2]) : null
    })
    .filter((k): k is string => Boolean(k))
}

/** The object literal assigned to `key` at the top level of `lit`, if any. */
function childObject(lit: string, key: string): string | null {
  for (const part of splitTopLevel(lit.slice(1, -1))) {
    const m = part.match(new RegExp(`^(?:["']${key}["']|${key})\\s*:`))
    if (!m) continue
    const rest = part.slice(m[0].length).trim()
    return rest.startsWith('{') ? sliceObjectLiteral(rest, 0) : null
  }
  return null
}

/** cva variant props: option unions per variant name, with defaults noted. */
function cvaProps(src: string): CatalogProp[] {
  const at = src.indexOf('cva(')
  if (at < 0) return []
  const brace = src.indexOf('{', at)
  if (brace < 0) return []
  const config = sliceObjectLiteral(src, brace)
  if (!config) return []
  const variants = childObject(config, 'variants')
  if (!variants) return []
  const defaults = new Map<string, string>()
  const defObj = childObject(config, 'defaultVariants')
  if (defObj) {
    for (const part of splitTopLevel(defObj.slice(1, -1))) {
      const m = part.match(/^(?:["']([^"']+)["']|(\w+))\s*:\s*["']([^"']*)["']/)
      if (m) defaults.set(m[1] ?? m[2], m[3])
    }
  }
  const props: CatalogProp[] = []
  for (const name of topLevelKeys(variants)) {
    const options = childObject(variants, name)
    if (!options) continue
    const keys = topLevelKeys(options)
    if (!keys.length) continue
    const def = defaults.get(name)
    props.push({
      name,
      type: keys.map(k => `'${k}'`).join(' | '),
      description: def ? `Default '${def}'.` : undefined,
    })
  }
  return props
}

/** Component names a file exports (PascalCase, variant helpers excluded). */
export function exportedComponents(src: string): string[] {
  const names = new Set<string>()
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Z]/.test(name) && !/Variants$/.test(name)) names.add(name)
    }
  }
  for (const m of src.matchAll(/export\s+(?:function|const)\s+([A-Z]\w*)/g)) names.add(m[1])
  return [...names]
}

/** Package + sibling dependencies from the import statements. */
function dependencies(src: string): string[] {
  const deps: string[] = []
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1]
    if (spec === 'react') continue
    const dep = spec.startsWith('./') ? spec.slice(2) : spec
    if (!deps.includes(dep)) deps.push(dep)
  }
  return deps
}

interface RootSignature {
  destructured: string[]
  inlineProps: CatalogProp[]
  baseElement?: string
  basePrimitive?: string
}

/** The root component function's parameter shape. */
function rootSignature(src: string, root: string): RootSignature {
  const out: RootSignature = { destructured: [], inlineProps: [] }
  const at = src.indexOf(`function ${root}(`)
  if (at < 0) return out
  // Slice the parameter list (paren-depth aware, string aware).
  let depth = 0
  let quote: string | null = null
  let end = -1
  const start = src.indexOf('(', at)
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) return out
  const params = src.slice(start + 1, end)
  const braceAt = params.indexOf('{')
  if (braceAt >= 0) {
    const destructure = sliceObjectLiteral(params, braceAt)
    if (destructure) {
      out.destructured = splitTopLevel(destructure.slice(1, -1))
        .filter(p => !p.startsWith('...'))
        .map(p => p.split('=')[0].split(':')[0].trim())
        .filter(Boolean)
      const typeText = params.slice(braceAt + destructure.length)
      const amp = typeText.indexOf('&')
      if (amp >= 0) {
        const inlineBrace = typeText.indexOf('{', amp)
        const inline = inlineBrace >= 0 ? sliceObjectLiteral(typeText, inlineBrace) : null
        if (inline) {
          for (const part of splitTopLevel(inline.slice(1, -1))) {
            const m = part.match(/^([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]+)$/)
            if (m) out.inlineProps.push({ name: m[1], type: m[2].trim() })
          }
        }
      }
      const baseEl = typeText.match(/ComponentProps<\s*"([a-z]+)"/)
      if (baseEl) out.baseElement = baseEl[1]
      const basePrim = typeText.match(/ComponentProps<typeof\s+([\w.]+)/)
      if (basePrim) out.basePrimitive = basePrim[1]
    }
  }
  return out
}

/**
 * Extract one catalog entry from a shadcn ui/*.tsx source.
 * `fileBase` is the file name without extension ('button').
 * Returns null when the file exports no component.
 */
export function extractReactEntry(src: string, sourceFile: string, fileBase: string): CatalogEntry | null {
  const exports = exportedComponents(src)
  if (!exports.length) return null
  const root = exports.find(e => e.toLowerCase() === fileBase.toLowerCase()) ?? exports[0]
  const sig = rootSignature(src, root)
  const props: CatalogProp[] = [...cvaProps(src)]
  const have = new Set(props.map(p => p.name))
  for (const p of sig.inlineProps) {
    if (!have.has(p.name)) { props.push(p); have.add(p.name) }
  }
  for (const name of sig.destructured) {
    if (have.has(name) || name === 'children') continue
    props.push(name === 'className' ? { name, type: 'string' } : { name })
    have.add(name)
  }
  let description = SHADCN_CURATED[fileBase] ?? `${root} component from the shadcn stock.`
  if (sig.baseElement) description += ` Renders a native <${sig.baseElement}> and accepts its standard props.`
  else if (sig.basePrimitive) description += ` Accepts the ${sig.basePrimitive.replace(/Primitive$/, '')} primitive's props.`
  return {
    tag: root,
    category: 'ui',
    description,
    props,
    slots: /\bchildren\b/.test(src) ? ['children'] : [],
    emits: [],
    dependencies: dependencies(src),
    exports,
    runtime: 'react',
    sourceFile,
    origin: 'shadcn-stock',
  }
}

/** Extract entries for every ui/*.tsx under `dir`, sorted by tag. */
export function extractShadcnCatalog(dir: string, sourcePrefix: string): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.tsx')).sort()) {
    const src = fs.readFileSync(path.join(dir, file), 'utf-8')
    const entry = extractReactEntry(src, `${sourcePrefix}/${file}`, file.replace(/\.tsx$/, ''))
    if (entry) entries.push(entry)
  }
  return entries.sort((a, b) => a.tag.localeCompare(b.tag))
}
