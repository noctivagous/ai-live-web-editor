/**
 * Muse Code translator (Muse Code design §6, slice 4): folds
 * one turn's SDK session items into ALE's ChatStreamEvent union —
 * the same vocabulary the Mastra and OpenCode paths emit, so
 * Deck / Panel / Stationary / TurnConsole needed no changes.
 *
 * The fold consumes the turn's items() stream: the SDK yields
 * each item once per revision change with its cumulative fields,
 * so text arrives by diffing consecutive revisions of an
 * agentMessage item (never by replaying an event log). Tool
 * calls are ordinary items here — built-in and MCP tools alike
 * render as the same tool-call / tool-result pair as on every
 * other engine; nothing about an MCP tool is special-cased.
 *
 * The terminal is the turn's completed outcome, classified —
 * never trusted as success: a failed turn's error is examined,
 * and a quota-class failure (§14: the 402-class) is reported as
 * a billing state, not as an agent error.
 */
import { summarizeArgs, type ChatStreamEvent, type TurnUsage } from '../chatStream.js'

/** The subset of an SDK item this translator reads (the wire
 * Item's per-kind fields, all optional). Structural on purpose:
 * the fold is pure and its tests drive fixture items. */
export interface MusecodeItemLike {
  itemId: string
  kind: string
  status: string
  text?: string
  messagePhase?: string
  tool?: string
  /** toolCall: model-authored argument JSON, verbatim. */
  args?: string
  /** toolCall: bounded result text. */
  visibleOutput?: string
  failureKind?: string
  failureReason?: string
  fallbackText?: string
}

/** The subset of the SDK's TokenUsage this translator reads. */
export interface MusecodeTokenUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** The subset of a turn error this translator reads. */
export interface MusecodeTurnErrorLike {
  kind?: string
  message?: string
  quota?: { limitKind: string; resetsAtMs: number }
}

/** The subset of the SDK's TurnOutcome this translator reads. */
export type MusecodeOutcomeLike =
  | {
      kind: 'completed'
      params: {
        terminal?: string
        reason?: string
        error?: MusecodeTurnErrorLike
        usage?: MusecodeTokenUsage
      }
    }
  | { kind: 'unqueued' }
  | { kind: 'terminalUnknown' }

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function clip(text: string, max = 300): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

/** One turn's TokenUsage → ALE's TurnUsage. Present-only
 * reporting, as on the other engines: a cache figure appears
 * only when the provider reported one. */
export function musecodeUsageFromTokens(tokens: MusecodeTokenUsage | undefined): TurnUsage | null {
  if (!tokens) return null
  const input = num(tokens.inputTokens)
  const output = num(tokens.outputTokens)
  if (input === 0 && output === 0) return null
  const usage: TurnUsage = { input, output, total: input + output }
  if (tokens.cacheReadTokens !== undefined) usage.cachedInput = num(tokens.cacheReadTokens)
  else if (tokens.cachedTokens !== undefined && num(tokens.cachedTokens) > 0) usage.cachedInput = num(tokens.cachedTokens)
  if (tokens.cacheWriteTokens !== undefined) usage.cacheWriteInput = num(tokens.cacheWriteTokens)
  if (tokens.reasoningTokens !== undefined && num(tokens.reasoningTokens) > 0) usage.reasoning = num(tokens.reasoningTokens)
  return usage
}

export interface MusecodeFailure {
  message: string
  /** True when the failure is a payment/quota state (§14), not
   * an agent error: the words shown differ, and the record
   * carries the distinction. */
  billing: boolean
  /** When the provider said the quota resets, when it said. */
  quotaResetsAtMs?: number
}

/** Classify a failed turn's error. The typed quota detail is
 * the branch signal (the SDK says: branch on presence, never on
 * message text); the kind vocabulary is the backstop. */
export function classifyMusecodeTurnError(error: MusecodeTurnErrorLike | undefined, reason?: string): MusecodeFailure {
  const message = error?.message || reason || 'the Muse Code session failed'
  if (error?.quota) {
    return { message, billing: true, quotaResetsAtMs: error.quota.resetsAtMs }
  }
  const kind = (error?.kind ?? '').toLowerCase()
  if (kind.includes('quota') || kind.includes('billing') || kind.includes('payment')) {
    return { message, billing: true }
  }
  return { message, billing: false }
}

export type MusecodeTerminal = 'succeeded' | 'failed' | 'interrupted'

