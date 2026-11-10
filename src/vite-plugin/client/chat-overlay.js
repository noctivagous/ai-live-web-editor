/**
 * DevTools custom-render client: floating chat window on the previewed page.
 * Iframe points at the launcher /chat-embed so Chat.tsx + SSE stay in one place.
 */
const LAUNCHER_URL = __LAUNCHER_URL__
const STORAGE = 'ai_live_chat_window'
const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 440
const MIN_WIDTH = 280
const MIN_HEIGHT = 320

function supportsPopover() {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'
}

function showManualPopover(el) {
  if (!el || !supportsPopover()) return
  try {
    if (!el.matches(':popover-open')) el.showPopover()
  } catch {
    /* not in document yet */
  }
}

function loadPos() {
  try {
    const raw = sessionStorage.getItem(STORAGE)
    if (!raw) return { x: null, y: null, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, collapsed: false }
    const p = JSON.parse(raw)
    return {
      x: p.x ?? null,
      y: p.y ?? null,
      w: Math.max(MIN_WIDTH, Number(p.w) || DEFAULT_WIDTH),
      h: Math.max(MIN_HEIGHT, Number(p.h) || DEFAULT_HEIGHT),
      collapsed: Boolean(p.collapsed),
    }
  } catch {
    return { x: null, y: null, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, collapsed: false }
  }
}

function savePos(state) {
  try { sessionStorage.setItem(STORAGE, JSON.stringify(state)) } catch { /* ignore */ }
}

function applyHostPos(host, saved) {
  host.style.right = saved.x == null ? '16px' : 'auto'
  host.style.bottom = saved.y == null ? '16px' : 'auto'
  if (saved.x != null) host.style.left = saved.x + 'px'
  else host.style.left = 'auto'
  if (saved.y != null) host.style.top = saved.y + 'px'
  else host.style.top = 'auto'
}

function ensureHostStyle() {
  if (document.getElementById('ai-live-chat-host-style')) return
  const style = document.createElement('style')
  style.id = 'ai-live-chat-host-style'
  style.textContent = `
    #ai-live-chat-host[popover] {
      position: fixed;
      inset: unset;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      overflow: visible;
      width: fit-content;
      height: fit-content;
      color: inherit;
    }
  `
  document.head.appendChild(style)
}

