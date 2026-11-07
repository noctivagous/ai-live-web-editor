import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addEdge, addNode, configuresFor, createFeatureGraph, effectiveValues,
  featureGraphSummary, getFeatureGraph, getNode, graphRollup, lintGraph,
  nodeSummary, prerequisites, removeEdge, removeNode, renameNode,
  renderFeatureMarkdown, reparentNode, saveFeatureGraph, seedValues,
  setNodeParam, setNodeStatus, subtree, validateParamValue,
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

test('parameter values: validation per type, seeding from defaults, effective overlay', () => {
  const root = tmpRoot()
  const { graph, currency } = storeGraph(root)
  const choice = currency.params![0]
  assert.equal(validateParamValue(choice, 'EUR'), null)
  assert.match(validateParamValue(choice, 'JPY')!, /not one of/)
  assert.equal(validateParamValue({ name: 'b', type: 'boolean' }, 'true'), null)
  assert.match(validateParamValue({ name: 'b', type: 'boolean' }, 'yes')!, /true/)
  assert.equal(validateParamValue({ name: 'n', type: 'number' }, '3.5'), null)
  assert.match(validateParamValue({ name: 'n', type: 'number' }, 'abc')!, /not a number/)
  assert.equal(validateParamValue({ name: 'c', type: 'color' }, '#a1b2c3'), null)
  assert.match(validateParamValue({ name: 'c', type: 'color' }, 'red')!, /hex color/)

  // setNodeParam refuses bad values and unknown params/nodes, sets good ones.
  assert.match(setNodeParam(graph, currency.id, 'currency', 'JPY')!, /not one of/)
  assert.equal(setNodeParam(graph, currency.id, 'currency', 'EUR'), null)
  assert.equal(currency.values?.currency, 'EUR')
  assert.match(setNodeParam(graph, currency.id, 'nope', 'x')!, /no parameter/)
  assert.match(setNodeParam(graph, 'missing', 'currency', 'EUR')!, /No node/)
  // The summary shows the effective value; markdown renders it.
  assert.equal(nodeSummary(currency).params?.[0].value, 'EUR')
  assert.match(renderFeatureMarkdown(graph), /currency: choice = EUR/)

  // Seeding fills only unset defaults.
  const fresh = addNode(graph, {
    name: 'Tax', kind: 'setting',
    params: [
      { name: 'rate', type: 'number', default: '20' },
      { name: 'label', type: 'text' },
    ],
  })
  assert.equal(seedValues(fresh), 1)
  assert.deepEqual(effectiveValues(fresh), { rate: '20' })
  assert.equal(seedValues(fresh), 0)
})

test('editing: rename, reparent with cycle refusals, remove lift vs cascade, unlink', () => {
  const root = tmpRoot()
  const { graph, storefront, engine, prices, cart, checkout } = storeGraph(root)

  assert.equal(renameNode(graph, prices.id, 'Price board'), true)
  assert.equal(getNode(graph, prices.id)?.name, 'Price board')
  assert.equal(renameNode(graph, 'missing', 'X'), false)
  assert.equal(renameNode(graph, prices.id, '  '), false)

  // Reparent Cart from Engine to Storefront; cycle attempts refused.
  assert.equal(reparentNode(graph, cart.id, storefront.id), null)
  assert.equal(getNode(graph, cart.id)?.parent, storefront.id)
  assert.match(reparentNode(graph, storefront.id, cart.id)!, /containment cycle/)
  assert.match(reparentNode(graph, storefront.id, storefront.id)!, /containment cycle/)
  assert.match(reparentNode(graph, cart.id, 'missing')!, /No node with id/)
  assert.equal(reparentNode(graph, cart.id, undefined), null)
  assert.equal(getNode(graph, cart.id)?.parent, undefined)

  // Unlink: the configures edge exists in the fixture (currency → prices).
  const currency = graph.nodes.find(n => n.name === 'Currency')!
  assert.equal(removeEdge(graph, { from: currency.id, to: prices.id, type: 'configures' }), true)
  assert.equal(removeEdge(graph, { from: currency.id, to: prices.id, type: 'configures' }), false)

  // Lift: removing Engine lifts Checkout (its only remaining child here) to top level.
  const lifted = removeNode(graph, engine.id, 'lift')!
  assert.deepEqual(lifted.removed.map(n => n.id), [engine.id])
  assert.equal(lifted.lifted, 2) // Checkout + Payments were Engine's children (Cart was moved out)
  assert.equal(getNode(graph, checkout.id)?.parent, undefined)
  assert.ok(getNode(graph, checkout.id), 'lifted child survives')

  // Cascade on a fresh graph removes the subtree and its edges.
  const root2 = tmpRoot()
  const g2 = storeGraph(root2)
  const cascaded = removeNode(g2.graph, g2.engine.id, 'cascade')!
  assert.equal(cascaded.removed.length, 4) // Engine, Cart, Payments, Checkout
  assert.equal(getNode(g2.graph, g2.checkout.id), null)
  assert.equal(g2.graph.edges.length, 1, 'only the configures edge outside the subtree survives')
  assert.equal(removeNode(g2.graph, 'missing', 'lift'), null)
})

test('lint: clean graph passes; each planted defect is reported; walks survive a parent cycle', () => {
  const root = tmpRoot()
  const { graph, storefront, prices, checkout, currency } = storeGraph(root)
  assert.deepEqual(lintGraph(graph), [])

  // Plant defects the way a hand edit could.
  prices.parent = 'f-missing'
  graph.nodes.push({ ...currency, id: currency.id, name: 'Currency clone' }) // duplicate id
  const broken = graph.nodes.find(n => n.name === 'Checkout')!
  broken.kind = 'widget' as typeof broken.kind
  broken.values = { nope: '1' }
  currency.values = { currency: 'BTC' } // off-schema value
  graph.edges.push({ from: checkout.id, to: 'f-gone', type: 'renders' })
  graph.edges.push({ from: checkout.id, to: prices.id, type: 'depends-on' })
  graph.edges.push({ from: prices.id, to: checkout.id, type: 'depends-on' })
  graph.edges.push({ from: prices.id, to: checkout.id, type: 'depends-on' }) // duplicate edge

  const kinds = lintGraph(graph).map(p => p.kind)
  for (const kind of ['duplicate-id', 'unknown-kind', 'dangling-parent', 'dangling-edge', 'duplicate-edge', 'depends-on-cycle', 'orphan-value', 'invalid-value'] as const) {
    assert.ok(kinds.includes(kind), `lint reports ${kind} (got: ${kinds.join(', ')})`)
  }

  // A containment cycle is reported — and the walks terminate.
  prices.parent = storefront.id
  storefront.parent = prices.id
  const cycleKinds = lintGraph(graph).map(p => p.kind)
  assert.ok(cycleKinds.includes('parent-cycle'), `lint reports parent-cycle (got: ${cycleKinds.join(', ')})`)
  assert.ok(subtree(graph, storefront.id).length >= 2, 'subtree terminates on a cycled graph')
  assert.match(renderFeatureMarkdown(graph), /Feature graph/, 'markdown render terminates on a cycled graph')
})
