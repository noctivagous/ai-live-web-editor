/**
 * Component catalog (phase-11-05 Step 1 + phase-11-06 §G): the
 * shadcn-model registry the agent consults before building common
 * UI from scratch. Entries follow the NoctComponentMeta contract
 * from noct-code-appkit (tag, category, description, typed props,
 * slots, emits, dependencies, examples) so metadata can be
 * *generated* from component sources (see extract.ts and
 * extractReact.ts), not hand-written.
 *
 * Two stocks share the one catalog. The shadcn stock (React,
 * `catalog/shadcn.json`, sources vendored at catalog/stock/shadcn)
 * is the default. The AppKit stock (Lit, `catalog/components.json`)
 * is OFF by default — it serves only projects that opt in (see
 * catalogSession.ts); search and the brief respect that, an
 * exact-tag lookup does not have to.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAppkitEnabled } from './catalogSession.js'

export interface CatalogProp {
  name: string
  type?: string
  description?: string
}

export interface CatalogEntry {
  tag: string
  category: string
  description: string
  props: CatalogProp[]
  slots: Array<{ name: string, description?: string } | string>
  emits: string[]
  /** Other catalog tags (or files) this component needs to work. */
  dependencies: string[]
  examples?: string[]
  /** Path of the component source inside its home project, for copy-own installs. */
  sourceFile?: string
  /** Which world the component runs in: Lit element (AppKit stock) or React component (shadcn stock). */
  runtime?: 'lit' | 'react'
  /** For multi-component files (the shadcn registry unit is a file): every exported component name. */
  exports?: string[]
  origin: 'inventory-seed' | 'extracted' | 'shadcn-stock'
}

export interface Catalog {
  version: number
  generatedFrom?: string
  components: CatalogEntry[]
}

const CATALOG_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'catalog',
)

const DEFAULT_CATALOG_PATH = path.join(CATALOG_DIR, 'components.json')
const SHADCN_CATALOG_PATH = path.join(CATALOG_DIR, 'shadcn.json')

let cached: Catalog | null = null

function loadCatalogFile(catalogPath: string): Catalog {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as Catalog
    return {
      version: parsed.version || 1,
      generatedFrom: parsed.generatedFrom,
      components: Array.isArray(parsed.components) ? parsed.components : [],
    }
  } catch {
    return { version: 1, components: [] }
  }
}

/**
 * Load the catalog. The default catalog merges both stock files
 * (AppKit + shadcn); an explicit path loads exactly that file.
 */
export function loadCatalog(catalogPath: string = DEFAULT_CATALOG_PATH): Catalog {
  if (cached && catalogPath === DEFAULT_CATALOG_PATH) return cached
  const catalog = loadCatalogFile(catalogPath)
  if (catalogPath === DEFAULT_CATALOG_PATH) {
    const shadcn = loadCatalogFile(SHADCN_CATALOG_PATH)
    if (shadcn.components.length) catalog.components = [...catalog.components, ...shadcn.components]
    cached = catalog
  }
  return catalog
}

/** Test hook: forget the cached catalog. */
export function resetCatalogCache(): void {
  cached = null
}

function score(entry: CatalogEntry, terms: string[]): number {
  const tag = entry.tag.toLowerCase()
  const category = entry.category.toLowerCase()
  const description = entry.description.toLowerCase()
  const propNames = entry.props.map(p => p.name.toLowerCase()).join(' ')
  let s = 0
  for (const t of terms) {
    if (tag === t) s += 6
    else if (tag.includes(t)) s += 3
    if (category === t) s += 2
    if (description.includes(t)) s += 2
    if (propNames.includes(t)) s += 1
  }
  return s
}

/** Which stock an entry belongs to: React entries are the shadcn stock, the rest AppKit. */
export function entryStock(entry: CatalogEntry): 'shadcn' | 'appkit' {
  return entry.runtime === 'react' ? 'shadcn' : 'appkit'
}

/**
 * Whether an entry is served by default. shadcn entries always
 * are; AppKit entries only when the stock is on for this session
 * (project opt-in) or the caller explicitly includes them.
 */
