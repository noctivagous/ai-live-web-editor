import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FILE_LAYOUT_TOOLS, SKETCH_ACTIVE_TOOLS } from '../../agentTools.js'
import { inspectDOMTool, patchDOMTool, takeSnapshotTool } from './realFsTools.js'
import { layoutSnapshotTool, pageSectionsTool, runInPageTool } from './layoutTools.js'
import {
  buildScanProgram,
  buildSetProgram,
  normalizeScanResult,
  normalizeSetResult,
} from '../../workbench/runtimeState.js'
import { runtimeStateScanTool, runtimeStateSetTool } from './runtimeStateTools.js'

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> }).execute(input, {})

/**
 * Execute a built in-page program against a stub window: the same code
 * the bridge runs, verified offline — including the incident shape (a
 * lowercase stored copy found by a mixed-case search).
 */
function withWindow(stores: Record<string, Record<string, string>>) {
  const g = globalThis as Record<string, unknown>
  const saved = g.window
  const store = (data: Record<string, string>) => {
    const keys = Object.keys(data)
    return {
      get length() { return keys.length },
      key: (i: number): string | null => keys[i] ?? null,
      getItem: (k: string): string | null => (k in data ? data[k] : null),
      setItem: (k: string, v: string): void => {
        if (!keys.includes(k)) keys.push(k)
        data[k] = String(v)
      },
    }
  }
  g.window = Object.fromEntries(Object.entries(stores).map(([n, d]) => [n, store(d)]))
  return () => {
    if (saved === undefined) delete g.window
    else g.window = saved
  }
}

const SIGN_STATE = {
  'tile-banner-studio': JSON.stringify({ composition: { container: { children: [{ lines: [{ copy: 'noctivagous' }] }] } } }),
}

describe('scan program (in-page behaviour)', () => {
  it('finds a mixed-case target in a lowercase stored copy, with its JSON path', () => {
    const restore = withWindow({ localStorage: { ...SIGN_STATE }, sessionStorage: {} })
    try {
      const out = eval(buildScanProgram('Noctivagous')) as {
        ok: boolean, stores: Record<string, { key: string, bytes: number }[]>,
        hits: { store: string, key: string, path: string }[],
      }
      assert.equal(out.ok, true)
      assert.equal(out.stores.localStorage.length, 1)
      assert.equal(out.hits.length, 1)
      assert.equal(out.hits[0].store, 'localStorage')
      assert.equal(out.hits[0].key, 'tile-banner-studio')
      assert.match(out.hits[0].path, /copy/)
    } finally { restore() }
  })

  it('inventories keys and sizes with no match, and tolerates absent stores', () => {
    const restore = withWindow({ sessionStorage: { a: 'xy' } })
    try {
      const out = eval(buildScanProgram(null)) as { ok: boolean, stores: Record<string, unknown>, hits: unknown[] }
      assert.equal(out.ok, true)
      assert.deepEqual(out.stores.sessionStorage, [{ key: 'a', bytes: 2 }])
      assert.deepEqual(out.stores.localStorage, { error: 'absent' })
      assert.deepEqual(out.hits, [])
    } finally { restore() }
  })

  it('embeds a hostile match string without breaking the program', () => {
    const restore = withWindow({ localStorage: { k: 'v' }, sessionStorage: {} })
    try {
      const out = eval(buildScanProgram('a"b\\c\nd')) as { ok: boolean, match: string, hits: unknown[] }
      assert.equal(out.ok, true)
      assert.equal(out.match, 'a"b\\c\nd')
      assert.deepEqual(out.hits, [])
    } finally { restore() }
  })
})

