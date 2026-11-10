/**
 * OpenCode chat translator (re-platform slice 1).
 *
 * Serves POST /api/chat/stream when agent settings select the
 * opencode engine, emitting the SAME ChatStreamEvent vocabulary
 * the Mastra path produces — the chat UI needed no changes. The
 * seam is the v2 server protocol: create-or-reuse a session for
 * the project root (directory addressing), POST the newest user
 * message as the prompt, and fold the /api/event bus stream into
 * UI events until the session's execution terminates.
 *
 * Turn boundaries in v2 are execution events, not stream close:
 * session.execution.succeeded / .failed / .interrupted (with
 * session.idle as a synonym end). Usage accumulates per step from
 * session.step.ended, whose TokenUsageInfo splits input into
 * uncached + cache.read + cache.write — mapped back to ALE's
 * TurnUsage shape, where cachedInput/cacheWriteInput are subsets
 * of input.
 *
 * Slice 6 re-attaches the verify gate + the console arc around
 * the turn, mirroring the Mastra stream's orchestration phase for
 * phase (chatStream.ts is the contract): turn-start cheap console
 * capture (both modes, consoleCheck on) with the since-last-chat
 * window read from the persisted watermarks; the Files gate
 * baseline reusing that capture; a console-expect scope in the
 * shared registry (slice 3) spanning the turn; post-turn the gate
 * (layout + console findings) on write turns, the epoch-guarded
 * turn read, expectation matching against that ONE read, the
 * full TurnConsoleDetail on the done event, watermark advance —
 * and, when the gate demands it, ONE fix-it follow-up sent as a
 * second prompt in the SAME session, its events folded into the
 * same client turn under a single done.
 *
 * Slice 7 puts ALE's own agents on the engine (opencode/agents.ts
 * defines them in the generated config): the translator selects
 * ale-files / ale-sketch per turn from the routed workflow —
 * creating the session with the agent, or switching the shared
 * session's agent when the workflow changed — and composes the
 * prompt with the SAME content the Mastra path assembles: the
 * route preamble (sketch / mixed / routed-to-files) and the
 * buildTurnContext parts (project brief, codebase map, triggered
 * skill bodies) ahead of the user's text. CONTENT DELTA, named:
 * on the Mastra path those ride as system-role messages (preamble
 * leading, context just before the last user message); the v2
 * prompt carries plain text, so they lead the prompt text in the
 * same relative order (preamble, context parts, user text) and
 * persist in the session history as part of the user turn.
 * Per-turn tool gating rides with the selection: before each
 * prompt the translator PATCHes the session's permissions with
 * the deny rules for this turn's agentTools-computed set and
 * records the same set in the host-side backstop registry
 * (opencode/toolPolicy.ts). The gate follow-up is gated as its
 * own Files turn, its set computed from the gate prompt exactly
 * as the Mastra follow-up computes its activeTools.
 *
 * NAMED DIFFERENCE from the Mastra path: Mastra's follow-up is a
 * separate stream run WITHOUT the memory option, so its synthetic
 * prompt/reply never persist into the user's thread. An in-session
 * OpenCode prompt necessarily persists in the session's history —
 * there is no non-persisting prompt in the v2 protocol. Accepted
 * for this path: the gate prompt is self-describing ("automatic
 * verification…"), and the session is the conversation of record.
 *
 * Slice 9 re-instruments chatDebug on this path: the same
 * ChatDebugTurn recorder the Mastra stream uses wraps the turn
 * (created with engine: 'opencode'), fed from the bus — every
 * client-bound event is recorded as it is sent, tool-call paths
 * are stashed from session.tool.called inputs (the record's
 * write claims resolve from the call args on this engine), the
 * gate decision/verification ride the done event exactly as on
 * the Mastra path, and the recorder finishes on every exit.
 * AI_LIVE_CHAT_DEBUG off = the recorder is a strict no-op, as
 * everywhere. Fields with no bus equivalent: none in the core
 * record — the bus offers tool names/outcomes, per-step usage,
 * and the translator computes the rest (mode, offered set, gate
 * state) exactly where the Mastra stream computes it. The one
 * shape delta is claim sources: write claims cite 'args' (the
 * tool call's input path), because bus tool results are content
 * parts, not the shaped result objects the Mastra chunks carry.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { currentAgentSettings } from '../agentSettings.js'
import { isWriteTool, type FilesTurnSignals } from '../agentTools.js'
import { createChatDebugTurn } from '../chatDebug.js'
import {
  abortSignalFromReq, beginChatSse, describeUpstreamError, summarizeArgs,
  type ChatSseResponse, type ChatStreamEvent, type ChatStreamReq, type TurnUsage,
  type VerifySummary,
} from '../chatStream.js'
import { verifyGateEnabled } from '../env.js'
import { getFsRoot } from '../launcher.js'
import { logServerError } from '../serverLog.js'
import { getSketchMode, parseSketchMode, setSketchMode, SKETCH_TURN_PREAMBLE, type SketchMode } from '../sketchSession.js'
import { buildTurnContext, latestUserText } from '../turnContext.js'
import {
  leftoverProbeNotes, matchExpectations, type ExpectationResult,
} from '../verify/consoleExpectations.js'
import { isAppEntry, tagProbeEntries } from '../verify/consoleSource.js'
import {
  captureConsoleCapture, readSinceLastChatEntries, readTurnConsole,
  shapeTurnConsoleDetail, type ConsoleCapture, type TurnConsoleRead,
} from '../verify/consoleTurn.js'
import {
  advanceConsoleWatermarks, getProjectConsoleMarks, markConsoleWatermarksStale,
} from '../verify/consoleWatermarks.js'
import {
  consoleErrorEntries, formatGatePrompt, gateNeedsFollowUp, PAGE_RELOADED_NOTE,
  shouldTriggerGate, type ConsoleEntry,
} from '../verify/gate.js'
import {
  captureBaseline, runVerifyGate, type GateBaseline, type GateResult,
} from '../verify/runGate.js'
import { FILES_ROUTED_PREAMBLE, routeChatTurn, SKETCH_MIXED_PREAMBLE } from '../workflowRoute.js'
import { agentIdForMode, registeredToolUniverse, turnAllowedTools, turnDenyRules } from './agents.js'
import { ensureOpencodeServer, type OpencodeHandle } from './supervisor.js'
import { clearTurnToolPolicy, setTurnToolPolicy } from './toolPolicy.js'
import {
  abandonExpectationScope, collectExpectationLiterals, openExpectationScope,
  type ExpectationScope,
} from './verifyTools.js'

/** The subset of a v2 bus event this translator reads. Events are
 * `{ id, created, type, location?, data }` on GET /api/event. */
