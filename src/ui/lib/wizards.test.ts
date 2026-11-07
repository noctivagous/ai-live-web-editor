import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { STUB_REASON, WIZARD_FACETS, WIZARDS, quickAddPrompt, wizardsForFacet } from './wizards.js'
import type { PackSummaryItem } from './api.js'

describe('wizards registry', () => {
  it('ids are unique, every wizard is complete, facets partition the registry', () => {
    const ids = new Set<string>()
    for (const w of WIZARDS) {
      assert.ok(!ids.has(w.id), `duplicate wizard id ${w.id}`)
      ids.add(w.id)
      assert.ok(w.title.length > 0 && w.blurb.length > 0, `${w.id} is incomplete`)
      assert.ok(WIZARD_FACETS.some(f => f.id === w.facet), `${w.id} has unknown facet ${w.facet}`)
    }
    let total = 0
    for (const f of WIZARD_FACETS) {
      const list = wizardsForFacet(f.id)
      assert.ok(list.length > 0, `facet ${f.id} has no wizards`)
      total += list.length
    }
    assert.equal(total, WIZARDS.length)
  })

  it('Add a Feature is the one ready wizard, under Features', () => {
    const ready = WIZARDS.filter(w => w.status === 'ready')
    assert.deepEqual(ready.map(w => w.id), ['add-feature'])
    assert.equal(ready[0].facet, 'features')
    assert.ok(STUB_REASON.length > 0)
  })

  it('quickAddPrompt carries the pack identity and the no-questions contract', () => {
    const pack: PackSummaryItem = { id: 'settings', name: 'Settings', description: '', nodes: 5, settings: 4, configures: [] }
    const text = quickAddPrompt(pack)
    assert.match(text, /Settings feature pack \(pack id settings\)/)
    assert.match(text, /stated defaults/)
    assert.match(text, /do not stop to ask questions/)
    assert.match(text, /feature-install-pack/)
  })
})
