import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import express from 'express'
import type { Server } from 'node:http'
import { getFsRoot, setFsRoot } from '../launcher.js'
import { markPageOwner, mountPageBridge } from '../pageBridge.js'
import { loadTemplates } from '../catalog/templates.js'
import { addEdge, addNode, createFeatureGraph, saveFeatureGraph } from '../features/features.js'
import { loadSkillCriteria } from '../skills/criteria.js'
import { activeSkills } from '../skills/skills.js'
import {
  planAddQuestionTool, planFinishTool, planFromGraphTool, planRemoveQuestionTool,
  planReviseQuestionTool, planUpdateTaskTool,
} from '../mastra/tools/planTools.js'
import { readSkillTool, runSkillChecksTool } from '../mastra/tools/skillTools.js'
import { findComponentTool } from '../mastra/tools/catalogTools.js'
import {
  adoptRegistryTool, codebaseMapTool, installCatalogComponentTool,
} from '../mastra/tools/codebaseMapTools.js'
import { placeTemplateTool } from '../mastra/tools/templateTools.js'
import { runtimeStateScanTool, runtimeStateSetTool } from '../mastra/tools/runtimeStateTools.js'
import { readSymbolTool, unpackCodeTool } from '../mastra/tools/codeTools.js'
import { PROJECT_TOOL_NAMES, runProjectTool } from './projectTools.js'

/**
 * Wave-4 group-A project-tool tests (slice 5). Same claim as
 * waves 1–3: PARITY — runProjectTool returns exactly what the
 * Mastra tool's execute returns. Stateful groups (plans, codebase
 * map / catalog / template writes, code tools) run ONE scripted
 * sequence through both paths against two identically-seeded
 * project roots and deepEqual every result plus the final on-disk
 * trees; store ids and timestamps are normalized through a
 * per-root registry that assigns placeholders in observation
 * order, so run A's k-th id and run B's k-th id compare equal.
 * Global-state groups (skills, catalog reads) run both
 * implementations back to back. Runtime-state proves the
 * no-page error parity plus a fake-bridge-page positive scan/set.
 */

const runMastra = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<any> }).execute(input, {})

const MASTRA_TOOLS: Record<string, unknown> = {
  'plan-add-question': planAddQuestionTool,
  'plan-remove-question': planRemoveQuestionTool,
  'plan-revise-question': planReviseQuestionTool,
  'plan-update-task': planUpdateTaskTool,
  'plan-finish': planFinishTool,
  'plan-from-graph': planFromGraphTool,
  'read-skill': readSkillTool,
  'run-skill-checks': runSkillChecksTool,
  'find-component': findComponentTool,
  'codebase-map': codebaseMapTool,
  'adopt-registry': adoptRegistryTool,
  'install-catalog-component': installCatalogComponentTool,
  'place-template': placeTemplateTool,
  'runtime-state-scan': runtimeStateScanTool,
  'runtime-state-set': runtimeStateSetTool,
  'unpack-code': unpackCodeTool,
  'read-symbol': readSymbolTool,
}

const ISO_RE = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g

class Registry {
  private map = new Map<string, string>()
  private counters: Record<string, number> = {}

  private add(id: unknown, kind: string) {
    if (typeof id !== 'string' || !id || this.map.has(id)) return
    this.counters[kind] = (this.counters[kind] ?? 0) + 1
    this.map.set(id, `$${kind}${this.counters[kind]}`)
  }

