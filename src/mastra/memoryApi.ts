/**
 * Memory API: the server half of Settings → Clear saved chat sessions.
 * Mounted on both servers like the other project APIs (planApi pattern).
 */
import type { Express } from 'express'
import { clearChatThreads } from './chatMemory.js'

export function mountMemoryApi(app: Express) {
  app.post('/api/chat/threads/clear', async (_req, res) => {
    try {
      const { deleted, attempted } = await clearChatThreads()
      res.json({ ok: true, deleted, attempted })
    } catch (e: unknown) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
}
