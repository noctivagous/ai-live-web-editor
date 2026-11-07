import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseFile } from './extract.js'
import {
  buildCodebaseMap, estimateTokens, findRegistryComponent, formatCodebaseMap,
  mapInjectionText, MAP_INJECTION_THRESHOLD, resolveRelativeImport, type SourceInput,
} from './codebaseMap.js'
import {
  adoptRegistry, buildAndPersistMap, buildMapForRoot, createMapRebuilder,
  declaredInputsForRoot, installCatalogComponent, readPersistedMap, scanProject,
} from './mapStore.js'

// ---------- fixtures ----------

const BUTTON: SourceInput = {
  path: '/src/components/ui/button.tsx',
  content: `import * as React from 'react'
export interface ButtonProps { variant?: string, size?: string, disabled?: boolean }
export function Button({ variant, size, disabled }: ButtonProps) {
  return <button data-variant={variant} data-size={size} disabled={disabled} />
}
`,
}
const CARD: SourceInput = {
  path: '/src/components/Card.jsx',
  content: `export function Card({ title, children }) {
  return <article><h2>{title}</h2>{children}</article>
}
export const CardFooter = () => <footer />
`,
}
const APP: SourceInput = {
  path: '/App.jsx',
  content: `import { Button } from './src/components/ui/button'
import { Card } from './src/components/Card'
export default function App() {
  return <main><Card title="Hi"><Button variant="primary" /></Card></main>
}
`,
}
const MAIN: SourceInput = {
  path: '/main.jsx',
  content: `import React from 'react'
import App from './App'
export const root = App
`,
}
const BARREL: SourceInput = {
  path: '/src/components/index.js',
  content: `export { Button } from './ui/button'
export { Card } from './Card'
`,
}
const CSS: SourceInput = { path: '/src/theme.css', content: `:root { --accent: #06c; }` }

function tmpProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-live-map-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
  }
  return root
}

/** A 20-file chain: main -> App -> Page01.. -> Widget (most-imported). */
function twentyFiles(): SourceInput[] {
  const files: SourceInput[] = [
    { path: '/src/main.jsx', content: `import App from './App'\n` },
    { path: '/src/App.jsx', content: `import Page01 from './pages/Page01'\nimport Widget from './components/Widget'\nexport default function App() { return <div><Page01 /><Widget /></div> }\n` },
    { path: '/src/components/Widget.jsx', content: `export default function Widget({ label }) { return <span>{label}</span> }\n` },
  ]
  for (let i = 1; i <= 17; i++) {
    const n = String(i).padStart(2, '0')
    const next = i < 17 ? `import Page${String(i + 1).padStart(2, '0')} from './Page${String(i + 1).padStart(2, '0')}'\n` : ''
    files.push({
      path: `/src/pages/Page${n}.jsx`,
      content: `${next}import Widget from '../components/Widget'\nexport default function Page${n}() { return <section><Widget label="p${n}" /></section> }\n`,
    })
  }
  return files
}

// ---------- extractor ----------

