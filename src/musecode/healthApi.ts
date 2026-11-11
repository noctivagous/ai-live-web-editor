/**
 * HTTP surface for musecode/health.ts, mounted on both servers
 * like the availability API: GET reads the health facts (the
 * probe is the cached result or null — reading health never
 * spends a run), POST runs the probe (cached per binary unless
 * the body asks to force it).
 */
import type { Express } from 'express'
import { getMuseCodeAvailability } from './availability.js'
import { getMuseCodeHealth, probeSandbox } from './health.js'

export function mountMuseCodeHealthApi(app: Express): void {
  app.get('/api/musecode/health', async (_req, res) => {
    res.json({ ok: true, health: await getMuseCodeHealth() })
  })
  app.post('/api/musecode/health/probe', async (req, res) => {
    const force = Boolean(req.body && typeof req.body === 'object' && (req.body as { force?: unknown }).force === true)
    const availability = await getMuseCodeAvailability()
    const probe = await probeSandbox(availability, { force })
    res.json({ ok: true, probe })
  })
}
