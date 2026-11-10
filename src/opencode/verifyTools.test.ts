import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, before, describe, it } from 'node:test'
import express from 'express'
import type { Server } from 'node:http'
import { getFsRoot, setFsRoot } from '../launcher.js'
import { markPageOwner, mountPageBridge } from '../pageBridge.js'
import { resolveSourceTool } from '../mastra/tools/resolveSourceTool.js'
import { getNetworkFailuresTool } from '../mastra/tools/verifyTools.js'
import {
  beginConsoleExpectations, collectConsoleExpectations, declareConsoleExpectation,
  endConsoleExpectations, matchExpectations, resetConsoleExpectationsForTests,
} from '../verify/consoleExpectations.js'
import { captureConsoleCapture, readTurnConsole, shapeTurnConsoleDetail } from '../verify/consoleTurn.js'
import { createRingBuffer, pushRing, readRing, type RingBuffer } from '../verify/ringBuffer.js'
import {
  VERIFY_TOOL_NAMES, abandonExpectationScope, collectExpectationLiterals,
  openExpectationScope, runVerifyTool,
} from './verifyTools.js'

/**
 * Wave-2 verify-tool tests (slice 3). Same claim as wave 1:
 * PARITY — runVerifyTool returns exactly what the Mastra tool's
 * execute returns — plus the console-expect scope lifecycle the
 * translator drives: open at prompt, literals collected after the
 * turn, the shared registry's collision semantics, and the
 * turn-window discipline (entries from before the turn-start
 * capture never match). Since slice 6 the matching input is the
 * every-turn console read (consoleTurn), so the window tests
 * drive the production composition: capture → scope → turn read
 * → matchExpectations.
 */

const runMastra = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<any> }).execute(input, {})

describe('runVerifyTool dispatch', () => {
  it('knows exactly the two wave-2 names', () => {
    assert.deepEqual([...VERIFY_TOOL_NAMES].sort(), ['get-network-failures', 'resolve-source'])
  })

  it('unknown names are an error value naming the available set', async () => {
    const r = await runVerifyTool('nope', {}) as { ok: boolean; error: string }
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown verify tool "nope"/)
    assert.match(r.error, /resolve-source/)
  })
})

describe('get-network-failures parity', () => {
  it('bridge channel: the labelled timing-only answer, identical to Mastra', async () => {
    for (const input of [{}, { maxEntries: 5 }, { sinceSeq: 2, maxEntries: 7 }]) {
      const mine = await runVerifyTool('get-network-failures', input)
      const theirs = await runMastra(getNetworkFailuresTool, input)
      assert.deepEqual(mine, theirs)
    }
    const r = await runVerifyTool('get-network-failures', {}) as any
    assert.equal(r.via, 'vite-page')
    assert.deepEqual(r.failures, [])
    assert.match(r.note, /timing-level/)
  })

  it('another origin with the pool off: the pool-off error, identical to Mastra', async () => {
    const input = { url: 'http://example.com/' }
    const mine = await runVerifyTool('get-network-failures', input)
    const theirs = await runMastra(getNetworkFailuresTool, input)
    assert.deepEqual(mine, theirs)
    assert.match(JSON.stringify(mine), /Playwright pool is off/)
  })
})

describe('resolve-source parity', () => {
  const originalRoot = getFsRoot()
  let dir = ''

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc3-resolve-'))
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'App.jsx'), [
      'export default function App() {',
      '  return (',
      '    <main className="shell">',
      '      <h1 className="hero-title">Welcome Home</h1>',
      '    </main>',
      '  )',
      '}',
      '',
    ].join('\n'))
    setFsRoot(dir)
  })

  after(() => {
    setFsRoot(originalRoot)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('sourceLoc (the data-ai-loc stamp) resolves exactly, identical to Mastra', async () => {
    const input = { selector: 'h1', sourceLoc: { file: '/src/App.jsx', line: 4 } }
    const mine = await runVerifyTool('resolve-source', input) as any
    const theirs = await runMastra(resolveSourceTool, input)
    assert.deepEqual(mine, theirs)
    assert.equal(mine.ok, true)
    assert.equal(mine.file, '/src/App.jsx')
    assert.equal(mine.confidence, 'exact')
  })

  it('heuristic anchors resolve the same file, identical to Mastra', async () => {
    const input = { selector: 'h1', textSnippet: 'Welcome Home', classList: ['hero-title'], tagName: 'h1' }
    const mine = await runVerifyTool('resolve-source', input) as any
    const theirs = await runMastra(resolveSourceTool, input)
    assert.deepEqual(mine, theirs)
    assert.equal(mine.ok, true)
    assert.equal(mine.file, '/src/App.jsx')
  })
})

