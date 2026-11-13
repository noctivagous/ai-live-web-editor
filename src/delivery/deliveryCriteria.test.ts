import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { runFacetCriteria } from '../facetLinks/facetCriteria.js'
import { writeCiSummary, type CiRunSummary } from './ciStore.js'
import { makeRun, recordTestRun } from './testStore.js'

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-criteria-'))
}

function scratchRepo(): string {
  const dir = scratch()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' })
  git('init', '-b', 'main')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  git('add', '-A')
  git('commit', '-m', 'first')
  return dir
}

function headOf(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim()
}

function ciRun(partial: Partial<CiRunSummary>): CiRunSummary {
  return {
    id: '1', pipelineName: 'CI', status: 'completed', conclusion: 'success',
    branch: 'main', createdAt: new Date().toISOString(), ...partial,
  }
}

function recordCi(dir: string, runs: CiRunSummary[]): void {
  writeCiSummary(dir, {
    updatedAt: new Date().toISOString(), provider: 'github-actions', connected: true, recentRuns: runs,
  })
}

describe('delivery facet criteria (§8.3 over the test store)', () => {
  it('all criteria are couldnt-check before any run exists', () => {
    const run = runFacetCriteria('delivery', scratch())
    assert.deepEqual(run.results.map(r => [r.id, r.verdict]), [
      ['tests-green', 'couldnt-check'],
      ['tests-no-flaky', 'couldnt-check'],
      ['ci-green', 'couldnt-check'],
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

describe('ci-green criterion (§13.8 — reads the recorded summary, never the provider)', () => {
  it('passes when the recorded run for HEAD succeeded, and names the pipeline', () => {
    const dir = scratchRepo()
    recordCi(dir, [ciRun({ commit: headOf(dir) })])
    const r = runFacetCriteria('delivery', dir).results.find(x => x.id === 'ci-green')!
    assert.equal(r.verdict, 'pass')
    assert.match(r.evidence, /"CI" succeeded on HEAD/)
  })

  it('fails when the recorded run for HEAD concluded failure', () => {
    const dir = scratchRepo()
    recordCi(dir, [ciRun({ commit: headOf(dir), conclusion: 'failure' })])
    const r = runFacetCriteria('delivery', dir).results.find(x => x.id === 'ci-green')!
    assert.equal(r.verdict, 'fail')
    assert.match(r.evidence, /concluded failure/)
  })

  it('is couldnt-check when the recorded runs are for other commits — a green run elsewhere proves nothing about HEAD', () => {
    const dir = scratchRepo()
    recordCi(dir, [ciRun({ commit: 'deadbeef'.repeat(5) })])
    const r = runFacetCriteria('delivery', dir).results.find(x => x.id === 'ci-green')!
    assert.equal(r.verdict, 'couldnt-check')
    assert.match(r.evidence, /No recorded CI run is for HEAD/)
  })

  it('is couldnt-check while the run for HEAD is still in progress', () => {
    const dir = scratchRepo()
    recordCi(dir, [ciRun({ commit: headOf(dir), status: 'in_progress', conclusion: null })])
    const r = runFacetCriteria('delivery', dir).results.find(x => x.id === 'ci-green')!
    assert.equal(r.verdict, 'couldnt-check')
    assert.match(r.evidence, /still in progress/)
  })

  it('picks the newest recorded run when several are for HEAD', () => {
    const dir = scratchRepo()
    const head = headOf(dir)
    recordCi(dir, [
      ciRun({ id: 'new', commit: head, conclusion: 'success', createdAt: '2026-01-02T00:00:00Z' }),
      ciRun({ id: 'old', commit: head, conclusion: 'failure', createdAt: '2026-01-01T00:00:00Z' }),
    ])
    // recentRuns are stored newest-first; the first match is the newest.
    const r = runFacetCriteria('delivery', dir).results.find(x => x.id === 'ci-green')!
    assert.equal(r.verdict, 'pass')
  })
})
