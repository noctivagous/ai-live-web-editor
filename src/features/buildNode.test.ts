import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addNode, createFeatureGraph, getNode } from './features.js'
import { buildNode, writeNodeConfig } from './buildNode.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'buildnode-test-'))
}

function mustBuild(result: ReturnType<typeof buildNode>): Extract<ReturnType<typeof buildNode>, { ok: true }> {
  if (result.ok === false) throw new Error(result.error)
  return result
}

test('build places a component binding, flips status to building, and is idempotent', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  const node = addNode(graph, { name: 'Save button', kind: 'component', component: 'Button' })

  const first = mustBuild(buildNode(graph, node.id, root))
  assert.equal(first.component?.state, 'placed')
  assert.ok(fs.existsSync(path.join(root, 'src/components/ui/button.tsx')))
  assert.equal(getNode(graph, node.id)?.status, 'building')

  const second = mustBuild(buildNode(graph, node.id, root))
  assert.equal(second.component?.state, 'already')
})

test('build places a template binding; an unknown component reports error without failing the build', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  const tpl = addNode(graph, { name: 'Pricing', kind: 'screen', template: 'pricing-section' })
  const placed = mustBuild(buildNode(graph, tpl.id, root))
  assert.equal(placed.template?.state, 'placed')
  assert.equal(placed.template?.dest, '/src/sections/PricingSection.jsx')
  assert.ok(fs.existsSync(path.join(root, 'src/sections/PricingSection.jsx')))
  assert.equal(mustBuild(buildNode(graph, tpl.id, root)).template?.state, 'already')

  const bad = addNode(graph, { name: 'Mystery', kind: 'component', component: 'NoSuchThing' })
  const report = mustBuild(buildNode(graph, bad.id, root))
  assert.equal(report.component?.state, 'error')
  assert.match(report.component?.error ?? '', /No catalog component/)
})

test('build seeds values and writes the config file the app reads; set values win over defaults', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  const node = addNode(graph, {
    name: 'Currency & pricing', kind: 'setting',
    params: [
      { name: 'currency', type: 'choice', options: ['USD', 'EUR'], default: 'USD' },
      { name: 'tax-inclusive-prices', type: 'boolean', default: 'false' },
    ],
  })
  const report = mustBuild(buildNode(graph, node.id, root))
  assert.equal(report.valuesSeeded, 2)
  assert.equal(report.configFile, '/src/config/currency-pricing.json')
  const written = JSON.parse(fs.readFileSync(path.join(root, 'src/config/currency-pricing.json'), 'utf-8'))
  assert.deepEqual(written, { currency: 'USD', 'tax-inclusive-prices': 'false' })

  // A later set value is what the next config write carries.
  getNode(graph, node.id)!.values = { currency: 'EUR' }
  writeNodeConfig(getNode(graph, node.id)!, root)
  const rewritten = JSON.parse(fs.readFileSync(path.join(root, 'src/config/currency-pricing.json'), 'utf-8'))
  assert.deepEqual(rewritten, { currency: 'EUR', 'tax-inclusive-prices': 'false' })
})

test('build refuses an unknown node; nodes without bindings build to a status flip only', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  const missing = buildNode(graph, 'nope', root)
  assert.equal(missing.ok, false)

  const plain = addNode(graph, { name: 'Search', kind: 'feature', status: 'planned' })
  const report = mustBuild(buildNode(graph, plain.id, root))
  assert.equal(report.component, undefined)
  assert.equal(report.template, undefined)
  assert.equal(report.configFile, undefined)
  assert.equal(report.valuesSeeded, 0)
  assert.equal(getNode(graph, plain.id)?.status, 'building')
  // A done node is not dragged back to building.
  const done = addNode(graph, { name: 'Old', kind: 'feature', status: 'done' })
  mustBuild(buildNode(graph, done.id, root))
  assert.equal(getNode(graph, done.id)?.status, 'done')
})