  /** Register store ids visible on disk, in file order. */
  observe(root: string) {
    const plansDir = path.join(root, 'ai-plans')
    if (fs.existsSync(plansDir)) {
      for (const f of fs.readdirSync(plansDir).sort()) {
        if (!f.endsWith('.json')) continue
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(plansDir, f), 'utf8'))
          this.add(doc.slug, 'plan')
          for (const q of doc.questions ?? []) this.add(q.id, 'q')
          for (const t of doc.tasks ?? []) this.add(t.id, 't')
        } catch { /* not a plan file */ }
      }
    }
    try {
      const g = JSON.parse(fs.readFileSync(path.join(root, 'ai-features', 'graph.json'), 'utf8'))
      for (const n of g.nodes ?? []) this.add(n.id, 'f')
    } catch { /* no graph */ }
  }

  resolve(placeholder: string): string {
    for (const [id, ph] of this.map) if (ph === placeholder) return id
    throw new Error(`unresolved placeholder ${placeholder}`)
  }

  normalize(value: unknown, root: string): unknown {
    if (Array.isArray(value)) return value.map(v => this.normalize(v, root))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = (k === 'createdAt' || k === 'updatedAt' || k === 'at') && typeof v === 'number'
          ? 0
          : this.normalize(v, root)
      }
      return out
    }
    if (typeof value === 'string') {
      let s = value.split(root).join('ROOT').replace(ISO_RE, 'TS')
        // Timestamps inside serialized file contents (plan JSON on disk).
        .replace(/"(createdAt|updatedAt|at)":\s*\d+/g, '"$1": 0')
      for (const [id, ph] of [...this.map].sort((a, b) => b[0].length - a[0].length)) {
        s = s.split(id).join(ph)
      }
      return s
    }
    return value
  }
}

function tmpProj(tag: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `project-parity-${tag}-`))
  const root = path.join(base, 'proj')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function treeOf(root: string, sub: string): Record<string, string> {
  const base = path.join(root, sub)
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else out[path.relative(base, full)] = fs.readFileSync(full, 'utf8')
    }
  }
  walk(base)
  return out
}

const ORIGINAL_ROOT = getFsRoot()
after(() => { setFsRoot(ORIGINAL_ROOT) })

describe('runProjectTool dispatch', () => {
  it('knows exactly the seventeen group-A names', () => {
    assert.deepEqual([...PROJECT_TOOL_NAMES].sort(), Object.keys(MASTRA_TOOLS).sort())
  })

  it('unknown tool names are an error value naming the available set', async () => {
    const r = await runProjectTool('nope', {}) as { ok: boolean; error: string }
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown project tool "nope"/)
    assert.match(r.error, /plan-add-question/)
  })
})

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

const SEED_PLAN = {
  slug: 'parity-plan', title: 'Parity Plan', kind: 'feature', level: 1, status: 'approved',
  goal: 'Check parity', considerations: [],
  questions: [{ id: 'qseed1', label: 'Seeded question?', control: 'text', default: 'seeded default' }],
  tasks: [{ id: 'tseed1', text: 'Seeded task', status: 'todo' }],
  createdAt: 1000, updatedAt: 1000,
}

function seedPlan(root: string) {
  const dir = path.join(root, 'ai-plans')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'parity-plan.json'), JSON.stringify(SEED_PLAN, null, 2), 'utf8')
  fs.writeFileSync(path.join(dir, '.active'), 'parity-plan', 'utf8')
}

