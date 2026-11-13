import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { deriveConfigInventory } from '../configregistry/configRegistry.js'
import { ciOverview, readPipelines, runCiAction, type CiPlugin } from './ci.js'
import { ciRunGreen, latestCiRunOnCommit, readCiSummary, writeCiSummary, type CiRunSummary } from './ciStore.js'
import { parseWorkflow } from './workflowYaml.js'

function scratch(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-ci-'))
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, text)
  }
  return dir
}

const WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

jobs:
  test:
    name: Run the tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm ci
      - name: Test
        run: npm test
  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Build it
        run: |
          npm run build
          npm run bundle
`

describe('workflow extractor (§13.8)', () => {
  it('reads name, block triggers (nested config ignored), jobs, needs, steps', () => {
    const def = parseWorkflow(WORKFLOW)
    assert.equal(def.name, 'CI')
    assert.deepEqual(def.triggers, ['push', 'pull_request', 'workflow_dispatch'])
    assert.equal(def.canDispatch, true)
    assert.equal(def.jobs.length, 2)
    const [test, build] = def.jobs
    assert.equal(test.id, 'test')
    assert.equal(test.name, 'Run the tests')
    assert.deepEqual(test.needs, [])
    assert.equal(test.steps.length, 3)
    assert.deepEqual(test.steps[0], { uses: 'actions/checkout@v4' })
    assert.deepEqual(test.steps[1], { name: 'Install', run: 'npm ci' })
    assert.equal(build.id, 'build')
    assert.deepEqual(build.needs, ['test'])
    // The block scalar is captured whole, and its second
    // line is not mistaken for another step or key.
    assert.equal(build.steps[0].run, 'npm run build\nnpm run bundle')
  })

  it('reads flow and scalar trigger forms', () => {
    assert.deepEqual(parseWorkflow('on: [push, pull_request]\njobs: {}\n').triggers, ['push', 'pull_request'])
    assert.deepEqual(parseWorkflow('on: push\n').triggers, ['push'])
    const blockList = parseWorkflow('on:\n  - push\n  - workflow_dispatch\n')
    assert.deepEqual(blockList.triggers, ['push', 'workflow_dispatch'])
    assert.equal(blockList.canDispatch, true)
  })

  it('reads block-list needs and a quoted name; schedule counts as a trigger', () => {
    const def = parseWorkflow(`name: "Nightly Checks"
on:
  schedule:
    - cron: '0 3 * * *'
jobs:
  a:
    steps:
      - run: echo a
  b:
    needs:
      - a
    steps:
      - run: echo b