export function mountChatOverlay() {
  if (window !== window.top) return
  if (location.pathname === '/chat-embed' || location.pathname.startsWith('/chat-embed/') || location.pathname === '/pool') return
  if (document.getElementById('ai-live-chat-host')) return
  const saved = loadPos()
  const chatSrc = `${String(LAUNCHER_URL || '').replace(/\/$/, '')}/chat-embed`
  const usePopover = supportsPopover()
  ensureHostStyle()
  const host = document.createElement('div')
  host.id = 'ai-live-chat-host'
  if (usePopover) host.setAttribute('popover', 'manual')
  else {
    host.style.position = 'fixed'
    host.style.zIndex = '90000'
  }
  applyHostPos(host, saved)
  const shadow = host.attachShadow({ mode: 'open' })

  const wrap = document.createElement('div')
  wrap.className = 'win'
  if (saved.collapsed) wrap.classList.add('collapsed')

  wrap.innerHTML = `
    <style>
      :host { display: block; }
      .win {
        position: relative;
        width: ${saved.w}px; height: ${saved.h}px;
        display: flex; flex-direction: column;
        background: #141417; color: #e4e4e7;
        border: 1px solid #26262c; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,.45);
        font-family: system-ui, sans-serif;
        overflow: hidden;
      }
      .win.collapsed { height: 40px !important; width: 180px !important; }
      .win.collapsed iframe, .win.collapsed .resize { display: none; }
      .bar {
        height: 40px; flex-shrink: 0;
        display: flex; align-items: center; gap: 8px;
        padding: 0 10px; cursor: move;
        background: #1a1a1e; border-bottom: 1px solid #26262c;
        user-select: none;
      }
      .bar b { font-size: 12px; font-weight: 600; }
      .bar span { font-size: 11px; color: #71717a; }
      .bar button {
        margin-left: auto; background: transparent; border: 1px solid #26262c;
        color: #d4d4d8; border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 11px;
      }
      iframe { flex: 1; border: 0; background: #141417; width: 100%; }
      .resize {
        position: absolute; right: 0; bottom: 0; width: 18px; height: 18px;
        cursor: nwse-resize; touch-action: none;
        background: linear-gradient(135deg, transparent 50%, #3f3f46 50%);
        border-bottom-right-radius: 12px;
      }
      .resize:hover { background: linear-gradient(135deg, transparent 50%, #3b82f6 50%); }
      .err {
        position: absolute; left: 8px; bottom: 8px; z-index: 2;
        display: flex; align-items: center; gap: 8px; max-width: calc(100% - 32px);
        padding: 6px 8px; font-size: 11px; color: #fecaca;
        background: #141417; border: 1px solid rgba(239,68,68,.4); border-radius: 8px;
      }
      .err button {
        background: #1a1a1e; border: 1px solid #26262c; color: #e4e4e7;
        border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 11px;
      }
    </style>
    <div class="bar">
      <b>AI Chat</b><span>overlay</span>
      <button type="button" data-collapse>▾</button>
    </div>
    <iframe title="AI Chat" src="${chatSrc}"></iframe>
    <div class="resize" title="Drag to resize"></div>
  `

  const size = { w: saved.w, h: saved.h }
  const pos = () => ({
    x: host.style.left && host.style.left !== 'auto' ? parseFloat(host.style.left) : null,
    y: host.style.top && host.style.top !== 'auto' ? parseFloat(host.style.top) : null,
    w: Math.round(size.w),
    h: Math.round(size.h),
    collapsed: wrap.classList.contains('collapsed'),
  })

  // Keep the whole window inside the viewport: shrink first, then shift.
  // Runs on mount (stale saves, smaller screens), drag/resize end, and
  // viewport resizes — afterwards pos() + savePos() persist the corrected box.
  function clampWin() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!wrap.classList.contains('collapsed')) {
      if (size.w > vw - 16) size.w = Math.max(MIN_WIDTH, vw - 16)
      if (size.h > vh - 16) size.h = Math.max(MIN_HEIGHT, vh - 16)
      wrap.style.width = size.w + 'px'
      wrap.style.height = size.h + 'px'
    }
    const r = host.getBoundingClientRect()
    let x = r.left
    let y = r.top
    if (r.right > vw) x -= r.right - vw
    if (r.bottom > vh) y -= r.bottom - vh
    if (x < 0) x = 0
    if (y < 0) y = 0
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    host.style.left = x + 'px'
    host.style.top = y + 'px'
  }

  const bar = wrap.querySelector('.bar')
  const btn = wrap.querySelector('[data-collapse]')
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    wrap.classList.toggle('collapsed')
    btn.textContent = wrap.classList.contains('collapsed') ? '▸' : '▾'
    savePos(pos())
  })

  let drag = null
  bar.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button')) return
    drag = { dx: ev.clientX - host.getBoundingClientRect().left, dy: ev.clientY - host.getBoundingClientRect().top }
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    host.style.left = (ev.clientX - drag.dx) + 'px'
    host.style.top = (ev.clientY - drag.dy) + 'px'
  })
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return
    host.style.left = (ev.clientX - drag.dx) + 'px'
    host.style.top = (ev.clientY - drag.dy) + 'px'
  })
  window.addEventListener('mouseup', () => {
    if (!drag) return
    drag = null
    clampWin()
    savePos(pos())
  })

  // Resize handle (bottom-right corner): drag to resize, size persists.
  const grip = wrap.querySelector('.resize')
  let sizing = null
  grip.addEventListener('mousedown', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    sizing = { x: ev.clientX, y: ev.clientY, w: size.w, h: size.h }
  })
  window.addEventListener('mousemove', (ev) => {
    if (!sizing) return
    size.w = Math.max(MIN_WIDTH, sizing.w + ev.clientX - sizing.x)
    size.h = Math.max(MIN_HEIGHT, sizing.h + ev.clientY - sizing.y)
    clampWin()
    if (window.__AI_LIVE_CHAT__) window.__AI_LIVE_CHAT__.width = size.w
    const api = window.__AI_LIVE_EDIT__
    if (api && typeof api.setToolbarOffset === 'function') api.setToolbarOffset(size.w + 32)
  })
  window.addEventListener('mouseup', () => {
    if (!sizing) return
    sizing = null
    clampWin()
    savePos(pos())
  })

  shadow.appendChild(wrap)
  document.documentElement.appendChild(host)
  showManualPopover(host)
  clampWin()
  savePos(pos())
  window.addEventListener('resize', () => {
    clampWin()
    savePos(pos())
  })

  // Deck mode needs the whole viewport: expand near-fullscreen on deck-open
  // (stashing the current box) and restore on deck-close. Only the chat
  // iframe may command this.
  const chatFrameEl = wrap.querySelector('iframe[title="AI Chat"]')
  let stashed = null
  window.addEventListener('message', (ev) => {
    const d = ev.data
    if (!d || typeof d !== 'object' || d.ns !== 'ai-live-chat-cmd') return
    try {
      if (ev.source !== chatFrameEl.contentWindow) return
    } catch { return }
    if (d.cmd === 'deck-open' && !stashed) {
      stashed = { ...size }
      size.w = Math.max(MIN_WIDTH, window.innerWidth - 32)
      size.h = Math.max(MIN_HEIGHT, window.innerHeight - 32)
      clampWin()
      savePos(pos())
      if (window.__AI_LIVE_CHAT__) window.__AI_LIVE_CHAT__.width = size.w
    } else if (d.cmd === 'deck-close' && stashed) {
      size.w = stashed.w
      size.h = stashed.h
      stashed = null
      clampWin()
      savePos(pos())
      if (window.__AI_LIVE_CHAT__) window.__AI_LIVE_CHAT__.width = size.w
      const api = window.__AI_LIVE_EDIT__
      if (api && typeof api.setToolbarOffset === 'function') api.setToolbarOffset(size.w + 32)
    }
  })
  window.__AI_LIVE_LAUNCHER__ = LAUNCHER_URL || location.origin
  window.__AI_LIVE_CHAT__ = { mounted: true, width: size.w, popover: usePopover }
  void installAnnotateToolbar()
}

