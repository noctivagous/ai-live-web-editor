import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { deliveryBriefLines } from './deliveryBrief.js'
import { writeCiSummary } from './ciStore.js'
import { makeRun, recordTestRun } from './testStore.js'
import { ALE_DELIVERY_TOOLS } from '../mcpserver/deliveryTools.js'
import { ALE_TOOLS, visibleAleTools } from '../mcpserver/registry.js'

describe('delivery brief (slice 1 skeleton)', () => {
  it('contributes no lines while nothing is known — each line is omitted honestly, never padded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-brief-'))
    assert.deepEqual(deliveryBriefLines(root), [])
  })

  it('folds CI status into the tests line (§13.8) — still three lines, never a fourth', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-brief-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' })
    git('init', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 'Test')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    git('add', '-A')
    git('commit', '-m', 'first')
    const head = git('rev-parse', 'HEAD').trim()
    recordTestRun(dir, makeRun('node-test', { kind: 'all' }, [{ file: 'a.test.js', name: 'ok', status: 'pass' }]))
    // No CI recorded: the tests line stands alone.
    let lines = deliveryBriefLines(dir)
    assert.equal(lines.length, 2) // git line + tests line
    assert.ok(!lines.some(l => l.includes('CI')), lines.join(' | '))
    writeCiSummary(dir, {
      updatedAt: new Date().toISOString(), provider: 'github-actions', connected: true,
      recentRuns: [{
        id: '1', pipelineName: 'CI', status: 'completed', conclusion: 'success',
        branch: 'main', commit: head, createdAt: new Date().toISOString(),
      }],
    })
    lines = deliveryBriefLines(dir)
    assert.equal(lines.length, 2, 'CI joins the tests line — no fourth line appears')
    assert.match(lines[1], /Tests: last full run green.*CI green on HEAD/)
    // A run recorded for a different commit says nothing about HEAD.
    writeCiSummary(dir, {
      updatedAt: new Date().toISOString(), provider: 'github-actions', connected: true,
      recentRuns: [{
        id: '2', pipelineName: 'CI', status: 'completed', conclusion: 'failure',
        branch: 'main', commit: 'deadbeef'.repeat(5), createdAt: new Date().toISOString(),
      }],
    })
    lines = deliveryBriefLines(dir)
    assert.ok(!lines.some(l => l.includes('CI')), lines.join(' | '))
  })
})

describe('delivery MCP tool family (slice 1 registration point)', () => {
  it('is composed into the registry, and every delivery tool is facet-tagged for §10.2 gating', () => {
    for (const t of ALE_DELIVERY_TOOLS) {
      assert.equal(t.facet, 'delivery', `${t.name} must be tagged facet: 'delivery'`)
      assert.ok(ALE_TOOLS.includes(t), `${t.name} must be composed into ALE_TOOLS`)
    }
  })

  it('visibleAleTools matches ALE_TOOLS when no facet is off', () => {
    assert.deepEqual(visibleAleTools().map(t => t.name), ALE_TOOLS.map(t => t.name))
  })
})
