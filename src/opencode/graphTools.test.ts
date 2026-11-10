import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { getFsRoot, setFsRoot } from '../launcher.js'
import {
  featureAddNodeTool, featureBuildNodeTool, featureEditNodeTool, featureInstallPackTool,
  featureLinkTool, featureLintTool, featureQueryTool, featureReconcileTool,
  featureRemoveNodeTool, featureSetParamTool, featureSetStatusTool, featureUninstallPackTool,
  featureUnlinkTool,
} from '../mastra/tools/featureTools.js'
import {
  userflowAddStepTool, userflowDeriveSuggestionsTool, userflowLinkTool, userflowQueryTool,
  userflowSetVerificationTool,
} from '../mastra/tools/userflowTools.js'
import { GRAPH_TOOL_NAMES, runGraphTool } from './graphTools.js'

/**
 * Wave-3 graph-tool tests (slice 4). Same claim as waves 1–2:
 * PARITY — runGraphTool returns exactly what the Mastra tool's
 * execute returns. The graph tools are stateful writes, so parity
 * is proven by running ONE scripted sequence of calls through
 * both paths against two identically-seeded fresh project roots
 * and deepEqual-ing every result. Store ids are time-based
 * (`f<base36-time><seq>`), so an id registry — fed by re-reading
 * both graphs from disk after each step, in array (creation)
 * order — maps each run's ids to the same placeholders; ISO
 * timestamps (verification blocks) and store stamp numbers are
 * normalized the same way.
 */

const runMastra = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<any> }).execute(input, {})

const MASTRA_TOOLS: Record<string, unknown> = {
  'feature-add-node': featureAddNodeTool,
  'feature-set-status': featureSetStatusTool,
  'feature-link': featureLinkTool,
  'feature-install-pack': featureInstallPackTool,
  'feature-query': featureQueryTool,
  'feature-set-param': featureSetParamTool,
  'feature-build-node': featureBuildNodeTool,
  'feature-edit-node': featureEditNodeTool,
  'feature-remove-node': featureRemoveNodeTool,
  'feature-unlink': featureUnlinkTool,
  'feature-lint': featureLintTool,
  'feature-uninstall-pack': featureUninstallPackTool,
  'feature-reconcile': featureReconcileTool,
  'userflow-add-step': userflowAddStepTool,
  'userflow-set-verification': userflowSetVerificationTool,
  'userflow-link': userflowLinkTool,
  'userflow-derive-suggestions': userflowDeriveSuggestionsTool,
  'userflow-query': userflowQueryTool,
}

const ISO_RE = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g

class IdRegistry {
  private map = new Map<string, string>()
  private counters = { f: 0, j: 0, s: 0 }

  /** Register any not-yet-seen store ids, in the order they appear
   * in the on-disk graphs (creation order), so run A's k-th node
   * and run B's k-th node share a placeholder. */
  observe(root: string) {
    const read = (rel: string) => {
      try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8')) } catch { return null }
    }
    const features = read('ai-features/graph.json')
    if (features) for (const n of features.nodes ?? []) this.add(n.id)
    const flows = read('ai-user-flows/graph.json')
    if (flows) {
      for (const j of flows.journeys ?? []) this.add(j.id)
      for (const s of flows.steps ?? []) this.add(s.id)
    }
  }

  private add(id: unknown) {
    if (typeof id !== 'string' || this.map.has(id)) return
    const prefix = id[0] as 'f' | 'j' | 's'
    if (!(prefix in this.counters)) return
    this.counters[prefix] += 1
    this.map.set(id, `$${prefix}${this.counters[prefix]}`)
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
      // Ids appear both as whole values and embedded in error
      // strings ("No renders edge from <id> to <id>…") — replace
      // every registered occurrence, longest first.
      for (const [id, ph] of [...this.map].sort((a, b) => b[0].length - a[0].length)) {
        s = s.split(id).join(ph)
      }
      return s
    }
    return value
  }
}

function tmpProj(tag: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `graph-parity-${tag}-`))
  const root = path.join(base, 'proj')
  fs.mkdirSync(root, { recursive: true })
  return root
}

type Exec = (tool: string, input: Record<string, unknown>) => Promise<any>

