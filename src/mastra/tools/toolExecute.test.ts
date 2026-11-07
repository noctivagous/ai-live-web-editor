import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from '../../launcher.js'
import { createPlan, getActivePlan, getPlan, savePlan } from '../../plans/plans.js'
import { findComponentTool } from './catalogTools.js'
import { codebaseMapTool, installCatalogComponentTool } from './codebaseMapTools.js'
import {
  planAddQuestionTool, planFinishTool, planRemoveQuestionTool,
  planReviseQuestionTool, planUpdateTaskTool,
} from './planTools.js'
import { poolOpenTool, runProjectCheckTool } from './realFsTools.js'
import { placeTemplateTool } from './templateTools.js'

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

/**
 * Plan tools (the last uncovered family from the audit): every tool
 * funnels through the active plan in the plans store, so the fixture
 * is a created plan, and the assertions are on persisted state —
 * the tools' whole contract is that the plan file reflects the edit.
 */
describe('plan tools execute()', () => {
  it('returns the no-plan error value when no plan is active', async () => {
    const root = tmpProject({})
    try {
      const r = await run(planAddQuestionTool, { label: 'Q?', defaultProposal: 'Skip it' })
      assert.equal(r.ok, false)
      assert.match(String(r.error), /No active plan/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('add / revise / remove a question, persisted to the plan store', async () => {
    const root = tmpProject({})
    try {
      createPlan({ title: 'Ship it', kind: 'feature', level: 2, goal: 'Ship the thing' }, root)
      const added = await run(planAddQuestionTool, {
        label: 'Who can share?', control: 'choice', options: ['Anyone', 'Team'], defaultProposal: 'Anyone',
      })
      assert.equal(added.ok, true)
      assert.equal(added.totalQuestions, 1)
      const q = added.question as { id: string, control: string }
      assert.equal(q.control, 'choice')
      assert.equal(getActivePlan()?.questions.length, 1)

      const revised = await run(planReviseQuestionTool, { id: q.id, label: 'Who can open a shared link?' })
      assert.equal(revised.ok, true)
      const rq = revised.question as { label: string, revised?: boolean }
      assert.equal(rq.label, 'Who can open a shared link?')
      assert.equal(rq.revised, true)

      const badRevise = await run(planReviseQuestionTool, { id: 'q-nope', label: 'x' })
      assert.equal(badRevise.ok, false)
      assert.match(String(badRevise.error), /No question with id/)

      const removed = await run(planRemoveQuestionTool, { id: q.id })
      assert.equal(removed.ok, true)
      assert.equal(removed.totalQuestions, 0)
      assert.equal(getActivePlan()?.questions.length, 0)
      const badRemove = await run(planRemoveQuestionTool, { id: q.id })
      assert.equal(badRemove.ok, false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('updates a task to done and finishes the plan', async () => {
    const root = tmpProject({})
    try {
      const doc = createPlan({ title: 'Build it', kind: 'feature', level: 2, goal: 'Build the thing' }, root)
      doc.tasks.push({ id: 'task-1', text: 'Build the thing', status: 'todo' })
      savePlan(doc)

      const updated = await run(planUpdateTaskTool, { id: 'task-1', status: 'done', detail: 'Built and verified' })
      assert.equal(updated.ok, true)
      assert.equal(updated.done, 1)
      assert.equal(updated.total, 1)
      const badTask = await run(planUpdateTaskTool, { id: 'task-nope', status: 'done' })
      assert.equal(badTask.ok, false)
      assert.match(String(badTask.error), /No task with id/)

      const finished = await run(planFinishTool, { summary: 'Shipped the thing.' })
      assert.equal(finished.ok, true)
      const done = getPlan(doc.slug)
      assert.equal(done?.status, 'done')
      assert.equal(done?.review?.summary, 'Shipped the thing.')
      assert.equal(done?.tasks[0].detail, 'Built and verified')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

/**
 * Catalog + template tools: find-component reads the editor's real
 * catalog (Button is a stable shadcn stock entry); place-template and
 * install-catalog-component write into the project — the assertions
 * pin that the file lands where the result says, and that a second
 * placement/install is refused instead of replacing.
 */
describe('catalog + template tools execute()', () => {
  it('find-component: summary search, full entry by tag, error values', async () => {
    const root = tmpProject({})
    try {
      const search = await run(findComponentTool, { query: 'button' })
      assert.equal(search.ok, true)
      assert.equal(search.tier, 'summary')
      const found = search.components as Array<{ tag: string }>
      assert.ok(found.some(c => c.tag === 'Button'), 'expected Button in button search results')

      const full = await run(findComponentTool, { tag: 'Button' })
      assert.equal(full.ok, true)
      assert.equal(full.tier, 'full')
      assert.equal((full.component as { tag: string }).tag, 'Button')

      const missing = await run(findComponentTool, { tag: 'NoSuchThing' })
      assert.equal(missing.ok, false)
      assert.match(String(missing.error), /No catalog component tagged/)

      const neither = await run(findComponentTool, {})
      assert.equal(neither.ok, false)
      assert.match(String(neither.error), /Pass a query or a tag/)

      const nonsense = await run(findComponentTool, { query: 'xqzwkj' })
      assert.equal(nonsense.ok, true)
      assert.equal((nonsense.components as unknown[]).length, 0)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('place-template: lists, places once at the reported path, refuses a second place', async () => {
    const root = tmpProject({})
    try {
      const list = await run(placeTemplateTool, {})
      assert.equal(list.ok, true)
      const templates = list.templates as Array<{ id: string }>
      assert.ok(templates.some(t => t.id === 'pricing-section'))

      const placed = await run(placeTemplateTool, { template: 'pricing-section' })
      assert.equal(placed.ok, true)
      assert.equal(placed.dest, '/src/sections/PricingSection.jsx')
      assert.ok(fs.existsSync(path.join(root, 'src/sections/PricingSection.jsx')), 'file must land where the result reports')

      const again = await run(placeTemplateTool, { template: 'pricing-section' })
      assert.equal(again.ok, false)
      assert.match(String(again.error), /Already present/)

      const unknown = await run(placeTemplateTool, { template: 'no-such-template' })
      assert.equal(unknown.ok, false)
      assert.match(String(unknown.error), /No template with id/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('install-catalog-component: copies to the reported path, records the registry, refuses a repeat', async () => {
    const root = tmpProject({})
    try {
      const installed = await run(installCatalogComponentTool, { tag: 'Button' })
      assert.equal(installed.ok, true)
      assert.equal(installed.dest, '/src/components/ui/button.tsx')
      assert.ok(fs.existsSync(path.join(root, 'src/components/ui/button.tsx')), 'file must land where the result reports')
      const registry = JSON.parse(fs.readFileSync(path.join(root, '.ai-live/components.json'), 'utf-8')) as {
        components: Array<{ name: string, file: string, origin: string }>
      }
      assert.ok(registry.components.some(c => c.file === '/src/components/ui/button.tsx' && c.origin === 'catalog'))

      const again = await run(installCatalogComponentTool, { tag: 'Button' })
      assert.equal(again.ok, false)
      assert.match(String(again.error), /Already present/)

      const unknown = await run(installCatalogComponentTool, { tag: 'NoSuchThing' })
      assert.equal(unknown.ok, false)
      assert.match(String(unknown.error), /No catalog component tagged/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
