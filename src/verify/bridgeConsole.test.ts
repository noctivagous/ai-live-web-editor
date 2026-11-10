import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

/**
 * Exercises the real page-bridge.js console buffer + `console` op by
 * simulating the server side: stub EventSource captures the client, then
 * we deliver commands through its onmessage handler and read POST bodies.
 */
function loadBridge(opts: { hash?: string } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.join(here, '..', 'vite-plugin', 'client', 'page-bridge.js'), 'utf8')
  const instances: Array<{ url: string, onmessage: ((ev: { data: string }) => void) | null, close: () => void }> = []
  const posted: unknown[] = []
  const listeners: Record<string, Array<(ev: any) => void>> = {}
  const windowStub: any = {
    addEventListener: (t: string, f: (ev: any) => void) => {
      listeners[t] = listeners[t] || []
      listeners[t].push(f)
    },
  }
  windowStub.top = windowStub
  const ctx: any = {
    window: windowStub,
    location: { pathname: '/', hash: opts.hash || '', href: `http://localhost:5173/${opts.hash || ''}` },
    document: { documentElement: {}, body: { appendChild() {} } },
    EventSource: class {
      url: string
      onmessage: ((ev: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string) {
        this.url = url
        instances.push(this)
      }
      close() {}
    },
    fetch: async (_url: string, init: any) => {
      posted.push(JSON.parse(init.body))
      return {}
    },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    setTimeout: (fn: () => void) => 0 as unknown as NodeJS.Timeout,
    clearTimeout: () => {},
  }
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  assert.equal(instances.length, 1)
  return { ctx, instances, posted, listeners }
}

function sendCmd(instances: Array<{ onmessage: ((ev: { data: string }) => void) | null }>, op: string, payload: unknown, id = 't1') {
  const inst = instances[0]
  assert.ok(inst.onmessage, 'bridge subscribed')
  inst.onmessage({ data: JSON.stringify({ id, op, payload }) })
}

describe('page-bridge console buffer', () => {
  it('records console calls and serves them via the console op', async () => {
    const { ctx, instances, posted } = loadBridge()
    ctx.console.log('hello page')
    ctx.console.error('boom')
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(posted.length, 1)
    const body = posted[0] as any
    assert.equal(body.ok, true)
    assert.deepEqual(body.entries.map((e: any) => [e.level, e.text]), [['log', 'hello page'], ['error', 'boom']])
    assert.equal(body.latestSeq, 2)
  })

  it('filters by sinceSeq and level', async () => {
    const { ctx, instances, posted } = loadBridge()
    ctx.console.log('a')
    ctx.console.warn('b')
    ctx.console.error('c')
    sendCmd(instances, 'console', { sinceSeq: 1, levels: ['error'] })
    await new Promise((r) => setTimeout(r, 20))
    const body = posted[0] as any
    assert.deepEqual(body.entries.map((e: any) => e.text), ['c'])
  })

  it('records uncaught errors and rejections', async () => {
    const { instances, posted, listeners } = loadBridge()
    assert.ok(listeners.error?.length, 'error listener hooked')
    assert.ok(listeners.unhandledrejection?.length, 'rejection listener hooked')
    listeners.error[0]({ message: 'kaboom', error: { stack: 'at x' } })
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    const body = posted[0] as any
    assert.equal(body.entries[0].level, 'pageerror')
    assert.ok(body.entries[0].text.includes('kaboom'))
  })

  it('caps the buffer at 200', async () => {
    const { ctx, instances, posted } = loadBridge()
    for (let i = 0; i < 250; i++) ctx.console.log(`m${i}`)
    sendCmd(instances, 'console', { maxEntries: 200 })
    await new Promise((r) => setTimeout(r, 20))
    const body = posted[0] as any
    assert.equal(body.entries.length, 200)
    assert.equal(body.entries[0].text, 'm50')
    assert.equal(body.latestSeq, 250)
  })

  it('stamps a page-instance id on console reads, stable within the page', async () => {
    const { instances, posted } = loadBridge()
    sendCmd(instances, 'console', {}, 'i1')
    await new Promise((r) => setTimeout(r, 20))
    sendCmd(instances, 'console', {}, 'i2')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(posted.length, 2)
    const a = (posted[0] as any).instance
    const b = (posted[1] as any).instance
    assert.equal(typeof a, 'string')
    assert.ok(a.length > 0, 'instance id present')
    assert.equal(a, b, 'same page instance across reads')
  })

  it('mints a different instance id for a new page (reload)', async () => {
    const one = loadBridge()
    sendCmd(one.instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    const two = loadBridge()
    sendCmd(two.instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    const a = (one.posted[0] as any).instance
    const b = (two.posted[0] as any).instance
    assert.equal(typeof a, 'string')
    assert.equal(typeof b, 'string')
    assert.notEqual(a, b)
  })

  it('slice C: a pageerror whose stack runs through an injected client is tagged editor', async () => {
    const { instances, posted, listeners } = loadBridge()
    const stack = [
      'Error: chat blew up',
      '    at mountChatOverlay (http://localhost:5173/@ai-live-editor/chat-overlay.js:120:11)',
      '    at http://localhost:5173/src/main.tsx:5:1',
    ].join('\n')
    listeners.error[0]({ message: 'chat blew up', error: { stack } })
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    const body = posted[0] as any
    assert.equal(body.entries[0].level, 'pageerror')
    assert.equal(body.entries[0].src, 'editor')
  })

  it('slice C: a pageerror through the overlay’s served path is tagged editor', async () => {
    const { instances, posted, listeners } = loadBridge()
    const stack = 'Error: pick failed\n    at HTMLDocument.<anonymous> (/live-edit/overlay.js:812:9)'
    listeners.error[0]({ message: 'pick failed', error: { stack } })
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    assert.equal((posted[0] as any).entries[0].src, 'editor')
  })

  it('slice C: an app-stack pageerror is tagged app', async () => {
    const { instances, posted, listeners } = loadBridge()
    const stack = 'Error: boom\n    at App (http://localhost:5173/src/App.tsx:9:3)'
    listeners.error[0]({ message: 'boom', error: { stack } })
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    assert.equal((posted[0] as any).entries[0].src, 'app')
  })

  it('slice C: a stackless console.error stays app (no stack is captured for console.*)', async () => {
    const { ctx, instances, posted } = loadBridge()
    ctx.console.error('plain app error')
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    const body = posted[0] as any
    assert.equal(body.entries[0].level, 'error')
    assert.equal(body.entries[0].src, 'app')
  })

  it('slice C: an unhandled rejection with an editor stack is tagged editor', async () => {
    const { instances, posted, listeners } = loadBridge()
    const reason = { stack: 'Error: overlay submit failed\n    at submit (http://localhost:5173/live-edit/overlay.js:1200:5)' }
    listeners.unhandledrejection[0]({ reason })
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    const body = posted[0] as any
    assert.equal(body.entries[0].level, 'pageerror')
    assert.equal(body.entries[0].src, 'editor')
  })

  it('tags check-frame connections and echoes the marker', async () => {
    const { instances, posted } = loadBridge({ hash: '#ai-check-375' })
    assert.ok(instances[0].url.includes('check=375'))
    sendCmd(instances, 'console', {})
    await new Promise((r) => setTimeout(r, 20))
    assert.equal((posted[0] as any).check, '375')
  })
})