export interface OpencodeBusEvent {
  type?: string
  data?: Record<string, unknown>
}

interface OpencodeTokens {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function clip(text: string, max = 300): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

/** One step's TokenUsageInfo -> TurnUsage. OpenCode reports input
 * EXCLUDING cache reads/writes (verified live: prompt_tokens 111
 * with 30 cached arrived as input 81 + cache.read 30); ALE's shape
 * counts cached tokens inside input, so they are added back. */
export function turnUsageFromTokens(tokens: OpencodeTokens | undefined): TurnUsage | null {
  if (!tokens) return null
  const cacheRead = num(tokens.cache?.read)
  const cacheWrite = num(tokens.cache?.write)
  const input = num(tokens.input) + cacheRead + cacheWrite
  const output = num(tokens.output)
  if (input === 0 && output === 0) return null
  const usage: TurnUsage = { input, output, total: input + output }
  if (tokens.cache?.read !== undefined) usage.cachedInput = cacheRead
  if (tokens.cache?.write !== undefined) usage.cacheWriteInput = cacheWrite
  if (tokens.reasoning !== undefined && num(tokens.reasoning) > 0) usage.reasoning = num(tokens.reasoning)
  return usage
}

export function sumUsage(a: TurnUsage | null, b: TurnUsage | null): TurnUsage | null {
  if (!a) return b
  if (!b) return a
  const out: TurnUsage = { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total }
  if (a.cachedInput !== undefined || b.cachedInput !== undefined) out.cachedInput = (a.cachedInput ?? 0) + (b.cachedInput ?? 0)
  if (a.cacheWriteInput !== undefined || b.cacheWriteInput !== undefined) out.cacheWriteInput = (a.cacheWriteInput ?? 0) + (b.cacheWriteInput ?? 0)
  if (a.reasoning !== undefined || b.reasoning !== undefined) out.reasoning = (a.reasoning ?? 0) + (b.reasoning ?? 0)
  return out
}

export type OpencodeTerminal = 'succeeded' | 'failed' | 'interrupted' | 'idle'

/**
 * OpenCode's native file-writing tools, as the v2 bus names them.
 * Write-turn detection mapping (the gate trigger + the
 * leftover-probe check): the Mastra path counts DISPATCHED
 * tool-call chunks and asks isWriteTool over ALE's WRITE_TOOLS.
 * The bus's session.tool.called is the same signal (a dispatched
 * call), and ported ALE tools keep their ALE names, so isWriteTool
 * applies to them unchanged; the natives below have no ALE name
 * and are the addition. bash/execute is deliberately NOT a write
 * signal — the Mastra path never counted shell calls either.
 */
export const OPENCODE_NATIVE_WRITE_TOOLS: ReadonlySet<string> = new Set(['edit', 'write', 'apply_patch'])

/** shouldTriggerGate widened with the native write tools above —
 * the opencode path's gate trigger, mirroring the Mastra path's
 * definition (Files mode + any dispatched write-tool call). */
export function opencodeGateTriggered(mode: SketchMode, toolTrace: string[]): boolean {
  return shouldTriggerGate(mode, toolTrace)
    || (mode === 'files' && toolTrace.some((n) => OPENCODE_NATIVE_WRITE_TOOLS.has(n)))
}

export interface OpencodeEventFolder {
  push: (ev: OpencodeBusEvent) => ChatStreamEvent[]
  readonly usage: TurnUsage | null
  readonly terminal: OpencodeTerminal | null
  readonly failure: string | null
  /** Every dispatched tool name this turn, in call order — the
   * counterpart of the Mastra path's toolTrace (dispatched
   * tool-call chunks, counted the same way). */
  readonly toolTrace: string[]
  /** File paths from file-writing tool calls (ALE write tools and
   * the native edit/write carry `path` in their call input;
   * apply_patch's input is patch text, so patch writes contribute
   * no paths — the leftover-probe check simply has nothing to
   * scan for them). */
  readonly writtenPaths: string[]
}

/** Fold one session's v2 bus events into ChatStreamEvents. Pure —
 * the recorded-stream tests drive this directly. */
export function createOpencodeEventFolder(sessionID: string): OpencodeEventFolder {
  const toolNames = new Map<string, string>()
  const calledTools = new Set<string>()
  const toolTrace: string[] = []
  const writtenPathSet = new Set<string>()
  let usage: TurnUsage | null = null
  let terminal: OpencodeTerminal | null = null
  let failure: string | null = null

  function toolResult(id: string, ok: boolean, detail: string): ChatStreamEvent {
    return { type: 'tool-result', id, name: toolNames.get(id) ?? 'tool', ok, detail }
  }

  return {
    get usage() { return usage },
    get terminal() { return terminal },
    get failure() { return failure },
    get toolTrace() { return toolTrace },
    get writtenPaths() { return [...writtenPathSet] },
    push(ev) {
      const data = ev.data ?? {}
      if (data.sessionID !== sessionID) return []
      const out: ChatStreamEvent[] = []
      switch (ev.type) {
        case 'session.text.delta': {
          const text = str(data.delta)
          if (text) out.push({ type: 'text-delta', text })
          break
        }
        case 'session.reasoning.delta': {
          const text = str(data.delta)
          if (text) out.push({ type: 'reasoning-delta', text })
          break
        }
        case 'session.tool.input.started': {
          const id = str(data.id)
          if (id) toolNames.set(id, str(data.name) || 'tool')
          break
        }
        case 'session.tool.called': {
          const id = str(data.id)
          if (!id) break
          calledTools.add(id)
          const name = toolNames.get(id) ?? str(data.name) ?? 'tool'
          toolTrace.push(name)
          if (isWriteTool(name) || OPENCODE_NATIVE_WRITE_TOOLS.has(name)) {
            const input = (data.input ?? {}) as Record<string, unknown>
            if (typeof input.path === 'string' && input.path) writtenPathSet.add(input.path)
          }
          out.push({ type: 'tool-call', id, name, detail: summarizeArgs(name, data.input) })
          break
        }
        case 'session.tool.success': {
          const id = str(data.id)
          if (!id) break
          const content = Array.isArray(data.content) ? data.content : []
          const texts = content.map((c) => {
            const part = (c ?? {}) as Record<string, unknown>
            if (part.type === 'text') return str(part.text)
            if (part.type === 'file') return `[file: ${str(part.uri)}]`
            return ''
          }).filter(Boolean)
          out.push(toolResult(id, true, clip(texts.join('\n') || 'done')))
          break
        }
        case 'session.tool.failed': {
          const id = str(data.id)
          if (!id) break
          const err = (data.error ?? {}) as Record<string, unknown>
          out.push(toolResult(id, false, clip(str(err.message) || 'tool failed')))
          break
        }
        case 'session.step.ended': {
          usage = sumUsage(usage, turnUsageFromTokens(data.tokens as OpencodeTokens | undefined))
          break
        }
        case 'session.execution.succeeded':
          terminal = 'succeeded'
          break
        case 'session.execution.interrupted':
          terminal = 'interrupted'
          break
        case 'session.execution.failed': {
          terminal = 'failed'
          const err = (data.error ?? {}) as Record<string, unknown>
          failure = str(err.message) || str(data.message) || 'the OpenCode session failed'
          break
        }
        case 'session.idle':
          if (!terminal) terminal = 'idle'
          break
        default:
          break
      }
      return out
    },
  }
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

function authHeaders(handle: OpencodeHandle): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`opencode:${handle.password}`).toString('base64')}`,
    'Content-Type': 'application/json',
  }
}

async function createSession(handle: OpencodeHandle, agent: string): Promise<string> {
  const r = await fetch(`${handle.baseUrl}/api/session`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      location: { directory: handle.projectRoot },
      model: { id: handle.modelID, providerID: handle.providerID },
      agent,
    }),
  })
  if (!r.ok) throw new Error(`OpenCode session create failed: HTTP ${r.status} ${await r.text().catch(() => '')}`.trim())
  const body = (await r.json()) as { data?: { id?: string } }
  const id = body.data?.id
  if (!id) throw new Error('OpenCode session create returned no session id')
  return id
}

/** Sessions per project root, in memory: the v2 server keeps the
 * conversation; the UI's resent history is not re-uploaded. The
 * entry also tracks which ALE agent the session currently runs —
 * a workflow change switches the agent on the shared session
 * (POST /api/session/{id}/agent) rather than forking the
 * conversation.
 *
 * The entry ALSO records the provider/model the session was
 * created with (slice 8): a session's model is fixed at creation,
 * and the server-side session store persists across sidecar
 * respawns — so after a connection switch the cached session
 * still exists but names a provider the new server's config no
 * longer has, and its turns fail with "Model unavailable".
 * prepareSession compares the entry's model against the current
 * handle's and starts a fresh session when they differ. A respawn
 * that keeps the same connection (a toggle flip, an MCP edit)
 * keeps the same model, so those sessions — and the conversation
 * — survive it. */
const sessionsByRoot = new Map<string, { id: string; agent: string; providerID: string; modelID: string }>()

/**
 * Forget the shared OpenCode session for one project root (the chat
 * Clear button's server half on this engine): the entry is dropped,
 * so the next turn creates a fresh session and the cleared history
 * is never recalled. The orphaned server-side session is simply
 * never reused. True when a cached session was dropped.
 */
export function clearOpencodeSession(root: string = getFsRoot()): boolean {
  return sessionsByRoot.delete(root)
}

/** One prompt's gating: the ALE agent to run it under and the ALE
 * tools this turn may call (agentTools-computed — see agents.ts).
 * Applied per prompt by prepareSession below. */
export interface TurnGate {
  agent: string
  mode: SketchMode
  allowed: string[]
}

function staleSessionError(): Error & { staleSession: true } {
  return Object.assign(new Error('OpenCode session no longer exists'), { staleSession: true as const })
}

/** Parse an SSE response body into bus events. */
async function* sseEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<OpencodeBusEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (signal.aborted) return
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n\n')
      while (cut >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
        if (dataLine) {
          try { yield JSON.parse(dataLine.slice(5)) as OpencodeBusEvent } catch { /* keepalive/comment block */ }
        }
        cut = buffer.indexOf('\n\n')
      }
    }
  } finally {
    try { reader.cancel() } catch { /* closed */ }
  }
}

const TURN_TIMEOUT_MS = 15 * 60_000

export async function pipeOpencodeChatStream(
  messages: unknown,
  res: ChatSseResponse,
  req?: ChatStreamReq,
  workflow?: unknown,
): Promise<void> {
  // Chat debug/reporting mode (AI_LIVE_CHAT_DEBUG=1): the same
  // recorder the Mastra stream uses, stamped with this engine —
  // a strict no-op unless the flag is on (see chatDebug.ts).
  const dbg = createChatDebugTurn({ engine: 'opencode', extraWriteTools: OPENCODE_NATIVE_WRITE_TOOLS })
  const { send: rawSend } = beginChatSse(res, req)
  // Every client-bound event also lands in the debug recorder.
  const send = (obj: unknown) => {
    dbg.recordEvent(obj as ChatStreamEvent)
    rawSend(obj)
  }
  const abortSignal = abortSignalFromReq(req)
  // Console-expect scope for this turn (slice 3, re-windowed in
  // slice 6): opened before the prompt is sent when console
  // checking is on, its literals collected after the main turn,
  // and the scope closed only after the gate follow-up has run —
  // abandoned on every other exit. The registry never leaks.
  let expScope: ExpectationScope | null = null
  try {
    // Turn mode, determined exactly as the Mastra stream
    // determines it (chatStream.ts): an explicit workflow wins,
    // then the router may switch a Sketch turn with files intent
    // to Files. The mode drives the gate (Files only) and is
    // shared session state, so both engines must maintain it the
    // same way.
    const parsed = parseSketchMode(workflow)
    if (parsed) setSketchMode(parsed)
    const routed = routeChatTurn(getSketchMode(), messages)
    if (routed.switched) setSketchMode(routed.mode)
    const mode = getSketchMode()
    dbg.noteMode(mode, routed.switched)
    if (routed.switched) send({ type: 'workflow', mode: routed.mode, reason: routed.reason })
    send({ type: 'status', text: 'starting…' })
    const userText = latestUserText(messages)
    if (!userText) {
      send({ type: 'error', error: 'No user message was provided for the OpenCode turn.' })
      res.end()
      dbg.finish({ error: 'No user message was provided for the OpenCode turn.' })
      return
    }
    // ---- Per-turn brief (slice 7): the same content assembly
    // the Mastra stream performs — the route preamble chosen by
    // the same conditions, then buildTurnContext's parts (project
    // brief, codebase map when the setting calls for it,
    // triggered skill bodies), then the user's text. The Mastra
    // path delivers these as system-role messages; here they lead
    // the prompt text (see the module header for the named
    // delta). The skills event fires exactly as on the Mastra
    // path when skill bodies joined the turn.
    const preamble = mode === 'sketch' && routed.intent === 'mixed'
      ? SKETCH_MIXED_PREAMBLE
      : mode === 'sketch'
        ? SKETCH_TURN_PREAMBLE
        : routed.switched
          ? FILES_ROUTED_PREAMBLE
          : null
    let skillsUsed: { name: string, via: string }[] = []
    const turnContext = await buildTurnContext(userText, {
      mode,
      onSkillsUsed: (used) => { skillsUsed = used },
    })
    if (skillsUsed.length) send({ type: 'skills', skills: skillsUsed })
    const promptText = [preamble, ...turnContext, userText]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join('\n\n')
    const handle = await ensureOpencodeServer(getFsRoot())

    // ---- Turn-start console capture + gate baseline (mirrors
    // chatStream.ts). The "Check console errors" preference is
    // read once, at turn start. On: a cheap console-only capture
    // (both modes — no layout snapshot, no check frames), the
    // since-last-chat window read while its page instance is
    // still the live one, and an open expectation scope. Off: no
    // capture, no reads — and the persisted between-chat
    // watermark is marked stale (never advanced), so the next
    // checked turn starts its window from its own start.
    const consoleCheckOn = currentAgentSettings().consoleCheck
    // The registered tool universe for THIS spawn's override
    // toggles (slice 8): the supervisor read the same settings
    // when it spawned the server (its fingerprint covers them),
    // so the plugin's registration and this universe agree. Deny
    // rules are computed over the registered set only.
    const settingsNow = currentAgentSettings()
    const toolUniverse = registeredToolUniverse({
      fs: settingsNow.aleFsTools, web: settingsNow.aleWebTools, skill: settingsNow.aleSkillTools,
    })
    const turnRoot = getFsRoot()
    let consoleCapture: ConsoleCapture | null = null
    let sinceEntries: ConsoleEntry[] = []
    if (consoleCheckOn) {
      try {
        consoleCapture = await captureConsoleCapture()
        sinceEntries = await readSinceLastChatEntries(getProjectConsoleMarks(turnRoot), consoleCapture)
      } catch { consoleCapture = null }
    } else {
      try { markConsoleWatermarksStale(turnRoot) } catch { /* best-effort */ }
    }
    // Pre-edit baseline on Files turns (the post-edit diff needs
    // it). Never breaks the turn: failure means the gate reports
    // "unverified". Console marks come from the cheap capture
    // above when it ran — the turn probes each channel once.
    let baseline: GateBaseline | null = null
    let baselineError: string | null = null
    if (mode === 'files' && verifyGateEnabled()) {
      try {
        baseline = await captureBaseline(consoleCapture ?? undefined)
      } catch (e: unknown) {
        baseline = null
        baselineError = e instanceof Error ? e.message : String(e)
      }
    }
    dbg.noteGateArmed(mode === 'files' && verifyGateEnabled(), { captured: Boolean(baseline), error: baselineError })
    if (consoleCheckOn) expScope = openExpectationScope()

    // ---- Agent selection + per-turn gating (slice 7). The
    // Files signals are read exactly as chatStream.ts reads them
    // (dynamic imports, each best-effort: a failed read leaves
    // that group text-triggered only).
    const readFilesSignals = async (text: string): Promise<FilesTurnSignals> => {
      let hasActivePlan = false
      let hasFeatureGraph = false
      let hasUserFlowGraph = false
      let searchAvailable = false
      try {
        const { getActivePlan } = await import('../plans/plans.js')
        hasActivePlan = Boolean(getActivePlan())
      } catch { /* plan tools stay text-triggered only */ }
      try {
        const { getFeatureGraph } = await import('../features/features.js')
        hasFeatureGraph = Boolean(getFeatureGraph())
      } catch { /* feature tools stay text-triggered only */ }
      try {
        const { getUserFlowGraph } = await import('../userflows/userflows.js')
        hasUserFlowGraph = Boolean(getUserFlowGraph())
      } catch { /* user flow tools stay text-triggered only */ }
      try {
        const { getSearchBackend } = await import('../searchSession.js')
        searchAvailable = getSearchBackend() !== 'off'
      } catch { /* research tools stay off */ }
      return { userText: text, hasActivePlan, hasFeatureGraph, hasUserFlowGraph, searchAvailable }
    }
    const mainSignals = await readFilesSignals(userText)
    const mainGate: TurnGate = {
      agent: agentIdForMode(mode),
      mode,
      allowed: turnAllowedTools(mode, mainSignals, consoleCheckOn),
    }
    // The debug record's offered set: this turn's allowed ALE
    // tools, with the same signals the Mastra stream records
    // (its Sketch branch records an empty signal set).
    if (mode === 'files') {
      dbg.noteTools(mainGate.allowed, {
        hasActivePlan: mainSignals.hasActivePlan,
        hasFeatureGraph: mainSignals.hasFeatureGraph,
        hasUserFlowGraph: mainSignals.hasUserFlowGraph,
        searchAvailable: mainSignals.searchAvailable,
      })
    } else {
      dbg.noteTools(mainGate.allowed, {})
    }

    let sessionID = ''
    /**
     * Bring the shared session to this prompt's gate: create it
     * under the gate's agent when absent, switch its agent when
     * the workflow changed, PATCH its permissions with the turn's
     * deny rules (the patch replaces the session list — verified
     * against 2.2.6), and record the same allowed set in the
     * host-side backstop registry. A 404 from the switch/patch is
     * the stale-session signal, retried once by the caller.
     */
    const prepareSession = async (gate: TurnGate): Promise<string> => {
      let entry = sessionsByRoot.get(handle.projectRoot)
      if (entry && (entry.providerID !== handle.providerID || entry.modelID !== handle.modelID)) {
        // The active connection changed under this session (see
        // sessionsByRoot): its model names a provider the current
        // server no longer serves. Drop it and create fresh below.
        sessionsByRoot.delete(handle.projectRoot)
        clearTurnToolPolicy(entry.id)
        entry = undefined
      }
      let sid = entry?.id ?? ''
      if (!sid) {
        sid = await createSession(handle, gate.agent)
        sessionsByRoot.set(handle.projectRoot, { id: sid, agent: gate.agent, providerID: handle.providerID, modelID: handle.modelID })
      } else if (entry && entry.agent !== gate.agent) {
        const r = await fetch(`${handle.baseUrl}/api/session/${encodeURIComponent(sid)}/agent`, {
          method: 'POST',
          headers: authHeaders(handle),
          body: JSON.stringify({ agent: gate.agent }),
        })
        if (r.status === 404) {
          sessionsByRoot.delete(handle.projectRoot)
          clearTurnToolPolicy(sid)
          throw staleSessionError()
        }
        if (!r.ok) throw new Error(`OpenCode agent switch failed: HTTP ${r.status} ${await r.text().catch(() => '')}`.trim())
        entry.agent = gate.agent
      }
      const patch = await fetch(`${handle.baseUrl}/api/session/${encodeURIComponent(sid)}`, {
        method: 'PATCH',
        headers: authHeaders(handle),
        body: JSON.stringify({ permissions: turnDenyRules(gate.allowed, toolUniverse) }),
      })
      if (patch.status === 404) {
        sessionsByRoot.delete(handle.projectRoot)
        clearTurnToolPolicy(sid)
        throw staleSessionError()
      }
      if (!patch.ok) throw new Error(`OpenCode session permissions update failed: HTTP ${patch.status} ${await patch.text().catch(() => '')}`.trim())
      sessionID = sid
      setTurnToolPolicy(sid, gate.allowed, gate.mode)
      return sid
    }

    const runTurn = async (sid: string, promptText: string): Promise<{ folder: OpencodeEventFolder; timedOut: boolean }> => {
      const folder = createOpencodeEventFolder(sid)
      const sseCtrl = new AbortController()
      const onAbort = () => sseCtrl.abort()
      abortSignal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => sseCtrl.abort(), TURN_TIMEOUT_MS)
      try {
        const sseRes = await fetch(`${handle.baseUrl}/api/event`, {
          headers: { Authorization: authHeaders(handle).Authorization, Accept: 'text/event-stream' },
          signal: sseCtrl.signal,
        })
        if (!sseRes.ok || !sseRes.body) throw new Error(`OpenCode event stream failed: HTTP ${sseRes.status}`)
        const promptRes = await fetch(`${handle.baseUrl}/api/session/${encodeURIComponent(sid)}/prompt`, {
          method: 'POST',
          headers: authHeaders(handle),
          body: JSON.stringify({ text: promptText }),
        })
        if (promptRes.status === 404) {
          // Stale session id (server restarted under us): drop it so
          // the caller retries once with a fresh session.
          sessionsByRoot.delete(handle.projectRoot)
          clearTurnToolPolicy(sid)
          throw staleSessionError()
        }
        if (!promptRes.ok) throw new Error(`OpenCode prompt failed: HTTP ${promptRes.status} ${await promptRes.text().catch(() => '')}`.trim())
        for await (const ev of sseEvents(sseRes.body, sseCtrl.signal)) {
          for (const out of folder.push(ev)) {
            // Stash the call's input for the record's write
            // claims (bus results are content parts, so claims
            // resolve from the call args — see the module header).
            if (out.type === 'tool-call') {
              dbg.noteToolChunk(out, { payload: { args: (ev.data ?? {}).input } })
            }
            send(out)
          }
          if (folder.terminal) break
        }
        return { folder, timedOut: !folder.terminal && !abortSignal.aborted }
      } finally {
        clearTimeout(timer)
        abortSignal.removeEventListener('abort', onAbort)
        sseCtrl.abort()
      }
    }

    const runWithStaleRetry = async (promptText: string, gate: TurnGate) => {
      try {
        return await runTurn(await prepareSession(gate), promptText)
      } catch (e) {
        if ((e as { staleSession?: boolean })?.staleSession) {
          return await runTurn(await prepareSession(gate), promptText)
        }
        throw e
      }
    }

    const { folder, timedOut } = await runWithStaleRetry(promptText, mainGate)
    if (abortSignal.aborted) {
      abandonExpectationScope(expScope)
      // Best-effort: tell the engine to stop the turn we abandoned.
      void fetch(`${handle.baseUrl}/api/session/${encodeURIComponent(sessionID)}/interrupt`, {
        method: 'POST', headers: authHeaders(handle), body: '{}',
      }).catch(() => { /* best-effort */ })
      try { send({ type: 'done' }) } catch { /* closed */ }
      res.end()
      dbg.finish({ aborted: true })
      return
    }
    if (folder.failure) {
      abandonExpectationScope(expScope)
      send({ type: 'error', error: folder.failure })
      res.end()
      dbg.finish({ error: folder.failure })
      return
    }
    if (timedOut) {
      abandonExpectationScope(expScope)
      send({ type: 'error', error: 'The OpenCode turn did not finish within 15 minutes and was abandoned.' })
      res.end()
      dbg.finish({ error: 'The OpenCode turn did not finish within 15 minutes and was abandoned.' })
      return
    }

    // ---- Post-turn: gate, console read, expectations, follow-up.
    // Mirrors chatStream.ts's sequence and VerifySummary shapes.
    const toolTrace = folder.toolTrace
    const writtenPaths = new Set(folder.writtenPaths)
    const gateTriggered = opencodeGateTriggered(mode, toolTrace)
    dbg.noteGateDecision(gateTriggered, [...toolTrace])
    let verification: VerifySummary = { ran: false }
    let totalUsage: TurnUsage | null = folder.usage
    // Console expectations declared during the main turn (the
    // registry's collect is a snapshot — the scope stays open
    // through the follow-up, as on the Mastra path).
    const expectationsDeclared = collectExpectationLiterals(expScope)
    // The gate itself (layout + its own console findings) runs
    // first when triggered: its settle doubles as the console
    // read's settle.
    let gate: GateResult | null = null
    if (
      mode === 'files' &&
      verifyGateEnabled() &&
      baseline &&
      gateTriggered &&
      !abortSignal.aborted
    ) {
      send({ type: 'status', text: consoleCheckOn ? 'verifying layout + console…' : 'verifying layout…' })
      try {
        gate = await runVerifyGate(baseline)
      } catch (e: unknown) {
        gate = { ran: true, layout: [], expected: [], console: [], unverified: [e instanceof Error ? e.message : String(e)] }
      }
    }
    // Every-turn console read: all levels, both channels,
    // epoch-guarded. Gate turns already settled inside
    // runVerifyGate; other turns take a short grace so post-edit
    // logging can land. No channel connected at turn start → the
    // read is a no-op.
    let turnRead: TurnConsoleRead | null = null
    if (consoleCheckOn && consoleCapture) {
      try {
        turnRead = await readTurnConsole(consoleCapture, undefined, { graceMs: gate ? 0 : 450 })
      } catch { turnRead = null }
    }
    let expectationResults: ExpectationResult[] = []
    let probeNotes: string[] = []
    if (expectationsDeclared.length) {
      expectationResults = matchExpectations(expectationsDeclared, turnRead?.entries ?? [])
      // Leftover probes: a declared literal still sitting in a
      // file this turn wrote (the planted log was never removed).
      // A summary note, never a follow-up trigger.
      if (gateTriggered && writtenPaths.size) {
        try {
          const files: { path: string, content: string }[] = []
          for (const p of writtenPaths) {
            try {
              const abs = path.isAbsolute(p) ? p : path.join(turnRoot, p)
              const content = await fsp.readFile(abs, 'utf8')
              files.push({ path: path.relative(turnRoot, abs) || p, content: content.slice(0, 512_000) })
            } catch { /* file gone or unreadable — nothing to find */ }
          }
          probeNotes = leftoverProbeNotes(expectationsDeclared, files)
        } catch { probeNotes = [] }
      }
    }
    const missingExpectations = expectationResults.filter((r) => !r.matched)
    if (gate) {
      // Source attribution: downstream of here, the gate's console
      // list feeds the follow-up decision, the follow-up prompt
      // and the summary count — all APP entries only. Entries
      // matching this turn's declared expectation literals are
      // tagged agent-probe now that the literals are known, and
      // filtered out with any other non-app entry: a probe the
      // agent planted is reported as an expectation result, never
      // chased as an app error.
      if (gate.console.length) {
        gate = { ...gate, console: tagProbeEntries(gate.console, expectationsDeclared).filter(isAppEntry) }
      }
      // The follow-up runs only for fixable findings (new layout,
      // console errors at error/pageerror level, missing
      // expectations) — warnings are reported, never chased, and
      // an unverified-only result skips it. With console checking
      // off, the gate's console findings neither trigger nor
      // reach the summary (layout verification is unaffected).
      const needsFollowUp = gateNeedsFollowUp(
        consoleCheckOn ? gate : { ...gate, console: [] },
        consoleCheckOn && turnRead?.readable ? missingExpectations.length : 0,
      )
      const prompt = needsFollowUp
        ? formatGatePrompt({
          layout: gate.layout,
          console: consoleCheckOn ? consoleErrorEntries(gate.console) : [],
          unverified: gate.unverified,
          expected: gate.expected,
          ...(consoleCheckOn && missingExpectations.length
            ? { missingExpectations: missingExpectations.map((r) => r.text) }
            : {}),
        })
        : null
      if (!prompt && gate.unverified.length) dbg.noteGateFollowUpSkipped('unverified-only')
      if (prompt && !abortSignal.aborted) {
        // The follow-up is a SECOND PROMPT IN THE SAME SESSION:
        // its events fold into this client turn and its usage
        // joins the turn's, under the single done below carrying
        // the (first) gate's summary. PERSISTENCE DIFFERENCE,
        // named: Mastra's follow-up stream runs without the
        // memory option so it never persists; an in-session
        // prompt here DOES persist in the OpenCode session —
        // accepted (see the module header). One follow-up max.
        // A follow-up that itself fails or times out does not
        // fail the turn: the findings stand in the summary.
        try {
          // The follow-up is gated as its own Files turn: the
          // Mastra follow-up streams with activeTools computed
          // from the gate prompt's text plus the same state
          // signals — mirrored here as the follow-up prompt's own
          // gate (agent switch + permission patch + backstop
          // policy all re-applied for its narrower set).
          const followGate: TurnGate = {
            agent: agentIdForMode('files'),
            mode: 'files',
            allowed: turnAllowedTools('files', await readFilesSignals(prompt), consoleCheckOn),
          }
          const follow = await runWithStaleRetry(prompt, followGate)
          totalUsage = sumUsage(totalUsage, follow.folder.usage)
          if (follow.folder.failure) console.error('[opencode] verify follow-up failed:', follow.folder.failure)
        } catch (e) {
          console.error('[opencode] verify follow-up errored:', e)
        }
        verification = {
          ran: true,
          newLayout: gate.layout.length,
          ...(consoleCheckOn ? { newConsole: gate.console.length } : {}),
          unverified: gate.unverified,
          followUp: true,
        }
      } else {
        verification = {
          ran: true,
          clean: !gate.layout.length && !gate.unverified.length && (!consoleCheckOn || !gate.console.length),
          newLayout: gate.layout.length,
          ...(consoleCheckOn ? { newConsole: gate.console.length } : {}),
          unverified: gate.unverified,
          followUp: false,
        }
      }
      if (gate.layout.length || gate.console.length || gate.unverified.length) {
        logServerError({
          kind: 'verify-gate',
          route: 'POST /api/chat/stream',
          model: `${handle.providerID}/${handle.modelID}`,
          message: `gate findings: ${gate.layout.length} layout, ${gate.console.length} console, ${gate.unverified.length} unverified`,
          detail: gate.unverified.join(' | ') || undefined,
        })
      }
    } else if (mode === 'files' && !verifyGateEnabled()) {
      verification = { ran: false, skipped: 'AI_LIVE_VERIFY=0' }
    } else if (mode === 'files' && baselineError && gateTriggered) {
      // A baseline-capture failure reads as a skipped gate with a
      // reason, not as a silent "nothing to verify".
      verification = { ran: false, skipped: `baseline capture failed: ${baselineError}` }
    }
    // Attach the every-turn console detail and advance the
    // persisted between-chat watermark to the positions this
    // turn's read observed. Nothing attaches when there is
    // nothing to report; the watermark advances regardless.
    if (consoleCheckOn && consoleCapture) {
      try {
        const detail = shapeTurnConsoleDetail({
          turnEntries: tagProbeEntries(turnRead?.entries ?? [], expectationsDeclared),
          sinceEntries: tagProbeEntries(sinceEntries, expectationsDeclared),
          expectations: expectationResults,
          notes: [
            ...probeNotes,
            ...(turnRead?.reloaded && !gate && turnRead.entries.length ? [PAGE_RELOADED_NOTE] : []),
          ],
        })
        if (detail) verification = { ...verification, console: detail }
        advanceConsoleWatermarks(turnRoot, turnRead?.latest ?? {})
      } catch { /* console surfacing never breaks the turn */ }
    }
    abandonExpectationScope(expScope)
    send({
      type: 'done', usage: totalUsage, model: `${handle.providerID}/${handle.modelID}`,
      verification,
    })
    res.end()
    dbg.finish({})
  } catch (e) {
    abandonExpectationScope(expScope)
    if (abortSignal.aborted) {
      try { send({ type: 'done' }) } catch { /* closed */ }
      try { res.end() } catch { /* closed */ }
      dbg.finish({ aborted: true })
      return
    }
    console.error('[opencode] chat turn failed:', e)
    try { send({ type: 'error', error: describeUpstreamError(e) }) } catch { /* closed */ }
    try { res.end() } catch { /* closed */ }
    dbg.finish({ error: e instanceof Error ? e.message : String(e) })
  }
}