describe('Rung 1 extractor', () => {
  it('parses a component definition with destructured + TS-typed props', () => {
    const info = parseFile(BUTTON)
    const btn = info.components.find(c => c.name === 'Button')
    assert.ok(btn)
    assert.deepEqual(btn?.props, ['variant', 'size', 'disabled'])
    assert.equal(btn?.exported, true)
    assert.ok(info.exports.includes('Button'))
  })

  it('parses plain destructured props and arrow components', () => {
    const info = parseFile(CARD)
    assert.deepEqual(info.components.find(c => c.name === 'Card')?.props, ['title', 'children'])
    assert.ok(info.components.some(c => c.name === 'CardFooter'))
  })

  it('captures re-exports as imports and exports', () => {
    const info = parseFile(BARREL)
    assert.ok(info.imports.some(i => i.reExport && i.names.includes('Button')))
    assert.ok(info.exports.includes('Button'))
    assert.ok(info.exports.includes('Card'))
  })

  it('resolves imports across files and renders', () => {
    const set = new Set([APP.path, BUTTON.path, CARD.path])
    assert.equal(resolveRelativeImport(APP.path, './src/components/ui/button', set), BUTTON.path)
    const info = parseFile(APP)
    assert.deepEqual(info.renders, ['Card', 'Button'])
  })

  it('does not mistake TS generics for rendered components', () => {
    const info = parseFile({ path: '/src/api.ts', content: `export async function load(): Promise<Array<Widget>> { const xs: Set<Card> = new Set(); return [] }\nexport function View() { return <div><Widget /></div> }\n` })
    assert.deepEqual(info.renders, ['Widget'])
  })

  it('marks an unparseable component signature as props unknown, never guessed', () => {
    const info = parseFile({ path: '/src/Weird.jsx', content: `import { memo } from 'react'\nexport const Weird = memo((props) => <div />)\n` })
    const w = info.components.find(c => c.name === 'Weird')
    assert.ok(w)
    assert.equal(w?.props, null)
  })
})

// ---------- map ----------

describe('codebase map', () => {
  it('ranks by in-degree, names the entry first, and speaks route vocabulary', () => {
    const map = buildCodebaseMap([MAIN, APP, BUTTON, CARD, BARREL, CSS])
    assert.equal(map.entry?.file, '/main.jsx')
    assert.equal(map.entry?.component, 'App')
    const text = formatCodebaseMap(map)
    const lines = text.split('\n')
    assert.ok(lines[0].includes('Entry: /main.jsx → App'))
    // Widget-level: Button and Card are each imported by App + barrel.
    const btnFile = map.files.find(f => f.path === BUTTON.path)
    assert.equal(btnFile?.inDegree, 2)
    // App renders lines carry the renders vocabulary.
    assert.ok(text.includes('renders <Card>, <Button>') || text.includes('renders'))
    assert.ok(text.includes('Styles/tokens: /src/theme.css'))
  })

  it('20-file fixture: formatted map fits the 1k-token budget and names the entry component first', () => {
    const map = buildCodebaseMap(twentyFiles())
    assert.equal(map.fileCount, 20)
    const text = formatCodebaseMap(map, 1000)
    assert.ok(estimateTokens(text) <= 1000, `map was ${estimateTokens(text)} tokens`)
    assert.ok(text.split('\n')[0].includes('/src/main.jsx'))
    assert.ok(text.split('\n')[0].includes('App'))
    // Most-imported file (Widget, in-degree 18) outranks the pages.
    const widgetAt = text.indexOf('Widget.jsx')
    const pageAt = text.indexOf('Page01.jsx')
    assert.ok(widgetAt > 0 && pageAt > 0 && widgetAt < pageAt)
  })

  it('truncation is explicit when the budget cannot hold every file', () => {
    const map = buildCodebaseMap(twentyFiles())
    const text = formatCodebaseMap(map, 120)
    assert.ok(text.includes('[truncated:'))
    assert.ok(estimateTokens(text) <= 140)
  })

  it('annotates a templated render in our vocabulary', () => {
    const files: SourceInput[] = [
      { path: '/src/App.jsx', content: `import PricingGrid from './PricingGrid'\nexport default function App() { return <PricingGrid /> }\n` },
      { path: '/src/PricingGrid.jsx', content: `export default function PricingGrid({ tiers }) { return <div>{tiers}</div> }\n` },
    ]
    const map = buildCodebaseMap(files, [{ name: 'PricingGrid', file: '/src/PricingGrid.jsx', origin: 'catalog', template: 'multi-column-3' }])
    assert.ok(formatCodebaseMap(map).includes('<PricingGrid (template multi-column-3)>'))
  })
})

// ---------- registry ----------

