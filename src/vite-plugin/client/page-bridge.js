/**
 * Live-page RPC for the Vite app. The agent inspects / patches / evals this
 * document over SSE + POST, same origin as the overlay.
 */
if (location.pathname === '/chat-embed' || location.pathname.startsWith('/chat-embed/') || location.pathname === '/pool') {
  // chat iframe is not the app
} else {
  startPageBridge()
}

function startPageBridge() {
  const top = window === window.top ? '1' : '0'
  // Check frames (hidden verification iframes) identify themselves so the
  // host can exclude them from normal dispatch and address them directly.
  // The marker travels in the page URL hash, e.g. #ai-check-375.
  const checkMatch = /#ai-check-([\w-]+)/.exec(location.hash || '')
  const check = checkMatch ? checkMatch[1] : ''
  let es

  // Console ring buffer (P0-b console signal): records console.* calls and
  // uncaught errors with sequence numbers so the host can poll "since seq".
  const consoleBuffer = []
  let consoleSeq = 0
  const CONSOLE_CAP = 200
  function pushConsole(level, text, stack) {
    consoleSeq += 1
    consoleBuffer.push({ seq: consoleSeq, level, text: String(text).slice(0, 2000), stack: stack ? String(stack).slice(0, 1000) : undefined, url: location.href, ts: Date.now() })
    if (consoleBuffer.length > CONSOLE_CAP) consoleBuffer.splice(0, consoleBuffer.length - CONSOLE_CAP)
  }
  function hookConsole() {
    try {
      for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const orig = console[level]
        if (typeof orig !== 'function' || orig.__aiLiveHooked) continue
        const fn = function (...args) {
          try {
            pushConsole(level, args.map((a) => {
              if (typeof a === 'string') return a
              try { return JSON.stringify(a) } catch { return String(a) }
            }).join(' '))
          } catch { /* ignore */ }
          return orig.apply(this, args)
        }
        fn.__aiLiveHooked = true
        console[level] = fn
      }
      if (!window.__aiLiveErrorHooked) {
        window.__aiLiveErrorHooked = true
        window.addEventListener('error', (ev) => {
          try { pushConsole('pageerror', ev.message || String(ev.error || 'unknown error'), ev.error && ev.error.stack) } catch { /* ignore */ }
        })
        window.addEventListener('unhandledrejection', (ev) => {
          try { pushConsole('pageerror', 'unhandled rejection: ' + String(ev.reason), ev.reason && ev.reason.stack) } catch { /* ignore */ }
        })
      }
    } catch { /* ignore */ }
  }
  hookConsole()

  function connect() {
    if (es) try { es.close() } catch { /* ignore */ }
    es = new EventSource(`/api/page/stream?top=${top}${check ? `&check=${encodeURIComponent(check)}` : ''}`)
    es.onmessage = (ev) => {
      let cmd
      try { cmd = JSON.parse(ev.data) } catch { return }
      if (!cmd || cmd.type === 'hello' || !cmd.id || !cmd.op) return
      void handle(cmd)
    }
    es.onerror = () => {
      try { es.close() } catch { /* ignore */ }
      setTimeout(connect, 1500)
    }
  }

  async function handle(cmd) {
    let body
    try {
      body = { id: cmd.id, ...(check ? { check } : null), ...(await run(cmd.op, cmd.payload || {})) }
    } catch (e) {
      body = { id: cmd.id, ...(check ? { check } : null), ok: false, error: String(e && e.message ? e.message : e) }
    }
    try {
      await fetch('/api/page/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch { /* server gone */ }
  }

  async function run(op, payload) {
    if (op === 'inspect') return inspect(payload.selector)
    if (op === 'patch') return patch(payload)
    if (op === 'eval') return evalJs(payload.code)
    if (op === 'layout-snapshot') return captureLayout(payload)
    if (op === 'snapshot') return snapshot(payload)
    if (op === 'console') return readConsole(payload)
    return { ok: false, error: 'unknown op ' + op }
  }

  function readConsole(payload) {
    const since = Number(payload.sinceSeq || 0)
    const levels = Array.isArray(payload.levels) && payload.levels.length ? new Set(payload.levels) : null
    const max = Math.max(1, Math.min(200, Number(payload.maxEntries || 100)))
    const entries = consoleBuffer.filter((e) => e.seq > since && (!levels || levels.has(e.level))).slice(-max)
    return { ok: true, entries, latestSeq: consoleSeq, frame: frameKind() }
  }

  function frameKind() {
    return window === window.top ? 'top' : 'iframe'
  }

  // Exact DOM→file join: read the dev-only data-ai-loc stamp the Vite
  // transform adds (`/rel/path.jsx:LINE`), else the nearest stamped
  // ancestor. Absent on unstamped pages — the resolver falls back to
  // heuristic matching.
  function readSourceLoc(el) {
    try {
      const n = el && typeof el.closest === 'function' ? el.closest('[data-ai-loc]') : null
      const raw = n && n.getAttribute ? n.getAttribute('data-ai-loc') : null
      if (!raw) return undefined
      const i = String(raw).lastIndexOf(':')
      if (i < 0) return { file: String(raw) }
      const line = Number(String(raw).slice(i + 1))
      return { file: String(raw).slice(0, i), line: Number.isFinite(line) && line > 0 ? line : undefined }
    } catch { return undefined }
  }

  function inspect(selector) {
    const el = selector ? document.querySelector(selector) : document.documentElement
    if (!el) return { ok: false, error: 'Selector not found: ' + selector, frame: frameKind() }
    const r = el.getBoundingClientRect()
    const sourceLoc = readSourceLoc(el)
    return {
      ok: true,
      tag: el.tagName,
      html: (el.outerHTML || '').slice(0, 20000),
      text: (el.textContent || '').slice(0, 8000),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      url: location.href,
      title: document.title,
      frame: frameKind(),
      ...(sourceLoc ? { sourceLoc } : null),
    }
  }

  function patch(payload) {
    if (typeof runLivePatch !== 'function') {
      return { ok: false, error: 'patch engine missing', frame: frameKind() }
    }
    const result = runLivePatch(payload || {}, document)
    return { ...result, frame: frameKind() }
  }

  function snapshot(payload) {
    if (typeof capturePageSnapshot !== 'function') {
      return { ok: false, error: 'snapshot engine missing', frame: frameKind() }
    }
    const result = capturePageSnapshot(payload || {}, document)
    return { ...result, frame: frameKind() }
  }

  function evalJs(code) {
    if (typeof code !== 'string' || !code.trim()) return { ok: false, error: 'code required' }
    try {
      const value = (0, eval)(code)
      return { ok: true, result: serialize(value, 0) }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    }
  }

  const LAYOUT_STYLES = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'flex-direction', 'flex-wrap', 'flex', 'flex-grow', 'flex-shrink',
    'grid-template-columns', 'grid-template-rows', 'justify-content', 'align-items',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'overflow', 'overflow-x', 'overflow-y', 'box-sizing', 'gap',
  ]

  function captureLayout(payload) {
    const t0 = Date.now()
    const maxTotal = Math.max(1, Math.min(2000, Number(payload.maxTotal || payload.maxElements || 300)))
    const includeText = Boolean(payload.includeTextSnippets)
    const textMax = Number(payload.textSnippetMaxLength || 80)
    const coord = payload.coordinateSpace === 'document' ? 'document' : 'viewport'
    const includeStyles = payload.includeComputedStyles !== false
    const scopeRoot = payload.scopeSelector
      ? document.querySelector(payload.scopeSelector) || document.documentElement
      : document.documentElement
    let nodes = []
    if (payload.selectors && payload.selectors.length) {
      for (const sel of payload.selectors) {
        try { nodes.push(...scopeRoot.querySelectorAll(sel)) } catch { /* bad selector */ }
      }
    } else {
      nodes = [...scopeRoot.querySelectorAll('*')]
    }
    const scrollX = window.scrollX || 0
    const scrollY = window.scrollY || 0
    const elements = []
    const seen = new Set()
    for (let i = 0; i < nodes.length && elements.length < maxTotal; i++) {
      const el = nodes[i]
      if (!(el instanceof Element) || seen.has(el)) continue
      seen.add(el)
      const r = el.getBoundingClientRect()
      if (!Number.isFinite(r.x) || r.width <= 0 || r.height <= 0) continue
      const x = coord === 'document' ? r.x + scrollX : r.x
      const y = coord === 'document' ? r.y + scrollY : r.y
      const id = el.id || undefined
      const classList = el.className && typeof el.className === 'string'
        ? el.className.split(/\s+/).filter(Boolean).slice(0, 8)
        : undefined
      let textSnippet
      if (includeText) {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ')
        if (t) textSnippet = t.slice(0, textMax)
      }
      let computedStyles
      if (includeStyles) {
        const cs = getComputedStyle(el)
        computedStyles = {}
        for (const k of LAYOUT_STYLES) computedStyles[k] = cs.getPropertyValue(k)
      }
      const parent = el.parentElement
      const sourceLoc = readSourceLoc(el)
      elements.push({
        tagName: el.tagName,
        id,
        classList,
        textSnippet,
        rect: { x, y, width: r.width, height: r.height, left: x, top: y, right: x + r.width, bottom: y + r.height },
        computedStyles,
        stableId: id ? `id:${id}` : `path:${cssPath(el)}`,
        parentStableId: parent ? (parent.id ? `id:${parent.id}` : `path:${cssPath(parent)}`) : undefined,
        ...(sourceLoc ? { sourceLoc } : null),
      })
    }
    return {
      ok: true,
      schemaVersion: 2,
      coordinateSpace: coord,
      page: {
        url: location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        scroll: { x: scrollX, y: scrollY },
      },
      computedStyleWhitelist: includeStyles ? LAYOUT_STYLES : [],
      elements,
      truncated: nodes.length > maxTotal,
      elapsedMs: Date.now() - t0,
    }
  }

  function cssPath(el) {
    const parts = []
    let n = el
    while (n && n.nodeType === 1 && parts.length < 8) {
      if (n.id) {
        parts.unshift('#' + n.id)
        break
      }
      const tag = n.tagName.toLowerCase()
      const parent = n.parentElement
      if (!parent) {
        parts.unshift(tag)
        break
      }
      const same = [...parent.children].filter((c) => c.tagName === n.tagName)
      const idx = same.indexOf(n) + 1
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${idx})` : tag)
      n = parent
    }
    return parts.join('>')
  }

  function serialize(v, depth) {
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`
    if (typeof Element !== 'undefined' && v instanceof Element) {
      return { tag: v.tagName, html: (v.outerHTML || '').slice(0, 4000) }
    }
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => serialize(x, depth + 1))
    if (depth > 3) return String(v)
    try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
  }

  connect()
}
