/**
 * Headless dispatch HTTP half (Muse Code design §13,
 * slice 10), mounted on both servers: the "Fix with Muse
 * Code" entry points POST a brief; the run is synchronous
 * (a dispatch is minutes, like a long chat turn); accept and
 * reject settle the pending diff.
 */
import type { Express } from 'express'
import {
  acceptDispatch, listDispatchRecords, rejectDispatch, runDispatch,
  type DispatchBriefInput,
} from './dispatch.js'

const SOURCES = ['criteria', 'console', 'gate', 'manual'] as const

export function mountDispatchApi(app: Express): void {
  app.get('/api/musecode/dispatches', (_req, res) => {
    res.json({ ok: true, dispatches: listDispatchRecords() })
  })

  app.post('/api/musecode/dispatch', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const evidence = typeof body.evidence === 'string' ? body.evidence : ''
    if (!title) return res.status(400).json({ ok: false, error: 'title required: what is being fixed' })
    const input: DispatchBriefInput = {
      title,
      evidence,
      criteria: Array.isArray(body.criteria) ? body.criteria.filter((c): c is string => typeof c === 'string') : undefined,
      source: (SOURCES as readonly string[]).includes(String(body.source)) ? (body.source as DispatchBriefInput['source']) : 'manual',
    }
    const record = await runDispatch(input)
    return res.json({ ok: record.status !== 'error', record })
  })

  app.post('/api/musecode/dispatch/accept', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const record = acceptDispatch(id)
    if (!record) return res.status(404).json({ ok: false, error: `no dispatch with id "${id}"` })
    return res.json({ ok: true, record })
  })

  app.post('/api/musecode/dispatch/reject', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : ''
    const record = rejectDispatch(id)
    if (!record) return res.status(404).json({ ok: false, error: `no dispatch with id "${id}"` })
    return res.json({ ok: true, record })
  })
}
