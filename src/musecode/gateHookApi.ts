/**
 * The Stop hook's HTTP half (Muse Code design §11, slice 9),
 * mounted on both servers like the other musecode APIs:
 *
 * - POST /api/musecode/stop-hook — the generated hook script
 *   POSTs the turn payload here; the editor runs the gate and
 *   records the verdict (musecode/gateHook.ts).
 * - GET  /api/musecode/gate-verdicts — the recorded verdicts
 *   for the active project (what the turn surfaces show; also
 *   the honest place to check a verdict the chat pipe's wait
 *   missed because the gate settled slowly).
 */
import type { Express } from 'express'
import { handleStopHook, listGateVerdicts, type StopHookPayload } from './gateHook.js'

export function mountGateHookApi(app: Express): void {
  app.post('/api/musecode/stop-hook', async (req, res) => {
    try {
      const result = await handleStopHook((req.body ?? {}) as StopHookPayload)
      return res.json({ ok: true, ...result })
    } catch (e: any) {
      return res.json({ ok: false, error: e?.message || String(e) })
    }
  })
  app.get('/api/musecode/gate-verdicts', (_req, res) => {
    res.json({ ok: true, verdicts: listGateVerdicts() })
  })
}
