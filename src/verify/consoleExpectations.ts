/**
 * Console expectations (slice B): during a chat turn the agent can
 * declare literal strings it expects to appear in the page console
 * (tool: console-expect) — the pattern is plant a console.log with the
 * literal, declare it, and the host's post-turn read reports matched
 * vs missing. Absence is itself a finding: the code path may not have
 * run.
 *
 * Turn keying: Mastra's agent tool context carries a threadId (one
 * per project) but no per-turn run id, so declarations live in a
 * single-active-turn registry — the same session-singleton pattern
 * the repo uses for sketch mode (sketchSession.ts), which the chat
 * stream opens and closes around each turn. The limits are explicit:
 * - begin() refuses while another turn's scope is live (a scope
 *   abandoned by a crashed turn expires after SCOPE_TTL_MS), so a
 *   second concurrent turn's declarations can never land in the
 *   first turn's report — that turn simply reports no expectations.
 * - collect() is keyed by the turn id the chat stream minted, so a
 *   superseded scope yields nothing rather than someone else's list.
 */
import type { ConsoleEntry } from './gate.js'

type ExpectationScope = { turnId: string, literals: string[], startedAt: number }

const SCOPE_TTL_MS = 10 * 60_000

let active: ExpectationScope | null = null

/** Open the declaration scope for a turn. False when another turn's
 * scope is still live — expectations stay untracked for this turn
 * rather than leaking across turns. */
export function beginConsoleExpectations(turnId: string, now = Date.now()): boolean {
  if (active && active.turnId !== turnId && now - active.startedAt < SCOPE_TTL_MS) return false
  active = { turnId, literals: [], startedAt: now }
  return true
}

/** The console-expect tool's write path: append one literal to the
 * active turn's declarations. */
export function declareConsoleExpectation(text: unknown): { ok: true, declared: number } | { error: string } {
  const literal = typeof text === 'string' ? text.trim() : ''
  if (!literal) return { error: 'console-expect needs a non-empty literal string' }
  if (!active) return { error: 'no active chat turn to attach this expectation to — expectations are declared during a chat turn and checked when it ends' }
  if (!active.literals.includes(literal)) active.literals.push(literal)
  return { ok: true, declared: active.literals.length }
}

/** Snapshot a turn's declarations (non-destructive: the scope stays
 * open until endConsoleExpectations so the turn's follow-up stream
 * cannot fail the tool, it just declares too late to be checked). */
export function collectConsoleExpectations(turnId: string): string[] {
  if (!active || active.turnId !== turnId) return []
  return [...active.literals]
}

export function endConsoleExpectations(turnId: string): void {
  if (active && active.turnId === turnId) active = null
}

export function resetConsoleExpectationsForTests(): void {
  active = null
}

export interface ExpectationResult {
  text: string
  matched: boolean
  /** The console entry text that satisfied the expectation. */
  matchedText?: string
}

/**
 * Match declared literals against a turn's console entries: literal
 * substring on the entry text, any level counts. Pure.
 */
export function matchExpectations(literals: string[], entries: ConsoleEntry[]): ExpectationResult[] {
  return literals.map((text) => {
    const hit = entries.find((e) => typeof e.text === 'string' && e.text.includes(text))
    return hit ? { text, matched: true, matchedText: hit.text } : { text, matched: false }
  })
}

/**
 * Leftover-probe check (pure): a declared literal still present in a
 * file the turn wrote means the planted console.log was never
 * removed. A note for the summary, never a follow-up trigger.
 */
export function leftoverProbeNotes(literals: string[], files: { path: string, content: string }[]): string[] {
  const notes: string[] = []
  for (const file of files) {
    if (literals.some((lit) => lit && file.content.includes(lit))) notes.push(`probe left in ${file.path}`)
  }
  return notes
}