describe('console-expect scope lifecycle (no live page)', () => {
  before(() => { markPageOwner() })
  afterEach(() => resetConsoleExpectationsForTests())

  it('a scope opens, and a second open refuses while it is live', () => {
    const scope = openExpectationScope()
    assert.ok(scope)
    const second = openExpectationScope()
    assert.equal(second, null)
    // Nothing declared → no literals → the turn reports no
    // expectations (the translator skips matching entirely).
    assert.deepEqual(collectExpectationLiterals(scope), [])
    abandonExpectationScope(scope)
  })

  it('with no readable console, declared literals are all reported missing — never matched', () => {
    const scope = openExpectationScope()
    assert.ok(scope)
    assert.deepEqual(declareConsoleExpectation('PLANTED-OC3'), { ok: true, declared: 1 })
    const literals = collectExpectationLiterals(scope)
    abandonExpectationScope(scope)
    // The translator matches against the turn read's entries; no
    // read (or an empty one) matches nothing.
    assert.deepEqual(matchExpectations(literals, []), [{ text: 'PLANTED-OC3', matched: false }])
  })

  it('collision parity: a live scope from another turn makes begin refuse, and declarations land in the live scope', () => {
    // A scope begun the way any engine's turn begins one.
    assert.equal(beginConsoleExpectations('other-turn'), true)
    const scope = openExpectationScope()
    assert.equal(scope, null)
    // The registry's defined behaviour: a declaration made now
    // belongs to the live scope and is collected by ITS turn.
    assert.deepEqual(declareConsoleExpectation('SHARED-OC3'), { ok: true, declared: 1 })
    assert.deepEqual(collectConsoleExpectations('other-turn'), ['SHARED-OC3'])
    endConsoleExpectations('other-turn')
    // And once it ends, a fresh scope opens cleanly.
    const next = openExpectationScope()
    assert.ok(next)
    abandonExpectationScope(next)
  })
})

