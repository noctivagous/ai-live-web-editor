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
  // Project-scoped clear — the server half of the chat Clear
  // button. Drops the active project's Mastra thread AND its cached
  // OpenCode session, whichever engine served past turns, so the
  // next turn starts with no recalled history on either engine.
  // Best-effort per store: one engine failing never blocks the other.
  app.post('/api/chat/clear', async (_req, res) => {
    try {
      const [{ clearChatThread }, { getFsRoot }] = await Promise.all([
        import('./chatMemory.js'),
        import('../launcher.js'),
      ])
      const thread = await clearChatThread(getFsRoot()).catch(() => false)
      let session = false
      try {
        const { clearOpencodeSession } = await import('../opencode/chat.js')
        session = clearOpencodeSession()
      } catch { /* sidecar modules unavailable — nothing cached */ }
      res.json({ ok: true, thread, session })
    } catch (e: unknown) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
}