/** One scripted sequence over both graph families. `$f1`-style
 * placeholders in inputs resolve through the run's own registry;
 * every result is normalized the same way. */
async function runScript(exec: Exec, root: string): Promise<unknown[]> {
  const reg = new IdRegistry()
  const results: unknown[] = []
  const call = async (tool: string, input: Record<string, unknown> = {}) => {
    const resolved: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      resolved[k] = typeof v === 'string' && /^\$[fjs]\d+$/.test(v) ? reg.resolve(v) : v
    }
    const r = await exec(tool, resolved)
    reg.observe(root)
    results.push(reg.normalize(r, root))
    return r
  }

  // Empty-project errors first (both families, no graph yet).
  await call('feature-query', { mode: 'overview' })
  await call('userflow-query', { mode: 'overview' })
  await call('userflow-derive-suggestions')

  // Features: create, link, mutate, query.
  await call('feature-add-node', { name: 'Storefront', kind: 'region' })
  await call('feature-add-node', { name: 'Checkout', kind: 'screen', parentId: '$f1' })
  await call('feature-add-node', {
    name: 'Currency', kind: 'setting', parentId: '$f1',
    params: [{ name: 'currency', type: 'choice', options: ['USD', 'EUR'], default: 'USD' }],
  })
  await call('feature-link', { from: '$f3', to: '$f2', type: 'configures' })
  await call('feature-set-status', { id: '$f2', status: 'building' })
  await call('feature-query', { mode: 'overview' })
  await call('feature-query', { mode: 'configures', id: '$f3' })
  await call('feature-query', { mode: 'prerequisites', id: '$f2' })
  await call('feature-set-param', { id: '$f3', name: 'currency', value: 'EUR' })
  await call('feature-build-node', { id: '$f3' })
  await call('feature-edit-node', { id: '$f2', name: 'Checkout flow' })
  await call('feature-query', { mode: 'search', text: 'Checkout' })
  await call('feature-query', { mode: 'status', status: 'building' })
  await call('feature-lint')
  await call('feature-reconcile')

  // A real pack in and back out (graft + uninstall parity).
  await call('feature-install-pack', { packId: 'settings' })
  await call('feature-query', { mode: 'pending' })
  await call('feature-uninstall-pack', { packId: 'settings' })

  // Feature error parity on the same live state.
  await call('feature-set-status', { id: 'f-missing', status: 'done' })
  await call('feature-add-node', { name: 'Orphan', kind: 'feature', parentId: 'f-missing' })
  await call('feature-link', { from: 'f-missing', to: '$f2', type: 'renders' })
  await call('feature-query', { mode: 'region', id: 'f-missing' })
  await call('feature-unlink', { from: '$f2', to: '$f3', type: 'renders' })
  await call('feature-install-pack', { packId: 'no-such-pack' })
  await call('feature-set-param', { id: '$f3', name: 'currency', value: 'JPY' })

  // Removal paths.
  await call('feature-unlink', { from: '$f3', to: '$f2', type: 'configures' })
  await call('feature-remove-node', { id: '$f3', mode: 'lift' })

  // User flows: create, link (incl. the cross-graph exercises
  // link), verify, query, derive.
  await call('userflow-add-step', { journey: 'Checkout', name: 'Cart page', type: 'screen' })
  await call('userflow-add-step', { journey: 'Checkout', name: 'Pay with card', type: 'action' })
  await call('userflow-link', { from: '$s1', to: '$s2', type: 'navigates-to' })
  await call('userflow-link', { from: '$s1', to: '$f2', type: 'exercises' })
  await call('userflow-set-verification', {
    id: '$s2', state: 'blocked', blockKind: 'console-error', evidence: 'pay failed: 500', runId: 'drive-1',
  })
  await call('userflow-query', { mode: 'overview' })
  await call('userflow-query', { mode: 'journey', id: 'Checkout' })
  await call('userflow-query', { mode: 'coverage' })
  await call('userflow-query', { mode: 'search', text: 'Pay' })
  await call('userflow-derive-suggestions')
  await call('feature-query', { mode: 'status', status: 'suggested' })

  // Userflow error parity.
  await call('userflow-set-verification', { id: 's-missing', state: 'ok' })
  await call('userflow-query', { mode: 'journey', id: 'Nowhere' })
  await call('userflow-link', { from: 's-missing', to: '$s1', type: 'submits' })
  await call('userflow-link', { from: '$s1', to: 'f-missing', type: 'exercises' })

  return results
}

