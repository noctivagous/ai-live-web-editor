import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { runFacetCriteria } from '../facetLinks/facetCriteria.js'
import { makeRun, recordTestRun } from './testStore.js'

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-criteria-'))
}

describe('delivery facet criteria (§8.3 over the test store)', () => {
  it('both criteria are couldnt-check before any run exists', () => {
    const run = runFacetCriteria('delivery', scratch())
    assert.deepEqual(run.results.map(r => [r.id, r.verdict]), [
      ['tests-green', 'couldnt-check'],
      ['tests-no-flaky', 'couldnt-check'],
    ])
  })

  it('tests-green reads the latest full run; a failing run fails with the failing keys as evidence', () => {
    const dir = scratch()
    recordTestRun(dir, makeRun('node-test', { kind: 'all' }, [
      { file: 'a.test.js', name: 'good', status: 'pass' },
      { file: 'a.test.js', name: 'bad', status: 'fail', failure: 'nope' },
    ]))
    const run = runFacetCriteria('delivery', dir)
    const green = run.results.find(r => r.id === 'tests-green')!
    assert.equal(green.verdict, 'fail')
    assert.match(green.evidence, /a\.test\.js::bad/)
    recordTestRun(dir, makeRun('node-test', { kind: 'all' }, [
      { file: 'a.test.js', name: 'good', status: 'pass' },
      { file: 'a.test.js', name: 'bad', status: 'pass' },
    ]))
    const run2 = runFacetCriteria('delivery', dir)
    assert.equal(run2.results.find(r => r.id === 'tests-green')!.verdict, 'pass')
    // 'bad' flipped between the two runs — the flaky criterion now fails.
    assert.equal(run2.results.find(r => r.id === 'tests-no-flaky')!.verdict, 'fail')
  })
})