function showOverlayError(wrap, message, retry) {
  let el = wrap.querySelector('.err')
  if (!el) {
    el = document.createElement('div')
    el.className = 'err'
    const text = document.createElement('span')
    text.setAttribute('data-msg', '')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Retry'
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      el.remove()
      void retry()
    })
    el.appendChild(text)
    el.appendChild(btn)
    wrap.appendChild(el)
  }
  el.querySelector('[data-msg]').textContent = message
}

/**
 * Fetch the annotate overlay's source. Same origin first: the plugin
 * serves /live-edit/overlay.js on the page's own Vite server, so
 * annotations do not depend on the launcher (:4112) being reachable
 * from this page. The configured launcher URL is the fallback (it is
 * also where the overlay will POST its submissions).
 */
async function fetchOverlaySource() {
  const bases = ['']
  const launcher = String(LAUNCHER_URL || '').replace(/\/$/, '')
  if (launcher) bases.push(launcher)
  let lastErr = null
  for (const base of bases) {
    try {
      const r = await fetch(base + '/live-edit/overlay.js', { cache: 'no-store' })
      if (!r.ok) throw new Error('overlay ' + r.status)
      return await r.text()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('overlay fetch failed')
}

let annotateInstallInFlight = false

async function installAnnotateToolbar() {
  window.__AI_LIVE_LAUNCHER__ = LAUNCHER_URL || location.origin
  if (!(window.__AI_LIVE_EDIT__ && window.__AI_LIVE_EDIT__.installed)) {
    // One install at a time: mountChatOverlay, the frame bootstrap
    // below and the error chip's Retry can all call here; the
    // overlay's own installed guard settles any race that remains.
    if (annotateInstallInFlight) return
    annotateInstallInFlight = true
    try {
      const src = await fetchOverlaySource()
      const script = document.createElement('script')
      // sourceURL names the inline-injected overlay after its served
      // route, so errors thrown inside overlay code carry that path
      // in their stacks — which is what lets the console capture
      // attribute them to the editor (src: 'editor') instead of the
      // app (slice C).
      script.textContent = `${src}\n//# sourceURL=/live-edit/overlay.js`
      document.documentElement.appendChild(script)
      if (!(window.__AI_LIVE_EDIT__ && window.__AI_LIVE_EDIT__.installed)) {
        // A 200 that wasn't the overlay (an SPA fallback page, say):
        // treat it as a failed install, not a silent success.
        throw new Error('overlay did not install')
      }
    } catch (err) {
      console.warn('[ai-live-editor] annotate overlay failed', err)
      // Loud, not silent: the toolbar is how users discover Annotate.
      // The error chip lives in the chat window, so only the top
      // frame can show it; in a frame the failure stays a console
      // warning and the editor notices the overlay never answers.
      const host = document.getElementById('ai-live-chat-host')
      const wrap = host?.shadowRoot?.querySelector('.win')
      if (wrap) {
        const where = LAUNCHER_URL || location.origin
        showOverlayError(wrap, `Annotate unavailable (${where}) — is the launcher running?`, installAnnotateToolbar)
      }
      return
    } finally {
      annotateInstallInFlight = false
    }
  }
  // Park the toolbar beside the chat window — only in the document
  // that hosts that window. In a frame there is no chat window, and
  // the toolbar keeps the overlay's default position.
  if (!document.getElementById('ai-live-chat-host')) return
  const api = window.__AI_LIVE_EDIT__
  const width = (window.__AI_LIVE_CHAT__ && window.__AI_LIVE_CHAT__.width) || DEFAULT_WIDTH
  if (api && typeof api.setToolbarOffset === 'function') api.setToolbarOffset(width + 32)
}

/**
 * The annotate starter. The floating chat window (mountChatOverlay)
 * stays top-frame only, but the annotate toolbar must exist wherever
 * the app is framed — above all inside the editor's preview iframe,
 * where this client is the only carrier that can start it. Runs in
 * every frame the plugin serves; installAnnotateToolbar is guarded
 * and idempotent, so a page where several carriers fire still gets
 * exactly one toolbar.
 */
export function bootstrapAnnotateToolbar() {
  if (location.pathname === '/chat-embed' || location.pathname.startsWith('/chat-embed/') || location.pathname === '/pool') return
  void installAnnotateToolbar()
}

export default function setupRenderer(ctx) {
  mountChatOverlay()
  const events = ctx && ctx.current && ctx.current.events
  if (events && events.on) {
    events.on('dom:panel:mounted', (panel) => {
      mountChatOverlay()
      panel.innerHTML = '<div style="padding:14px;font:12.5px system-ui;color:#a1a1aa;line-height:1.5">Chat is the floating window on this page (bottom right), next to Annotate.</div>'
    })
  }
}

mountChatOverlay()
bootstrapAnnotateToolbar()
