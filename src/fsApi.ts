/**
 * File-browser operations API: the rename/move, delete, and
 * create-folder endpoints the file pane needs beyond list/read/write.
 * POST /api/fs/rename  { from, to }              -> { ok, from, to, isDir }
 * POST /api/fs/delete  { path, recursive? }      -> { ok, path, isDir }
 * POST /api/fs/mkdir   { path }                  -> { ok, path }
 * POST /api/fs/write-binary { path, base64 }     -> { ok, path, bytes }
 * GET  /api/fs/read-binary?path=/x.png           -> the file's bytes
 * All three honor the sketch write guard like /api/fs/write, and all
 * path safety lives in fsOps.ts (traversal-checked, root-anchored).
 * Mounted on both servers like the other project APIs.
 */
import type { Express } from 'express'
import { getFsRoot } from './launcher.js'
import { sketchWriteGuard } from './sketchSession.js'
import { deletePath, mkdirPath, readBinaryFile, renamePath, writeBinaryFile } from './fsOps.js'

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

  app.get('/api/fs/read-binary', (req, res) => {
    try {
      const r = readBinaryFile(getFsRoot(), req.query.path)
      const ext = String(req.query.path || '').split('.').pop()?.toLowerCase()
      const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon' }
      res.setHeader('Content-Type', types[ext ?? ''] ?? 'application/octet-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.send(r.buffer)
    } catch (e: any) { res.status(400).json({ ok: false, error: e.message }) }
  })

  app.post('/api/fs/write-binary', (req, res) => {
    try {
      if (guard(res)) return
      const r = writeBinaryFile(getFsRoot(), req.body?.path, req.body?.base64)
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