`)
    assert.equal(def.name, 'Nightly Checks')
    assert.deepEqual(def.triggers, ['schedule'])
    assert.deepEqual(def.jobs[1].needs, ['a'])
  })

  it('a strange file degrades to an empty def, never a throw', () => {
    const def = parseWorkflow('this is not yaml at all\n{{{')
    assert.deepEqual(def, { triggers: [], canDispatch: false, jobs: [] })
    assert.equal(def.name, undefined)
  })
})

describe('pipeline reading', () => {
  it('reads pipelines from .github/workflows with file-name fallback', () => {
    const dir = scratch({
      '.github/workflows/ci.yml': WORKFLOW,
      '.github/workflows/release.yaml': 'on: workflow_dispatch\njobs:\n  ship:\n    steps:\n      - run: echo ship\n',
      'src/index.js': 'export {}\n',
    })
    const pipelines = readPipelines(dir)
    assert.equal(pipelines.length, 2)
    assert.equal(pipelines[0].name, 'CI')
    assert.equal(pipelines[0].file, '.github/workflows/ci.yml')
    assert.equal(pipelines[0].id, 'github-actions:.github/workflows/ci.yml')
    assert.equal(pipelines[1].name, 'release')
    assert.equal(pipelines[1].canDispatch, true)
  })
})

describe('summary cache (ciStore)', () => {
  const run = (id: string, commit: string, conclusion: string | null = 'success'): CiRunSummary => ({
    id, pipelineName: 'CI', status: conclusion === null ? 'in_progress' : 'completed',
    conclusion, commit, createdAt: '2026-11-13T00:00:00.000Z',
  })

  it('round-trips, caps, and answers the on-commit question', () => {
    const dir = scratch({})
    assert.equal(readCiSummary(dir), null)
    writeCiSummary(dir, {
      updatedAt: '2026-11-13T01:00:00.000Z', provider: 'github-actions', connected: true,
      recentRuns: [run('2', 'bbb'), run('1', 'aaa')],
    })
    const back = readCiSummary(dir)
    assert.equal(back?.recentRuns.length, 2)
    assert.equal(latestCiRunOnCommit(dir, 'aaa')?.id, '1')
    assert.equal(latestCiRunOnCommit(dir, 'zzz'), null)
    assert.equal(latestCiRunOnCommit(dir, null), null)
    assert.equal(ciRunGreen(run('3', 'ccc')), true)
    assert.equal(ciRunGreen(run('4', 'ccc', 'failure')), false)
    assert.equal(ciRunGreen(run('5', 'ccc', null)), false)
  })
})

/* ── the core service, against a fake plugin ─────────────── */

const FAKE_RUN: CiRunSummary = {
  id: '42', pipelineName: 'CI', status: 'completed', conclusion: 'success',
  commit: 'abc123', branch: 'main', createdAt: '2026-11-13T02:00:00.000Z',
}

function fakePlugin(over: Partial<CiPlugin> = {}): { plugin: CiPlugin, calls: string[] } {
  const calls: string[] = []
  const plugin: CiPlugin = {
    id: 'fake', label: 'Fake CI',
    detect: () => true,
    connectState: async () => ({ connected: true, accountLabel: 'someone', howToConnect: 'Connect somehow.' }),
    pipelines: (root) => readPipelines(root, 'fake'),
    runs: async () => { calls.push('runs'); return [FAKE_RUN] },
    runDetail: async () => { throw new Error('not here') },
    jobLogs: async () => [],
    trigger: async () => { calls.push('trigger'); return { ok: true } },
    rerun: async () => { calls.push('rerun'); return { ok: true } },
    cancel: async () => { calls.push('cancel'); return { ok: true } },
    ...over,
  }
  return { plugin, calls }
}

describe('CI core service', () => {
  it('connected: live runs are served and the summary cache is written', async () => {
    const dir = scratch({ '.github/workflows/ci.yml': WORKFLOW })
    const { plugin } = fakePlugin()
    const overview = await ciOverview(dir, [plugin])
    assert.equal(overview.runsSource, 'live')
    assert.deepEqual(overview.runs, [FAKE_RUN])
    assert.equal(overview.pipelines.length, 1)
    assert.equal(readCiSummary(dir)?.recentRuns[0].id, '42')
  })

  it('not connected: cached runs are served as cache; the plugin\'s action methods are never called', async () => {
    const dir = scratch({ '.github/workflows/ci.yml': WORKFLOW })
    writeCiSummary(dir, {
      updatedAt: '2026-11-12T00:00:00.000Z', provider: 'fake', connected: true, recentRuns: [FAKE_RUN],
    })
    const { plugin, calls } = fakePlugin({
      connectState: async () => ({ connected: false, howToConnect: 'Set FAKE_TOKEN.' }),
    })
    const overview = await ciOverview(dir, [plugin])
    assert.equal(overview.runsSource, 'cache')
    assert.equal(overview.cachedAt, '2026-11-12T00:00:00.000Z')
    assert.deepEqual(overview.runs, [FAKE_RUN])
    assert.equal(overview.pipelines.length, 1)
    const refused = await runCiAction(dir, [plugin], { action: 'trigger', pipelineId: 'fake:.github/workflows/ci.yml' })
    assert.ok('error' in refused && /not connected/.test(refused.error))
    assert.deepEqual(calls, [])
  })

  it('trigger refuses a pipeline that does not declare workflow_dispatch', async () => {
    const dir = scratch({ '.github/workflows/ci.yml': 'name: Push only\non: push\njobs:\n  t:\n    steps:\n      - run: npm test\n' })
    const { plugin, calls } = fakePlugin()
    const r = await runCiAction(dir, [plugin], { action: 'trigger', pipelineId: 'fake:.github/workflows/ci.yml' })
    assert.ok('error' in r && /workflow_dispatch/.test(r.error))
    assert.deepEqual(calls, [])
  })
})

describe('configuration recognizer (§13.8 detection)', () => {
  it('a workflow file is recognised with its name and shape', () => {
    const dir = scratch({ '.github/workflows/ci.yml': WORKFLOW, 'index.html': '<html></html>' })
    const inv = deriveConfigInventory(dir)
    const entry = inv.groups.flatMap(g => g.entries).find(e => e.file === '.github/workflows/ci.yml')
    assert.ok(entry)
    assert.match(entry.summary, /"CI"/)
    assert.match(entry.summary, /push/)
    assert.match(entry.summary, /2 jobs/)
  })
})
