import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getTemplate, loadTemplates, placeTemplate, templateSummary } from './templates.js'
import { readPersistedMap } from '../codebaseMap/mapStore.js'

test('the templates manifest ships three named arrangements with sources on disk', () => {
  const file = loadTemplates()
  assert.equal(file.templates.length, 3)
  const ids = file.templates.map(t => t.id)
  assert.deepEqual(ids.sort(), ['hero-module', 'multi-column-3', 'pricing-section'])
  for (const t of file.templates) {
    assert.ok(fs.existsSync(path.join(process.cwd(), 'catalog', 'templates', t.sourceFile)), `${t.id} source exists`)
    assert.ok(t.target.startsWith('/src/'), `${t.id} target is a project path`)
  }
  assert.equal(getTemplate('multi-column-3')?.kind, 'multi-column')
  assert.ok(templateSummary(file).includes('place-template'))
})

test('placeTemplate writes once, never replaces, and the map picks the file up', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'main.jsx'), "import App from './App.jsx'\n")
  fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'export default function App() { return null }\n')
  const placed = placeTemplate('pricing-section', root)
  assert.equal(placed.ok, true)
  assert.equal(placed.dest, '/src/sections/PricingSection.jsx')
  const written = fs.readFileSync(path.join(root, 'src', 'sections', 'PricingSection.jsx'), 'utf-8')
  assert.ok(written.includes('PLANS'))
  assert.ok(written.includes('export default function PricingSection'))
  const again = placeTemplate('pricing-section', root)
  assert.equal(again.ok, false, 'placing never replaces a project file')
  assert.equal(placeTemplate('nope', root).ok, false)
  const map = readPersistedMap(root)
  assert.ok(map, 'map persisted after placement')
  assert.ok(map!.components.some(c => c.name === 'PricingSection'), 'placed component is in the project map')
})

test('template sources are self-contained sections with editable constants', () => {
  for (const id of ['hero-module', 'multi-column-3', 'pricing-section']) {
    const t = getTemplate(id)!
    const src = fs.readFileSync(path.join(process.cwd(), 'catalog', 'templates', t.sourceFile), 'utf-8')
    assert.ok(src.includes('export default function'), `${id} exports a component`)
    assert.ok(/const [A-Z_]+ =/.test(src), `${id} carries top-of-file constants to str-replace`)
    assert.ok(!src.includes('from \'cn\'') && !src.includes('class-variance-authority'), `${id} has no package dependencies`)
  }
})
