import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import express from 'express'
import type { Server } from 'node:http'
import { markPageOwner, mountPageBridge } from '../pageBridge.js'
import { PAGE_SECTIONS_PROGRAM } from '../workbench/pageSections.js'
import { layoutSnapshotTool, layoutSvgTool, pageSectionsTool, runInPageTool } from '../mastra/tools/layoutTools.js'
import { evalTool, inspectDOMTool, patchDOMTool, poolOpenTool, takeSnapshotTool } from '../mastra/tools/realFsTools.js'
import { PAGE_TOOL_NAMES, runPageTool } from './pageTools.js'

/**
 * Wave-1 page-tool dispatch tests. The core claim of the slice is
 * PARITY: runPageTool must return exactly what the Mastra tool's
 * execute returns for the same input over the same channel. So
 * these tests connect one fake bridge page (an SSE client that
 * answers ops with canned payloads in the real client's envelope
 * shapes) and run both implementations against it, plus the
 * honest-failure cases with no page connected.
 */

const runMastra = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<any> }).execute(input, {})

/** Bridge results carry the random per-command id from the result
 * envelope — an artifact both implementations receive identically;
 * strip it before equality checks. */
const stripId = (v: any) => {
  if (!v || typeof v !== 'object') return v
  const { id: _id, ...rest } = v
  return rest
}

const MASTRA_TOOLS: Record<string, unknown> = {
  'take-snapshot': takeSnapshotTool,
  'inspect-dom': inspectDOMTool,
  'page-sections': pageSectionsTool,
  'layout-snapshot': layoutSnapshotTool,
  'layout-svg': layoutSvgTool,
  'patch-dom': patchDOMTool,
  'eval-js': evalTool,
  'run-in-page': runInPageTool,
  'pool-open': poolOpenTool,
}

const SECTIONS_RESULT = {
  url: 'http://localhost:5173/', title: 'Fake App', mode: 'landmarks',
  viewport: { w: 800, h: 600 },
  sections: [{
    name: 'Hero', tag: 'section', role: 'region', selector: 'section.hero', aiLoc: '',
    depth: 0, rect: { x: 0, y: 0, w: 800, h: 200 }, digest: 'Welcome in', elements: 12, interactive: 3,
  }],
  outline: [{ level: 1, text: 'Fake App' }],
}

const LAYOUT_RAW = {
  ok: true, frame: 'top', schemaVersion: 2, coordinateSpace: 'viewport',
  page: { url: 'http://localhost:5173/', title: 'Fake App', viewport: { width: 800, height: 600 } },
  computedStyleWhitelist: ['display'],
  truncated: false,
  elements: [{
    stableId: 'e1', parentStableId: '', tag: 'section', selector: 'section.hero',
    rect: { x: 0, y: 0, width: 800, height: 200 }, text: 'Welcome in',
  }],
}

/** Canned per-op answers, in the real bridge client's envelope
 * shapes ({...handlerResult} posted to /api/page/result). */
function fakeAnswer(cmd: { op: string; payload: Record<string, any> }): Record<string, unknown> {
  const p = cmd.payload || {}
  switch (cmd.op) {
    case 'snapshot':
      return { ok: true, frame: 'top', text: 'SNAPSHOT-MARKER\nheading "Fake App"', elements: 4 }
    case 'inspect':
      return { ok: true, frame: 'top', tag: 'SECTION', selector: p.selector, text: 'INSPECT-MARKER', children: 2, childTags: ['h1', 'p'] }
    case 'patch':
      return { ok: true, frame: 'top', op: p.op || 'text', selector: p.selector, text: p.text }
    case 'layout-snapshot':
      return LAYOUT_RAW
    case 'eval': {
      if (p.code === PAGE_SECTIONS_PROGRAM) return { ok: true, result: SECTIONS_RESULT }
      if (typeof p.code === 'string' && p.code.includes('var CODE =')) {
        // run-in-page's wrapped program: the page would return the
        // program's own result object as the eval result.
        return { ok: true, result: { ok: true, value: 42, console: ['ran'], elapsedMs: 3 } }
      }
      return { ok: true, result: 'EVAL-MARKER' }
    }
    default:
      return { ok: false, error: `fake page does not answer ${cmd.op}` }
  }
}

describe('runPageTool with no live page (honest failures)', () => {
  before(() => { markPageOwner() })

  it('knows exactly the nine wave-1 names', () => {
    assert.deepEqual([...PAGE_TOOL_NAMES].sort(), Object.keys(MASTRA_TOOLS).sort())
  })

  it('unknown tool names are an error value naming the available set', async () => {
    const r = await runPageTool('nope', {}) as { ok: boolean; error: string }
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown page tool "nope"/)
    assert.match(r.error, /take-snapshot/)
  })

  it('senses return the not-connected error, identical to the Mastra tools', async () => {
    for (const name of ['take-snapshot', 'inspect-dom', 'page-sections', 'layout-snapshot', 'layout-svg', 'patch-dom', 'eval-js', 'run-in-page']) {
      const input = name === 'patch-dom' ? { selector: 'h1', op: 'text', text: 'x' }
        : name === 'eval-js' || name === 'run-in-page' ? { code: 'return 1' }
          : {}
      const mine = await runPageTool(name, input)
      const theirs = await runMastra(MASTRA_TOOLS[name], input)
      assert.deepEqual(mine, theirs, name)
      assert.match(JSON.stringify(mine), /No live Vite page connected/, name)
    }
  })

  it('pool-open returns the pool-off error, identical to the Mastra tool', async () => {
    const mine = await runPageTool('pool-open', { url: 'http://example.com/' })
    const theirs = await runMastra(poolOpenTool, { url: 'http://example.com/' })
    assert.deepEqual(mine, theirs)
    assert.match(JSON.stringify(mine), /Playwright pool is off/)
  })
})

