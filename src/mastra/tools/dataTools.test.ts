import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from '../../launcher.js'
import { dataAddTool, dataFindTool, dataGetTool, dataInspectTool, dataRemoveTool, dataSetTool } from './dataTools.js'

/**
 * execute()-level tests for the structured-data core tools: one
 * verb set over the neutral tree model, exercised against three
 * of its formats (JSON, YAML, .env) to pin that the core — not a
 * per-format tool — does the work, with splice-exact writes.
 */

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> }).execute(input, {})

function tmpProject(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-tools-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  setFsRoot(root)
  return root
}

const PKG = '{\n  "name": "demo",\n  "version": "0.1.0",\n  "dependencies": { "react": "^18.3.0" }\n}\n'
const CI = 'name: CI\njobs:\n  build:\n    timeout-minutes: 30\n'

describe('data core over JSON (package.json)', () => {
  it('inspect reports the recognised profile and an outline', async () => {
    tmpProject({ 'package.json': PKG })
    const r = await run(dataInspectTool, { path: '/package.json' })
    assert.equal(r.ok, true)
    assert.equal(r.format, 'json')
    assert.match(r.profile as string, /^package\.json/)
    assert.ok((r.outline as { children: unknown[] }).children.length >= 3)
  })

  it('find → get → set round-trips one value, byte-exact elsewhere', async () => {
    const root = tmpProject({ 'package.json': PKG })
    const found = await run(dataFindTool, { path: '/package.json', query: 'react' })
    assert.deepEqual((found.matches as { address: string }[]).map((m) => m.address), ['dependencies.react'])
    const got = await run(dataGetTool, { path: '/package.json', address: 'dependencies.react' })
    assert.equal(got.value, '^18.3.0')
    const set = await run(dataSetTool, { path: '/package.json', address: 'dependencies.react', value: '^19.0.0' })
    assert.equal(set.ok, true)
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), PKG.replace('"^18.3.0"', '"^19.0.0"'))
  })

  it('a missing address and a bad type refuse without writing', async () => {
    const root = tmpProject({ 'package.json': PKG })
    assert.equal((await run(dataGetTool, { path: '/package.json', address: 'nope.deep' })).ok, false)
    assert.equal((await run(dataSetTool, { path: '/package.json', address: 'dependencies', value: 'x' })).ok, false)
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), PKG)
  })
})

describe('data core over YAML and .env', () => {
  it('the same verbs work on a workflow file and an env file', async () => {
    const root = tmpProject({ '.github/workflows/ci.yml': CI, '.env': 'PORT=3000\n' })
    const inspect = await run(dataInspectTool, { path: '/.github/workflows/ci.yml' })
    assert.equal(inspect.profile, 'GitHub Actions workflow')
    const set = await run(dataSetTool, { path: '/.github/workflows/ci.yml', address: 'jobs.build.timeout-minutes', value: '45' })
    assert.equal(set.ok, true)
    assert.equal(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'), CI.replace(': 30', ': 45'))
    const envSet = await run(dataSetTool, { path: '/.env', address: 'PORT', value: '8080' })
    assert.equal(envSet.ok, true)
    assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'PORT=8080\n')
  })

  it('refuses files outside the core with a plain reason', async () => {
    tmpProject({ 'app.ts': 'export {}\n' })
    const r = await run(dataInspectTool, { path: '/app.ts' })
    assert.equal(r.ok, false)
    assert.match(r.error as string, /not a structured-data file/)
  })
})

describe('data core over XML', () => {
  it('the same verbs inspect and edit an XML file in place', async () => {
    const doc = '<project name="demo"><version>2</version></project>\n'
    const root = tmpProject({ 'app.xml': doc })
    const inspect = await run(dataInspectTool, { path: '/app.xml' })
    assert.equal(inspect.ok, true)
    assert.equal(inspect.format, 'xml')
    const got = await run(dataGetTool, { path: '/app.xml', address: 'project.@name' })
    assert.equal(got.value, 'demo')
    const set = await run(dataSetTool, { path: '/app.xml', address: 'project.version', value: '3' })
    assert.equal(set.ok, true)
    assert.equal(fs.readFileSync(path.join(root, 'app.xml'), 'utf8'), doc.replace('<version>2</version>', '<version>3</version>'))
  })
})

describe('data-add and data-remove', () => {
  it('adds and removes a package.json field through the core', async () => {
    const root = tmpProject({ 'package.json': PKG })
    const added = await run(dataAddTool, { path: '/package.json', parent: '', key: 'license', value: 'MIT' })
    assert.equal(added.ok, true)
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), PKG.replace('\n}', ',\n  "license": "MIT"\n}'))
    const dup = await run(dataAddTool, { path: '/package.json', parent: '', key: 'license', value: 'ISC' })
    assert.equal(dup.ok, false)
    const removed = await run(dataRemoveTool, { path: '/package.json', address: 'license' })
    assert.equal(removed.ok, true)
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), PKG)
  })

  it('appends a YAML list item and removes a section', async () => {
    const root = tmpProject({ 'ci.yml': 'jobs:\n  build:\n    steps:\n      - one\n' })
    const added = await run(dataAddTool, { path: '/ci.yml', parent: 'jobs.build.steps', value: 'two' })
    assert.equal(added.ok, true)
    assert.equal(fs.readFileSync(path.join(root, 'ci.yml'), 'utf8'), 'jobs:\n  build:\n    steps:\n      - one\n      - two\n')
    const removed = await run(dataRemoveTool, { path: '/ci.yml', address: 'jobs' })
    assert.equal(removed.ok, true)
    assert.equal(fs.readFileSync(path.join(root, 'ci.yml'), 'utf8'), '')
  })
})