describe('set program (in-page behaviour)', () => {
  it('sets a JSON path, verifies by read-back, and returns the backup', () => {
    const data = { ...SIGN_STATE }
    const restore = withWindow({ localStorage: data, sessionStorage: {} })
    try {
      const out = eval(buildSetProgram({
        store: 'localStorage',
        key: 'tile-banner-studio',
        path: 'composition.container.children[0].lines[0].copy',
        valueJson: JSON.stringify("farmers' market"),
        reload: false,
      })) as { ok: boolean, backup: string, reloaded?: boolean }
      assert.equal(out.ok, true)
      assert.equal(out.reloaded, undefined)
      assert.match(out.backup, /noctivagous/)
      assert.match(data['tile-banner-studio'], /farmers' market/)
    } finally { restore() }
  })

  it('replaces a whole value when no path is given', () => {
    const data = { k: 'old' }
    const restore = withWindow({ localStorage: data, sessionStorage: {} })
    try {
      const out = eval(buildSetProgram({ store: 'localStorage', key: 'k', valueJson: JSON.stringify({ n: 1 }), reload: false })) as { ok: boolean }
      assert.equal(out.ok, true)
      assert.equal(data.k, '{"n":1}')
    } finally { restore() }
  })

  it('refuses a path set on non-JSON with guidance', () => {
    const restore = withWindow({ localStorage: { k: 'plain' }, sessionStorage: {} })
    try {
      const out = eval(buildSetProgram({ store: 'localStorage', key: 'k', path: 'a.b', valueJson: '1', reload: false })) as { ok: boolean, error: string }
      assert.equal(out.ok, false)
      assert.match(out.error, /omit path/)
    } finally { restore() }
  })
})

describe('normalizers', () => {
  it('passes a valid scan through and rejects garbage as error values', () => {
    const good = normalizeScanResult({ ok: true, match: 'x', stores: {}, hits: [{ store: 's', key: 'k', path: 'a' }], hitsTruncated: false, indexedDB: false })
    assert.equal(good.ok, true)
    assert.equal((good as { hits: unknown[] }).hits.length, 1)
    assert.deepEqual(normalizeScanResult(null), { ok: false, error: 'unreadable scan result' })
    assert.deepEqual(normalizeScanResult({ ok: true }), { ok: false, error: 'unreadable scan result' })
  })

  it('passes a valid set result through and rejects garbage as error values', () => {
    const good = normalizeSetResult({ ok: true, store: 'localStorage', key: 'k', backup: 'old' })
    assert.deepEqual(good, { ok: true, store: 'localStorage', key: 'k', backup: 'old' })
    assert.deepEqual(normalizeSetResult('nope'), { ok: false, store: '', key: '', error: 'unreadable set result' })
  })
})

describe('bridge-unavailable behaviour', () => {
  it('scan returns the no-live-page error as a value, never a throw', async () => {
    const r = await run(runtimeStateScanTool, { match: 'sign' })
    assert.ok(r.error || r.ok === false, JSON.stringify(r))
    assert.match(String(r.error), /Vite page|live page/i)
  })

  it('set returns the no-live-page error as a value, never a throw', async () => {
    const r = await run(runtimeStateSetTool, { key: 'k', value: 'v' })
    assert.ok(r.error || r.ok === false, JSON.stringify(r))
    assert.match(String(r.error), /Vite page|live page/i)
  })

  it('set refuses an oversized value before touching the bridge', async () => {
    const r = await run(runtimeStateSetTool, { key: 'k', value: 'x'.repeat(1_000_001) })
    assert.match(String(r.error), /too large/)
  })
})

describe('registration', () => {
  it('both tools ride sketch turns and Files layout turns', () => {
    for (const id of ['runtime-state-scan', 'runtime-state-set']) {
      assert.ok((SKETCH_ACTIVE_TOOLS as readonly string[]).includes(id), id)
      assert.ok((FILE_LAYOUT_TOOLS as readonly string[]).includes(id), id)
    }
  })
})

describe('steering pointers (tool descriptions)', () => {
  it('take-snapshot admits its canvas blindness and points at the scan', () => {
    assert.ok(takeSnapshotTool.description?.includes('canvas'))
    assert.ok(takeSnapshotTool.description?.includes('runtime-state-scan'))
  })

  it('patch-dom admits it cannot change painted pixels and points at both tools', () => {
    assert.ok(patchDOMTool.description?.includes('canvas'))
    assert.ok(patchDOMTool.description?.includes('runtime-state-scan'))
    assert.ok(patchDOMTool.description?.includes('runtime-state-set'))
  })

  it('page-sections points painted content at the scan', () => {
    assert.ok(pageSectionsTool.description?.includes('runtime-state-scan'))
  })

  it('run-in-page stays check-only and points edits at the set tool', () => {
    assert.ok(runInPageTool.description?.includes('never to edit'))
    assert.ok(runInPageTool.description?.includes('runtime-state-set'))
  })

  it('inspect-dom stays positioned after the structural senses', () => {
    assert.ok(inspectDOMTool.description?.includes('layout-snapshot'))
  })

  it('layout-snapshot keeps its scopeSelector teaching', () => {
    assert.ok(layoutSnapshotTool.description?.includes('scopeSelector'))
  })

  it('scan and set point at each other', () => {
    assert.ok(runtimeStateScanTool.description?.includes('runtime-state-set'))
    assert.ok(runtimeStateSetTool.description?.includes('runtime-state-scan'))
  })
})
