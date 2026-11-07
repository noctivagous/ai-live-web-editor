/**
 * Chat-thread identity + turn preparation for Mastra Memory.
 *
 * One thread per project, keyed by the project's ABSOLUTE ROOT, not its
 * display id: the store is one editor-global DB (storage.ts), and folder
 * names repeat — two different `lumen`s (or the same project opened via
 * the launcher and via the Path-2 plugin) must never merge histories.
 * The root itself never leaves this machine: ids are sha256 digests.
 *
 * Turn contract (prepareMemoryTurn):
 * - First turn on a thread: the client's supplied history rides through
 *   untouched, so a pre-memory conversation seeds the thread as it is
 *   persisted. Nothing the user already had is dropped.
 * - Later turns: the client still sends its localStorage history, but
 *   the server drops everything except system messages and the newest
 *   user message — recalled thread history supplies the rest, so a turn
 *   is never billed for the same history twice.
 * - Any store failure: the turn proceeds with the client's payload and
 *   no memory. Memory is continuity, not a dependency.
 *
 * One-shot agent calls (live-edit annotation submits, the verify-gate
 * follow-up) pass NO memory option: their synthetic prompts must never
 * be persisted into the user's thread.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { getFsRoot, listProjects } from '../launcher.js'
import { editorMemory } from './memory.js'

export type ChatThreadIds = { thread: string, resource: string }

export function chatThreadIds(root: string): ChatThreadIds {
  const digest = createHash('sha256').update(path.resolve(root)).digest('hex')
  return {
    thread: `ai-live-chat-${digest.slice(0, 32)}`,
    resource: `ai-live-root-${digest}`,
  }
}

export function currentChatThreadIds(): ChatThreadIds {
  return chatThreadIds(getFsRoot())
}

/**
 * Reduce a chat payload to what a memory-backed turn still needs from
 * the client: system messages (mode preambles, per-turn context) and
 * the newest user message. Pure so the rule is unit-testable.
 */
export function dropClientHistory(payload: unknown): unknown {
  if (!Array.isArray(payload)) return payload
  let lastUser = -1
  for (let i = 0; i < payload.length; i++) {
    const m = payload[i] as { role?: unknown } | null
    if (m && typeof m === 'object' && m.role === 'user') lastUser = i
  }
  if (lastUser < 0) return payload
  return payload.filter((m, i) => {
    const row = m as { role?: unknown } | null
    return (row && typeof row === 'object' && row.role === 'system') || i === lastUser
  })
}

export type PreparedMemoryTurn = {
  payload: unknown
  memory?: ChatThreadIds
}

export async function prepareMemoryTurn(payload: unknown): Promise<PreparedMemoryTurn> {
  const ids = currentChatThreadIds()
  try {
    const existing = await editorMemory.getThreadById({ threadId: ids.thread })
    return existing
      ? { payload: dropClientHistory(payload), memory: ids }
      : { payload, memory: ids }
  } catch {
    return { payload }
  }
}

/**
 * Delete the chat threads of the active project and every project in
 * the workspace (the plugin's own fs root is included via getFsRoot,
 * which is the foreign app's root on that surface). Backs Settings →
 * Clear saved chat sessions: once history lives server-side, clearing
 * only the browser copy would leave the agent still remembering.
 */
export async function clearChatThreads(): Promise<{ deleted: number, attempted: number }> {
  const roots = new Set<string>([getFsRoot()])
  try {
    for (const p of listProjects()) roots.add(p.root)
  } catch { /* workspace listing is best-effort; the active root still clears */ }
  let deleted = 0
  for (const root of roots) {
    const { thread } = chatThreadIds(root)
    try {
      await editorMemory.deleteThread(thread)
      deleted++
    } catch { /* a thread that was never created has nothing to delete */ }
  }
  return { deleted, attempted: roots.size }
}