const originalRoot = getFsRoot()
after(() => { setFsRoot(originalRoot) })

describe('runGraphTool dispatch', () => {
  it('knows exactly the eighteen wave-3 names', () => {
    assert.deepEqual([...GRAPH_TOOL_NAMES].sort(), Object.keys(MASTRA_TOOLS).sort())
    assert.equal(GRAPH_TOOL_NAMES.length, 18)
  })

  it('unknown names are an error value naming the available set', async () => {
    const r = await runGraphTool('nope', {}) as { ok: boolean; error: string }
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown graph tool "nope"/)
    assert.match(r.error, /feature-add-node/)
    assert.match(r.error, /userflow-query/)
  })
})

describe('graph tools parity (scripted sequence, Mastra vs ported)', () => {
  it('every result matches, and both stores land identical on disk', async () => {
    const rootA = tmpProj('a')
    const rootB = tmpProj('b')
    try {
      setFsRoot(rootA)
      const mine = await runScript((tool, input) => runGraphTool(tool, input), rootA)
      setFsRoot(rootB)
      const theirs = await runScript((tool, input) => runMastra(MASTRA_TOOLS[tool], input), rootB)
      assert.deepEqual(mine, theirs)

      // Derive-suggestions actually created suggestions in both runs
      // (the blocked step qualifies) — the normalized results already
      // prove it, but pin the headline count explicitly.
      const derive = mine.find((r: any) => r && typeof r === 'object' && 'createdNames' in r) as any
      assert.ok(derive.created >= 1, `expected suggestions, got ${JSON.stringify(derive)}`)

      // On-disk stores: normalize each with its own registry and compare.
      for (const rel of ['ai-features/graph.json', 'ai-user-flows/graph.json']) {
        const regA = new IdRegistry(); regA.observe(rootA)
        const regB = new IdRegistry(); regB.observe(rootB)
        const a = regA.normalize(JSON.parse(fs.readFileSync(path.join(rootA, rel), 'utf-8')), rootA)
        const b = regB.normalize(JSON.parse(fs.readFileSync(path.join(rootB, rel), 'utf-8')), rootB)
        assert.deepEqual(a, b, rel)
      }
      // The set-param config file the app reads: identical bytes.
      const cfgA = fs.readFileSync(path.join(rootA, 'src/config/currency.json'), 'utf-8')
      const cfgB = fs.readFileSync(path.join(rootB, 'src/config/currency.json'), 'utf-8')
      assert.equal(cfgA, cfgB)
      assert.match(cfgA, /EUR/)
    } finally {
      setFsRoot(originalRoot)
      fs.rmSync(path.dirname(rootA), { recursive: true, force: true })
      fs.rmSync(path.dirname(rootB), { recursive: true, force: true })
    }
  })
})

describe('graph endpoint (apiApp)', () => {
  it('POST /api/graph/tool dispatches and answers unknown tools as values', async () => {
    const { createApiApp } = await import('../apiApp.js')
    const api = createApiApp()
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = api.listen(0, '127.0.0.1', () => resolve(s))
    })
    const port = (server.address() as { port: number }).port
    const root = tmpProj('api')
    try {
      setFsRoot(root)
      const post = async (body: unknown) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/graph/tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        return res.json() as Promise<any>
      }
      const added = await post({ tool: 'userflow-add-step', input: { journey: 'J', name: 'First', type: 'screen' } })
      assert.equal(added.ok, true)
      assert.equal(added.step.name, 'First')
      const overview = await post({ tool: 'userflow-query', input: { mode: 'overview' } })
      assert.equal(overview.counts.steps, 1)
      const unknown = await post({ tool: 'nope', input: {} })
      assert.equal(unknown.ok, false)
      assert.match(unknown.error, /unknown tool "nope"/)
    } finally {
      setFsRoot(originalRoot)
      await new Promise<void>((r) => server.close(() => r()))
      fs.rmSync(path.dirname(root), { recursive: true, force: true })
    }
  })
})
