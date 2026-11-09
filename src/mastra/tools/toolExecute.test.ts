import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from '../../launcher.js'
import { createPlan, getActivePlan, getPlan, savePlan } from '../../plans/plans.js'
import { findComponentTool } from './catalogTools.js'
import { pageSectionsTool, runInPageTool } from './layoutTools.js'
import { readSymbolTool, unpackCodeTool } from './codeTools.js'
import { codebaseMapTool, installCatalogComponentTool } from './codebaseMapTools.js'
import {
  featureAddNodeTool, featureBuildNodeTool, featureEditNodeTool, featureInstallPackTool, featureLinkTool, featureLintTool, featureQueryTool, featureReconcileTool, featureRemoveNodeTool, featureSetParamTool, featureSetStatusTool, featureUninstallPackTool, featureUnlinkTool,
} from './featureTools.js'
import {
  userflowAddStepTool, userflowDeriveSuggestionsTool, userflowLinkTool, userflowQueryTool, userflowSetVerificationTool,
} from './userflowTools.js'
import {
  planAddQuestionTool, planFinishTool, planFromGraphTool, planRemoveQuestionTool,
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
      assert.match(String(neither.error), /Pass a query, a tag, or a pack id/)

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

  it('find-component searches top-down: packs surface whole features, exact pack id returns the subgraph', async () => {
    const root = tmpProject({})
    try {
      const search = await run(findComponentTool, { query: 'admin configuration for a store' })
      assert.equal(search.ok, true)
      const packs = search.packs as Array<{ id: string }> | undefined
      assert.equal(packs?.[0]?.id, 'admin-configuration', 'the whole feature outranks its pieces')

      const pieces = await run(findComponentTool, { query: 'button' })
      assert.equal(pieces.ok, true)
      assert.equal(pieces.packs, undefined, 'piece words do not summon packs')

      const full = await run(findComponentTool, { pack: 'admin-configuration' })
      assert.equal(full.ok, true)
      assert.equal(full.tier, 'full')
      const pack = full.pack as { nodes: unknown[], externalLinks: unknown[] }
      assert.equal(pack.nodes.length, 6)
      assert.ok(pack.externalLinks.length >= 4, 'the pack declares how it configures the host app')

      const unknownPack = await run(findComponentTool, { pack: 'no-such-pack' })
      assert.equal(unknownPack.ok, false)
      assert.match(String(unknownPack.error), /No feature pack with id/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

/**
 * Feature graph tools: add-node bootstraps the graph, every mutation
 * persists to ai-features/, queries read the same store back, and
 * bad ids / duplicate edges come back as error values.
 */
describe('feature graph tools execute()', () => {
  it('queries and status on a graph-less project return the no-graph error value', async () => {
    const root = tmpProject({})
    try {
      const q = await run(featureQueryTool, { mode: 'overview' })
      assert.equal(q.ok, false)
      assert.match(String(q.error), /No feature graph/)
      const s = await run(featureSetStatusTool, { id: 'f-x', status: 'done' })
      assert.equal(s.ok, false)
      assert.match(String(s.error), /No feature graph/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('builds a small graph end to end: bootstrap, link, status, query', async () => {
    const root = tmpProject({})
    try {
      const region = await run(featureAddNodeTool, { name: 'Storefront', kind: 'region' })
      assert.equal(region.ok, true)
      const regionId = (region.node as { id: string }).id
      assert.ok(fs.existsSync(path.join(root, 'ai-features/graph.json')), 'first add bootstraps the graph')

      const badParent = await run(featureAddNodeTool, { name: 'Orphan', kind: 'feature', parentId: 'f-missing' })
      assert.equal(badParent.ok, false)
      assert.match(String(badParent.error), /No node with id/)

      const prices = await run(featureAddNodeTool, { name: 'Price display', kind: 'feature', parentId: regionId })
      const pricesId = (prices.node as { id: string }).id
      const currency = await run(featureAddNodeTool, {
        name: 'Currency', kind: 'setting', parentId: regionId,
        params: [{ name: 'currency', type: 'choice', options: ['USD', 'EUR'], default: 'USD' }],
      })
      const currencyId = (currency.node as { id: string }).id

      const linked = await run(featureLinkTool, { from: currencyId, to: pricesId, type: 'configures' })
      assert.equal(linked.ok, true)
      const dup = await run(featureLinkTool, { from: currencyId, to: pricesId, type: 'configures' })
      assert.equal(dup.ok, false)
      const badLink = await run(featureLinkTool, { from: currencyId, to: 'f-missing', type: 'configures' })
      assert.equal(badLink.ok, false)

      const configured = await run(featureQueryTool, { mode: 'configures', id: currencyId })
      assert.equal(configured.ok, true)
      assert.deepEqual((configured.configures as Array<{ id: string }>).map(n => n.id), [pricesId])

      const statused = await run(featureSetStatusTool, { id: pricesId, status: 'done' })
      assert.equal(statused.ok, true)
      assert.equal((statused.overall as { pct: number }).pct, 50, 'one of two counted leaves built (region excluded)')
      const badStatus = await run(featureSetStatusTool, { id: 'f-missing', status: 'done' })
      assert.equal(badStatus.ok, false)

      const overview = await run(featureQueryTool, { mode: 'overview' })
      assert.equal(overview.ok, true)
      assert.equal((overview.regions as unknown[]).length, 1)
      assert.ok(fs.existsSync(path.join(root, 'ai-features/graph.md')), 'rendered outline written beside the canonical json')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('feature-install-pack grafts a pack, refuses a repeat, and errors on unknown packs', async () => {
    const root = tmpProject({})
    try {
      const unknown = await run(featureInstallPackTool, { packId: 'no-such-pack' })
      assert.equal(unknown.ok, false)
      assert.match(String(unknown.error), /No feature pack with id/)

      const installed = await run(featureInstallPackTool, { packId: 'settings' })
      assert.equal(installed.ok, true)
      assert.equal((installed.added as unknown[]).length, 5)
      assert.equal(installed.totalNodes, 5)
      assert.ok(fs.existsSync(path.join(root, 'ai-features/graph.json')))

      const again = await run(featureInstallPackTool, { packId: 'settings' })
      assert.equal(again.ok, false)
      assert.match(String(again.error), /already installed/)

      const overview = await run(featureQueryTool, { mode: 'overview' })
      assert.equal(overview.ok, true)
      assert.equal((overview.overall as { total: number }).total, 5, 'the grafted settings nodes are in the graph and counted')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('the loop closes: plan-from-graph generates, plan-update-task writes node status back', async () => {
    const root = tmpProject({})
    try {
      const noGraph = await run(planFromGraphTool, { packId: 'auth' })
      assert.equal(noGraph.ok, false)
      assert.match(String(noGraph.error), /No feature graph/)

      await run(featureInstallPackTool, { packId: 'auth' })
      const generated = await run(planFromGraphTool, { packId: 'auth' })
      assert.equal(generated.ok, true)
      assert.equal(generated.kind, 'install')
      const tasks = generated.tasks as Array<{ id: string, text: string, nodeId: string }>
      const session = tasks.find(t => t.text === 'Session service')!
      assert.ok(session.nodeId)

      const doing = await run(planUpdateTaskTool, { id: session.id, status: 'doing' })
      assert.equal(doing.ok, true)
      const mid = await run(featureQueryTool, { mode: 'status', status: 'building' })
      assert.deepEqual((mid.nodes as Array<{ id: string }>).map(n => n.id), [session.nodeId], 'the node is building, via the plan save alone')

      const done = await run(planUpdateTaskTool, { id: session.id, status: 'done', detail: 'token issue/check in place' })
      assert.equal(done.ok, true)
      const after = await run(featureQueryTool, { mode: 'status', status: 'done' })
      assert.deepEqual((after.nodes as Array<{ id: string }>).map(n => n.id), [session.nodeId])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('build-out: feature-build-node places bindings, feature-set-param validates and writes the config file', async () => {
    const root = tmpProject({})
    try {
      const installed = await run(featureInstallPackTool, { packId: 'admin-configuration' })
      assert.equal(installed.ok, true)
      const added = installed.added as Array<{ id: string, name: string }>
      const currency = added.find(n => n.name === 'Currency & pricing')!

      // The graft seeded values from defaults — visible in the canonical graph.
      const graphDoc = JSON.parse(fs.readFileSync(path.join(root, 'ai-features/graph.json'), 'utf-8')) as
        { nodes: Array<{ id: string, values?: Record<string, string> }> }
      assert.equal(graphDoc.nodes.find(n => n.id === currency.id)?.values?.currency, 'USD')

      // Set-param validates against the schema, then writes graph + config.
      const bad = await run(featureSetParamTool, { id: currency.id, name: 'currency', value: 'BTC' })
      assert.equal(bad.ok, false)
      assert.match(String(bad.error), /not one of/)
      const set = await run(featureSetParamTool, { id: currency.id, name: 'currency', value: 'EUR' })
      assert.equal(set.ok, true)
      assert.equal(set.configFile, '/src/config/currency-pricing.json')
      const config = JSON.parse(fs.readFileSync(path.join(root, 'src/config/currency-pricing.json'), 'utf-8'))
      assert.equal(config.currency, 'EUR')
      assert.equal(config['tax-inclusive-prices'], 'false')

      // Building a bound node places its template + component and flips status.
      const bound = await run(featureAddNodeTool, {
        name: 'Pricing page', kind: 'screen', template: 'pricing-section', component: 'Button',
      })
      assert.equal(bound.ok, true)
      const boundId = (bound.node as { id: string }).id
      const built = await run(featureBuildNodeTool, { id: boundId })
      assert.equal(built.ok, true)
      const t = (built as { template?: { state: string, dest?: string } }).template
      assert.equal(t?.state, 'placed')
      assert.ok(fs.existsSync(path.join(root, '.' + (t?.dest ?? ''))))
      assert.equal((built as { component?: { state: string } }).component?.state, 'placed')
      assert.ok(fs.existsSync(path.join(root, 'src/components/ui/button.tsx')))
      const again = await run(featureBuildNodeTool, { id: boundId })
      assert.equal((again as { template?: { state: string } }).template?.state, 'already')
      assert.equal((again as { component?: { state: string } }).component?.state, 'already')
      const building = await run(featureQueryTool, { mode: 'status', status: 'building' })
      assert.ok((building.nodes as Array<{ id: string }>).some(n => n.id === boundId))

      const missing = await run(featureBuildNodeTool, { id: 'f-nope' })
      assert.equal(missing.ok, false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('editing: rename/reparent, unlink, remove lift, lint, and pack uninstall through execute()', async () => {
    const root = tmpProject({})
    try {
      const region = await run(featureAddNodeTool, { name: 'Storefront', kind: 'region' })
      const regionId = (region.node as { id: string }).id
      const child = await run(featureAddNodeTool, { name: 'Prices', kind: 'feature', parentId: regionId })
      const childId = (child.node as { id: string }).id

      const renamed = await run(featureEditNodeTool, { id: childId, name: 'Price board' })
      assert.equal(renamed.ok, true)
      assert.equal((renamed.node as { name: string }).name, 'Price board')
      const cyclic = await run(featureEditNodeTool, { id: regionId, parentId: childId })
      assert.equal(cyclic.ok, false)
      assert.match(String(cyclic.error), /containment cycle/)
      const detached = await run(featureEditNodeTool, { id: childId, parentId: null })
      assert.equal(detached.ok, true)
      assert.equal((detached.node as { parent?: string }).parent, undefined)

      const linked = await run(featureLinkTool, { from: childId, to: regionId, type: 'renders' })
      assert.equal(linked.ok, true)
      const unlinked = await run(featureUnlinkTool, { from: childId, to: regionId, type: 'renders' })
      assert.equal(unlinked.ok, true)
      const unlinkMiss = await run(featureUnlinkTool, { from: childId, to: regionId, type: 'renders' })
      assert.equal(unlinkMiss.ok, false)

      const clean = await run(featureLintTool, {})
      assert.equal(clean.ok, true)
      assert.deepEqual(clean.problems, [])

      // Break the graph on disk the way a hand edit could, then lint sees it.
      const file = path.join(root, 'ai-features/graph.json')
      const doc = JSON.parse(fs.readFileSync(file, 'utf-8')) as { nodes: Array<{ id: string, parent?: string }> }
      doc.nodes.find(n => n.id === childId)!.parent = 'f-ghost'
      fs.writeFileSync(file, JSON.stringify(doc))
      const dirty = await run(featureLintTool, {})
      assert.equal(dirty.ok, false)
      assert.ok((dirty.problems as Array<{ kind: string }>).some(p => p.kind === 'dangling-parent'))

      const removed = await run(featureRemoveNodeTool, { id: regionId, mode: 'lift' })
      assert.equal(removed.ok, true)
      assert.equal(removed.totalNodes, 1, 'the child survives a lift removal of its region')

      const installed = await run(featureInstallPackTool, { packId: 'printing' })
      assert.equal(installed.ok, true)
      const uninstalled = await run(featureUninstallPackTool, { packId: 'printing' })
      assert.equal(uninstalled.ok, true)
      assert.equal((uninstalled.removed as unknown[]).length, 5)
      assert.equal(uninstalled.totalNodes, 1)
      const uninstallMiss = await run(featureUninstallPackTool, { packId: 'printing' })
      assert.equal(uninstallMiss.ok, false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('pending links persist, resurface on add-node, and reconcile reports drift', async () => {
    const root = tmpProject({})
    try {
      const installed = await run(featureInstallPackTool, { packId: 'printing' })
      assert.equal(installed.ok, true)
      assert.equal((installed.pendingLinks as unknown[]).length, 2, 'unwired links recorded on the graph, not just reported')

      const pending = await run(featureQueryTool, { mode: 'pending' })
      assert.equal(pending.ok, true)
      assert.equal((pending.pendingLinks as Array<{ fromName: string }>)[0].fromName, 'Document content')

      // Adding the matching node wires the pendings and says so.
      const invoice = await run(featureAddNodeTool, { name: 'Invoice list', kind: 'data' })
      assert.equal(invoice.ok, true)
      assert.equal((invoice.resolvedLinks as unknown[]).length, 2)
      const after = await run(featureQueryTool, { mode: 'pending' })
      assert.deepEqual(after.pendingLinks, [])

      // Reconcile: nothing done yet, so nothing to check.
      const clean = await run(featureReconcileTool, {})
      assert.equal(clean.ok, true)
      assert.equal(clean.checked, 0)

      // Claim a component is done without placing it: drift.
      const btn = await run(featureAddNodeTool, { name: 'Save button', kind: 'component', component: 'Button' })
      const btnId = (btn.node as { id: string }).id
      await run(featureSetStatusTool, { id: btnId, status: 'done' })
      const drifted = await run(featureReconcileTool, {})
      assert.equal(drifted.ok, false)
      assert.equal((drifted.drift as unknown[]).length, 1)

      // Build it out and the drift clears.
      await run(featureBuildNodeTool, { id: btnId })
      const healed = await run(featureReconcileTool, {})
      assert.equal(healed.ok, true)
      assert.deepEqual(healed.drift, [])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

/**
 * Feature graph tools: add-node bootstraps the graph, every mutation
 * persists to ai-features/, queries read the same store back, and
 * bad ids / duplicate edges come back as error values.
 */
describe('feature graph tools execute()', () => {
  it('queries and status on a graph-less project return the no-graph error value', async () => {
    const root = tmpProject({})
    try {
      const q = await run(featureQueryTool, { mode: 'overview' })
      assert.equal(q.ok, false)
      assert.match(String(q.error), /No feature graph/)
      const s = await run(featureSetStatusTool, { id: 'f-x', status: 'done' })
      assert.equal(s.ok, false)
      assert.match(String(s.error), /No feature graph/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('builds a small graph end to end: bootstrap, link, status, query', async () => {
    const root = tmpProject({})
    try {
      const region = await run(featureAddNodeTool, { name: 'Storefront', kind: 'region' })
      assert.equal(region.ok, true)
      const regionId = (region.node as { id: string }).id
      assert.ok(fs.existsSync(path.join(root, 'ai-features/graph.json')), 'first add bootstraps the graph')

      const badParent = await run(featureAddNodeTool, { name: 'Orphan', kind: 'feature', parentId: 'f-missing' })
      assert.equal(badParent.ok, false)
      assert.match(String(badParent.error), /No node with id/)

      const prices = await run(featureAddNodeTool, { name: 'Price display', kind: 'feature', parentId: regionId })
      const pricesId = (prices.node as { id: string }).id
      const currency = await run(featureAddNodeTool, {
        name: 'Currency', kind: 'setting', parentId: regionId,
        params: [{ name: 'currency', type: 'choice', options: ['USD', 'EUR'], default: 'USD' }],
      })
      const currencyId = (currency.node as { id: string }).id

      const linked = await run(featureLinkTool, { from: currencyId, to: pricesId, type: 'configures' })
      assert.equal(linked.ok, true)
      const dup = await run(featureLinkTool, { from: currencyId, to: pricesId, type: 'configures' })
      assert.equal(dup.ok, false)
      const badLink = await run(featureLinkTool, { from: currencyId, to: 'f-missing', type: 'configures' })
      assert.equal(badLink.ok, false)

      const configured = await run(featureQueryTool, { mode: 'configures', id: currencyId })
      assert.equal(configured.ok, true)
      assert.deepEqual((configured.configures as Array<{ id: string }>).map(n => n.id), [pricesId])

      const statused = await run(featureSetStatusTool, { id: pricesId, status: 'done' })
      assert.equal(statused.ok, true)
      assert.equal((statused.overall as { pct: number }).pct, 50, 'one of two counted leaves built (region excluded)')
      const badStatus = await run(featureSetStatusTool, { id: 'f-missing', status: 'done' })
      assert.equal(badStatus.ok, false)

      const overview = await run(featureQueryTool, { mode: 'overview' })
      assert.equal(overview.ok, true)
      assert.equal((overview.regions as unknown[]).length, 1)
      assert.ok(fs.existsSync(path.join(root, 'ai-features/graph.md')), 'rendered outline written beside the canonical json')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

/**
 * User flow graph tools: add-step bootstraps the graph (and the
 * journey, when the name is new), links validate on both sides of
 * the exercises join, verification records and clears blocks, and
 * queries read the same store back.
 */
describe('user flow graph tools execute()', () => {
  it('queries and verification on a graph-less project return the no-graph error value', async () => {
    const root = tmpProject({})
    try {
      const q = await run(userflowQueryTool, { mode: 'overview' })
      assert.equal(q.ok, false)
      assert.match(String(q.error), /No user flow graph/)
      const v = await run(userflowSetVerificationTool, { id: 's-x', state: 'ok' })
      assert.equal(v.ok, false)
      assert.match(String(v.error), /No user flow graph/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('builds a flow end to end: bootstrap, links both ways, verification, coverage', async () => {
    const root = tmpProject({})
    try {
      // A feature to exercise — coverage reads the two graphs together.
      const feature = await run(featureAddNodeTool, { name: 'Payments', kind: 'service' })
      assert.equal(feature.ok, true)
      const paymentsId = (feature.node as { id: string }).id

      const cart = await run(userflowAddStepTool, { journey: 'Checkout', name: 'Cart page', type: 'screen' })
      assert.equal(cart.ok, true)
      assert.equal((cart.journey as { created?: boolean }).created, true, 'a new journey name starts the journey')
      assert.ok(fs.existsSync(path.join(root, 'ai-user-flows/graph.json')), 'first add bootstraps the graph')
      const cartId = (cart.step as { id: string }).id

      const pay = await run(userflowAddStepTool, { journey: 'Checkout', name: 'Pay with card', type: 'action' })
      assert.equal(pay.ok, true)
      assert.equal((pay.journey as { created?: boolean }).created, undefined, 'the same journey name reuses the journey')
      const payId = (pay.step as { id: string }).id

      const linked = await run(userflowLinkTool, { from: cartId, to: payId, type: 'navigates-to' })
      assert.equal(linked.ok, true)
      const dup = await run(userflowLinkTool, { from: cartId, to: payId, type: 'navigates-to' })
      assert.equal(dup.ok, false)
      const badLink = await run(userflowLinkTool, { from: cartId, to: 's-missing', type: 'navigates-to' })
      assert.equal(badLink.ok, false)

      const badExercises = await run(userflowLinkTool, { from: payId, to: 'f-missing', type: 'exercises' })
      assert.equal(badExercises.ok, false)
      assert.match(String(badExercises.error), /No node with id/)
      const exercised = await run(userflowLinkTool, { from: payId, to: paymentsId, type: 'exercises' })
      assert.equal(exercised.ok, true)

      const blocked = await run(userflowSetVerificationTool, {
        id: payId, state: 'blocked', blockKind: 'missing-affordance',
        evidence: 'No pay button on the cart page', runId: 'dogfood-1',
      })
      assert.equal(blocked.ok, true)
      assert.equal((blocked.step as { block?: { kind: string } }).block?.kind, 'missing-affordance')
      const badStep = await run(userflowSetVerificationTool, { id: 's-missing', state: 'ok' })
      assert.equal(badStep.ok, false)

      const coverage = await run(userflowQueryTool, { mode: 'coverage' })
      assert.equal(coverage.ok, true)
      assert.deepEqual(coverage.neverExercised, [])
      assert.deepEqual((coverage.stepsWithoutFeatures as Array<{ id: string }>).map(s => s.id), [cartId])
      assert.deepEqual(
        (coverage.blockedFeatures as Array<{ feature: { id: string } }>).map(b => b.feature.id),
        [paymentsId],
        'the blocked pay step implicates the feature it exercises',
      )

      const cleared = await run(userflowSetVerificationTool, { id: payId, state: 'ok' })
      assert.equal(cleared.ok, true)
      assert.equal((cleared.step as { block?: unknown }).block, undefined, 'verifying ok clears the block')

      const overview = await run(userflowQueryTool, { mode: 'overview' })
      assert.equal(overview.ok, true)
      assert.equal((overview.counts as { steps: number, ok: number }).steps, 2)
      assert.equal((overview.counts as { steps: number, ok: number }).ok, 1)
      assert.ok(fs.existsSync(path.join(root, 'ai-user-flows/graph.md')), 'rendered outline written beside the canonical json')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('derive-suggestions reflects the flow records into the feature graph, idempotently', async () => {
    const root = tmpProject({})
    try {
      const noFlow = await run(userflowDeriveSuggestionsTool, {})
      assert.equal(noFlow.ok, false)
      assert.match(String(noFlow.error), /No user flow graph/)

      const feature = await run(featureAddNodeTool, { name: 'Payments', kind: 'service' })
      const paymentsId = (feature.node as { id: string }).id
      const cart = await run(userflowAddStepTool, { journey: 'Checkout', name: 'Cart page', type: 'screen' })
      const cartId = (cart.step as { id: string }).id
      const pay = await run(userflowAddStepTool, { journey: 'Checkout', name: 'Pay with card', type: 'action' })
      const payId = (pay.step as { id: string }).id
      await run(userflowLinkTool, { from: payId, to: paymentsId, type: 'exercises' })
      await run(userflowSetVerificationTool, {
        id: payId, state: 'blocked', blockKind: 'missing-affordance',
        evidence: 'No pay button on the cart page', runId: 'dogfood-1',
      })

      const derived = await run(userflowDeriveSuggestionsTool, {})
      assert.equal(derived.ok, true)
      assert.equal(derived.created, 2, 'a fix for the blocked step + coverage for the feature-less cart step')
      assert.deepEqual(
        [...(derived.createdNames as string[])].sort(),
        ['Add feature for Cart page', 'Fix Pay with card (missing-affordance)'],
      )
      assert.equal(derived.live, 2)
      const graphJson = JSON.parse(fs.readFileSync(path.join(root, 'ai-features/graph.json'), 'utf-8')) as {
        nodes: { name: string, status: string, suggestion?: { stepId: string } }[],
      }
      const fix = graphJson.nodes.find(n => n.suggestion?.stepId === payId)
      assert.equal(fix?.status, 'suggested')
      assert.ok(graphJson.nodes.some(n => n.name === 'Suggested by dogfooding' && n.status !== 'suggested'))

      const again = await run(userflowDeriveSuggestionsTool, {})
      assert.equal(again.created, 0, 'idempotent — no duplicates')
      assert.equal(again.alreadyLive, 2)

      // The step verifies ok on a later run: the fix is withdrawn,
      // the coverage suggestion (cart still exercises nothing) stays.
      await run(userflowSetVerificationTool, { id: payId, state: 'ok' })
      const afterOk = await run(userflowDeriveSuggestionsTool, {})
      assert.equal(afterOk.withdrawn, 1)
      assert.equal(afterOk.live, 1)
      assert.ok(cartId)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('unpack-code execute()', () => {
  const DENSE = 'const a=1;function go(x){return x+a}const h=(y)=>y*3;'

  it('writes a formatted copy under .ai-live/unpacked and returns its section map', async () => {
    const root = tmpProject({ 'dist/bundle.min.js': DENSE })
    try {
      const r = await run(unpackCodeTool, { path: '/dist/bundle.min.js' })
      assert.equal(r.ok, true)
      assert.equal(r.path, '/dist/bundle.min.js')
      assert.equal(r.unpackedPath, '/.ai-live/unpacked/dist/bundle.min.js')
      assert.equal(r.originalLines, 1)
      assert.ok(Number(r.formattedLines) > 3, String(r.formattedLines))
      const names = (r.sections as { name: string }[]).map((s) => s.name)
      assert.ok(names.includes('go'), names.join(','))
      assert.ok(names.includes('h'), names.join(','))
      const copy = fs.readFileSync(path.join(root, '.ai-live', 'unpacked', 'dist', 'bundle.min.js'), 'utf8')
      assert.ok(copy.split('\n').length > 3)
      // The original is never touched.
      assert.equal(fs.readFileSync(path.join(root, 'dist', 'bundle.min.js'), 'utf8'), DENSE)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses non-code files, escapes, and its own output', async () => {
    const root = tmpProject({ 'styles.css': 'a { color: red }', 'ok.js': 'const a = 1;' })
    try {
      const css = await run(unpackCodeTool, { path: '/styles.css' })
      assert.equal(css.ok, false)
      assert.match(String(css.error), /handles JS\/TS files/)
      const escape = await run(unpackCodeTool, { path: '../outside.js' })
      assert.equal(escape.ok, false)
      const missing = await run(unpackCodeTool, { path: '/nope.js' })
      assert.equal(missing.ok, false)
      assert.match(String(missing.error), /No such file/)
      await run(unpackCodeTool, { path: '/ok.js' })
      const again = await run(unpackCodeTool, { path: '/.ai-live/unpacked/ok.js' })
      assert.equal(again.ok, false)
      assert.match(String(again.error), /already an unpacked copy/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('read-symbol execute()', () => {
  const DENSE = 'const a=1;function go(x){return x+a}const h=(y)=>y*3;'

  it('pulls one named symbol out of a dense file without the rest', async () => {
    const root = tmpProject({ 'dist/bundle.min.js': DENSE })
    try {
      const r = await run(readSymbolTool, { path: '/dist/bundle.min.js', name: 'go' })
      assert.equal(r.ok, true)
      assert.equal(r.matchCount, 1)
      const m = (r.matches as { kind: string, source: string, truncated: boolean }[])[0]
      assert.equal(m.kind, 'function')
      assert.ok(m.source.includes('return x + a'), m.source)
      assert.ok(!m.source.includes('y * 3'), m.source)
      assert.equal(m.truncated, false)
      // The unpacked copy exists for follow-up ranged reads.
      assert.ok(fs.existsSync(path.join(root, '.ai-live', 'unpacked', 'dist', 'bundle.min.js')))
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('reports a miss with the names that do exist, and reads from a copy path', async () => {
    const root = tmpProject({ 'mod.js': DENSE })
    try {
      const miss = await run(readSymbolTool, { path: '/mod.js', name: 'nope' })
      assert.equal(miss.ok, false)
      assert.match(String(miss.error), /No top-level symbol named nope/)
      assert.ok((miss.available as string[]).includes('go'))
      assert.ok((miss.available as string[]).includes('h'))
      const fromCopy = await run(readSymbolTool, { path: '/.ai-live/unpacked/mod.js', name: 'h' })
      assert.equal(fromCopy.ok, true)
      assert.equal(fromCopy.unpackedPath, '/.ai-live/unpacked/mod.js')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('run-in-page execute()', () => {
  it('returns the no-live-page error as a value when nothing is connected', async () => {
    const r = await run(runInPageTool, { code: 'return 1' })
    assert.ok(r.error || r.ok === false, JSON.stringify(r))
    assert.match(String(r.error), /Vite page/)
  })
})

describe('page-sections execute()', () => {
  it('returns the no-live-page error as a value when nothing is connected', async () => {
    // No bridge client is connected in the test environment and no url
    // is passed, so the eval never leaves the bridge: the tool must
    // surface that as an error value, never a throw. (The program
    // itself is verified live against a real Chromium page; the
    // normalizer has its own unit suite.)
    const r = await run(pageSectionsTool, {})
    assert.ok(r.error || r.ok === false, JSON.stringify(r))
    // The bridge's exact wording varies by channel ('No live Vite page
    // connected' vs 'Vite page not reachable on :5173'); the contract
    // pinned here is an error value naming the page, never a throw.
    assert.match(String(r.error), /Vite page/)
  })
})
