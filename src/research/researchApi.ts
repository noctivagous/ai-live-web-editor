/**
 * Research settings API (phase-11-06 §N): the Brave key's
 * server half for the Settings/wizard Search card. The key is
 * stored in the editor's `.env` (BRAVE_API_KEY) via the same
 * upsert the AI config uses, and process.env is updated in
 * step so the tools pick it up without a restart. The key
 * itself is never returned — only configured status + last4.
 */
import type { Express } from 'express'
import { braveApiKey, removeEnvVar, upsertEnvVar } from '../env.js'
import { braveSearch } from './brave.js'

export interface BraveStatus {
  configured: boolean
  keyLast4?: string
}

export function braveStatus(key: string = braveApiKey()): BraveStatus {
  return key
    ? { configured: true, keyLast4: key.slice(-4) }
    : { configured: false }
}

export function mountResearchApi(app: Express) {
  app.get('/api/research/config', (_req, res) => {
    res.json({ ok: true, brave: braveStatus() })
  })

  app.post('/api/research/brave', (req, res) => {
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : null
    if (apiKey === null) return res.status(400).json({ ok: false, error: 'apiKey (string) required' })
    if (apiKey) {
      upsertEnvVar('BRAVE_API_KEY', apiKey)
      process.env.BRAVE_API_KEY = apiKey
    } else {
      removeEnvVar('BRAVE_API_KEY')
      delete process.env.BRAVE_API_KEY
    }
    return res.json({ ok: true, brave: braveStatus() })
  })

  // Validate a candidate key (or the saved one) with one real
  // search — the card's Test button. Nothing is saved here.
  app.post('/api/research/brave/test', async (req, res) => {
    const candidate = typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()
      ? req.body.apiKey.trim()
      : braveApiKey()
    const r = await braveSearch('brave search api', { count: 1 }, fetch, candidate)
    if (r.ok === false) return res.json({ ok: false, error: r.error })
    return res.json({ ok: true, resultCount: r.results.length })
  })
}
