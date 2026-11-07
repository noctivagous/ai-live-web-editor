import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from '../../launcher.js'
import { codebaseMapTool } from './codebaseMapTools.js'
import { poolOpenTool, runProjectCheckTool } from './realFsTools.js'

/**
 * execute()-level tests for the tools the file-tool suites don't
 * cover (basics audit slice 6): the permanent form of the audit's
 * live harness, so a tool cannot silently break — returning success
 * for the wrong thing, or a throw where callers expect an error
 * value — without a test noticing. Only deterministic, offline
 * behaviours are pinned here; live-page ops against a real page
 * belong to the bridge/pool suites.
 */

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> }).execute(input, {})

function tmpProject(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-execute-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  setFsRoot(root)
  return root
}

describe('run-project-check execute()', () => {
  it('runs the project build script and reports ok', async () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ scripts: { build: 'true' } }) })
    try {
      const r = await run(runProjectCheckTool, {})
      assert.equal(r.ok, true)
      assert.equal(r.script, 'build')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('returns an error value (no throw) when there is no package.json', async () => {
    const root = tmpProject({ 'index.html': '<html>' })
    try {
      const r = await run(runProjectCheckTool, {})
      assert.equal(r.ok, false)
      assert.match(String(r.error), /No package\.json/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('returns an error value when the build script is missing', async () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ scripts: {} }) })
    try {
      const r = await run(runProjectCheckTool, {})
      assert.equal(r.ok, false)
      assert.match(String(r.error), /No build script/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('codebase-map execute()', () => {
  it('builds the map for the active project and persists it', async () => {
    const root = tmpProject({
      'index.html': '<html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
      'src/main.jsx': 'import App from "./App.jsx"\n',
      'src/App.jsx': 'export default function App() { return <div>hi</div> }\n',
    })
    try {
      const r = await run(codebaseMapTool, {})
      assert.equal(r.ok, true)
      assert.ok(Number(r.fileCount) >= 2)
      assert.equal(fs.existsSync(path.join(root, '.ai-live', 'map.json')), true)
      const miss = await run(codebaseMapTool, { focus: 'no-such-component-zzz' })
      assert.equal(miss.ok, true)
      assert.equal(miss.found, false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('pool-open execute()', () => {
  it('returns the pool-off error value instead of throwing', async () => {
    const root = tmpProject({})
    try {
      const r = await run(poolOpenTool, { url: 'http://example.com/' })
      assert.match(String(r.error), /Playwright pool is off/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
