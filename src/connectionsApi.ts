import type { Express, Request, Response } from 'express'
import {
  activateConnection, connectionKey, getStore, publicStore, recordProbe,
  removeConnection, setModalityDefaults, upsertConnection,
} from './connections.js'
import { listProviderModels, ProbeError } from './providers.js'
import { MODALITIES, type Modality } from './providerPresets.js'

function fail(res: Response, e: unknown) {
  res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
}

async function probe(body: Record<string, unknown>) {
  let key = typeof body.key === 'string' ? body.key.trim() : ''
  let baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : ''
  const presetId = typeof body.presetId === 'string' ? body.presetId : undefined
  if (typeof body.connectionId === 'string' && body.connectionId) {
    const conn = getStore().connections.find(c => c.id === body.connectionId)
    if (conn) {
      if (!key) key = connectionKey(conn)
      if (!baseUrl) baseUrl = conn.baseUrl
    }
  }
  const listed = await listProviderModels(key, baseUrl, { allModels: true, presetId })
  const suggestedByModality = Object.fromEntries(
    MODALITIES.map(m => [m, listed.tagged.some(t => t.modalities.includes(m))
      ? listed.tagged.filter(t => t.modalities.includes(m)).map(t => t.id)
      : []]),
  ) as Record<Modality, string[]>
  return { ...listed, suggestedByModality }
}

/** Shared BYOK connection routes, mounted by both server entry points. */
export function mountConnectionsApi(app: Express) {
  app.get('/api/connections', (_req: Request, res: Response) => {
    res.json(publicStore())
  })

  app.post('/api/connections/probe', async (req: Request, res: Response) => {
    try {
      res.json({ ok: true, ...(await probe(req.body || {})) })
    } catch (e) {
      if (e instanceof ProbeError) {
        res.json({ ok: false, errorKind: e.kind, error: e.message, models: [] })
      } else {
        res.json({ ok: false, errorKind: 'unknown', error: e instanceof Error ? e.message : String(e), models: [] })
      }
    }
  })

  app.post('/api/connections', (req: Request, res: Response) => {
    try {
      const body = req.body || {}
      const conn = upsertConnection({
        id: typeof body.id === 'string' ? body.id : undefined,
        presetId: typeof body.presetId === 'string' ? body.presetId : 'custom',
        name: typeof body.name === 'string' ? body.name : undefined,
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        model: typeof body.model === 'string' ? body.model : '',
        key: typeof body.key === 'string' ? body.key : undefined,
        verifiedModels: Array.isArray(body.verifiedModels) ? body.verifiedModels : undefined,
      })
      res.json({ ...publicStore(), saved: conn.id })
    } catch (e) {
      fail(res, e)
    }
  })

  app.post('/api/connections/delete', (req: Request, res: Response) => {
    try {
      removeConnection(String(req.body?.id || ''))
      res.json(publicStore())
    } catch (e) {
      fail(res, e)
    }
  })

  app.post('/api/connections/activate', (req: Request, res: Response) => {
    try {
      activateConnection(String(req.body?.id || ''))
      res.json(publicStore())
    } catch (e) {
      fail(res, e)
    }
  })

  app.post('/api/connections/test', async (req: Request, res: Response) => {
    const id = String(req.body?.id || '')
    try {
      const result = await probe({ connectionId: id })
      recordProbe(id, result.tagged, true)
      res.json({ ...publicStore(), probe: { ok: true, models: result.tagged.length } })
    } catch (e) {
      recordProbe(id, [], false)
      if (e instanceof ProbeError) {
        res.json({ ...publicStore(), probe: { ok: false, errorKind: e.kind, error: e.message } })
      } else {
        fail(res, e)
      }
    }
  })

  app.post('/api/connections/modalities', (req: Request, res: Response) => {
    try {
      const defaults = setModalityDefaults(req.body?.defaults || {})
      res.json({ ...publicStore(), modalityDefaults: defaults })
    } catch (e) {
      fail(res, e)
    }
  })
}