describe('plan tools (twin seeded roots, scripted sequence)', () => {
  it('every result and the final plan files match the Mastra path', async () => {
    const rootA = tmpProj('plan-a')
    const rootB = tmpProj('plan-b')
    seedPlan(rootA)
    seedPlan(rootB)
    const regA = new Registry(); regA.observe(rootA)
    const regB = new Registry(); regB.observe(rootB)

    type Step = { tool: string; input: (reg: Registry) => Record<string, unknown> }
    const steps: Step[] = [
      { tool: 'plan-add-question', input: () => ({ label: 'Choice q', control: 'choice', options: ['a', 'b'], defaultProposal: 'a' }) },
      { tool: 'plan-add-question', input: () => ({ label: 'Text q', defaultProposal: 'none' }) },
      { tool: 'plan-revise-question', input: () => ({ id: 'qseed1', label: 'Seeded question, revised?', defaultProposal: 'new default' }) },
      { tool: 'plan-revise-question', input: () => ({ id: 'q-missing', label: 'x' }) },
      { tool: 'plan-remove-question', input: (reg) => ({ id: reg.resolve('$q2') }) },
      { tool: 'plan-remove-question', input: () => ({ id: 'q-missing' }) },
      { tool: 'plan-update-task', input: () => ({ id: 'tseed1', status: 'doing' }) },
      { tool: 'plan-update-task', input: () => ({ id: 'tseed1', status: 'done', detail: 'shipped' }) },
      { tool: 'plan-update-task', input: () => ({ id: 't-missing', status: 'done' }) },
      { tool: 'plan-finish', input: () => ({ summary: 'all done' }) },
    ]
    for (const step of steps) {
      setFsRoot(rootA)
      const theirs = await runMastra(MASTRA_TOOLS[step.tool], step.input(regA))
      regA.observe(rootA)
      setFsRoot(rootB)
      const mine = await runProjectTool(step.tool, step.input(regB))
      regB.observe(rootB)
      assert.deepEqual(regB.normalize(mine, rootB), regA.normalize(theirs, rootA), step.tool)
    }
    const treeA = treeOf(rootA, 'ai-plans')
    const treeB = treeOf(rootB, 'ai-plans')
    assert.deepEqual(
      Object.fromEntries(Object.entries(treeB).map(([k, v]) => [k, regB.normalize(v, rootB)])),
      Object.fromEntries(Object.entries(treeA).map(([k, v]) => [k, regA.normalize(v, rootA)])),
    )
  })

  it('no active plan: every plan tool returns the same refusal on both paths', async () => {
    const root = tmpProj('noplan')
    setFsRoot(root)
    for (const tool of ['plan-add-question', 'plan-remove-question', 'plan-revise-question', 'plan-update-task', 'plan-finish']) {
      const input = tool === 'plan-add-question' ? { label: 'x', defaultProposal: 'y' }
        : tool === 'plan-finish' ? { summary: 's' }
          : tool === 'plan-update-task' ? { id: 't1', status: 'done' }
            : { id: 'q1' }
      const mine = await runProjectTool(tool, input)
      const theirs = await runMastra(MASTRA_TOOLS[tool], input)
      assert.deepEqual(mine, theirs, tool)
      assert.match((mine as { error: string }).error, /No active plan/, tool)
    }
    const mine = await runProjectTool('plan-from-graph', { nodeId: 'nope' })
    const theirs = await runMastra(MASTRA_TOOLS['plan-from-graph'], { nodeId: 'nope' })
    assert.deepEqual(mine, theirs)
  })

  it('plan-from-graph over a seeded graph matches, plan files included', async () => {
    const seedGraph = (root: string) => {
      setFsRoot(root)
      const g = createFeatureGraph('Parity')
      const region = addNode(g, { name: 'Region', kind: 'region' })
      const feat = addNode(g, { name: 'Feat', kind: 'feature', parent: region.id })
      const dep = addNode(g, { name: 'Dep', kind: 'feature', parent: region.id })
      addEdge(g, { from: feat.id, to: dep.id, type: 'depends-on' })
      saveFeatureGraph(g)
      return region.id
    }
    const rootA = tmpProj('pfg-a')
    const rootB = tmpProj('pfg-b')
    const regionA = seedGraph(rootA)
    const regionB = seedGraph(rootB)
    const regA = new Registry(); regA.observe(rootA)
    const regB = new Registry(); regB.observe(rootB)

    setFsRoot(rootA)
    const theirs = await runMastra(MASTRA_TOOLS['plan-from-graph'], { nodeId: regionA })
    regA.observe(rootA)
    setFsRoot(rootB)
    const mine = await runProjectTool('plan-from-graph', { nodeId: regionB })
    regB.observe(rootB)
    assert.deepEqual(regB.normalize(mine, rootB), regA.normalize(theirs, rootA))
    const treeA = treeOf(rootA, 'ai-plans')
    const treeB = treeOf(rootB, 'ai-plans')
    assert.deepEqual(
      Object.fromEntries(Object.entries(treeB).map(([k, v]) => [k, regB.normalize(v, rootB)])),
      Object.fromEntries(Object.entries(treeA).map(([k, v]) => [k, regA.normalize(v, rootA)])),
    )
  })
})

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

