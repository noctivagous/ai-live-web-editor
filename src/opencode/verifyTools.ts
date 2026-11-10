/**
 * Verify tools as plain host functions (re-platform slice 3).
 *
 * Wave 2: get-network-failures and resolve-source, served to the
 * OpenCode plugin through the same POST /api/page/tool dispatch as
 * the wave-1 page tools (the endpoint consults pageTools first,
 * then this module). Each function is the Mastra tool's execute
 * body (src/mastra/tools/verifyTools.ts, resolveSourceTool.ts)
 * with the wrapper removed — same host plumbing (liveTarget's
 * network read, the source-map resolver over a fresh project
 * index), so results match the Mastra path's exactly, including
 * the honest per-channel answers: the bridge reports NO request
 * failures (it only has timing-level data, and says so), the pool
 * returns request-level failures, pool-off is an error value.
 *
 * console-expect does NOT ride this dispatch — it is a write into
 * turn state, not a page/host read, so it has its own endpoint
 * (POST /api/console/expect, the get-console precedent). Its
 * declarations land in the shared expectation registry
 * (src/verify/consoleExpectations.ts — ported verbatim from the
 * console arc, where the Mastra path's console-expect tool writes
 * to the same module), and the scope lifecycle lives below: the
 * OpenCode translator (opencode/chat.ts) opens a scope when it
 * sends a prompt and collects at turn end, exactly as the Mastra
 * chat stream does on the console branch. Registry semantics are
 * the registry's own — a scope begun by any live turn makes this
 * turn's begin refuse (its declarations then belong to the live
 * scope, and this turn reports no expectations), never a fork.
 *
 * Turn window (slice 6): the scope is now ONLY the registry
 * lifecycle. The observation window comes from the translator's
 * every-turn console capture (verify/consoleTurn.ts — the console
 * arc's epoch-guarded machinery, ported with the gate): declared
 * literals are matched exactly once, against that turn read, by
 * the registry's matchExpectations in the translator — the same
 * orchestration the Mastra path runs on the console branch.
 * Slice 3's private seq-mark read is gone: one console read per
 * turn, no second read that could disagree with the epoch guard.
 * A turn with no readable console reports every declaration
 * missing — "couldn't observe" never confirms a match.
 */
import { getFsRoot } from '../launcher.js'
import { withDispatchDebugLog } from '../chatDebug.js'
import { liveNetworkFailures } from '../liveTarget.js'
import { indexProjectSources } from '../mastra/tools/resolveSourceTool.js'
import { resolveSelector } from '../sourceMap/resolveSource.js'
import {
  beginConsoleExpectations, collectConsoleExpectations, endConsoleExpectations,
} from '../verify/consoleExpectations.js'

type Input = Record<string, any>

async function getNetworkFailures(input: Input) {
  const { url, ...rest } = (input ?? {}) as Input
  return liveNetworkFailures(rest as Record<string, unknown>, url)
}

async function resolveSource(input: Input) {
  const { selector, stableId, textSnippet, classList, tagName, sourceLoc } = (input ?? {}) as Input
  const files = indexProjectSources(getFsRoot())
  return resolveSelector({ selector, stableId, textSnippet, classList, tagName, sourceLoc }, files)
}

/** The wave-2 dispatch tools by their (Mastra-identical) names. */
export const VERIFY_TOOL_HANDLERS: Record<string, (input: Input) => Promise<unknown>> = {
  'get-network-failures': getNetworkFailures,
  'resolve-source': resolveSource,
}

export const VERIFY_TOOL_NAMES = Object.keys(VERIFY_TOOL_HANDLERS)

/** Run one wave-2 tool by name; unknown names are an error value,
 * never a throw (the dispatch endpoint's contract). */
async function runVerifyToolImpl(name: string, input: Input): Promise<unknown> {
  const handler = VERIFY_TOOL_HANDLERS[name]
  if (!handler) {
    return { ok: false, error: `unknown verify tool "${name}". Available: ${VERIFY_TOOL_NAMES.join(', ')}` }
  }
  return handler(input ?? {})
}

/* ------------------------------------------------------------------ */
/* console-expect scope lifecycle (translator side)                    */
/* ------------------------------------------------------------------ */

export interface ExpectationScope {
  turnId: string
  closed: boolean
}

function mintTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Open the expectation scope for an OpenCode turn: mint the turn
 * id and begin the shared registry scope. Null when another
 * turn's scope is live — the registry refused, so this turn
 * tracks no expectations (its console-expect calls, if any,
 * declare into the live scope; that is the registry's defined
 * behaviour for concurrent turns on either engine).
 */
export function openExpectationScope(): ExpectationScope | null {
  const turnId = mintTurnId()
  if (!beginConsoleExpectations(turnId)) return null
  return { turnId, closed: false }
}

/**
 * Snapshot a turn's declared literals (the registry's collect is
 * non-destructive). The translator matches them against the
 * turn's console read and ends the scope after the verify-gate
 * follow-up has run — the same timing the Mastra stream uses, so
 * a console-expect call inside the follow-up declares too late
 * to be checked instead of failing the tool.
 */
export function collectExpectationLiterals(scope: ExpectationScope | null): string[] {
  if (!scope || scope.closed) return []
  return collectConsoleExpectations(scope.turnId)
}

/** Close a scope (any exit — success, abort, failure): the
 * registry must never leak a live scope into the next turn. */
export function abandonExpectationScope(scope: ExpectationScope | null): void {
  if (!scope || scope.closed) return
  scope.closed = true
  endConsoleExpectations(scope.turnId)
}

/** The exported dispatch: the impl above, plus its per-tool debug
 * record when chat debug is on (slice 9 — chatDebug.ts). */
export async function runVerifyTool(name: string, input: Input): Promise<unknown> {
  return withDispatchDebugLog(name, input, () => runVerifyToolImpl(name, input))
}
