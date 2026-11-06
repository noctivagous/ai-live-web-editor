/**
 * Regenerate catalog/components.json from noct-code-appkit sources.
 *
 *   npx tsx scripts/extract-catalog.ts <path-to-appkit>/src/lib
 *
 * Extracted entries (full NoctComponentMeta: props, slots, emits,
 * dependencies) replace inventory seeds by tag; components whose
 * sources export no meta (the meta/ introspection pair) keep
 * their seed entries.
 */
import fs from 'node:fs'
import path from 'node:path'
import { extractCatalog } from '../src/catalog/extract.js'
import type { Catalog, CatalogEntry } from '../src/catalog/catalog.js'

const libRoot = process.argv[2]
if (!libRoot) {
  console.error('usage: npx tsx scripts/extract-catalog.ts <path-to-appkit>/src/lib')
  process.exit(1)
}

const catalogPath = path.join(process.cwd(), 'catalog', 'components.json')
const current = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as Catalog
const extracted = extractCatalog(libRoot)
const byTag = new Map<string, CatalogEntry>(current.components.map(c => [c.tag, c]))
for (const entry of extracted) byTag.set(entry.tag, entry)

const merged: Catalog = {
  version: 1,
  generatedFrom: `extracted from noct-code-appkit src/lib (${extracted.length} components) + inventory seeds for the rest`,
  components: [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag)),
}
fs.writeFileSync(catalogPath, JSON.stringify(merged, null, 1) + '\n', 'utf-8')
console.log(`catalog: ${merged.components.length} entries (${extracted.length} extracted, ${merged.components.length - extracted.length} seed)`)
