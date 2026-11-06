/**
 * Regenerate catalog/shadcn.json from the vendored shadcn stock.
 * Usage: npx tsx scripts/extract-shadcn.ts [stock-ui-dir] [out-file]
 * Defaults: catalog/stock/shadcn/ui → catalog/shadcn.json.
 * Provenance of the stock itself: catalog/stock/shadcn/PROVENANCE.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { extractShadcnCatalog } from '../src/catalog/extractReact.ts'

const dir = process.argv[2] ?? 'catalog/stock/shadcn/ui'
const out = process.argv[3] ?? 'catalog/shadcn.json'
const components = extractShadcnCatalog(path.resolve(dir), 'catalog/stock/shadcn/ui')
const catalog = {
  version: 1,
  generatedFrom: 'shadcn-ui/ui@42f3bb6 (new-york-v4), vendored at catalog/stock/shadcn — regenerate with scripts/extract-shadcn.ts',
  components,
}
fs.writeFileSync(path.resolve(out), JSON.stringify(catalog, null, 2) + '\n', 'utf-8')
console.log(`wrote ${components.length} shadcn entries to ${out}`)
for (const c of components) console.log(`  ${c.tag}: ${c.props.length} props, exports [${(c.exports ?? []).join(', ')}], deps [${c.dependencies.join(', ')}]`)
