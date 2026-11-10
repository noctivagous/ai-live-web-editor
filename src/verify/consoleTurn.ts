/**
 * Every-turn console checking (slice B): the cheap half of the verify
 * gate, split out so EVERY chat turn — Files or Sketch, write or not —
 * gets a console watermark at its start and a console read at its end.
 *
 * Cost discipline: the start capture is two watermark probes (the
 * bridge probe is one HTTP round-trip to the project's own server and
 * fails fast when nothing listens; the pool probe is a no-op unless
 * the pool is the live target). No layout snapshot, no check frames.
 * When neither channel was connected at the start, the end read is
 * skipped entirely — a quiet turn with no page costs the failed
 * start probe and nothing else.
 */
import { pageCommand } from '../pageBridge.js'
import { liveConsole } from '../liveTarget.js'
import { captureConsoleMarks } from './runGate.js'
import {
  consoleEpochPlan,
  consoleInstanceOf,
  isErrorLevel,
  type ConsoleChannelMark,
  type ConsoleEntry,
  type ConsoleInstance,
  type ConsoleWatermark,
} from './gate.js'
import { sinceWindow, type ProjectConsoleMarks } from './consoleWatermarks.js'
import type { ExpectationResult } from './consoleExpectations.js'
import { dedupeConsoleEntries, isAppEntry } from './consoleSource.js'

export type ConsoleChannelId = 'bridge' | 'pool'

export interface ConsoleCapture {
  at: number
  bridge: ConsoleChannelMark
  pool: ConsoleChannelMark
}

export interface ConsoleChannelRead {
  entries: ConsoleEntry[]
  latestSeq: number
  instance?: ConsoleInstance
  error?: string
}

/** The two console channels' reads, abstracted so the turn
 * orchestration is testable without a live page. Watermark probes
 * are NOT duplicated here — captureConsoleMarks in runGate.ts is
 * the one implementation, shared with the gate baseline. */
export interface ConsoleChannels {
  read(channel: ConsoleChannelId, sinceSeq: number, maxEntries: number): Promise<ConsoleChannelRead>
}

