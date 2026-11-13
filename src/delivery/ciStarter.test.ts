import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { addCiStarter } from './ciStarter.js'
import { parseWorkflow } from './workflowYaml.js'

/**
 * The CI starter (§13.8): a plain workflow file for the
 * detected stack, written once, never overwriting — and the
 * file it writes must be readable by the same structural
 * reader the CI section renders pipelines with.
 */

function scratch(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-ci-starter-'))
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8')
  }
  return dir
}

describe('addCiStarter (§13.8)', () => {
  it('writes a test-on-push workflow for a node project, readable by the pipeline reader', () => {
    const dir = scratch({
      'package.json': JSON.stringify({ name: 'w', scripts: { test: 'node --test', build: 'tsc' } }),
      'package-lock.json': '{}',
    })
    const r = addCiStarter(dir)
    assert.equal(r.ok, true)
    if (r.ok !== true) return
    assert.equal(r.file, '.github/workflows/ci.yml')
    assert.equal(r.stack, 'node')
    const text = fs.readFileSync(path.join(dir, r.file), 'utf-8')
    assert.match(text, /npm ci/)
    const def = parseWorkflow(text)
    assert.equal(def.name, 'CI')
    assert.deepEqual(def.triggers, ['push', 'pull_request'])
    assert.equal(def.jobs.length, 1)
    const runs = def.jobs[0].steps.map(s => s.run).filter(Boolean)
    assert.ok(runs.includes('npm test'), runs.join(','))
    assert.ok(runs.includes('npm run build'), runs.join(','))
    // Second call refuses: the file is the user's now.
    const again = addCiStarter(dir)
    assert.equal(again.ok, false)
    if (again.ok === false) assert.match(again.error, /already exists/)
  })

  it('refuses a node project with nothing to run, in plain words', () => {
    const dir = scratch({ 'package.json': JSON.stringify({ name: 'w', scripts: {} }) })
    const r = addCiStarter(dir)
    assert.equal(r.ok, false)
    if (r.ok === false) assert.match(r.error, /no test or build script/)
    assert.equal(fs.existsSync(path.join(dir, '.github')), false, 'nothing was written')
  })

  it('writes a pytest workflow for a python project that declares pytest', () => {
    const dir = scratch({ 'requirements.txt': 'pytest==8.0\nrequests\n' })
    const r = addCiStarter(dir)
    assert.equal(r.ok, true)
    if (r.ok !== true) return
    assert.equal(r.stack, 'python')
    const def = parseWorkflow(fs.readFileSync(path.join(dir, r.file), 'utf-8'))
    assert.deepEqual(def.triggers, ['push', 'pull_request'])
    const runs = def.jobs[0].steps.map(s => s.run).filter(Boolean)
    assert.ok(runs.includes('pip install -r requirements.txt'), runs.join(','))
    assert.ok(runs.includes('pytest'), runs.join(','))
  })

  it('refuses when no known stack is detected', () => {
    const dir = scratch({ 'README.md': 'hello\n' })
    const r = addCiStarter(dir)
    assert.equal(r.ok, false)
    if (r.ok === false) assert.match(r.error, /No stack/)
  })
})
