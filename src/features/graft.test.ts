import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addEdge, addNode, createFeatureGraph, getFeatureGraph, getNode, graphRollup, removeNode, saveFeatureGraph } from './features.js'
import { graftPack, type GraftResult, uninstallPack, resolvePendingLinks } from './graft.js'

/** Narrow a graft result to its success variant or fail the test. */
function mustOk(result: GraftResult): Extract<GraftResult, { ok: true }> {
  if (result.ok === false) throw new Error(`graft refused: ${result.error}`)
  return result
}
import { getPack, type FeaturePack } from '../catalog/packs.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graft-test-'))
}

/** A small host graph: two storefront/engine features and a document. */
function hostGraph(root: string) {
  const graph = createFeatureGraph('Store app', root)
  const prices = addNode(graph, { name: 'Price display', kind: 'feature', status: 'done' })
  const checkout = addNode(graph, { name: 'Checkout', kind: 'screen', status: 'building' })
  const invoice = addNode(graph, { name: 'Invoice document', kind: 'data' })
  saveFeatureGraph(graph, root)
  return { graph, prices, checkout, invoice }
}

test('admin grafts into a store graph: nodes land bound + proposed, configures links wire by name match', () => {
  const root = tmpRoot()
  const { graph, prices, checkout } = hostGraph(root)
  const result = mustOk(graftPack(graph, getPack('admin-configuration')!))
  assert.equal(result.added.length, 6)
  assert.ok(result.added.every(n => n.pack === 'admin-configuration' && n.status === 'proposed'))
  const shell = result.added.find(n => n.name === 'Admin shell')!
  assert.ok(result.added.filter(n => n.kind === 'setting').every(n => n.parent === shell.id), 'sections nest under the remapped shell')
  assert.equal(result.internalEdges, 5, 'shell renders its five sections')
  const wiredPairs = result.wired.map(w => `${w.fromName}→${w.toName}`)
  assert.ok(wiredPairs.includes('Currency & pricing→Price display'), wiredPairs.join(', '))
  assert.ok(wiredPairs.includes('Currency & pricing→Checkout'), 'one setting configures several host features')
  assert.ok(wiredPairs.includes('Payment providers→Checkout'))
  assert.ok(wiredPairs.includes('Shipping zones→Checkout'))
  assert.ok(wiredPairs.includes('Store identity→Invoice document'), 'the identity settings reach receipts/invoices')
  const unwiredRoles = result.unwired.map(l => l.role)
  assert.deepEqual(unwiredRoles, ['storefront appearance'], 'unmatched links are reported, not dropped')
  assert.equal(graphRollup(graph).overall.total, 3 + 6, 'grafted leaves join the rollup')
  assert.ok(prices.id !== checkout.id)
})

test('a second graft of the same pack is refused and changes nothing', () => {
  const root = tmpRoot()
  const { graph } = hostGraph(root)
  assert.equal(graftPack(graph, getPack('settings')!).ok, true)
  const count = graph.nodes.length
  const again = graftPack(graph, getPack('settings')!)
  assert.equal(again.ok, false)
  if (again.ok === false) assert.match(again.error, /already installed/)
  assert.equal(graph.nodes.length, count)
})

test('unknown parent refuses before any node lands', () => {
  const root = tmpRoot()
  const { graph } = hostGraph(root)
  const result = graftPack(graph, getPack('auth')!, { parentId: 'f-missing' })
  assert.equal(result.ok, false)
  assert.equal(graph.nodes.length, 3)
})

test('roots attach under a given parent; build order puts the session service first', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('App', root)
  const region = addNode(graph, { name: 'Platform', kind: 'region' })
  const result = mustOk(graftPack(graph, getPack('auth')!, { parentId: region.id }))
  assert.ok(result.added.every(n => n.parent === region.id), 'auth has no internal containment: every root nests under the region')
  const order = result.buildOrder.map(n => n.name)
  assert.ok(order.indexOf('Session service') < order.indexOf('Sign-in screen'))
  assert.ok(order.indexOf('Session service') < order.indexOf('Password reset flow'))
})

test("printing's inbound link wires host → pack: the document flows into the print service's data node", () => {
  const root = tmpRoot()
  const { graph, invoice } = hostGraph(root)
  const result = mustOk(graftPack(graph, getPack('printing')!))
  const docdata = result.added.find(n => n.name === 'Document content')!
  const inbound = result.wired.find(w => w.role === "the app's documents and reports")
  assert.equal(inbound?.from, invoice.id)
  assert.equal(inbound?.to, docdata.id)
  assert.equal(inbound?.type, 'data-flows')
  const setup = result.added.find(n => n.name === 'Page setup')!
  const outbound = result.wired.find(w => w.role === 'printed output of documents')
  assert.equal(outbound?.from, setup.id)
  assert.equal(outbound?.to, invoice.id)
})

test('a malformed pack is refused whole — no partial graft', () => {
  const root = tmpRoot()
  const { graph } = hostGraph(root)
  const broken: FeaturePack = {
    id: 'broken', name: 'Broken', description: 'x',
    nodes: [
      { localId: 'a', name: 'A', kind: 'feature' },
      { localId: 'b', name: 'B', kind: 'feature', parent: 'ghost' },
    ],
    edges: [],
    externalLinks: [],
  }
  const result = graftPack(graph, broken)
  assert.equal(result.ok, false)
  assert.equal(graph.nodes.length, 3, 'nothing landed')
  assert.equal(getFeatureGraph(root)?.nodes.length, 3)
})

