/**
 * DevTools action client: annotation overlay on the live page (click elements, add notes).
 * Same overlay.js the launcher uses for Static preview; this is how it reaches Vite HMR.
 */
const LAUNCHER_URL = __LAUNCHER_URL__

async function ensureOverlay() {
  window.__AI_LIVE_LAUNCHER__ = LAUNCHER_URL || location.origin
  if (window.__AI_LIVE_EDIT__ && window.__AI_LIVE_EDIT__.installed) return window.__AI_LIVE_EDIT__
  const src = await fetch((LAUNCHER_URL || '') + '/live-edit/overlay.js', { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('overlay fetch failed: ' + r.status)
    return r.text()
  })
  const script = document.createElement('script')
  script.textContent = src
  document.documentElement.appendChild(script)
  return window.__AI_LIVE_EDIT__
}

function parkToolbarNextToChat() {
  const api = window.__AI_LIVE_EDIT__
  const chat = window.__AI_LIVE_CHAT__
  const width = (chat && chat.width) || 380
  if (api && typeof api.setToolbarOffset === 'function') {
    api.setToolbarOffset(width + 32)
    return
  }
  const toolbar = document.querySelector('#ai-live-edit-root .ai-le-toolbar')
  if (toolbar) toolbar.style.right = (width + 32) + 'px'
}

export default function setupAnnotate(ctx) {
  const events = ctx && ctx.current && ctx.current.events
  if (!events || !events.on) return
  events.on('entry:activated', async () => {
    try {
      const api = await ensureOverlay()
      api.enableSelectMode()
      parkToolbarNextToChat()
    } catch (err) {
      console.warn('[ai-live-editor] annotate failed', err)
    }
  })
  events.on('entry:deactivated', () => {
    try { window.__AI_LIVE_EDIT__?.disableSelectMode?.() } catch { /* ignore */ }
  })
}
