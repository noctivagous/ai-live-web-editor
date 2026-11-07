import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addNode, createFeatureGraph, setNodeStatus } from './features.js'
import { buildNode, writeNodeConfig } from './buildNode.js'
import { reconcileGraph } from './reconcile.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'))
}

test('drift: a done node whose bindings are missing from the project is reported, binding by binding', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  const btn = addNode(graph, { name: 'Save button', kind: 'component', component: 'Button', status: 'done' })
  const page = addNode(graph, { name: 'Pricing', kind: 'screen', template: 'pricing-section', status: 'verified' })
  const settings = addNode(graph, {
    name: 'Currency & pricing', kind: 'setting', status: 'done',
    params: [{ name: 'currency', type: 'choice', options: ['USD', 'EUR'], default: 'USD' }],
  })
  void btn; void page; void settings

  const first = reconcileGraph(graph, root)
  assert.equal(first.checked, 3)
  assert.equal(first.drift.length, 3)
  assert.deepEqual(first.drift.map(d => d.binding).sort(), ['component Button', 'parameters', 'template pricing-section'])

  // Build the nodes out for real; the drift clears piece by piece.
  buildNode(graph, btn.id, root)
  buildNode(graph, page.id, root)
  writeNodeConfig(settings, root)
  const after = reconcileGraph(graph, root)
  assert.equal(after.checked, 3)
  assert.deepEqual(after.drift, [])
})

test('only done/verified nodes are checked — proposed bindings are intent, not drift', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  addNode(graph, { name: 'Future button', kind: 'component', component: 'Button' }) // proposed
  const building = addNode(graph, { name: 'WIP', kind: 'screen', template: 'pricing-section', status: 'building' })
  void building
  const result = reconcileGraph(graph, root)
  assert.equal(result.checked, 0)
  assert.deepEqual(result.drift, [])

  // A done node with no bindings at all cannot drift checkably.
  addNode(graph, { name: 'Plain feature', kind: 'feature', status: 'done' })
  assert.equal(reconcileGraph(graph, root).checked, 0)
})

test('a non-catalog component binding reconciles against the codebase map by name', () => {
  const root = tmpRoot()
  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true })
  const graph = createFeatureGraph('App', root)
  const widget = addNode(graph, { name: 'Widget', kind: 'component', component: 'Widget', status: 'done' })

  const missing = reconcileGraph(graph, root)
  assert.equal(missing.drift.length, 1)
  assert.match(missing.drift[0].problem, /codebase map finds no component named Widget/)

  fs.writeFileSync(
    path.join(root, 'src/components/Widget.tsx'),
    'export function Widget() {\n  return null\n}\n',
  )
  const found = reconcileGraph(graph, root)
  assert.deepEqual(found.drift, [])
  void widget
})

test('a deleted config file is drift even when the node was honestly built', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  const settings = addNode(graph, {
    name: 'Brand', kind: 'setting',
    params: [{ name: 'brand-color', type: 'color', default: '#3366cc' }],
  })
  buildNode(graph, settings.id, root)
  setNodeStatus(graph, settings.id, 'done')
  assert.deepEqual(reconcileGraph(graph, root).drift, [])
  fs.rmSync(path.join(root, 'src/config/brand.json'))
  const drifted = reconcileGraph(graph, root)
  assert.equal(drifted.drift.length, 1)
  assert.match(drifted.drift[0].problem, /src\/config\/brand\.json/)
})
