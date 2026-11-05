/**
 * DevTools custom-render client: floating chat window on the previewed page.
 * Iframe points at the launcher /chat-embed so Chat.tsx + SSE stay in one place.
 */
const LAUNCHER_URL = __LAUNCHER_URL__
const STORAGE = 'ai_live_chat_window'
const WIDTH = 380

function loadPos() {
  try {
    const raw = sessionStorage.getItem(STORAGE)
    if (!raw) return { x: null, y: null, collapsed: false }
    return JSON.parse(raw)
  } catch {
    return { x: null, y: null, collapsed: false }
  }
}

function savePos(state) {
  try { sessionStorage.setItem(STORAGE, JSON.stringify(state)) } catch { /* ignore */ }
}

export function mountChatOverlay() {
  if (location.pathname === '/chat-embed' || location.pathname.startsWith('/chat-embed/') || location.pathname === '/pool') return
  if (document.getElementById('ai-live-chat-host')) return
  const saved = loadPos()
  const host = document.createElement('div')
  host.id = 'ai-live-chat-host'
  const shadow = host.attachShadow({ mode: 'open' })

  const wrap = document.createElement('div')
  wrap.className = 'win'
  wrap.style.right = saved.x == null ? '16px' : 'auto'
  wrap.style.bottom = saved.y == null ? '16px' : 'auto'
  if (saved.x != null) wrap.style.left = saved.x + 'px'
  if (saved.y != null) wrap.style.top = saved.y + 'px'
  if (saved.collapsed) wrap.classList.add('collapsed')

  wrap.innerHTML = `
    <style>
      :host { all: initial; }
      .win {
        position: fixed; z-index: 90000;
        width: ${WIDTH}px; height: 440px;
        display: flex; flex-direction: column;
        background: #141417; color: #e4e4e7;
        border: 1px solid #26262c; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,.45);
        font-family: system-ui, sans-serif;
        overflow: hidden;
      }
      .win.collapsed { height: 40px; width: 180px; }
      .win.collapsed iframe { display: none; }
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
    </style>
    <div class="bar">
      <b>AI Chat</b><span>overlay</span>
      <button type="button" data-collapse>▾</button>
    </div>
    <iframe title="AI Chat" src="${(LAUNCHER_URL || '') + '/chat-embed'}"></iframe>
  `

  const bar = wrap.querySelector('.bar')
  const btn = wrap.querySelector('[data-collapse]')
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    wrap.classList.toggle('collapsed')
    btn.textContent = wrap.classList.contains('collapsed') ? '▸' : '▾'
    savePos({
      x: wrap.style.left ? parseFloat(wrap.style.left) : null,
      y: wrap.style.top ? parseFloat(wrap.style.top) : null,
      collapsed: wrap.classList.contains('collapsed'),
    })
  })

  let drag = null
  bar.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button')) return
    drag = { dx: ev.clientX - wrap.getBoundingClientRect().left, dy: ev.clientY - wrap.getBoundingClientRect().top }
    wrap.style.right = 'auto'
    wrap.style.bottom = 'auto'
    wrap.style.left = (ev.clientX - drag.dx) + 'px'
    wrap.style.top = (ev.clientY - drag.dy) + 'px'
  })
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return
    wrap.style.left = (ev.clientX - drag.dx) + 'px'
    wrap.style.top = (ev.clientY - drag.dy) + 'px'
  })
  window.addEventListener('mouseup', () => {
    if (!drag) return
    drag = null
    savePos({
      x: parseFloat(wrap.style.left),
      y: parseFloat(wrap.style.top),
      collapsed: wrap.classList.contains('collapsed'),
    })
  })

  shadow.appendChild(wrap)
  document.documentElement.appendChild(host)
  window.__AI_LIVE_LAUNCHER__ = LAUNCHER_URL || location.origin
  window.__AI_LIVE_CHAT__ = { mounted: true, width: WIDTH }
  void installAnnotateToolbar()
}

async function installAnnotateToolbar() {
  window.__AI_LIVE_LAUNCHER__ = LAUNCHER_URL || location.origin
  if (!(window.__AI_LIVE_EDIT__ && window.__AI_LIVE_EDIT__.installed)) {
    try {
      const src = await fetch((LAUNCHER_URL || '') + '/live-edit/overlay.js').then((r) => {
        if (!r.ok) throw new Error('overlay ' + r.status)
        return r.text()
      })
      const script = document.createElement('script')
      script.textContent = src
      document.documentElement.appendChild(script)
    } catch (err) {
      console.warn('[ai-live-editor] annotate overlay failed', err)
      return
    }
  }
  const api = window.__AI_LIVE_EDIT__
  if (api && typeof api.setToolbarOffset === 'function') api.setToolbarOffset(WIDTH + 32)
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
