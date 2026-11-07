import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPack, loadPacks, packSummary, packSummaryLine, searchPacks, validatePack,
} from './packs.js'

test('the shipped manifest loads the four starter packs, each structurally valid', () => {
  const file = loadPacks()
  assert.deepEqual(
    file.packs.map(p => p.id).sort(),
    ['admin-configuration', 'auth', 'printing', 'settings'],
  )
  for (const pack of file.packs) {
    assert.deepEqual(validatePack(pack), [], `${pack.id}: ${validatePack(pack).join('; ')}`)
    assert.ok(pack.nodes.length >= 5, `${pack.id} is a real subgraph, not a stub`)
    assert.ok(pack.externalLinks.length >= 1, `${pack.id} reaches into the host app`)
  }
})

test('the ladder is recorded: admin and settings shells derive from master-detail', () => {
  for (const id of ['admin-configuration', 'settings']) {
    const pack = getPack(id)!
    const shell = pack.nodes.find(n => n.kind === 'screen')!
    assert.equal(shell.derivedFrom, 'master-detail', id)
  }
  const admin = getPack('admin-configuration')!
  const currency = admin.nodes.find(n => n.localId === 'currency')!
  assert.equal(currency.kind, 'setting')
  assert.ok(currency.params?.some(p => p.name === 'currency' && p.type === 'choice'))
})

test('summaries are tier-1 sized: one-liner, counts, configures roles only', () => {
  const summary = packSummary(getPack('admin-configuration')!)
  assert.equal(summary.nodes, 6)
  assert.equal(summary.settings, 5)
  assert.ok(summary.description.length <= 121)
  assert.ok(summary.configures.includes('price display and checkout totals'))
  assert.ok(!('edges' in summary) && !('externalLinks' in summary), 'no full-pack fields leak into tier 1')
})

test('search ranks whole features by id, name, node names, then description', () => {
  assert.equal(searchPacks('admin configuration')[0]?.id, 'admin-configuration')
  assert.equal(searchPacks('print preview')[0]?.id, 'printing')
  assert.equal(searchPacks('sign in')[0]?.id, 'auth')
  const settingsHits = searchPacks('settings').map(s => s.id)
  assert.ok(settingsHits.includes('settings') && settingsHits.includes('admin-configuration'))
  assert.deepEqual(searchPacks('xqzwkj'), [])
  assert.deepEqual(searchPacks('button dialog form table input select'), [], 'piece words do not summon packs')
})

test('validatePack catches dangling references in a hand-authored pack', () => {
  const broken = {
    id: 'broken', name: 'Broken', description: 'x',
    nodes: [
      { localId: 'a', name: 'A', kind: 'feature' as const },
      { localId: 'a', name: 'A again', kind: 'feature' as const },
      { localId: 'b', name: 'B', kind: 'feature' as const, parent: 'ghost' },
    ],
    edges: [{ from: 'a', to: 'ghost', type: 'depends-on' as const }],
    externalLinks: [{ from: 'ghost', type: 'configures' as const, role: 'things', match: 'thing' }],
  }
  const problems = validatePack(broken)
  assert.ok(problems.some(p => p.includes('duplicate localId a')))
  assert.ok(problems.some(p => p.includes('parent ghost')))
  assert.ok(problems.some(p => p.includes('edge to unknown node ghost')))
  assert.ok(problems.some(p => p.includes('external link from unknown node ghost')))
})

test('the brief line names every pack with its size', () => {
  const line = packSummaryLine()
  for (const id of ['admin-configuration', 'settings', 'printing', 'auth']) {
    assert.ok(line.includes(id), id)
  }
  assert.match(line, /tier 3/)
})
