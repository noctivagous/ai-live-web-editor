/**
 * HTTP surface for musecode/availability.ts, mounted on both
 * servers (server.ts + apiApp.ts) like agentSettingsApi: the
 * Settings engine picker, the setup wizard's path step and the
 * sandbox surface all read availability from here.
 */
import type { Express } from 'express'
import { getMuseCodeAvailability, resetMuseCodeAvailabilityCache } from './availability.js'

export function mountMuseCodeAvailabilityApi(app: Express): void {
  app.get('/api/musecode/availability', async (req, res) => {
    // ?fresh=1 drops the 30s cache first: the requirement note's
    // Refresh must see a Muse Code install that just finished,
    // not the answer from before it.
    if (req.query.fresh === '1') resetMuseCodeAvailabilityCache()
    const availability = await getMuseCodeAvailability()
    res.json({ ok: true, availability })
  })
}
