import type { Express } from 'express'
import { livePageOp } from './liveTarget.js'
import {
  acceptSketch,
  appendSketchPatch,
  discardSketch,
  getSketchState,
  parseSketchMode,
  setSketchMode,
  snapshotPublic,
  undoLastSketch,
  type SketchPatch,
} from './sketchSession.js'

function restoreFailed(result: unknown): string | null {
  if (!result || typeof result !== 'object') return 'restore returned nothing'
  const r = result as Record<string, unknown>
  if (r.ok === false || r.error) return String(r.error || 'restore failed')
  return null
}

async function restoreOnPage(patch: SketchPatch) {
  return livePageOp('patch', {
    selector: patch.selector,
    op: 'restore',
    restoreOp: patch.op,
    before: patch.before,
  })
}

export function mountWorkflowApi(app: Express) {
  app.get('/api/workflow', (_req, res) => {
    res.json(snapshotPublic(getSketchState()))
  })

  app.post('/api/workflow', async (req, res) => {
    try {
      const body = req.body || {}
      const mode = parseSketchMode(body.mode)
      if (mode) setSketchMode(mode)
      const action = body.action
      if (action === 'undo') {
        const { undone } = undoLastSketch()
        if (undone) {
          const result = await restoreOnPage(undone)
          const err = restoreFailed(result)
          if (err) {
            appendSketchPatch(undone)
            return res.status(502).json({ ...snapshotPublic(getSketchState()), restoreError: err })
          }
        }
      } else if (action === 'discard') {
        const { undone } = discardSketch()
        const errors: string[] = []
        for (const patch of undone) {
          const err = restoreFailed(await restoreOnPage(patch))
          if (err) errors.push(`${patch.selector}: ${err}`)
        }
        if (errors.length) {
          return res.status(502).json({ ...snapshotPublic(getSketchState()), restoreError: errors.join('; ') })
        }
      } else if (action === 'accept') {
        acceptSketch()
      }
      res.json(snapshotPublic(getSketchState()))
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(500).json({ ok: false, error: message })
    }
  })
}
