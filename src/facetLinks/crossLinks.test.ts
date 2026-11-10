import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addCrossLink, getCrossLinks, removeCrossLink, resolveCrossLinks } from './crossLinks.js'
import { FACET_CRITERIA, runFacetCriteria } from './facetCriteria.js'
import { saveDesignGraph } from '../design/designGraph.js'

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-links-'))
  fs.mkdirSync(path.join(root, 'ai-features'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ai-features/graph.json'), JSON.stringify({
    version: 1, updatedAt: Date.now(),
    nodes: [{ id: 'f1', name: 'Checkout', kind: 'feature', status: 'built' }],
    edges: [],
  }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'demo', dependencies: { react: '^18.2.0' },
  }))
  saveDesignGraph({
    version: 1, derivedAt: Date.now(),
    nodes: [{ id: 'component:Cart', kind: 'component', name: 'Cart', file: 'src/Cart.tsx' }],
    edges: [],
  }, root)
  return root
}

describe('cross-facet links (§8.1)', () => {
  it('round-trips through the store and resolves against real facet data', () => {
    const root = tmpProject()
    addCrossLink({ kind: 'uses-component', from: 'Checkout', to: 'Cart' }, root)
    addCrossLink({ kind: 'requires-package', from: 'Checkout', to: 'react' }, root)
    assert.equal(getCrossLinks(root).links.length, 2)
    const resolved = resolveCrossLinks(root)
    assert.ok(resolved.every(l => l.resolved))
  })

  it('a link whose target is gone lists as broken, not silently dropped', () => {
    const root = tmpProject()
    addCrossLink({ kind: 'uses-component', from: 'Checkout', to: 'NoSuchComponent' }, root)
    addCrossLink({ kind: 'requires-package', from: 'Checkout', to: 'not-a-package' }, root)
    const resolved = resolveCrossLinks(root)
    assert.ok(resolved.every(l => !l.resolved))
    const file = removeCrossLink(resolved[0].id, root)
    assert.equal(file.links.length, 1)
  })

  it('sanitize drops malformed links', () => {
    const root = tmpProject()
    fs.writeFileSync(path.join(root, 'ai-features/cross-links.json'), JSON.stringify({
      version: 1,
      links: [{ id: 'x', kind: 'bogus', from: 'a', to: 'b' }, { id: 'y', kind: 'needs-config', from: 'Checkout', to: 'package.json' }],
    }))
    const links = getCrossLinks(root)
    assert.equal(links.links.length, 1)
    assert.equal(links.links[0].kind, 'needs-config')
  })
})

describe('per-facet criteria sets (§8.3)', () => {
  it('every set parses through the shared verify-criteria parser with no errors', () => {
    for (const [facet, file] of Object.entries(FACET_CRITERIA)) {
      assert.deepEqual(file.errors, [], facet)
      assert.ok(file.criteria.length >= 2, facet)
    }
  })

  it('runs against facet reports with evidence', () => {
    const root = tmpProject()
    const stack = runFacetCriteria('tech-stack', root)
    assert.ok(stack.results.every(r => r.evidence.length > 0))
    // react is declared but there is no lockfile: the declared-
    // installed check cannot pass — it must say so, not pass.
    const arch = runFacetCriteria('architecture', root)
    assert.ok(arch.results.every(r => r.verdict === 'couldnt-check'))
  })
})