export function entryEnabled(entry: CatalogEntry, includeAppkit = false): boolean {
  return entryStock(entry) === 'shadcn' || includeAppkit || getAppkitEnabled()
}

/**
 * Find catalog components for a need ("settings panel", "split
 * panes", "data table"). Plain term scoring over the metadata —
 * the registry's point is that no vector search is needed.
 * AppKit entries are excluded unless that stock is on or
 * `includeAppkit` is set.
 */
export function findComponents(
  query: string,
  limit = 6,
  catalog: Catalog = loadCatalog(),
  opts: { includeAppkit?: boolean } = {},
): CatalogEntry[] {
  const terms = query.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
  if (!terms.length) return []
  return catalog.components
    .filter(e => entryEnabled(e, opts.includeAppkit))
    .map(e => ({ e, s: score(e, terms) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.tag.localeCompare(b.e.tag))
    .slice(0, limit)
    .map(x => x.e)
}

/**
 * Tier-1 summary of a catalog entry (§3 tiering): tag, category, a
 * one-line description and prop NAMES only — no types, no slot/emit
 * detail, no examples. A search of these costs ~300 tokens total;
 * the full entry is one exact-tag lookup away.
 */
export interface CatalogSummary {
  tag: string
  category: string
  description: string
  props: string[]
  runtime?: 'lit' | 'react'
  stock: 'shadcn' | 'appkit'
}

function oneLiner(text: string, max = 120): string {
  const first = text.split(/(?<=[.!])\s/)[0] || text
  const flat = first.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + '…'
}

export function entrySummary(entry: CatalogEntry): CatalogSummary {
  return {
    tag: entry.tag,
    category: entry.category,
    description: oneLiner(entry.description),
    props: entry.props.map(pr => pr.name),
    ...(entry.runtime ? { runtime: entry.runtime } : {}),
    stock: entryStock(entry),
  }
}

/** Tier-1 search: the find-component search path returns summaries, never full entries. */
export function searchSummaries(
  query: string,
  limit = 6,
  catalog: Catalog = loadCatalog(),
  opts: { includeAppkit?: boolean } = {},
): CatalogSummary[] {
  return findComponents(query, limit, catalog, opts).map(entrySummary)
}

/**
 * Exact-tag lookup. Deliberately NOT stock-filtered: naming a
 * component exactly is an explicit request, so an AppKit tag
 * resolves even while that stock is off.
 */
export function getComponent(tag: string, catalog: Catalog = loadCatalog()): CatalogEntry | undefined {
  return catalog.components.find(c => c.tag === tag)
}

/** One-line catalog summary for the project brief (enabled stocks only). */
export function catalogSummary(catalog: Catalog = loadCatalog()): string {
  const enabled = catalog.components.filter(e => entryEnabled(e))
  const offCount = catalog.components.length - enabled.length
  if (!enabled.length && !offCount) return ''
  const stocks: string[] = []
  for (const stock of ['shadcn', 'appkit'] as const) {
    const inStock = enabled.filter(e => entryStock(e) === stock)
    if (!inStock.length) continue
    const byCategory = new Map<string, number>()
    for (const c of inStock) byCategory.set(c.category, (byCategory.get(c.category) || 0) + 1)
    const parts = [...byCategory.entries()].map(([k, n]) => `${k} ${n}`).join(', ')
    stocks.push(stock === 'shadcn' ? `${inStock.length} shadcn/React (${parts})` : `${inStock.length} AppKit/Lit (${parts})`)
  }
  let summary = `Component catalog: ${enabled.length} ready-made components (${stocks.join('; ')}). Before building common UI (settings, app shell, tables, forms, layout), call find-component to check the catalog and copy from it instead of hand-rolling.`
  if (stocks.length === 2) {
    summary += ' For ordinary UI in a React project prefer the shadcn entries; the AppKit entries cover Noct chrome plus the logic, flow and gui categories shadcn has no equivalent for.'
  }
  if (offCount) {
    summary += ` The Noct AppKit stock (${offCount} Lit components) is off by default and applies only to projects that opt in (project.ai.json "appkit": true) — do not plan around it for this project.`
  }
  return summary
}