export const liveConsoleChannels: ConsoleChannels = {
  async read(channel, sinceSeq, maxEntries) {
    try {
      const raw = (channel === 'pool'
        ? await liveConsole({ sinceSeq, maxEntries }, undefined)
        : await pageCommand('console', { sinceSeq, maxEntries })) as any
      if (raw?.error) return { entries: [], latestSeq: 0, error: String(raw.error) }
      return {
        entries: Array.isArray(raw?.entries) ? raw.entries as ConsoleEntry[] : [],
        latestSeq: Number(raw?.latestSeq || 0),
        instance: consoleInstanceOf(raw),
      }
    } catch (e: unknown) {
      return { entries: [], latestSeq: 0, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

/** Start-of-turn capture: both channels' watermarks, nothing else.
 * The marks function is injectable for tests; production uses
 * runGate's captureConsoleMarks (the gate baseline reuses the same
 * capture, so a turn probes each channel once). */
export async function captureConsoleCapture(
  marksFn: () => Promise<{ bridge: ConsoleChannelMark, pool: ConsoleChannelMark }> = captureConsoleMarks,
): Promise<ConsoleCapture> {
  const marks = await marksFn()
  return { at: Date.now(), bridge: marks.bridge, pool: marks.pool }
}

export function anyChannelConnected(capture: ConsoleCapture): boolean {
  return capture.bridge.connected || capture.pool.connected
}

const CHANNELS: ConsoleChannelId[] = ['bridge', 'pool']

/**
 * The "since your last chat" entries for a turn, read at turn START
 * (while the page instance the window is anchored to is still the
 * live one — a mid-turn reload must not make the window unreadable).
 * Only failure-class entries (error/pageerror/warn) are reported.
 * Never throws; a channel that cannot be read contributes nothing.
 */
export async function readSinceLastChatEntries(
  marks: ProjectConsoleMarks | undefined,
  capture: ConsoleCapture,
  channels: ConsoleChannels = liveConsoleChannels,
): Promise<ConsoleEntry[]> {
  const out: ConsoleEntry[] = []
  for (const channel of CHANNELS) {
    const window = sinceWindow(marks, channel, capture[channel])
    if (!window) continue
    const raw = await channels.read(channel, window.sinceSeq, 200)
    if (raw.error) continue
    for (const e of raw.entries) {
      if (e.seq > window.sinceSeq && e.seq <= capture[channel].seq
        && (isErrorLevel(e.level) || e.level === 'warn') && !/^\s*$/.test(e.text || '')) {
        out.push(e)
      }
    }
  }
  return out
}

export interface TurnConsoleRead {
  /** This turn's entries, all levels, from every readable channel. */
  entries: ConsoleEntry[]
  /** Latest observed position per channel (watermark advance input).
   * A channel whose end read failed keeps its start position — that
   * position was observed this turn, so advancing to it is honest. */
  latest: { bridge?: ConsoleWatermark, pool?: ConsoleWatermark }
  /** At least one channel answered the end read — expectations and
   * findings are verifiable rather than guesses. */
  readable: boolean
  /** A channel's page instance changed during the turn. */
  reloaded: boolean
}

/**
 * End-of-turn read. `graceMs` is the bounded settle for non-gate
 * turns (gate turns pass 0 — runVerifyGate already settled HMR):
 * just long enough for the page's own post-edit logging to land,
 * short enough that a quiet turn barely notices.
 */
export async function readTurnConsole(
  capture: ConsoleCapture,
  channels: ConsoleChannels = liveConsoleChannels,
  opts: { graceMs?: number, sleep?: (ms: number) => Promise<void> } = {},
): Promise<TurnConsoleRead> {
  const out: TurnConsoleRead = { entries: [], latest: {}, readable: false, reloaded: false }
  if (!anyChannelConnected(capture)) return out
  const graceMs = opts.graceMs ?? 0
  if (graceMs > 0) {
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    await sleep(graceMs)
  }
  for (const channel of CHANNELS) {
    const start = capture[channel]
    if (!start.connected) continue
    const probe = await channels.read(channel, start.seq, 1)
    if (probe.error) {
      out.latest[channel] = { seq: start.seq, instance: start.instance }
      continue
    }
    // Epoch guard (slice A): a reloaded page restarts its seq, so a
    // naive since-start read would suppress the new page's errors.
    const plan = consoleEpochPlan({ seq: start.seq, instance: start.instance }, probe.instance)
    const raw = await channels.read(channel, plan.sinceSeq, 200)
    if (raw.error) {
      out.latest[channel] = { seq: start.seq, instance: start.instance }
      continue
    }
    out.readable = true
    if (plan.reloaded) out.reloaded = true
    for (const e of raw.entries) if (e.seq > plan.sinceSeq) out.entries.push(e)
    out.latest[channel] = {
      seq: Math.max(raw.latestSeq || 0, plan.sinceSeq),
      instance: raw.instance ?? probe.instance,
    }
  }
  return out
}

/* ---------- done-payload shaping (pure) ---------- */

export const CONSOLE_DETAIL_CAP = 20
export const CONSOLE_TEXT_MAX = 300

export interface ConsoleDetailEntry { level: string, text: string, ts?: number, count?: number }

export interface TurnConsoleDetail {
  errors: ConsoleDetailEntry[]
  errorTotal: number
  warnings: ConsoleDetailEntry[]
  warningTotal: number
  sinceLastChat: ConsoleDetailEntry[]
  sinceLastChatTotal: number
  expectations: ExpectationResult[]
  notes: string[]
  /** This-turn entries attributed to the editor's own injected
   * clients (slice C). Carried in the payload for the summary/debug
   * record only — the footer never renders them: they are not the
   * app's errors, and a turn whose only output was editor noise
   * stays quiet. */
  editorCount: number
}

function clipEntry(e: ConsoleEntry & { count?: number }): ConsoleDetailEntry {
  const text = typeof e.text === 'string' ? e.text : String(e.text ?? '')
  const out: ConsoleDetailEntry = {
    level: e.level,
    text: text.length > CONSOLE_TEXT_MAX ? `${text.slice(0, CONSOLE_TEXT_MAX - 1)}…` : text,
  }
  if (typeof e.ts === 'number') out.ts = e.ts
  if (typeof e.count === 'number' && e.count > 1) out.count = e.count
  return out
}

/**
 * Shape the console part of a turn's verify summary. Errors and
 * warnings are this-turn entries only (since-last-chat entries ride
 * in their own group and never count as findings).
 *
 * Source attribution (slice C): only app entries count anywhere
 * here — editor-attributed entries are tallied as editorCount and
 * agent-probe entries are reported through the expectation results.
 * Each list is deduped on (level, text, src) BEFORE the cap, so
 * totals count distinct reportable entries and a repeat shows as
 * one entry with a count.
 *
 * Returns null when there is nothing to report — not even editor
 * noise — the caller then omits the field and the footer renders
 * nothing.
 */
export function shapeTurnConsoleDetail(args: {
  turnEntries: ConsoleEntry[]
  sinceEntries: ConsoleEntry[]
  expectations: ExpectationResult[]
  notes: string[]
}): TurnConsoleDetail | null {
  const editorCount = args.turnEntries.filter((e) => e.src === 'editor').length
  const appTurn = args.turnEntries.filter((e) => isAppEntry(e))
  const errors = dedupeConsoleEntries(appTurn.filter((e) => isErrorLevel(e.level) && !/^\s*$/.test(e.text || '')))
  const warnings = dedupeConsoleEntries(appTurn.filter((e) => e.level === 'warn' && !/^\s*$/.test(e.text || '')))
  const since = dedupeConsoleEntries(args.sinceEntries.filter((e) => isAppEntry(e)))
  const expectations = args.expectations.map((r) => r.matchedText && r.matchedText.length > CONSOLE_TEXT_MAX
    ? { ...r, matchedText: `${r.matchedText.slice(0, CONSOLE_TEXT_MAX - 1)}…` }
    : r)
  if (!errors.length && !warnings.length && !since.length && !expectations.length && !args.notes.length && editorCount === 0) {
    return null
  }
  return {
    errors: errors.slice(0, CONSOLE_DETAIL_CAP).map(clipEntry),
    errorTotal: errors.length,
    warnings: warnings.slice(0, CONSOLE_DETAIL_CAP).map(clipEntry),
    warningTotal: warnings.length,
    sinceLastChat: since.slice(0, CONSOLE_DETAIL_CAP).map(clipEntry),
    sinceLastChatTotal: since.length,
    expectations,
    notes: [...args.notes],
    editorCount,
  }
}
