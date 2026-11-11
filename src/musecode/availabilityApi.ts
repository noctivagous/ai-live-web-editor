/**
 * HTTP surface for musecode/availability.ts, mounted on both
 * servers (server.ts + apiApp.ts) like agentSettingsApi: the
 * Settings engine picker, the setup wizard's path step and the
 * sandbox surface all read availability from here.
 */
import type { Express } from 'express'
import { getMuseCodeAvailability } from './availability.js'

export function mountMuseCodeAvailabilityApi(app: Express): void {
  app.get('/api/musecode/availability', async (_req, res) => {
    const availability = await getMuseCodeAvailability()
    res.json({ ok: true, availability })
  })
}
