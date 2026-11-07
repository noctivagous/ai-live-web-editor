/**
 * File-browser operations API: the rename/move, delete, and
 * create-folder endpoints the file pane needs beyond list/read/write.
 * POST /api/fs/rename  { from, to }              -> { ok, from, to, isDir }
 * POST /api/fs/delete  { path, recursive? }      -> { ok, path, isDir }
 * POST /api/fs/mkdir   { path }                  -> { ok, path }
 * All three honor the sketch write guard like /api/fs/write, and all
 * path safety lives in fsOps.ts (traversal-checked, root-anchored).
 * Mounted on both servers like the other project APIs.
 */
import type { Express } from 'express'
import { getFsRoot } from './launcher.js'
import { sketchWriteGuard } from './sketchSession.js'
import { deletePath, mkdirPath, renamePath } from './fsOps.js'

export function mountFsApi(app: Express) {
  const guard = (res: import('express').Response): boolean => {
    const blocked = sketchWriteGuard()
    if (!blocked) return false
    res.status(409).json({ ok: false, ...blocked })
    return true
  }

  app.post('/api/fs/rename', (req, res) => {
    try {
      if (guard(res)) return
      const r = renamePath(getFsRoot(), req.body?.from, req.body?.to)
      res.json({ ok: true, ...r })
    } catch (e: any) { res.status(400).json({ ok: false, error: e.message }) }
  })

  app.post('/api/fs/delete', (req, res) => {
    try {
      if (guard(res)) return
      const r = deletePath(getFsRoot(), req.body?.path, req.body?.recursive === true)
      res.json({ ok: true, ...r })
    } catch (e: any) { res.status(400).json({ ok: false, error: e.message }) }
  })

  app.post('/api/fs/mkdir', (req, res) => {
    try {
      if (guard(res)) return
      const r = mkdirPath(getFsRoot(), req.body?.path)
      res.json({ ok: true, ...r })
    } catch (e: any) { res.status(400).json({ ok: false, error: e.message }) }
  })
}
