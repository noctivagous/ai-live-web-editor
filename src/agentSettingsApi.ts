/**
 * HTTP surface for agentSettings.ts, mounted on both servers
 * (server.ts + apiApp.ts) like projectConfigApi.
 */
import type { Express } from 'express'
import { loadAgentSettings, saveAgentSettings } from './agentSettings.js'

export function mountAgentSettingsApi(app: Express): void {
  app.get('/api/agent-settings', (_req, res) => {
    res.json({ ok: true, settings: loadAgentSettings() })
  })
  app.post('/api/agent-settings', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}
    const patch: Record<string, unknown> = {}
    if ('defaultWorkflow' in body) patch.defaultWorkflow = body.defaultWorkflow
    if ('contextTrim' in body) patch.contextTrim = body.contextTrim
    if ('mapInjection' in body) patch.mapInjection = body.mapInjection
    res.json({ ok: true, settings: saveAgentSettings(patch) })
  })
}