describe('skill tools (shared editor state, back-to-back parity)', () => {
  it('read-skill returns the same body; unknown names the same refusal', async () => {
    const mine = await runProjectTool('read-skill', { name: 'making-layouts' })
    const theirs = await runMastra(MASTRA_TOOLS['read-skill'], { name: 'making-layouts' })
    assert.deepEqual(mine, theirs)
    assert.equal((mine as { ok: boolean }).ok, true)
    const mineErr = await runProjectTool('read-skill', { name: 'no-such-skill' })
    const theirsErr = await runMastra(MASTRA_TOOLS['read-skill'], { name: 'no-such-skill' })
    assert.deepEqual(mineErr, theirsErr)
  })

  it('run-skill-checks: unknown skill and no-criteria skill refuse identically', async () => {
    const mineErr = await runProjectTool('run-skill-checks', { skill: 'no-such-skill' })
    const theirsErr = await runMastra(MASTRA_TOOLS['run-skill-checks'], { skill: 'no-such-skill' })
    assert.deepEqual(mineErr, theirsErr)
    const noChecks = activeSkills().find(s => loadSkillCriteria(s.name).criteria.length === 0)
    assert.ok(noChecks, 'a shipped skill without verify.json criteria exists')
    const mine = await runProjectTool('run-skill-checks', { skill: noChecks.name })
    const theirs = await runMastra(MASTRA_TOOLS['run-skill-checks'], { skill: noChecks.name })
    assert.deepEqual(mine, theirs)
    assert.match((mine as { error: string }).error, /carries no checks/)
  })

  it('run-skill-checks on making-layouts (no page connected) matches verdict for verdict', async () => {
    const root = tmpProj('skillchecks')
    setFsRoot(root)
    const mine = await runProjectTool('run-skill-checks', { skill: 'making-layouts' })
    const theirs = await runMastra(MASTRA_TOOLS['run-skill-checks'], { skill: 'making-layouts' })
    assert.deepEqual(mine, theirs)
  })
})

/* ------------------------------------------------------------------ */
/* Catalog reads                                                       */
/* ------------------------------------------------------------------ */

describe('find-component (shared catalog, back-to-back parity)', () => {
  it('query, tag, pack and refusal shapes all match', async () => {
    for (const input of [
      { query: 'settings panel' },
      { tag: 'Button' },
      { pack: 'admin-configuration' },
      { pack: 'nope' },
      { tag: 'nope' },
      {},
      { query: 'zzzzqqq-nothing-matches' },
    ]) {
      const mine = await runProjectTool('find-component', input)
      const theirs = await runMastra(MASTRA_TOOLS['find-component'], input)
      assert.deepEqual(mine, theirs, JSON.stringify(input))
    }
  })
})

/* ------------------------------------------------------------------ */
/* Codebase map, catalog + template writes (twin roots)                */
/* ------------------------------------------------------------------ */

function seedSrcTree(root: string) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'twin', version: '0.0.0' }), 'utf8')
  fs.writeFileSync(path.join(root, 'src', 'main.jsx'),
    "import App from './App.jsx'\nexport function boot() { return App }\n", 'utf8')
  fs.writeFileSync(path.join(root, 'src', 'App.jsx'),
    'export default function App() { return <div><Button /></div> }\nfunction Button() { return <button>Hi</button> }\n', 'utf8')
}

