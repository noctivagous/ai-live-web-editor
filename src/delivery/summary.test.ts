import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { deliveryBriefLines } from './deliveryBrief.js'
import { recordDeployment, type DeploymentRecord } from './deploy.js'
import { deliverySummary } from './summary.js'
import { makeRun, recordTestRun } from './testStore.js'

function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-summary-'))
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

describe('deliverySummary — the Overview roll-up (§13.6)', () => {
  it('unknowns stay null on an empty non-repo directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-summary-'))
    const s = await deliverySummary(dir)
    assert.equal(s.git, null)
    assert.equal(s.tests, null)
    assert.equal(s.deploy, null)
    assert.equal(s.upToDate, null)
  })

  it('answers clean tree / tests green / deployed commit == HEAD', async () => {
    const dir = scratchRepo()
    recordTestRun(dir, makeRun('node-test', { kind: 'all' }, [{ file: 'a.test.js', name: 'ok', status: 'pass' }]))
    const rec: DeploymentRecord = {
      id: 'd1', at: new Date().toISOString(), pluginId: 'fake', targetId: 'fake:one', targetName: 'one',
      kind: 'production', action: 'deploy', commit: headOf(dir), url: 'https://one.example.com', state: 'succeeded',
    }
    recordDeployment(dir, rec)
    let s = await deliverySummary(dir)
    assert.equal(s.git?.branch, 'main')
    assert.equal(s.git?.changed, 0)
    assert.equal(s.tests?.green, true)
    assert.equal(s.upToDate, true)
    // A new commit moves HEAD past the deployment.
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'second'], { cwd: dir })
    s = await deliverySummary(dir)
    assert.equal(s.upToDate, false)
    // A dirty tree is counted, not hidden.
    fs.writeFileSync(path.join(dir, 'c.txt'), 'three\n')
    s = await deliverySummary(dir)
    assert.equal(s.git?.changed, 1)
  })
})

describe('delivery brief lines — the real providers (§13.6)', () => {
  it('all three lines appear once their facts exist, in order', () => {
    const dir = scratchRepo()
    fs.writeFileSync(path.join(dir, 'dirty.txt'), 'x\n')
    recordTestRun(dir, makeRun('node-test', { kind: 'all' }, [
      { file: 'a.test.js', name: 'ok', status: 'pass' },
      { file: 'a.test.js', name: 'also ok', status: 'pass' },
    ]))
    recordDeployment(dir, {
      id: 'd1', at: new Date().toISOString(), pluginId: 'fake', targetId: 'fake:one', targetName: 'one',
      kind: 'production', action: 'deploy', commit: headOf(dir), url: 'https://one.example.com', state: 'succeeded',
    })
    const lines = deliveryBriefLines(dir)
    assert.equal(lines.length, 3)
    assert.match(lines[0], /^Git: branch main · 1 changed file$/)
    assert.match(lines[1], /^Tests: last full run green — 2 passed \(node-test\)$/)
    assert.match(lines[2], /^Live: https:\/\/one\.example\.com \(deployed just now from [0-9a-f]{7}\)$/)
  })

  it('a failing verdict reads as failing, not green', () => {
    const dir = scratchRepo()
    recordTestRun(dir, makeRun('node-test', { kind: 'all' }, [{ file: 'a.test.js', name: 'bad', status: 'fail' }]))
    const lines = deliveryBriefLines(dir)
    assert.match(lines.find(l => l.startsWith('Tests:'))!, /1 failure of 1/)
  })
})
