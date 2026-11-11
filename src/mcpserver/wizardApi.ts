/**
 * The wizard channel's HTTP half (Muse Code design §9.2,
 * slice 8), mounted on both servers like every project API:
 *
 * - GET  /api/wizards/events   — SSE: an `wizard-open` event
 *   for each agent-opened wizard (replayed for late joiners),
 *   which the editor UI turns into the open wizard on screen.
 * - POST /api/wizards/complete — the UI reports the outcome
 *   { completionId, outcome } when the wizard completes or is
 *   cancelled; that resolves the pending tool call.
 */
import type { Express } from 'express'
import { onWizardOpen } from './wizards.js'
import { reportWizardCompletion } from './wizardTools.js'

export function mountWizardApi(app: Express): void {
  app.get('/api/wizards/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    const off = onWizardOpen((open) => {
      try { res.write(`event: wizard-open\ndata: ${JSON.stringify(open)}\n\n`) } catch { /* closed */ }
    })
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* closed */ } }, 15000)
    req.on('close', () => {
      clearInterval(ping)
      off()
    })
  })

  app.post('/api/wizards/complete', (req, res) => {
    const completionId = typeof req.body?.completionId === 'string' ? req.body.completionId : ''
    const raw = (req.body?.outcome && typeof req.body.outcome === 'object' ? req.body.outcome : {}) as Record<string, unknown>
    if (!completionId) return res.status(400).json({ ok: false, error: 'completionId required' })
    const resolved = reportWizardCompletion(completionId, {
      status: raw.status === 'cancelled' ? 'cancelled' : 'completed',
      wizardId: typeof raw.wizardId === 'string' ? raw.wizardId : '',
      ...(typeof raw.action === 'string' ? { action: raw.action } : {}),
      ...(raw.created !== undefined ? { created: raw.created } : {}),
      ...(raw.detail !== undefined ? { detail: raw.detail } : {}),
      ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
    })
    return res.json({ ok: resolved, resolved })
  })
}
