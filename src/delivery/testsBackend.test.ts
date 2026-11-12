import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseJunit } from './junit.js'
import { detectRunners, discoverTests, kindOf, scanJsTestNames } from './testRunners.js'
import { runTests, setTestExecutor } from './testRun.js'
import { flakyTestKeys, lastTestVerdict, latestFailureKeys, makeRun, readTestRuns, recordTestRun } from './testStore.js'

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-tests-'))
}

function nodeProject(): string {
  const dir = scratch()
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'math.test.js'), `
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
describe('math', () => {
  it('adds', () => { assert.equal(1 + 1, 2) })
  it('breaks', () => { assert.equal(1 + 1, 3) })
})
`)
  fs.mkdirSync(path.join(dir, 'e2e'))
  fs.writeFileSync(path.join(dir, 'e2e', 'flow.test.js'), `
import { it } from 'node:test'
import assert from 'node:assert/strict'
it('loads', () => { assert.ok(true) })
`)
  return dir
}

describe('junit reader', () => {
  it('extracts cases with failures, skips, and decoded entities', () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase name="ok one" classname="s" file="/p/a.test.js" time="0.01"/>
      <testcase name="bad one" classname="s" file="/p/a.test.js" time="0.02" failure="2 !== 3&#10;"><failure type="x">2 !== 3 &lt;here&gt;</failure></testcase>
      <testcase name="skip one" classname="s" file="/p/a.test.js" time="0"><skipped/></testcase>
    </testsuite></testsuites>`
    const cases = parseJunit(xml)
    assert.equal(cases.length, 3)
    assert.equal(cases[0].name, 'ok one')
    assert.equal(cases[1].failure, '2 !== 3 <here>')
    assert.equal(cases[2].skipped, true)
  })
})

describe('discovery', () => {
  it('kinds come from where a test lives', () => {
    assert.equal(kindOf('src/a.test.ts'), 'unit')
    assert.equal(kindOf('e2e/flow.test.ts'), 'e2e')
    assert.equal(kindOf('src/api.integration.test.ts'), 'integration')
    assert.equal(kindOf('tests/integration/db.test.ts'), 'integration')
  })

  it('scanJsTestNames reads it/test literals', () => {
    assert.deepEqual(scanJsTestNames(`it('one', () => {}); test("two", () => {}); describe('suite', () => {})`), ['one', 'two'])
  })

  it('detects node:test and discovers suites with kinds', () => {
    const dir = nodeProject()
    const runners = detectRunners(dir)
    assert.deepEqual(runners.map(r => r.id), ['node-test'])
    const suites = discoverTests(dir)
    assert.equal(suites.length, 2)
    const math = suites.find(s => s.file.endsWith('math.test.js'))!
    assert.deepEqual(math.tests.map(t => t.name), ['adds', 'breaks'])
    assert.equal(suites.find(s => s.file.includes('e2e'))!.kind, 'e2e')
  })
})

describe('run engine — node:test for real', () => {
  it('runs all, records results with the failure text, and stores the run', async () => {
    const dir = nodeProject()
    const outcome = await runTests(dir, { kind: 'all' })
    assert.equal(outcome.runs.length, 1)
    const run = outcome.runs[0]
    assert.equal(run.totals.total, 3)
    assert.equal(run.totals.pass, 2)
    assert.equal(run.totals.fail, 1)
    const bad = run.results.find(r => r.name === 'breaks')!
    assert.match(bad.failure ?? '', /2 !== 3|strictly equal/)
    assert.equal(readTestRuns(dir).runs.length, 1)
    assert.deepEqual(latestFailureKeys(dir), ['src/math.test.js::breaks'])
    const verdict = lastTestVerdict(dir)
    assert.equal(verdict?.green, false)
    assert.equal(verdict?.total, 3)
  })

  it('failures-only re-runs just the failing test', async () => {
    const dir = nodeProject()
    await runTests(dir, { kind: 'all' })
    const outcome = await runTests(dir, { kind: 'failures', keys: [] })
    assert.equal(outcome.runs.length, 1)
    assert.equal(outcome.runs[0].totals.total, 1)
    assert.equal(outcome.runs[0].results[0].name, 'breaks')
  })

  it('a single-test run does not pose as the project verdict', async () => {
    const dir = nodeProject()
    await runTests(dir, { kind: 'single', file: 'e2e/flow.test.js', name: 'loads' })
    assert.equal(lastTestVerdict(dir), null)
  })
})

describe('run engine — vitest through a fake executor', () => {
  it('builds the vitest command, reads the JSON report file, and parses it', async () => {
    const dir = scratch()
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'vf', devDependencies: { vitest: '^2.0.0' },
    }))
    fs.writeFileSync(path.join(dir, 'a.test.ts'), `import { it } from 'vitest'\nit('works', () => {})\nit('fails', () => {})\n`)
    let seenArgs: string[] = []
    setTestExecutor(async (_cmd, args) => {
      seenArgs = args
      const reportArg = args.find(a => a.startsWith('--outputFile.json='))!
      const reportPath = reportArg.slice('--outputFile.json='.length)
      fs.mkdirSync(path.dirname(reportPath), { recursive: true })
      fs.writeFileSync(reportPath, JSON.stringify({
        testResults: [{
          name: path.join(dir, 'a.test.ts'),
          assertionResults: [
            { title: 'works', status: 'passed', duration: 3 },
            { title: 'fails', status: 'failed', duration: 5, failureMessages: ['boom'] },
          ],
        }],
      }))
      return { stdout: '', stderr: '', exitCode: 1 }
    })
    try {
      const outcome = await runTests(dir, { kind: 'all' })
      assert.ok(seenArgs.includes('vitest'))
      assert.equal(outcome.runs.length, 1)
      assert.equal(outcome.runs[0].totals.pass, 1)
      assert.equal(outcome.runs[0].totals.fail, 1)
      assert.equal(outcome.runs[0].results.find(r => r.name === 'fails')!.failure, 'boom')
    } finally {
      setTestExecutor(null)
    }
  })
})

describe('flakiness from recorded history', () => {
  it('a test that flips across recent runs is flagged; a steady failure is not', () => {
    const dir = scratch()
    const mk = (status: 'pass' | 'fail') => makeRun('node-test', { kind: 'all' }, [
      { file: 'a.test.js', name: 'flip', status, durationMs: 1 },
      { file: 'a.test.js', name: 'steady red', status: 'fail', durationMs: 1 },
      { file: 'a.test.js', name: 'steady green', status: 'pass', durationMs: 1 },
    ])
    recordTestRun(dir, mk('pass'))
    recordTestRun(dir, mk('fail'))
    assert.deepEqual(flakyTestKeys(dir), ['a.test.js::flip'])
  })
})