describe('runPageTool against a fake bridge page (parity + shaping)', () => {
  let server: Server
  let base = ''
  let closePage: () => void = () => {}

  before(async () => {
    const app = express()
    app.use(express.json())
    mountPageBridge(app)
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
    const port = (server.address() as { port: number }).port
    base = `http://127.0.0.1:${port}`

    // The fake page: hold the bridge SSE stream open and answer
    // each command in the real client's envelope shape.
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
            await fetch(`${base}/api/page/result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: cmd.id, ...fakeAnswer(cmd) }),
            }).catch(() => { /* server closing */ })
          }
        }
      } catch { /* aborted at teardown */ }
    })()
    // Let the hello/registration settle before dispatching.
    await new Promise((r) => setTimeout(r, 50))
  })

  after(async () => {
    closePage()
    await new Promise((resolve) => server.close(resolve))
  })

  it('take-snapshot returns the shaped snapshot with the page text', async () => {
    const r = await runPageTool('take-snapshot', {}) as any
    assert.equal(r.via, 'vite-page')
    assert.match(r.text, /SNAPSHOT-MARKER/)
    assert.deepEqual(stripId(r), stripId(await runMastra(takeSnapshotTool, {})))
  })

  it('inspect-dom returns the element payload for the selector', async () => {
    const input = { selector: 'section.hero' }
    const r = await runPageTool('inspect-dom', input) as any
    assert.equal(r.via, 'vite-page')
    assert.equal(r.text, 'INSPECT-MARKER')
    assert.equal(r.selector, 'section.hero')
    assert.deepEqual(stripId(r), stripId(await runMastra(inspectDOMTool, input)))
  })

  it('page-sections normalizes the program result and counts sections', async () => {
    const r = await runPageTool('page-sections', {}) as any
    assert.equal(r.ok, true)
    assert.equal(r.via, 'vite-page')
    assert.equal(r.sectionCount, 1)
    assert.equal(r.sections[0].name, 'Hero')
    assert.deepEqual(stripId(r), stripId(await runMastra(pageSectionsTool, {})))
  })

  it('run-in-page matches the Mastra tool over the same envelope', async () => {
    const input = { code: 'return 6 * 7' }
    const mine = await runPageTool('run-in-page', input)
    const theirs = await runMastra(runInPageTool, input)
    assert.deepEqual(stripId(mine), stripId(theirs))
  })

  it('eval-js returns the eval result', async () => {
    const input = { code: 'document.title' }
    const r = await runPageTool('eval-js', input) as any
    assert.equal(r.via, 'vite-page')
    assert.equal(r.result, 'EVAL-MARKER')
    assert.deepEqual(stripId(r), stripId(await runMastra(evalTool, input)))
  })

  it('patch-dom returns the patch outcome (and records nothing outside sketch mode)', async () => {
    const input = { selector: 'h1', op: 'text', text: 'Patched!' }
    const r = await runPageTool('patch-dom', input) as any
    assert.equal(r.via, 'vite-page')
    assert.equal(r.ok, true)
    assert.equal(r.text, 'Patched!')
    assert.deepEqual(stripId(r), stripId(await runMastra(patchDOMTool, input)))
  })

  it('layout-snapshot returns the agent shape (no duplicated snapshot object)', async () => {
    const mine = await runPageTool('layout-snapshot', {}) as any
    const theirs = await runMastra(layoutSnapshotTool, {})
    assert.deepEqual(stripId(mine), stripId(theirs))
    if (!mine.error) {
      assert.equal('snapshot' in mine, false)
      assert.equal(mine.via, 'vite-page')
    }
  })

  it('layout-svg matches the Mastra tool', async () => {
    const mine = await runPageTool('layout-svg', {})
    const theirs = await runMastra(layoutSvgTool, {})
    assert.deepEqual(stripId(mine), stripId(theirs))
    const svg = (mine as any)?.svg
    if (typeof svg === 'string') assert.match(svg, /<svg/)
  })

  it('POST /api/page/tool on the apiApp dispatches identically', async () => {
    const { createApiApp } = await import('../apiApp.js')
    const api = createApiApp()
    const apiServer = await new Promise<Server>((resolve) => {
      const s = api.listen(0, '127.0.0.1', () => resolve(s))
    })
    try {
      const apiBase = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`
      const bad = await (await fetch(`${apiBase}/api/page/tool`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'nope', input: {} }),
      })).json() as { ok: boolean; error: string }
      assert.equal(bad.ok, false)
      // Since slice 3 the dispatch serves wave-2 verify tools too,
      // so the unknown-tool error lists the combined set.
      assert.match(bad.error, /unknown tool "nope"/)
      assert.match(bad.error, /resolve-source/)
      const good = await (await fetch(`${apiBase}/api/page/tool`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'take-snapshot', input: {} }),
      })).json() as any
      assert.equal(good.via, 'vite-page')
      assert.match(good.text, /SNAPSHOT-MARKER/)
    } finally {
      await new Promise((resolve) => apiServer.close(resolve))
    }
  })
})
