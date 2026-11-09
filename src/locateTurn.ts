/**
 * Per-chat-turn locate state (AsyncLocalStorage).
 *
 * - Overlapping reads: a second read-real-file whose range is already
 *   inside a successful untruncated read this turn returns a pointer,
 *   not the body again.
 * - Working set: grep / read / replace paths flush into thread working
 *   memory at the end of the turn so the next turn does not re-search.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type ReadCover = { path: string, start: number, end: number }
export type LocateNote = { path: string, start?: number, end?: number }

type TurnState = { reads: ReadCover[], locates: LocateNote[] }

const als = new AsyncLocalStorage<TurnState>()

export function runChatTurnScope<T>(fn: () => T): T {
  return als.run({ reads: [], locates: [] }, fn)
}

function state(): TurnState | undefined {
  return als.getStore()
}

export function coveringRead(path: string, start: number, end: number): ReadCover | null {
  const s = state()
  if (!s) return null
  return s.reads.find(r => r.path === path && r.start <= start && r.end >= end) || null
}

export function recordRead(path: string, start: number, end: number, truncated: boolean): void {
  const s = state()
  if (!s || truncated || end < start) return
  if (!coveringRead(path, start, end)) s.reads.push({ path, start, end })
  recordLocate(path, start, end)
}

export function recordLocate(path: string, start?: number, end?: number): void {
  const s = state()
  if (!s || !path) return
  const prev = s.locates.findIndex(n => n.path === path)
  const note: LocateNote = { path, start, end }
  if (prev >= 0) s.locates[prev] = note
  else s.locates.push(note)
}

export function takeLocates(): LocateNote[] {
  const s = state()
  if (!s) return []
  const notes = s.locates.slice(0, 20)
  s.locates.length = 0
  return notes
}

const FILES_HEAD = '## Files touched'

/** Merge locate notes into the working-memory markdown template. */
export function mergeFilesTouched(workingMemory: string, notes: LocateNote[]): string {
  if (!notes.length) return workingMemory
  const byPath = new Map<string, string>()
  for (const n of notes) {
    const range = n.start != null
      ? (n.end != null && n.end !== n.start ? ` L${n.start}–${n.end}` : ` L${n.start}`)
      : ''
    byPath.set(n.path, `- ${n.path}${range}`)
  }
  const incoming = [...byPath.values()]
  const src = workingMemory.includes(FILES_HEAD)
    ? workingMemory
    : `${workingMemory.trimEnd()}\n\n${FILES_HEAD}\n`
  const idx = src.indexOf(FILES_HEAD)
  const afterHead = idx + FILES_HEAD.length
  const restStart = src.indexOf('\n## ', afterHead)
  const before = src.slice(0, afterHead)
  const section = (restStart < 0 ? src.slice(afterHead) : src.slice(afterHead, restStart)).replace(/^\n/, '')
  const after = restStart < 0 ? '' : src.slice(restStart)
  const existing = section.split('\n').map(l => l.trim()).filter(l => l.startsWith('- '))
  const keep = existing.filter(l => {
    const path = l.replace(/^- /, '').replace(/ L\d.*$/, '')
    return !byPath.has(path)
  })
  const merged = [...keep, ...incoming].slice(-20)
  const body = merged.length ? `\n${merged.join('\n')}\n` : '\n'
  return `${before}${body}${after.startsWith('\n') || after === '' ? after : `\n${after}`}`
}

export async function flushLocatesToWorkingMemory(): Promise<void> {
  const notes = takeLocates()
  if (!notes.length) return
  try {
    const { currentChatThreadIds } = await import('./mastra/chatMemory.js')
    const { editorMemory } = await import('./mastra/memory.js')
    const ids = currentChatThreadIds()
    const { WORKING_MEMORY_TEMPLATE } = await import('./mastra/memory.js')
    const current = await editorMemory.getWorkingMemory({ threadId: ids.thread, resourceId: ids.resource })
    const base = typeof current === 'string' && current.trim() ? current : WORKING_MEMORY_TEMPLATE
    const next = mergeFilesTouched(base, notes)
    if (next === base) return
    await editorMemory.updateWorkingMemory({ threadId: ids.thread, resourceId: ids.resource, workingMemory: next })
  } catch { /* working memory is continuity, not a dependency */ }
}
