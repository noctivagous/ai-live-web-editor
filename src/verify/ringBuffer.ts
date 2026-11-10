/** Capped ring buffer with sequence numbers — shared shape for console capture. */
import type { ConsoleSrc } from './consoleSource.js'

export type RingEntry = {
  seq: number
  level: string
  text: string
  stack?: string
  url?: string
  ts: number
  kind?: string
  /** Source attribution (slice C): whose code produced the entry.
   * Absent on pre-slice-C entries, where it means 'app'. */
  src?: ConsoleSrc
}

export type RingBuffer = {
  entries: RingEntry[]
  seq: number
  cap: number
}

export function createRingBuffer(cap = 200): RingBuffer {
  return { entries: [], seq: 0, cap: Math.max(1, cap) }
}

export function pushRing(
  buf: RingBuffer,
  entry: Omit<RingEntry, 'seq' | 'ts'> & { ts?: number },
): RingEntry {
  buf.seq += 1
  const full: RingEntry = { ...entry, seq: buf.seq, ts: entry.ts ?? Date.now() }
  buf.entries.push(full)
  if (buf.entries.length > buf.cap) buf.entries.splice(0, buf.entries.length - buf.cap)
  return full
}

export function readRing(
  buf: RingBuffer,
  opts: { sinceSeq?: number, levels?: string[], maxEntries?: number } = {},
): { entries: RingEntry[], latestSeq: number } {
  const since = opts.sinceSeq || 0
  const levels = opts.levels?.length ? new Set(opts.levels) : null
  const max = Math.max(1, Math.min(buf.cap, opts.maxEntries || 100))
  const entries = buf.entries
    .filter((e) => e.seq > since && (!levels || levels.has(e.level)))
    .slice(-max)
  return { entries, latestSeq: buf.seq }
}
