import type { Express } from 'express'
import { getFsRoot } from '../launcher.js'
import { configGet, configSet, deriveConfigInventory } from './configRegistry.js'

/** Configuration HTTP API, mounted on both servers. */
export function mountConfigApi(app: Express) {
  app.get('/api/config-inventory', (_req, res) => {
    res.json({ ok: true, inventory: deriveConfigInventory() })
  })

  app.post('/api/config/get', (req, res) => {
    const file = typeof req.body?.file === 'string' ? req.body.file : ''
    if (!file) return res.status(400).json({ ok: false, error: 'Expected { file }.' })
    const result = configGet(getFsRoot(), file, typeof req.body?.key === 'string' ? req.body.key : undefined)
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error })
    res.json({ ok: true, value: result.value })
  })

  app.post('/api/config/set', (req, res) => {
    const file = typeof req.body?.file === 'string' ? req.body.file : ''
    const key = typeof req.body?.key === 'string' ? req.body.key : ''
    if (!file || !key) return res.status(400).json({ ok: false, error: 'Expected { file, key, value }.' })
    const result = configSet(getFsRoot(), file, key, req.body.value)
    if (result.ok === false) return res.status(422).json({ ok: false, error: result.error })
    res.json({ ok: true, inventory: deriveConfigInventory() })
  })
}