describe('console-expect window matching (fake bridge page)', () => {
  let server: Server
  let base = ''
  let closePage: () => void = () => {}
  let ring: RingBuffer

  before(async () => {
    markPageOwner()
    ring = createRingBuffer(200)
    const app = express()
    app.use(express.json())
    mountPageBridge(app)
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
    const port = (server.address() as { port: number }).port
    base = `http://127.0.0.1:${port}`

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
            const answer = cmd.op === 'console'
              ? readRing(ring, cmd.payload || {})
              : { ok: false, error: `fake page does not answer ${cmd.op}` }
            await fetch(`${base}/api/page/result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: cmd.id, ...answer }),
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

  afterEach(() => resetConsoleExpectationsForTests())

  it('matches only entries newer than the turn-start capture', async () => {
    pushRing(ring, { level: 'log', text: 'PRE-TURN boot line' })
    // The production composition (translator, slice 6): capture at
    // turn start, scope for declarations, the epoch-guarded turn
    // read at turn end, one match against that read.
    const capture = await captureConsoleCapture()
    assert.equal(capture.bridge.connected, true)
    const scope = openExpectationScope()
    assert.ok(scope)
    declareConsoleExpectation('PLANTED-OC3')
    declareConsoleExpectation('GHOST-OC3')
    declareConsoleExpectation('PRE-TURN')
    pushRing(ring, { level: 'log', text: 'render done: PLANTED-OC3 ok' })
    const literals = collectExpectationLiterals(scope)
    abandonExpectationScope(scope)
    const turnRead = await readTurnConsole(capture, undefined, { graceMs: 0 })
    const results = matchExpectations(literals, turnRead.entries)
    assert.deepEqual(results, [
      { text: 'PLANTED-OC3', matched: true, matchedText: 'render done: PLANTED-OC3 ok' },
      { text: 'GHOST-OC3', matched: false },
      // Present in the ring, but older than the capture: the
      // window discipline says it is not this turn's signal.
      { text: 'PRE-TURN', matched: false },
    ])
  })

  it('an editor-shaped entry still matches by text (registry semantics: any level, substring)', async () => {
    const capture = await captureConsoleCapture()
    const scope = openExpectationScope()
    assert.ok(scope)
    declareConsoleExpectation('OVERLAY-OC3')
    pushRing(ring, { level: 'error', text: 'OVERLAY-OC3 failed to mount', url: 'http://localhost:5173/@ai-live-editor/chat-overlay.js' })
    const literals = collectExpectationLiterals(scope)
    abandonExpectationScope(scope)
    const turnRead = await readTurnConsole(capture, undefined, { graceMs: 0 })
    const results = matchExpectations(literals, turnRead.entries)
    assert.deepEqual(results, [
      { text: 'OVERLAY-OC3', matched: true, matchedText: 'OVERLAY-OC3 failed to mount' },
    ])
  })
})

describe('the HTTP endpoints the plugin calls (apiApp)', () => {
  let apiServer: Server
  let apiBase = ''

  before(async () => {
    const { createApiApp } = await import('../apiApp.js')
    const api = createApiApp()
    apiServer = await new Promise<Server>((resolve) => {
      const s = api.listen(0, '127.0.0.1', () => resolve(s))
    })
    apiBase = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`
  })

  after(async () => {
    await new Promise((resolve) => apiServer.close(resolve))
  })

  afterEach(() => resetConsoleExpectationsForTests())

  const post = async (route: string, body: unknown) => (await fetch(`${apiBase}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json() as any

  it('POST /api/page/tool dispatches the wave-2 tools', async () => {
    const r = await post('/api/page/tool', { tool: 'get-network-failures', input: {} })
    assert.equal(r.via, 'vite-page')
    assert.deepEqual(r.failures, [])
    assert.match(r.note, /timing-level/)
  })

  it('POST /api/console/expect with no live turn scope is an honest error', async () => {
    const r = await post('/api/console/expect', { text: 'PROBE-HTTP' })
    assert.match(r.error, /no active chat turn/)
  })

  it('POST /api/console/expect records into the live scope the translator opened', async () => {
    const scope = openExpectationScope()
    assert.ok(scope)
    const r = await post('/api/console/expect', { text: 'PROBE-HTTP' })
    assert.deepEqual(r, { ok: true, declared: 1 })
    // The endpoint wrote into the SAME registry the scope reads:
    // collecting the scope sees the declaration (no page → missing).
    const literals = collectExpectationLiterals(scope)
    abandonExpectationScope(scope)
    assert.deepEqual(matchExpectations(literals, []), [{ text: 'PROBE-HTTP', matched: false }])
  })
})

describe('expectation results in the full detail (shapeTurnConsoleDetail)', () => {
  // Slice 3 shaped expectations into an expectations-only detail
  // via buildExpectationsDetail; slice 6's full sweep shapes them
  // through the console arc's shapeTurnConsoleDetail instead. The
  // two claims slice 3 pinned survive the move:
  it('produces the console detail shape with only the expectations group filled', () => {
    const detail = shapeTurnConsoleDetail({
      turnEntries: [], sinceEntries: [], notes: [],
      expectations: [
        { text: 'A', matched: true, matchedText: 'saw A' },
        { text: 'B', matched: false },
      ],
    })
    assert.deepEqual(detail, {
      errors: [],
      errorTotal: 0,
      warnings: [],
      warningTotal: 0,
      sinceLastChat: [],
      sinceLastChatTotal: 0,
      expectations: [
        { text: 'A', matched: true, matchedText: 'saw A' },
        { text: 'B', matched: false },
      ],
      notes: [],
      editorCount: 0,
    })
  })

  it('clips matchedText at 300 chars, like the console arc shaping', () => {
    const long = 'x'.repeat(400)
    const detail = shapeTurnConsoleDetail({
      turnEntries: [], sinceEntries: [], notes: [],
      expectations: [{ text: 'A', matched: true, matchedText: long }],
    })!
    assert.equal(detail.expectations[0].matchedText!.length, 300)
    assert.ok(detail.expectations[0].matchedText!.endsWith('…'))
  })
})
