import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addEdge, addNode, configuresFor, createFeatureGraph, featureGraphSummary,
  getFeatureGraph, graphRollup, prerequisites, renderFeatureMarkdown,
  saveFeatureGraph, setNodeStatus, subtree,
} from './features.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'features-test-'))
}

/** A small store graph: Storefront region + Engine region, a Currency
 * setting configuring prices, Checkout depending on Payments + Cart. */
function storeGraph(root: string) {
  const graph = createFeatureGraph('Store app', root)
  const storefront = addNode(graph, { name: 'Storefront', kind: 'region' })
  const engine = addNode(graph, { name: 'Engine', kind: 'region' })
  const prices = addNode(graph, { name: 'Price display', kind: 'feature', parent: storefront.id, status: 'done' })
  const cart = addNode(graph, { name: 'Cart', kind: 'feature', parent: engine.id, status: 'verified' })
  const payments = addNode(graph, { name: 'Payments', kind: 'service', parent: engine.id, status: 'building' })
  const checkout = addNode(graph, { name: 'Checkout', kind: 'screen', parent: engine.id })
  const currency = addNode(graph, {
    name: 'Currency', kind: 'setting', parent: storefront.id, status: 'done',
    params: [{ name: 'currency', type: 'choice', options: ['USD', 'EUR'], default: 'USD' }],
  })
  addEdge(graph, { from: currency.id, to: prices.id, type: 'configures' })
  addEdge(graph, { from: checkout.id, to: payments.id, type: 'depends-on' })
  addEdge(graph, { from: checkout.id, to: cart.id, type: 'depends-on' })
  saveFeatureGraph(graph, root)
  return { graph, storefront, engine, prices, cart, payments, checkout, currency }
}

test('create → graph.json + graph.md on disk; create is idempotent', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('Store app', root)
  assert.ok(fs.existsSync(path.join(root, 'ai-features/graph.json')))
  assert.ok(fs.existsSync(path.join(root, 'ai-features/graph.md')))
  assert.equal(createFeatureGraph('Other title', root).title, 'Store app')
  assert.equal(getFeatureGraph(root)?.title, graph.title)
  assert.equal(getFeatureGraph(tmpRoot()), null)
})

test('rollup counts leaves only: regions and dropped nodes excluded, done+verified built', () => {
  const root = tmpRoot()
  const { graph, engine } = storeGraph(root)
  const { overall, regions } = graphRollup(graph)
  // Counted: Price display (done), Cart (verified), Payments (building),
  // Checkout (proposed), Currency (done) = 5; built = 3.
  assert.equal(overall.total, 5)
  assert.equal(overall.built, 3)
  assert.equal(overall.pct, 60)
  const engineRollup = regions.find(r => r.node.id === engine.id)!.rollup
  assert.equal(engineRollup.total, 3)
  assert.equal(engineRollup.built, 1)
  setNodeStatus(graph, engine.id, 'done')
  assert.equal(graphRollup(graph).overall.total, 5, 'region status never enters the count')
})

test('edges refuse duplicates, self-links and missing endpoints', () => {
  const root = tmpRoot()
  const { graph, checkout, cart } = storeGraph(root)
  assert.equal(addEdge(graph, { from: checkout.id, to: cart.id, type: 'depends-on' }), false, 'duplicate')
  assert.equal(addEdge(graph, { from: checkout.id, to: checkout.id, type: 'depends-on' }), false, 'self-link')
  assert.equal(addEdge(graph, { from: checkout.id, to: 'f-missing', type: 'depends-on' }), false, 'missing endpoint')
  assert.equal(addEdge(graph, { from: checkout.id, to: cart.id, type: 'data-flows' }), true, 'same pair, different type is a different edge')
})

test('configures query reads both directions', () => {
  const root = tmpRoot()
  const { graph, currency, prices } = storeGraph(root)
  assert.deepEqual(configuresFor(graph, currency.id).configures.map(n => n.id), [prices.id])
  assert.deepEqual(configuresFor(graph, prices.id).configuredBy.map(n => n.id), [currency.id])
  assert.equal(configuresFor(graph, currency.id).configuredBy.length, 0)
})

test('prerequisites are transitive and ordered dependencies-first', () => {
  const root = tmpRoot()
  const { graph, checkout, payments, cart } = storeGraph(root)
  const shipping = addNode(graph, { name: 'Shipping', kind: 'feature', parent: checkout.parent })
  addEdge(graph, { from: payments.id, to: shipping.id, type: 'depends-on' })
  const prereqs = prerequisites(graph, checkout.id)
  const ids = prereqs.map(n => n.id)
  assert.ok(ids.includes(cart.id) && ids.includes(payments.id) && ids.includes(shipping.id))
  assert.ok(ids.indexOf(shipping.id) < ids.indexOf(payments.id), 'shipping (a dependency of payments) comes first')
  assert.equal(prerequisites(graph, cart.id).length, 0)
})

test('subtree follows containment; the markdown view renders tree, edges and rollup', () => {
  const root = tmpRoot()
  const { graph, engine } = storeGraph(root)
  assert.equal(subtree(graph, engine.id).length, 4, 'region + its three children')
  const md = renderFeatureMarkdown(graph)
  assert.match(md, /# Feature graph: Store app/)
  assert.match(md, /Checkout/)
  assert.match(md, /Currency —configures→ Price display/)
  assert.match(md, /Progress by region/)
  assert.match(featureGraphSummary(graph), /FEATURE GRAPH "Store app" — 5 features, 60% built/)
})

test('status changes persist through save + reload', () => {
  const root = tmpRoot()
  const { graph, checkout } = storeGraph(root)
  setNodeStatus(graph, checkout.id, 'blocked')
  saveFeatureGraph(graph, root)
  const reloaded = getFeatureGraph(root)!
  assert.equal(reloaded.nodes.find(n => n.id === checkout.id)?.status, 'blocked')
  assert.equal(graphRollup(reloaded).overall.blocked, 1)
})
