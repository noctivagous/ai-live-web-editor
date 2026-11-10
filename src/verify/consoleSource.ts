/**
 * Console source attribution (slice C): every console entry carries
 * a `src` saying whose code produced it, so the editor never reports
 * its own noise as the app's errors.
 *
 * - 'app' — the project's own code. Also the meaning of a MISSING
 *   src: entries captured before slice C (saved turns, old bridge
 *   clients) are app entries.
 * - 'editor' — the editor's own injected clients (the plugin's
 *   page bridge / chat overlay, the annotate overlay). Classified at
 *   CAPTURE time from the script URL a console event came from
 *   (pool: msg.location()) or from an error's stack (bridge + pool)
 *   — see EDITOR_SCRIPT_MARKERS.
 * - 'agent-probe' — an entry whose text matches a literal the agent
 *   declared with console-expect for the current turn. The page
 *   cannot know declarations, so this tag is applied at READ time
 *   (server-side, when the turn's declared literals are known), in
 *   tagProbeEntries — never at capture.
 *
 * The bridge client (page-bridge.js) is plain JS served to real
 * pages and cannot import this module; it carries the same marker
 * list inline. Keep the two in step.
 */

export type ConsoleSrc = 'app' | 'editor' | 'agent-probe'

/** The structural minimum of a console entry for source logic. */
export interface SrcEntry {
  level: string
  text: string
  src?: ConsoleSrc
  ts?: number
}

/**
 * URL fragments that identify a script the editor injected into the
 * page: the plugin's clients, served under /@ai-live-editor/
 * (page-bridge.js, chat-overlay.js), and the annotate overlay's
 * served route /live-edit/overlay.js (the overlay is injected inline,
 * but its installer appends a sourceURL naming that route, so its
 * stack frames carry it).
 */
export const EDITOR_SCRIPT_MARKERS = ['/@ai-live-editor/', '/live-edit/overlay.js']

/** 'editor' when a single script URL belongs to an injected editor
 * script; undefined when it doesn't say (caller defaults to 'app'). */
export function srcFromUrl(url?: string | null): ConsoleSrc | undefined {
  if (!url) return undefined
  for (const marker of EDITOR_SCRIPT_MARKERS) {
    if (url.includes(marker)) return 'editor'
  }
  return undefined
}

/** 'editor' when any frame of an error stack runs through an
 * injected editor script; undefined otherwise. */
export function srcFromStack(stack?: string | null): ConsoleSrc | undefined {
  if (!stack) return undefined
  for (const marker of EDITOR_SCRIPT_MARKERS) {
    if (stack.includes(marker)) return 'editor'
  }
  return undefined
}

/**
 * Capture-time classification (pool console/pageerror handlers):
 * the event's source URL wins when it identifies an editor script;
 * the stack is the fallback (pageerror events carry no location).
 * Anything unidentified is the app's — the editor must prove an
 * entry is its own before it may hide it.
 */
export function classifyCaptureSrc(input: { url?: string | null, stack?: string | null }): ConsoleSrc {
  return srcFromUrl(input.url) ?? srcFromStack(input.stack) ?? 'app'
}

/** True when an entry counts as the app's own output: src 'app' or
 * absent (pre-slice-C entries). Editor and agent-probe entries are
 * reported through their own channels, never as app findings. */
export function isAppEntry(e: { src?: ConsoleSrc }): boolean {
  return e.src === undefined || e.src === 'app'
}

/**
 * Read-time agent-probe tagging: entries whose text contains one of
 * the turn's declared console-expect literals become 'agent-probe'.
 * An entry already classified 'editor' at capture keeps that tag —
 * the capture-time evidence (its stack) is stronger than a text
 * coincidence. Matching is the same literal-substring rule
 * matchExpectations uses, and tagging never alters the text, so
 * expectation matching is unaffected. Pure: returns the input array
 * with matched entries replaced by tagged copies.
 */
export function tagProbeEntries<T extends SrcEntry>(entries: T[], literals: string[]): T[] {
  const lits = literals.filter((l) => l.length > 0)
  if (!lits.length) return entries
  return entries.map((e) => {
    if (e.src === 'editor' || e.src === 'agent-probe') return e
    if (typeof e.text === 'string' && lits.some((lit) => e.text.includes(lit))) {
      return { ...e, src: 'agent-probe' as ConsoleSrc }
    }
    return e
  })
}

export type DedupedEntry<T> = T & { count: number }

/**
 * Collapse repeats within one read window: entries with identical
 * (level, text, src) become the first occurrence (its ts/seq kept)
 * with a `count` of how many times the line appeared. Caps the
 * caller applies belong AFTER this — seven copies of one warning
 * are one reportable entry with count 7, not seven entries.
 * Pure and order-preserving.
 */
export function dedupeConsoleEntries<T extends SrcEntry>(entries: T[]): DedupedEntry<T>[] {
  const byKey = new Map<string, DedupedEntry<T>>()
  const out: DedupedEntry<T>[] = []
  for (const e of entries) {
    const key = `${e.level}\n${e.src ?? 'app'}\n${e.text}`
    const existing = byKey.get(key)
    if (existing) {
      existing.count += 1
    } else {
      const copy: DedupedEntry<T> = { ...e, count: 1 }
      byKey.set(key, copy)
      out.push(copy)
    }
  }
  return out
}