describe('project registry', () => {
  it('bare imported project: components are inferred, props from signatures, no fabricated prose', () => {
    const map = buildCodebaseMap([MAIN, APP, BUTTON, CARD])
    const btn = map.components.find(c => c.name === 'Button')
    assert.equal(btn?.origin, 'inferred')
    assert.equal(btn?.confidence, 'inferred')
    assert.deepEqual(btn?.props, ['variant', 'size', 'disabled'])
    assert.equal(btn?.description, undefined)
    assert.equal(btn?.usedBy, 1)
    assert.deepEqual(btn?.usedByFiles, ['/App.jsx'])
  })

  it('catalog project: declared entries win, deduped by file, carrying origin + confidence', () => {
    const map = buildCodebaseMap([MAIN, APP, BUTTON, CARD], [
      { name: 'Button', file: BUTTON.path, origin: 'catalog', description: 'The catalog button.', props: ['variant'] },
    ])
    const buttons = map.components.filter(c => c.name === 'Button')
    assert.equal(buttons.length, 1)
    assert.equal(buttons[0].origin, 'catalog')
    assert.equal(buttons[0].confidence, 'declared')
    assert.equal(buttons[0].description, 'The catalog button.')
    assert.deepEqual(buttons[0].props, ['variant'])
  })

  it('unparseable components are listed by file only (propsKnown false)', () => {
    const map = buildCodebaseMap([{ path: '/src/Weird.jsx', content: `import { memo } from 'react'\nexport const Weird = memo((props) => <div />)\n` }])
    const w = map.components.find(c => c.name === 'Weird')
    assert.equal(w?.propsKnown, false)
    assert.deepEqual(w?.props, [])
  })

  it('agent contract: an existing button is found for reuse instead of inventing one', () => {
    const map = buildCodebaseMap([MAIN, APP, BUTTON, CARD])
    const hit = findRegistryComponent(map.components, 'use the existing button if there is one')
    assert.equal(hit?.name, 'Button')
    assert.equal(hit?.file, BUTTON.path)
    // The reuse edit's import resolves back to that exact file.
    const set = new Set(map.files.map(f => f.path))
    assert.equal(resolveRelativeImport('/App.jsx', './src/components/ui/button', set), BUTTON.path)
    assert.equal(findRegistryComponent(map.components, 'carousel'), null)
  })
})

describe('registry loader (store)', () => {
  it('shadcn project: components.json is config — installed files under the ui dir are declared shadcn', () => {
    const root = tmpProject({
      'components.json': JSON.stringify({ style: 'new-york', aliases: { ui: '@/components/ui' } }),
      'src/components/ui/button.tsx': BUTTON.content,
      'src/App.jsx': APP.content.replace("./src/components/ui/button", "./components/ui/button"),
    })
    const declared = declaredInputsForRoot(root)
    assert.ok(declared.some(d => d.name === 'Button' && d.origin === 'shadcn'))
    const map = buildMapForRoot(root)
    assert.equal(map.components.find(c => c.name === 'Button')?.origin, 'shadcn')
    assert.equal(map.components.find(c => c.name === 'Button')?.confidence, 'declared')
  })

  it('catalog project: a carried catalog manifest is declared catalog', () => {
    const root = tmpProject({
      'catalog/components.json': JSON.stringify({ version: 1, components: [{ tag: 'Button', sourceFile: 'src/components/ui/button.tsx', description: 'Catalog button.' }] }),
      'src/components/ui/button.tsx': BUTTON.content,
    })
    const map = buildMapForRoot(root)
    const btn = map.components.find(c => c.name === 'Button')
    assert.equal(btn?.origin, 'catalog')
    assert.equal(btn?.description, 'Catalog button.')
  })

  it('bare project on disk: scan finds source + css, everything inferred', () => {
    const root = tmpProject({ 'App.jsx': APP.content, 'main.jsx': MAIN.content, 'src/theme.css': CSS.content, 'src/components/Card.jsx': CARD.content, 'src/components/ui/button.tsx': BUTTON.content })
    assert.equal(scanProject(root).length, 5)
    const map = buildMapForRoot(root)
    assert.ok(map.components.every(c => c.origin === 'inferred'))
    assert.deepEqual(map.styleFiles, ['/src/theme.css'])
  })
})