describe('codebase-map + catalog/template writes (twin seeded roots)', () => {
  it('every result and the written files match the Mastra path', async () => {
    const rootA = tmpProj('map-a')
    const rootB = tmpProj('map-b')
    seedSrcTree(rootA)
    seedSrcTree(rootB)
    const regA = new Registry()
    const regB = new Registry()
    const firstTemplate = loadTemplates().templates[0]?.id
    assert.ok(firstTemplate, 'the catalog ships at least one template')

    type Step = { tool: string; input: Record<string, unknown> }
    const steps: Step[] = [
      { tool: 'codebase-map', input: {} },
      { tool: 'codebase-map', input: { focus: 'Button' } },
      { tool: 'codebase-map', input: { focus: 'no-such-thing' } },
      { tool: 'adopt-registry', input: {} },
      { tool: 'install-catalog-component', input: { tag: 'Button' } },
      { tool: 'install-catalog-component', input: { tag: 'Button' } },
      { tool: 'install-catalog-component', input: { tag: 'Nope' } },
      { tool: 'place-template', input: {} },
      { tool: 'place-template', input: { template: firstTemplate } },
      { tool: 'place-template', input: { template: firstTemplate } },
      { tool: 'place-template', input: { template: 'nope' } },
    ]
    for (const step of steps) {
      setFsRoot(rootA)
      const theirs = await runMastra(MASTRA_TOOLS[step.tool], step.input)
      setFsRoot(rootB)
      const mine = await runProjectTool(step.tool, step.input)
      assert.deepEqual(regB.normalize(mine, rootB), regA.normalize(theirs, rootA), step.tool)
    }
    // On-disk equality for everything the sequence wrote.
    const treeA = treeOf(rootA, '.')
    const treeB = treeOf(rootB, '.')
    assert.deepEqual(
      Object.fromEntries(Object.entries(treeB).map(([k, v]) => [k, regB.normalize(v, rootB)])),
      Object.fromEntries(Object.entries(treeA).map(([k, v]) => [k, regA.normalize(v, rootA)])),
    )
  })
})

/* ------------------------------------------------------------------ */
/* Code tools (twin roots)                                             */
/* ------------------------------------------------------------------ */

describe('code tools (twin seeded roots)', () => {
  it('unpack + read-symbol results and the unpacked copies match', async () => {
    const seed = (root: string) => {
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
      fs.mkdirSync(path.join(root, 'src'), { recursive: true })
      fs.writeFileSync(path.join(root, 'dist', 'bundle.min.js'),
        'function alpha(){return 1}function beta(x){return x+1}var gamma=42;\n', 'utf8')
      fs.writeFileSync(path.join(root, 'src', 'util.ts'),
        "export function checkout(cart) { return cart.total }\nexport const VERSION = '1.0'\n", 'utf8')
      fs.writeFileSync(path.join(root, 'src', 'style.css'), 'body { color: red }\n', 'utf8')
    }
    const rootA = tmpProj('code-a')
    const rootB = tmpProj('code-b')
    seed(rootA)
    seed(rootB)
    const steps: { tool: string; input: Record<string, unknown> }[] = [
      { tool: 'unpack-code', input: { path: '/dist/bundle.min.js' } },
      { tool: 'unpack-code', input: { path: '/.ai-live/unpacked/dist/bundle.min.js' } },
      { tool: 'unpack-code', input: { path: '/src/style.css' } },
      { tool: 'read-symbol', input: { path: '/dist/bundle.min.js', name: 'beta' } },
      { tool: 'read-symbol', input: { path: '/src/util.ts', name: 'checkout' } },
      { tool: 'read-symbol', input: { path: '/src/util.ts', name: 'nope' } },
    ]
    for (const step of steps) {
      setFsRoot(rootA)
      const theirs = await runMastra(MASTRA_TOOLS[step.tool], step.input)
      setFsRoot(rootB)
      const mine = await runProjectTool(step.tool, step.input)
      assert.deepEqual(mine, theirs, step.tool)
    }
    assert.deepEqual(treeOf(rootB, 'dist'), treeOf(rootA, 'dist'))
    assert.deepEqual(treeOf(rootB, '.ai-live'), treeOf(rootA, '.ai-live'))
  })
})

/* ------------------------------------------------------------------ */
/* Runtime state                                                       */
/* ------------------------------------------------------------------ */

describe('runtime-state tools with no live page (honest failures)', () => {
  before(() => { markPageOwner() })

  it('scan and set return the same error value on both paths', async () => {
    const root = tmpProj('rts-none')
    setFsRoot(root)
    for (const [tool, input] of [
      ['runtime-state-scan', {}],
      ['runtime-state-scan', { match: 'hero' }],
      ['runtime-state-set', { key: 'k', value: { a: 1 } }],
    ] as const) {
      const mine = await runProjectTool(tool, input)
      const theirs = await runMastra(MASTRA_TOOLS[tool], input)
      assert.deepEqual(mine, theirs, tool)
      assert.match(JSON.stringify(mine), /No live Vite page connected/, tool)
    }
  })
})