test('grafted setting nodes arrive with values seeded from their defaults', () => {
  const root = tmpRoot()
  const { graph } = hostGraph(root)
  const pack = getPack('admin-configuration')!
  mustOk(graftPack(graph, pack))
  const currency = graph.nodes.find(n => n.name === 'Currency & pricing')!
  assert.deepEqual(currency.values, { currency: 'USD', 'tax-inclusive-prices': 'false' })
  const brand = graph.nodes.find(n => n.name === 'Brand')!
  assert.deepEqual(brand.values, { 'brand-color': '#3366cc' })
  const identity = graph.nodes.find(n => n.name === 'Store identity')!
  assert.deepEqual(identity.values, { 'store-name': 'My Store' }, 'params without defaults stay unset')
})

test('uninstall removes the pack, lifts host children, refuses a pack that is not installed', () => {
  const root = tmpRoot()
  const { graph } = hostGraph(root)
  const before = graph.nodes.length
  mustOk(graftPack(graph, getPack('admin-configuration')!))
  assert.equal(graph.nodes.length, before + 6)

  // A host node parented under the pack shell must survive, lifted out.
  const shell = graph.nodes.find(n => n.pack === 'admin-configuration' && n.kind === 'screen')!
  const hostChild = addNode(graph, { name: 'Store policies', kind: 'feature', parent: shell.id })
  addEdge(graph, { from: hostChild.id, to: shell.id, type: 'depends-on' })

  const result = uninstallPack(graph, 'admin-configuration')
  assert.equal(result.ok, true)
  assert.equal(result.removed.length, 6)
  assert.equal(result.lifted, 1)
  assert.equal(graph.nodes.length, before + 1)
  assert.equal(getNode(graph, hostChild.id)?.parent, undefined, 'host child lifted to top level')
  assert.ok(!graph.edges.some(e => e.to === shell.id || e.from === shell.id), 'edges touching removed nodes are gone')
  assert.ok(!graph.nodes.some(n => n.pack === 'admin-configuration'))

  const refused = uninstallPack(graph, 'admin-configuration')
  assert.equal(refused.ok, false)
  assert.match(refused.ok === false ? refused.error : '', /not installed/)
})

test('pending links: an unmatched graft link is recorded on the graph and wires itself when a matching node appears', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('Bare app', root)
  addNode(graph, { name: 'Dashboard', kind: 'screen' })
  const result = mustOk(graftPack(graph, getPack('printing')!))
  assert.equal(result.unwired.length, 2)
  assert.equal(graph.pendingLinks?.length, 2, 'both links persisted, not just reported')
  saveFeatureGraph(graph, root)
  assert.equal(getFeatureGraph(root)?.pendingLinks?.length, 2, 'pending links survive a save/load round trip')
  const inbound = graph.pendingLinks!.find(l => l.direction === 'in')!
  assert.equal(inbound.pack, 'printing')
  assert.equal(getNode(graph, inbound.from)?.name, 'Document content')

  // Nothing matches yet — resolution is a no-op.
  const other = addNode(graph, { name: 'Settings', kind: 'feature' })
  assert.deepEqual(resolvePendingLinks(graph, [other]), [])
  assert.equal(graph.pendingLinks?.length, 2)

  // The matching node appears: both links wire, records clear.
  const invoice = addNode(graph, { name: 'Invoice list', kind: 'data' })
  const resolved = resolvePendingLinks(graph, [invoice])
  assert.equal(resolved.length, 2)
  assert.equal(graph.pendingLinks?.length, 0)
  assert.ok(graph.edges.some(e => e.from === invoice.id && e.to === inbound.from && e.type === 'data-flows'),
    'the inbound link points host → pack, as declared')
  const setup = graph.nodes.find(n => n.name === 'Page setup')!
  assert.ok(graph.edges.some(e => e.from === setup.id && e.to === invoice.id && e.type === 'configures'))
})

test("a later graft's nodes can satisfy an earlier pack's pending links — never its own", () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('Bare app', root)
  mustOk(graftPack(graph, getPack('printing')!))
  assert.equal(graph.pendingLinks?.length, 2)

  const docs: FeaturePack = {
    id: 'docs', name: 'Docs', description: 'x',
    nodes: [{ localId: 'inv', name: 'Invoice document', kind: 'data' }],
    edges: [],
    externalLinks: [{ from: 'inv', type: 'configures', role: 'doc settings', match: 'invoice' }],
  }
  const result = mustOk(graftPack(graph, docs))
  assert.equal(result.resolvedLinks.length, 2, "printing's pendings wired to the new invoice node")
  assert.equal(graph.pendingLinks?.length, 1, "only the docs pack's own fresh pending remains")
  assert.equal(graph.pendingLinks![0].pack, 'docs')
})

test('uninstall clears the pack pending links; removing a node drops pendings that pointed from it', () => {
  const root = tmpRoot()
  const graph = createFeatureGraph('Bare app', root)
  mustOk(graftPack(graph, getPack('printing')!))
  assert.equal(graph.pendingLinks?.length, 2)
  const un = uninstallPack(graph, 'printing')
  assert.equal(un.ok, true)
  assert.equal(graph.pendingLinks?.length ?? 0, 0)

  const root2 = tmpRoot()
  const g2 = createFeatureGraph('Bare app', root2)
  mustOk(graftPack(g2, getPack('printing')!))
  const docNode = g2.nodes.find(n => n.name === 'Document content')!
  removeNode(g2, docNode.id, 'cascade')
  assert.equal(g2.pendingLinks?.length, 1, 'the data-flows pending died with its endpoint; the configures one remains')
  assert.equal(g2.pendingLinks![0].type, 'configures')
})
