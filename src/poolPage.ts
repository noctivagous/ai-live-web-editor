import { getFsRoot } from './launcher.js'
import { getPoolInfo } from './browserPool.js'
import { liveTarget, playwrightPoolEnabled } from './env.js'
import fs from 'fs'
import type { Express } from 'express'

const EDITOR = `http://localhost:${process.env.LAUNCHER_PORT || 4112}`
const VITE = process.env.VITE_ORIGIN || 'http://localhost:5173'

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

export function poolLandingHtml() {
  const info = getPoolInfo()
  let fileCount = 0
  try { fileCount = fs.readdirSync(getFsRoot()).length } catch {}
  const enabled = playwrightPoolEnabled()
  const activity = info.activity.length
    ? info.activity.map(a => `<li><b>${esc(a.kind)}</b> ${esc(a.summary)} <span style="color:#888">${esc(a.at)}</span></li>`).join('')
    : '<li style="color:#888">No agent activity yet</li>'
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="5"/><title>AI Live Editor — Browser Pool</title></head>
<body style="font-family:system-ui;background:#0f0f0f;color:#eee;padding:32px;max-width:640px;margin:0 auto">
<h1>AI Live Editor — Browser Pool</h1>
<p>This window is the <b>agent's Chrome</b> (Playwright). Use the editor at <a style="color:#8ab4f8" href="${EDITOR}/">${esc(EDITOR)}</a>. The Vite app is <a style="color:#8ab4f8" href="${VITE}/">${esc(VITE)}</a>.</p>
<p>Pool is <b>${enabled ? 'on' : 'off'}</b>. Start with <code>npm run dev:pool</code> or enable it in Settings.</p>
<ul>
<li>Executable: <code>${esc(info.executable)}</code></li>
<li>FS root: <code>${esc(getFsRoot())}</code> (${fileCount} top-level entries)</li>
<li>Open pages: ${info.pages}</li>
<li>Profile: <code>${esc(info.userDataDir)}</code></li>
</ul>
<h2>Recent agent activity (refreshes every 5s)</h2>
<ul>${activity}</ul>
</body></html>`
}

export function mountPoolPage(app: Express) {
  app.get('/pool', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(poolLandingHtml())
  })
}

export const POOL_LANDING = `${VITE}/pool`

export async function waitForVite(origin = VITE, ms = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(origin + '/')
      if (r.ok) return true
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

export async function openPoolBrowser() {
  const { getBrowser } = await import('./browserPool.js')
  const ok = await waitForVite()
  if (!ok) console.log('[browser] Vite not ready; opening pool anyway')
  const appUrl = `${VITE}/`
  if (liveTarget() === 'pool') {
    const ctx = await getBrowser(appUrl)
    const extra = await ctx.newPage()
    await extra.goto(POOL_LANDING, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {})
    console.log('[browser] LIVE_TARGET=pool — working tab', appUrl, '+', POOL_LANDING)
    return
  }
  await getBrowser(POOL_LANDING)
}