describe('runtime-state tools against a fake bridge page (parity + shaping)', () => {
  let server: Server
  let closePage: () => void = () => {}

  const SCAN_RAW = {
    ok: true, match: null,
    stores: {
      localStorage: { keys: [{ key: 'hero-banner', bytes: 42 }], totalBytes: 42 },
      sessionStorage: { keys: [], totalBytes: 0 },
    },
    hits: [], hitsTruncated: false, indexedDB: false,
  }
  const SET_RAW = { ok: true, store: 'localStorage', key: 'k', appliedBytes: 7, backup: null, reloaded: false }

  before(async () => {
    const app = express()
    app.use(express.json())
    mountPageBridge(app)
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
    const port = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${port}`
    const ctrl = new AbortController()
    closePage = () => ctrl.abort()
    const res = await fetch(`${base}/api/page/stream?top=1`, { signal: ctrl.signal })
    assert.ok(res.body, 'bridge stream opened')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          buf += decoder.decode(value, { stream: true })
          let cut = buf.indexOf('\n\n')
          while (cut >= 0) {
            const block = buf.slice(0, cut)
            buf = buf.slice(cut + 2)
            const line = block.split('\n').find((l) => l.startsWith('data:'))
            cut = buf.indexOf('\n\n')
            if (!line) continue
            let cmd: any
            try { cmd = JSON.parse(line.slice(5)) } catch { continue }
            if (!cmd || cmd.type === 'hello' || !cmd.id || !cmd.op) continue
            const code = String(cmd.payload?.code ?? '')
            const result = cmd.op === 'eval' && code.includes('var MATCH') ? SCAN_RAW
              : cmd.op === 'eval' && code.includes('var ARGS') ? SET_RAW
                : null
            await fetch(`${base}/api/page/result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result
                ? { id: cmd.id, ok: true, result }
                : { id: cmd.id, ok: false, error: `fake page does not answer ${cmd.op}` }),
            }).catch(() => { /* server closing */ })
          }
        }
      } catch { /* aborted at teardown */ }
    })()
    await new Promise((r) => setTimeout(r, 50))
  })

  after(async () => {
    closePage()
    await new Promise((resolve) => server.close(resolve))
  })

  it('scan normalizes the program result identically on both paths', async () => {
    const mine = await runProjectTool('runtime-state-scan', {}) as any
    const theirs = await runMastra(MASTRA_TOOLS['runtime-state-scan'], {}) as any
    assert.equal(mine.ok, true)
    assert.deepEqual(mine, theirs)
  })

  it('set returns the read-back result identically on both paths', async () => {
    const input = { key: 'k', value: { a: 1 } }
    const mine = await runProjectTool('runtime-state-set', input) as any
    const theirs = await runMastra(MASTRA_TOOLS['runtime-state-set'], input) as any
    assert.equal(mine.ok, true)
    assert.deepEqual(mine, theirs)
  })
})

/* ------------------------------------------------------------------ */
/* The HTTP endpoint the plugin calls (apiApp)                          */
/* ------------------------------------------------------------------ */

describe('the project-tool endpoint (apiApp)', () => {
  let server: Server
  let base = ''

  before(async () => {
    const { createApiApp } = await import('../apiApp.js')
    const api = createApiApp()
    await new Promise<void>((resolve) => { server = api.listen(0, '127.0.0.1', resolve) })
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  after(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('POST /api/project/tool dispatches and answers unknown tools as values', async () => {
    const okRes = await fetch(`${base}/api/project/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'read-skill', input: { name: 'making-layouts' } }),
    })
    const okBody = await okRes.json() as any
    assert.equal(okBody.ok, true)
    assert.equal(okBody.name, 'making-layouts')
    const badRes = await fetch(`${base}/api/project/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'nope', input: {} }),
    })
    const badBody = await badRes.json() as any
    assert.equal(badBody.ok, false)
    assert.match(badBody.error, /unknown tool "nope"/)
  })
})
