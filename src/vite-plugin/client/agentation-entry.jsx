/**
 * Agentation mount for the live page (phase-11-05 Step 5, Rung 1).
 * Injected by the Vite plugin via an /@fs script tag, using the editor
 * package's own React — the project being edited needs no changes.
 * "Send to Agent" posts the annotations to the editor's API
 * (/api/live-edit/agentation), which runs the editor agent on them.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Agentation } from 'agentation'

const LAUNCHER = window.__AI_LIVE_LAUNCHER__ || location.origin

// Keep Agentation's toolbar clear of the chat overlay popover, which
// docks bottom-right (~384px wide). Agentation persists a dragged
// position under this key; the stored point anchors the toolbar
// container (~293px wide, toggle at its right end), so seed it a
// container-width further left than the chat edge. Seed once, before
// first mount; a position the user drags to is never overridden.
try {
  if (!localStorage.getItem('feedback-toolbar-position')) {
    localStorage.setItem('feedback-toolbar-position', JSON.stringify({
      x: Math.max(16, window.innerWidth - 880),
      y: Math.max(16, window.innerHeight - 84),
    }))
  }
} catch { /* storage unavailable: default position */ }

function showResult(ok, text) {
  document.getElementById('ai-live-agentation-result')?.remove()
  const box = document.createElement('div')
  box.id = 'ai-live-agentation-result'
  box.style.cssText = [
    'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483000',
    'max-width:420px', 'max-height:40vh', 'overflow:auto',
    'background:#101418', 'color:#e8f0ee', 'border:1px solid ' + (ok ? '#2fbf9a' : '#e05d5d'),
    'border-radius:10px', 'padding:10px 12px', 'font:13px/1.45 system-ui,sans-serif',
    'white-space:pre-wrap', 'box-shadow:0 8px 30px rgba(0,0,0,.45)',
  ].join(';')
  const close = document.createElement('button')
  close.textContent = '×'
  close.title = 'Dismiss'
  close.style.cssText = 'float:right;background:none;border:0;color:#9fb3ad;font-size:16px;cursor:pointer'
  close.onclick = () => box.remove()
  const body = document.createElement('div')
  body.textContent = (ok ? 'Agent: ' : 'Send failed: ') + String(text || '').slice(0, 1500)
  box.append(close, body)
  document.body.appendChild(box)
  if (ok) setTimeout(() => box.remove(), 20000)
}

async function handleSubmit(output, annotations) {
  const res = await fetch(`${LAUNCHER}/api/live-edit/agentation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations, output, url: location.href }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    showResult(false, data.error || `HTTP ${res.status}`)
    // Throwing keeps the annotations in the toolbar (Agentation treats
    // a rejected onSubmit as a failed delivery and retains feedback).
    throw new Error(data.error || `Send failed (${res.status})`)
  }
  showResult(true, data.text || 'Done.')
}

if (!document.getElementById('ai-live-agentation')) {
  const host = document.createElement('div')
  host.id = 'ai-live-agentation'
  document.body.appendChild(host)
  createRoot(host).render(<Agentation onSubmit={handleSubmit} />)
}
