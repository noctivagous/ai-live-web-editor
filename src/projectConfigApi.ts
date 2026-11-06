/**
 * HTTP surface for the project manifest (phase-11-06 §A):
 * GET/POST /api/project/config. Mounted by both server entry
 * points, like the workflow API. POST merges a patch into
 * project.ai.json; a defaultDeviceTarget in the patch also moves
 * the session's current target.
 */
import type { Express } from 'express'
import { isDesignated, readProjectConfig, sanitizeProjectConfig, writeProjectConfig } from './projectConfig.js'
import { setDeviceTarget } from './deviceSession.js'

export function mountProjectConfigApi(app: Express) {
  app.get('/api/project/config', (_req, res) => {
    const config = readProjectConfig()
    res.json({ ok: true, config, designated: isDesignated(config) })
  })

  app.post('/api/project/config', (req, res) => {
    try {
      const patch = sanitizeProjectConfig(req.body || {})
      // An explicit null/empty type un-designates the project.
      if (req.body && 'type' in req.body && !patch.type) patch.type = undefined
      // An explicit null/empty format returns to the type default.
      if (req.body && 'format' in req.body && !patch.format) patch.format = undefined
      const config = writeProjectConfig(patch)
      if (patch.defaultDeviceTarget) setDeviceTarget(patch.defaultDeviceTarget)
      res.json({ ok: true, config, designated: isDesignated(config) })
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Failed to write project config' })
    }
  })
}
