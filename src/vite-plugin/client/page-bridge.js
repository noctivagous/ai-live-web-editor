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
  let es

  function connect() {
    if (es) try { es.close() } catch { /* ignore */ }
    es = new EventSource(`/api/page/stream?top=${top}`)
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
      body = { id: cmd.id, ...(await run(cmd.op, cmd.payload || {})) }
    } catch (e) {
      body = { id: cmd.id, ok: false, error: String(e && e.message ? e.message : e) }
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
    if (op === 'patch') return patch(payload.selector, payload.html)
    if (op === 'eval') return evalJs(payload.code)
    if (op === 'layout-snapshot') return captureLayout(payload)
    return { ok: false, error: 'unknown op ' + op }
  }

  function inspect(selector) {
    const el = selector ? document.querySelector(selector) : document.documentElement
    if (!el) return { ok: false, error: 'Selector not found: ' + selector }
    const r = el.getBoundingClientRect()
    return {
      ok: true,
      tag: el.tagName,
      html: (el.outerHTML || '').slice(0, 20000),
      text: (el.textContent || '').slice(0, 8000),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      url: location.href,
      title: document.title,
    }
  }

  function patch(selector, html) {
    const t0 = Date.now()
    const el = document.querySelector(selector || 'body')
    if (!el) return { ok: false, error: 'Selector not found: ' + selector }
    if (html !== undefined) el.innerHTML = html
    el.setAttribute('data-ai-patched', 'true')
    const r = el.getBoundingClientRect()
    return {
      ok: true,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      htmlLen: el.innerHTML.length,
      elapsedMs: Date.now() - t0,
    }
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
      elements.push({
        tagName: el.tagName,
        id,
        classList,
        textSnippet,
        rect: { x, y, width: r.width, height: r.height, left: x, top: y, right: x + r.width, bottom: y + r.height },
        computedStyles,
        stableId: id ? `id:${id}` : `path:${cssPath(el)}`,
        parentStableId: parent ? (parent.id ? `id:${parent.id}` : `path:${cssPath(parent)}`) : undefined,
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