export interface MusecodeEventFolder {
  pushItem: (item: MusecodeItemLike) => ChatStreamEvent[]
  pushOutcome: (outcome: MusecodeOutcomeLike) => void
  readonly usage: TurnUsage | null
  readonly terminal: MusecodeTerminal | null
  readonly failure: MusecodeFailure | null
  /** Every dispatched tool name this turn, in call order. */
  readonly toolTrace: string[]
}

const TERMINAL_ITEM_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled', 'rejected', 'timedOut'])

/** Fold one turn's items into ChatStreamEvents. Pure — the
 * recorded-fixture tests drive this directly. */
export function createMusecodeEventFolder(): MusecodeEventFolder {
  const toolTrace: string[] = []
  const textSeen = new Map<string, number>()
  const outputSeen = new Map<string, number>()
  const toolStarted = new Set<string>()
  const toolFinished = new Set<string>()
  let usage: TurnUsage | null = null
  let terminal: MusecodeTerminal | null = null
  let failure: MusecodeFailure | null = null

  function textDelta(item: MusecodeItemLike, field: 'text' | 'visibleOutput', make: (text: string) => ChatStreamEvent): ChatStreamEvent[] {
    const seen = field === 'text' ? textSeen : outputSeen
    const full = item[field] ?? ''
    const prev = seen.get(item.itemId) ?? 0
    if (full.length <= prev) {
      if (full.length < prev) seen.set(item.itemId, full.length)
      return []
    }
    seen.set(item.itemId, full.length)
    const fresh = full.slice(prev)
    return fresh ? [make(fresh)] : []
  }

  function pushItem(item: MusecodeItemLike): ChatStreamEvent[] {
    const out: ChatStreamEvent[] = []
    switch (item.kind) {
      case 'agentMessage': {
        out.push(...textDelta(item, 'text', (text) => ({ type: 'text-delta', text })))
        break
      }
      case 'reasoning': {
        out.push(...textDelta(item, 'text', (text) => ({ type: 'reasoning-delta', text })))
        break
      }
      case 'toolCall': {
        const id = item.itemId
        const name = item.tool || 'tool'
        if (!toolStarted.has(id)) {
          toolStarted.add(id)
          toolTrace.push(name)
          let parsed: unknown = null
          if (item.args) { try { parsed = JSON.parse(item.args) } catch { /* almost-JSON stays a bare name */ } }
          out.push({ type: 'tool-call', id, name, detail: summarizeArgs(name, parsed) })
        } else if (!toolFinished.has(id) && !TERMINAL_ITEM_STATUSES.has(item.status)) {
          // Live output growth streams as tool-delta; output that
          // only appears WITH the terminal revision is not
          // streamed — the tool-result's detail carries it, once.
          out.push(...textDelta(item, 'visibleOutput', (text) => ({ type: 'tool-delta', id, name, text })))
        }
        if (TERMINAL_ITEM_STATUSES.has(item.status) && !toolFinished.has(id)) {
          toolFinished.add(id)
          const ok = item.status === 'completed'
          const detail = clip(item.visibleOutput || item.failureReason || item.fallbackText || (ok ? 'done' : item.status))
          out.push({ type: 'tool-result', id, name, ok, detail })
        }
        break
      }
      default:
        // userMessage, subagent, workflow, hookRun, systemNotice,
        // and kinds this build doesn't know: no chat event. The
        // protocol says unknown kinds render generically in a
        // transcript view; ALE's chat stream has no generic row,
        // so they are carried by the session record instead.
        break
    }
    return out
  }

  function pushOutcome(outcome: MusecodeOutcomeLike): void {
    if (outcome.kind === 'unqueued') {
      terminal = 'interrupted'
      return
    }
    if (outcome.kind === 'terminalUnknown') {
      terminal = 'failed'
      failure = { message: 'Muse Code stopped before the turn finished, so the turn’s outcome isn’t known.', billing: false }
      return
    }
    const params = outcome.params
    if (params.usage) usage = musecodeUsageFromTokens(params.usage)
    if (params.terminal === 'completed') {
      terminal = 'succeeded'
    } else if (params.terminal === 'cancelled') {
      terminal = 'interrupted'
    } else {
      terminal = 'failed'
      failure = classifyMusecodeTurnError(params.error, params.reason)
    }
  }

  return {
    pushItem,
    pushOutcome,
    get usage() { return usage },
    get terminal() { return terminal },
    get failure() { return failure },
    get toolTrace() { return toolTrace },
  }
}