// ---------- persistence + watcher ----------

describe('map persistence + watcher', () => {
  it('persists to .ai-live/map.json and never touches source files', () => {
    const root = tmpProject({ 'App.jsx': APP.content, 'main.jsx': MAIN.content })
    const before = fs.readFileSync(path.join(root, 'App.jsx'), 'utf-8')
    const map = buildAndPersistMap(root)
    const persisted = readPersistedMap(root)
    assert.equal(persisted?.fileCount, map.fileCount)
    assert.ok(fs.existsSync(path.join(root, '.ai-live/map.json')))
    assert.equal(fs.readFileSync(path.join(root, 'App.jsx'), 'utf-8'), before)
  })

  it('rebuilder debounces to one rebuild and ignores the map file itself', async () => {
    let rebuilds = 0
    const root = tmpProject({ 'App.jsx': APP.content })
    const rebuilder = createMapRebuilder(() => root, 20, () => { rebuilds++ })
    rebuilder.schedule(path.join(root, 'App.jsx'))
    rebuilder.schedule(path.join(root, 'App.jsx'))
    rebuilder.schedule(path.join(root, '.ai-live/map.json'))
    await new Promise(r => setTimeout(r, 70))
    assert.equal(rebuilds, 1)
    rebuilder.dispose()
  })
})

// ---------- adopt + install ----------

describe('adopt + install', () => {
  it('adopt is opt-in: nothing is written until it runs, then entries read back as declared', () => {
    const root = tmpProject({ 'App.jsx': APP.content, 'main.jsx': MAIN.content, 'src/components/Card.jsx': CARD.content, 'src/components/ui/button.tsx': BUTTON.content })
    assert.equal(fs.existsSync(path.join(root, '.ai-live/components.json')), false)
    const result = adoptRegistry(root)
    assert.equal(result.ok, true)
    assert.ok(result.adopted >= 2)
    const map = buildMapForRoot(root)
    assert.ok(map.components.length > 0)
    assert.ok(map.components.every(c => c.confidence === 'declared'))
  })

  it('install puts a catalog component alongside project components and never replaces', () => {
    const root = tmpProject({ 'App.jsx': APP.content, 'main.jsx': MAIN.content, 'src/components/Card.jsx': CARD.content })
    const first = installCatalogComponent('Button', root)
    assert.equal(first.ok, true)
    assert.equal(first.dest, '/src/components/ui/button.tsx')
    assert.ok(fs.existsSync(path.join(root, 'src/components/ui/button.tsx')))
    const map = buildMapForRoot(root)
    const btn = map.components.find(c => c.name === 'Button')
    assert.equal(btn?.origin, 'catalog')
    assert.equal(btn?.confidence, 'declared')
    // The project's own Card is untouched and still present.
    assert.ok(map.components.some(c => c.name === 'Card'))
    const second = installCatalogComponent('Button', root)
    assert.equal(second.ok, false)
    assert.match(second.error || '', /never replaces|Already present/)
  })

  it('install refuses a component that is not vendored in the repo', () => {
    const root = tmpProject({ 'App.jsx': APP.content })
    const result = installCatalogComponent('noct-app-settings', root)
    assert.equal(result.ok, false)
  })
})

// ---------- Rung 2 injection ----------

describe('Rung 2 injection', () => {
  it('stays silent below the threshold and injects above it', () => {
    const small = buildCodebaseMap([MAIN, APP, BUTTON, CARD])
    assert.ok(small.fileCount < MAP_INJECTION_THRESHOLD)
    assert.equal(mapInjectionText(small), null)
    const big = buildCodebaseMap(twentyFiles())
    const text = mapInjectionText(big)
    assert.ok(text)
    assert.ok(text!.includes('Codebase map'))
    assert.ok(estimateTokens(text!) <= 900)
  })
})
