import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { addCrossLink, resolveCrossLinks } from './crossLinks.js'

function tmpProject(withTest = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-links-delivery-'))
  fs.mkdirSync(path.join(root, 'ai-features'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ai-features/graph.json'), JSON.stringify({
    version: 1, updatedAt: Date.now(),
    nodes: [{ id: 'f1', name: 'Checkout', kind: 'feature', status: 'built' }],
    edges: [],
  }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module' }))
  if (withTest) {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/cart.test.js'), [
      "import { test } from 'node:test'",
      "test('adds up', () => {})",
      '',
    ].join('\n'))
  }
  return root
}

function gitRepo(root: string, subjects: string[]): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' })
  git('init', '-b', 'main')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'Test')
  subjects.forEach((s, i) => {
    fs.writeFileSync(path.join(root, `f${i}.txt`), `${i}\n`)
    git('add', '-A')
    git('commit', '-m', s)
  })
}

describe('delivery cross-facet links (§8.1, §13.4/§13.3)', () => {
  it('proved-by resolves against discovered test keys; a missing test is broken', () => {
    const root = tmpProject()
    addCrossLink({ kind: 'proved-by', from: 'Checkout', to: 'src/cart.test.js::adds up' }, root)
    addCrossLink({ kind: 'proved-by', from: 'Checkout', to: 'src/cart.test.js::not a test' }, root)
    const resolved = resolveCrossLinks(root)
    assert.equal(resolved.find(l => l.to.endsWith('adds up'))!.resolved, true)
    assert.equal(resolved.find(l => l.to.endsWith('not a test'))!.resolved, false)
  })

  it('implements resolves only when history mentions the PR and the target exists', () => {
    const root = tmpProject()
    gitRepo(root, ['Merge pull request #12 from feat/checkout', 'plain work'])
    addCrossLink({ kind: 'implements', from: 'pr:12', to: 'Checkout' }, root)
    addCrossLink({ kind: 'implements', from: 'pr:99', to: 'Checkout' }, root)
    addCrossLink({ kind: 'implements', from: 'pr:12', to: 'NoSuchFeature' }, root)
    const resolved = resolveCrossLinks(root)
    const byFromTo = (f: string, t: string) => resolved.find(l => l.from === f && l.to === t)!
    assert.equal(byFromTo('pr:12', 'Checkout').resolved, true)
    assert.equal(byFromTo('pr:99', 'Checkout').resolved, false, '#99 is not in history')
    assert.equal(byFromTo('pr:12', 'NoSuchFeature').resolved, false)
  })

  it('a #1 reference does not resolve pr:12 by prefix accident (and vice versa)', () => {
    const root = tmpProject()
    gitRepo(root, ['fix for #123'])
    addCrossLink({ kind: 'implements', from: 'pr:12', to: 'Checkout' }, root)
    addCrossLink({ kind: 'implements', from: 'pr:123', to: 'Checkout' }, root)
    const resolved = resolveCrossLinks(root)
    assert.equal(resolved.find(l => l.from === 'pr:12')!.resolved, false)
    assert.equal(resolved.find(l => l.from === 'pr:123')!.resolved, true)
  })
})
