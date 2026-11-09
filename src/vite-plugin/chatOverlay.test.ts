import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

/**
 * Exercises the real chat-overlay.js annotate starter in a vm, the
 * way bridgeConsole.test.ts exercises page-bridge.js: the module is
 * loaded with stubbed window/document/fetch, in a NON-TOP frame —
 * the preview-iframe case, where the chat window must not mount but
 * the annotate toolbar must start. The fetch stub returns a fake
 * overlay source that installs a marker __AI_LIVE_EDIT__.
 */
const LAUNCHER = 'http://launcher.test'
const FAKE_OVERLAY = `
  window.__AI_LIVE_EDIT__ = {
    installed: true,
    setToolbarOffset: function (px) { (window.__parkCalls = window.__parkCalls || []).push(px) },
  }
`

type FetchImpl = (url: string) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>

function okOverlay(): Promise<{ ok: boolean, status: number, text: () => Promise<string> }> {
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAKE_OVERLAY) })
}

function loadClient(opts: {
  pathname?: string
  fetchImpl?: FetchImpl
  hostPresent?: boolean
  preinstalled?: boolean
  chatWidth?: number
} = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  let src = fs.readFileSync(path.join(here, 'client', 'chat-overlay.js'), 'utf8')
  src = src.replaceAll('__LAUNCHER_URL__', JSON.stringify(LAUNCHER))
  src = src.replace(/^export (?:default )?/gm, '')

  const fetches: string[] = []
  const warnings: string[] = []
  const fetchImpl = opts.fetchImpl ?? (() => okOverlay())
  const hostStub = { shadowRoot: { querySelector: () => null } }

  const windowStub: any = {
    addEventListener: () => {},
  }
  // A frame: window.top is some other window.
  windowStub.top = {}
  if (opts.preinstalled) {
    windowStub.__AI_LIVE_EDIT__ = {
      installed: true,
      setToolbarOffset: (px: number) => { (windowStub.__parkCalls = windowStub.__parkCalls || []).push(px) },
    }
  }
  if (opts.chatWidth) windowStub.__AI_LIVE_CHAT__ = { width: opts.chatWidth }

  const ctx: any = {
    window: windowStub,
    location: { pathname: opts.pathname ?? '/', origin: 'http://localhost:5173', href: 'http://localhost:5173/' },
    document: {
      getElementById: (id: string) => (opts.hostPresent && id === 'ai-live-chat-host' ? hostStub : null),
      createElement: (_tag: string) => ({ textContent: '' }),
      documentElement: {
        appendChild: (el: { textContent?: string }) => {
          // An inline <script> executes on insertion in a browser;
          // run the fake overlay source the same way.
          if (el.textContent) vm.runInContext(el.textContent, ctx)
        },
      },
      head: { appendChild: () => {} },
    },
    fetch: (url: string) => {
      fetches.push(url)
      return fetchImpl(url)
    },
    console: {
      log() {}, info() {}, debug() {}, error() {},
      warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    HTMLElement: undefined,
    setTimeout: (fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout },
    clearTimeout: () => {},
  }
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  const flush = () => new Promise((r) => setTimeout(r, 25))
  return { ctx, windowStub, fetches, warnings, flush }
}

describe('chat-overlay annotate starter (in a frame)', () => {
  it('installs the overlay in a non-top frame, same-origin first, without parking', async () => {
    const { windowStub, fetches, flush } = loadClient()
    await flush()
    assert.deepEqual(fetches, ['/live-edit/overlay.js'])
    assert.equal(windowStub.__AI_LIVE_EDIT__?.installed, true)
    // No chat window lives in this document: no park offset is applied.
    assert.deepEqual(windowStub.__parkCalls ?? [], [])
    // The chat window itself stayed unmounted (top-frame only).
    assert.equal(windowStub.__AI_LIVE_CHAT__, undefined)
  })

  it('falls back to the launcher URL when the same-origin fetch fails', async () => {
    const { windowStub, fetches, flush } = loadClient({
      fetchImpl: (url) => (url.startsWith(LAUNCHER) ? okOverlay() : Promise.reject(new Error('404'))),
    })
    await flush()
    assert.deepEqual(fetches, ['/live-edit/overlay.js', `${LAUNCHER}/live-edit/overlay.js`])
    assert.equal(windowStub.__AI_LIVE_EDIT__?.installed, true)
  })

  it('does not refetch when the overlay is already installed, and parks beside a present chat window', async () => {
    const { windowStub, fetches, flush } = loadClient({ preinstalled: true, hostPresent: true, chatWidth: 500 })
    await flush()
    assert.deepEqual(fetches, [])
    assert.deepEqual(windowStub.__parkCalls, [532])
  })

  it('dedupes concurrent install attempts into one fetch', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => { release = r })
    const { ctx, windowStub, fetches, flush } = loadClient({
      fetchImpl: async () => { await gate; return okOverlay() },
    })
    // The module load already started one install; pile on more.
    vm.runInContext('bootstrapAnnotateToolbar()', ctx)
    vm.runInContext('bootstrapAnnotateToolbar()', ctx)
    release!()
    await flush()
    assert.equal(fetches.length, 1)
    assert.equal(windowStub.__AI_LIVE_EDIT__?.installed, true)
  })

  it('fails warn-only in a frame when the overlay cannot be fetched', async () => {
    const { windowStub, warnings, flush } = loadClient({
      fetchImpl: () => Promise.reject(new Error('down')),
    })
    await flush()
    assert.equal(windowStub.__AI_LIVE_EDIT__, undefined)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /annotate overlay failed/)
  })

  it('does not start on the chat-embed or pool pages', async () => {
    for (const pathname of ['/chat-embed', '/pool']) {
      const { fetches, flush } = loadClient({ pathname })
      await flush()
      assert.deepEqual(fetches, [], pathname)
    }
  })
})
