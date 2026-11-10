/** Map Mastra fullStream chunks to compact SSE events for the chat UI. */
import type { ExpectationResult } from './verify/consoleExpectations.js'

export interface TurnUsage {
  input: number
  output: number
  total: number
  /** Input tokens served from the provider prompt cache (a subset of input). Present only when the provider reported it — a reported 0 is kept, absence means "not reported". */
  cachedInput?: number
  /** Input tokens written to the prompt cache this turn (a subset of input, Anthropic-shaped reports). */
  cacheWriteInput?: number
  /** Reasoning tokens (a subset of output — a breakdown, never added to it). */
  reasoning?: number
}

export type VerifySummary = {
  ran: boolean
  clean?: boolean
  newLayout?: number
  newConsole?: number
  unverified?: string[]
  followUp?: boolean
  skipped?: string
  /** Console detail in the console arc's shape (errors/warnings/
   * since-last-chat/expectations), produced by shapeTurnConsole
   * Detail. Since slice 6 the OpenCode path fills the full detail
   * exactly as the console arc's Mastra stream does; the groups a
   * turn does not fill stay empty rather than fabricated. The
   * rendering consumer is the console arc's TurnConsole, which
   * reads exactly this shape. */
  console?: TurnConsoleDetail
}

/** One entry in a TurnConsoleDetail list (text clipped host-side). */
export interface ConsoleDetailEntry {
  level: string
  text: string
  ts?: number
  /** Repeat count when identical entries were deduped into one. */
  count?: number
}

/** The console part of a turn's verify summary — field-for-field
 * the shape the console arc's shapeTurnConsoleDetail produces and
 * its footer model consumes (an expectations-only detail renders
 * exactly the "Expected in console" group there). */
export interface TurnConsoleDetail {
  errors: ConsoleDetailEntry[]
  errorTotal: number
  warnings: ConsoleDetailEntry[]
  warningTotal: number
  sinceLastChat: ConsoleDetailEntry[]
  sinceLastChatTotal: number
  expectations: ExpectationResult[]
  notes: string[]
  editorCount: number
}

export type ChatStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'workflow'; mode: 'files' | 'sketch'; reason?: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-delta'; id: string; name: string; text: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'text-delta'; text: string }
  | { type: 'skills'; skills: { name: string, via: string }[] }
  | { type: 'error'; error: string }
  | { type: 'done'; usage?: TurnUsage | null; model?: string; verification?: VerifySummary }

type LooseRecord = Record<string, unknown>

export type ChatSseResponse = {
  setHeader: (name: string, value: string) => void
  flushHeaders?: () => void
  write: (chunk: string) => unknown
  flush?: () => void
  end: () => void
  socket?: { setNoDelay?: (v: boolean) => void } | null
}

export type ChatStreamReq = {
  aborted?: boolean
  socket?: ChatSseResponse['socket'] | null
  on?: (event: string, listener: () => void) => void
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

/** Tie a Mastra abortSignal to the HTTP client disconnect. */
export function abortSignalFromReq(req?: ChatStreamReq): AbortSignal {
  const ctrl = new AbortController()
  if (!req) return ctrl.signal
  const abort = () => {
    if (!ctrl.signal.aborted) ctrl.abort()
  }
  if (req.aborted) abort()
  req.on?.('aborted', abort)
  req.on?.('close', abort)
  return ctrl.signal
}

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === 'object' ? value as LooseRecord : {}
}

function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function firstString(obj: LooseRecord, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

function toolNameOf(p: LooseRecord, fallback = 'tool'): string {
  return firstString(p, ['toolName', 'name']) || fallback
}

function toolIdOf(p: LooseRecord, name: string): string {
  return firstString(p, ['toolCallId', 'id']) || name
}

function argsOf(p: LooseRecord): unknown {
  if (p.args != null) return p.args
  if (p.input != null) return p.input
  if (p.arguments != null) return p.arguments
  return undefined
}

/** Best-effort path/selector from streaming (possibly incomplete) tool JSON. */
export function previewPartialArgs(name: string, raw: string): string {
  const n = name || 'tool'
  if (!raw) return `${n}…`
  try {
    return summarizeArgs(n, JSON.parse(raw))
  } catch { /* still streaming */ }
  const path = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const selector = raw.match(/"selector"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const url = raw.match(/"url"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const target = (path?.[1] || selector?.[1] || url?.[1] || '').replace(/\\"/g, '"')
  if (target) return `${n} ${target}`
  return `${n}…`
}

export function summarizeArgs(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return name
  const a = args as LooseRecord
  const parts = [name]
  if (typeof a.path === 'string') parts.push(a.path)
  else if (typeof a.selector === 'string') parts.push(a.selector)
  if (typeof a.url === 'string' && a.url) parts.push(a.url)
  if (typeof a.pattern === 'string') parts.push(clip(a.pattern, 40))
  if (typeof a.op === 'string') parts.push(a.op)
  if (typeof a.target === 'string' && a.target) parts.push(a.target)
  if (typeof a.position === 'string' && a.position) parts.push(a.position)
  if (typeof a.text === 'string') parts.push(clip(a.text, 40))
  if (typeof a.style === 'string') parts.push(clip(a.style, 40))
  if (typeof a.old_string === 'string') parts.push(`${a.old_string.length}→${typeof a.new_string === 'string' ? a.new_string.length : 0}`)
  if (typeof a.content === 'string') parts.push(`${a.content.length} chars`)
  else if (typeof a.html === 'string') parts.push(`${a.html.length} chars html`)
  else if (typeof a.code === 'string') parts.push(clip(a.code, 80))
  return parts.join(' ')
}

/** Applied line range from a tool result (`range` or `startLine`/`endLine`). */
function resultRange(r: LooseRecord): [number, number] | null {
  if (Array.isArray(r.range) && r.range.length === 2 && typeof r.range[0] === 'number' && typeof r.range[1] === 'number') {
    return [r.range[0], r.range[1]]
  }
  if (typeof r.startLine === 'number' && typeof r.endLine === 'number') return [r.startLine, r.endLine]
  return null
}

function matchBits(r: LooseRecord): string[] {
  const bits: string[] = []
  if (typeof r.matches === 'number') bits.push(`${r.matches} match${r.matches === 1 ? '' : 'es'}`)
  const range = resultRange(r)
  if (range) bits.push(`L${range[0]}–${range[1]}`)
  if (typeof r.fileLines === 'number') bits.push(`${r.fileLines} lines`)
  return bits
}

export function summarizeResult(result: unknown): string {
  if (result == null) return 'done'
  if (typeof result === 'string') return clip(result, 200)
  if (typeof result !== 'object') return clip(String(result), 200)
  const r = result as LooseRecord
  // Error results keep the message first, then the line facts — a miss
  // reads "old_string not found … · /path · 0 matches · 124 lines".
  if (r.error) return [clip(String(r.error), 200), ...(typeof r.path === 'string' ? [r.path] : []), ...matchBits(r)].join(' · ')
  const bits: string[] = []
  if (typeof r.path === 'string') bits.push(r.path)
  if (typeof r.bytes === 'number') bits.push(`${r.bytes}b`)
  if (typeof r.content === 'string') bits.push(`${r.content.length} chars`)
  if (Array.isArray(r.files)) bits.push(`${r.files.length} files`)
  if (Array.isArray(r.hits)) bits.push(`${r.hits.length} hits`)
  bits.push(...matchBits(r))
  if (r.rect && typeof r.rect === 'object') {
    const rect = r.rect as { width?: number; height?: number }
    if (rect.width != null && rect.height != null) bits.push(`${Math.round(rect.width)}×${Math.round(rect.height)}`)
  }
  if (typeof r.outerHTML === 'string') bits.push(clip(r.outerHTML, 120))
  else if (typeof r.html === 'string') bits.push(clip(r.html, 120))
  else if (typeof r.text === 'string') bits.push(clip(r.text, 120))
  if (r.ok === true && bits.length === 0) return 'ok'
  if (bits.length) return bits.join(' · ')
  try {
    return clip(JSON.stringify(result), 180)
  } catch {
    return 'done'
  }
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object') {
    const o = value as LooseRecord
    if (typeof o.message === 'string') return o.message
    if (typeof o.error === 'string') return o.error
  }
  return 'stream error'
}

function errorStatus(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const o = value as LooseRecord
  for (const key of ['statusCode', 'status']) {
    const n = o[key]
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return null
}

function errorHost(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const url = firstString(value as LooseRecord, ['url'])
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Provider response bodies (AI SDK `responseBody`, often a JSON string)
 * carry the real reason — e.g. xAI's 403 "used all available credits".
 * Prefer that detail over the bare HTTP status text ("Forbidden").
 */
function providerDetail(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const body = (value as LooseRecord).responseBody ?? (value as LooseRecord).data
  if (typeof body === 'string' && body) {
    try {
      const parsed = JSON.parse(body) as LooseRecord
      const inner = firstString(parsed, ['error', 'message', 'detail'])
      if (inner) return inner
    } catch { /* not JSON — fall through to raw text */ }
    return body.length <= 500 ? body : ''
  }
  if (body && typeof body === 'object') {
    return firstString(body as LooseRecord, ['error', 'message', 'detail'])
  }
  return ''
}

/**
 * Turn an upstream LLM failure into a chat-readable message: HTTP status,
 * provider host, the provider's own reason, and what to do about it.
 * Never returns a bare status text like "Forbidden".
 */
export function describeUpstreamError(err: unknown): string {
  if (typeof err === 'string') return err || 'stream error'
  if (!err || typeof err !== 'object') return 'stream error'
  const base = err instanceof Error ? err.message : errorMessage(err)
  const status = errorStatus(err)
  const host = errorHost(err)
  const detail = providerDetail(err)
  const where = [status != null ? `HTTP ${status}` : '', host ? `from ${host}` : '']
    .filter(Boolean).join(' ')
  const haystack = `${base} ${detail}`.toLowerCase()
  const quoted = detail ? ` — "${detail.length > 300 ? `${detail.slice(0, 299)}…` : detail}"` : ''

  if (/used all available credits|spending limit|out of credits|insufficient.*credit|exceed.*quota|quota exceeded|billing/i.test(haystack)) {
    return `AI provider refused the request${where ? ` (${where})` : ''}: the account is out of credits or hit its spending limit${quoted}. ` +
      `Fix: buy more credits or raise the monthly spending limit in the provider console${host ? ` (${host})` : ''}, then retry.`
  }
  if (status === 401 || /invalid.*api.?key|incorrect api key|unauthorized/i.test(haystack)) {
    return `AI provider rejected the API key${where ? ` (${where})` : ''}${quoted}. ` +
      `Fix: open Review setup, paste a valid key with its matching base URL and model, then Save.`
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(haystack)) {
    return `AI provider rate-limited the request${where ? ` (${where})` : ''}${quoted}. Fix: wait a minute and retry.`
  }
  if ((status != null && status >= 500) || /bad gateway|service unavailable|gateway timeout|internal error/i.test(haystack)) {
    return `AI provider errored${where ? ` (${where})` : ''}${quoted}. Fix: retry shortly — this is usually transient.`
  }
  if (status === 403) {
    return `AI provider refused the request${where ? ` (${where})` : ''}${quoted || `: ${base || 'forbidden'}`}. ` +
      `Fix: check the key's permissions and the account's spending limits, then retry.`
  }
  if (where || detail) {
    return `AI request failed${where ? ` (${where})` : ''}${quoted || `: ${base || 'unknown error'}`}`
  }
  return base || 'stream error'
}

function chunkText(p: LooseRecord): string {
  return firstString(p, ['text', 'textDelta', 'delta', 'argsTextDelta'])
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Normalise provider/Mastra usage payloads (camelCase AI SDK or
 * snake_case gateway shapes) to TurnUsage. Returns null when the
 * provider reported nothing — callers must render "not reported",
 * never 0.
 */
function nestedNum(rec: unknown, keys: string[]): number | null {
  if (!rec || typeof rec !== 'object') return null
  const r = rec as Record<string, unknown>
  for (const k of keys) {
    const v = num(r[k])
    if (v !== null) return v
  }
  return null
}

export function toTurnUsage(raw: unknown): TurnUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const input = num(r.inputTokens ?? r.input_tokens ?? r.promptTokens ?? r.prompt_tokens)
  const output = num(r.outputTokens ?? r.output_tokens ?? r.completionTokens ?? r.completion_tokens)
  const total = num(r.totalTokens ?? r.total_tokens)
  if (input === null && output === null && total === null) return null
  const i = input ?? 0
  const o = output ?? 0
  const usage: TurnUsage = { input: i, output: o, total: total ?? i + o }
  // Cache + reasoning splits: without them there is no way to tell a cheap
  // cached turn from an expensive one, and cost math has to price every
  // input token at the full rate. Field present (even 0) = reported.
  const cached = num(r.cachedInputTokens ?? r.cacheReadInputTokens ?? r.cache_read_input_tokens)
    ?? nestedNum(r.prompt_tokens_details ?? r.promptTokenDetails ?? r.input_tokens_details, ['cached_tokens', 'cachedTokens', 'cache_read_input_tokens'])
  if (cached !== null) usage.cachedInput = Math.min(cached, usage.input)
  const cacheWrite = num(r.cacheWriteInputTokens ?? r.cacheCreationInputTokens ?? r.cache_creation_input_tokens)
    ?? nestedNum(r.prompt_tokens_details ?? r.promptTokenDetails ?? r.input_tokens_details, ['cache_creation_input_tokens', 'cacheWriteTokens', 'cache_creation_tokens'])
  if (cacheWrite !== null) usage.cacheWriteInput = Math.min(cacheWrite, usage.input)
  const reasoning = num(r.reasoningTokens ?? r.reasoning_tokens)
    ?? nestedNum(r.completion_tokens_details ?? r.completionTokenDetails ?? r.outputTokenDetails, ['reasoning_tokens', 'reasoningTokens'])
  if (reasoning !== null) usage.reasoning = Math.min(reasoning, usage.output)
  return usage
}

/** Add two turn usages (a turn's verify-gate follow-up stream is a second bill). */
export function sumTurnUsage(a: TurnUsage | null, b: TurnUsage | null): TurnUsage | null {
  if (!a) return b
  if (!b) return a
  const out: TurnUsage = { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total }
  const add = (key: 'cachedInput' | 'cacheWriteInput' | 'reasoning') => {
    if (a[key] !== undefined || b[key] !== undefined) out[key] = (a[key] ?? 0) + (b[key] ?? 0)
  }
  add('cachedInput')
  add('cacheWriteInput')
  add('reasoning')
  return out
}

export interface StepCapState {
  stepStarts: number
  /** Last step-finish reason ('stop' | 'tool-calls' | …), null when unseen. */
  lastReason: string | null
  /** Whether the last finished step dispatched tool calls. */
  lastHadTools: boolean
}

export function emptyStepCapState(): StepCapState {
  return { stepStarts: 0, lastReason: null, lastHadTools: false }
}

/** Fold one fullStream chunk into the step-cap state (no UI effect). */
export function trackStepCap(state: StepCapState, chunk: unknown): StepCapState {
  if (!chunk || typeof chunk !== 'object') return state
  const c = chunk as { type?: string; payload?: unknown }
  if (c.type === 'step-start') return { ...state, stepStarts: state.stepStarts + 1 }
  if (c.type !== 'step-finish') return state
  const p = asRecord(c.payload ?? chunk)
  const stepResult = asRecord(p.stepResult)
  const reason = typeof stepResult.reason === 'string' ? stepResult.reason : null
  const output = asRecord(p.output)
  const hadTools = Array.isArray(output.toolCalls) && output.toolCalls.length > 0
  return { ...state, lastReason: reason, lastHadTools: hadTools }
}

/**
 * Did this turn stop because it ran out of steps rather than finishing?
 * A clean finish ('stop') is never flagged, even at the cap; an unseen
 * reason only flags when the last step dispatched tools.
 */
export function hitStepCap(state: StepCapState, maxSteps: number): boolean {
  if (!Number.isFinite(maxSteps) || maxSteps <= 0) return false
  if (state.stepStarts < maxSteps) return false
  if (state.lastReason === 'stop') return false
  if (state.lastReason === 'tool-calls' || state.lastReason === 'length') return true
  return state.lastHadTools
}

/** Tool-step budget for one streamed chat turn (mirrors maxSteps below). */
export const CHAT_MAX_STEPS = 12

/** Host-voiced note appended when a turn dies at the step cap mid-work. */
export const STEP_CAP_NOTE =
  '\n\n*Note: this turn stopped at the 12-step tool budget with work still in flight — say “continue” to pick it back up.*'

export function mapMastraChunk(chunk: unknown): ChatStreamEvent | null {
  if (!chunk || typeof chunk !== 'object') return null
  const c = chunk as { type?: string; payload?: unknown }
  const p = asRecord(c.payload ?? chunk)
  const type = c.type

  if (type === 'start' || type === 'step-start') {
    const model = firstString(p, ['modelId', 'model'])
    return { type: 'status', text: model ? `calling ${model}…` : 'thinking…' }
  }
  if (type === 'reasoning-start') {
    return { type: 'status', text: 'thinking…' }
  }
  if (type === 'reasoning-delta') {
    const text = chunkText(p)
    if (!text) return null
    return { type: 'reasoning-delta', text }
  }
  if (type === 'tool-call-input-streaming-start' || type === 'tool-input-start') {
    const name = toolNameOf(p)
    return { type: 'tool-call', id: toolIdOf(p, name), name, detail: `${name}…` }
  }
  if (type === 'tool-call-delta' || type === 'tool-input-delta') {
    const name = toolNameOf(p, '')
    const text = chunkText(p)
    if (!text) return null
    const id = toolIdOf(p, name || 'tool')
    return { type: 'tool-delta', id, name: name || 'tool', text }
  }
  if (type === 'tool-call') {
    const name = toolNameOf(p)
    return {
      type: 'tool-call',
      id: toolIdOf(p, name),
      name,
      detail: summarizeArgs(name, argsOf(p)),
    }
  }
  if (type === 'tool-result' || type === 'tool-output') {
    const name = toolNameOf(p)
    const result = p.result ?? p.output
    const failed = p.isError === true || (result && typeof result === 'object' && 'error' in (result as object) && (result as { error?: unknown }).error)
    return {
      type: 'tool-result',
      id: toolIdOf(p, name),
      name,
      ok: !failed,
      detail: summarizeResult(result),
    }
  }
  if (type === 'tool-error') {
    const name = toolNameOf(p)
    return {
      type: 'tool-result',
      id: toolIdOf(p, name),
      name,
      ok: false,
      detail: errorMessage(p.error),
    }
  }
  if (type === 'text-delta') {
    const text = chunkText(p)
    if (!text) return null
    return { type: 'text-delta', text }
  }
  if (type === 'error') {
    return { type: 'error', error: describeUpstreamError(p.error ?? p.message) }
  }
  return null
}

export function beginChatSse(
  res: ChatSseResponse,
  req?: ChatStreamReq,
) {
  res.socket?.setNoDelay?.(true)
  req?.socket?.setNoDelay?.(true)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const flush = () => { res.flush?.() }
  res.write(': connected\n\n')
  flush()
  const send = (obj: unknown) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
    flush()
  }
  return {
    send,
    aborted: () => Boolean(req && 'aborted' in req && req.aborted),
  }
}

/** Read a finished stream's totalUsage (a value or a promise, gateway-dependent). */
async function readStreamUsage(streamResult: unknown): Promise<TurnUsage | null> {
  if (!streamResult || typeof streamResult !== 'object') return null
  const r = streamResult as { totalUsage?: unknown }
  const raw = typeof r.totalUsage === 'function' || (r.totalUsage && typeof (r.totalUsage as PromiseLike<unknown>).then === 'function')
    ? await (r.totalUsage as PromiseLike<unknown>)
    : r.totalUsage
  return toTurnUsage(raw)
}

/** The newest user message's text, for skill trigger matching. */


export async function pipeAgentChatStream(
  messages: unknown,
  res: ChatSseResponse,
  req?: ChatStreamReq,
  workflow?: unknown,
  opts?: { mcp?: boolean },
) {
  const { parseSketchMode, setSketchMode, getSketchMode, SKETCH_TURN_PREAMBLE } = await import('./sketchSession.js')
  const {
    FILES_ROUTED_PREAMBLE,
    SKETCH_MIXED_PREAMBLE,
    routeChatTurn,
    withContextBeforeLastUser,
    withSystemPreamble,
  } = await import('./workflowRoute.js')
  const { buildTurnContext, latestUserText } = await import('./turnContext.js')
  // Chat debug/reporting mode (AI_LIVE_CHAT_DEBUG=1): a strict no-op
  // recorder unless the flag is on — see chatDebug.ts.
  const { createChatDebugTurn } = await import('./chatDebug.js')
  const dbg = createChatDebugTurn()
  const parsed = parseSketchMode(workflow)
  if (parsed) setSketchMode(parsed)
  const routed = routeChatTurn(getSketchMode(), messages)
  if (routed.switched) setSketchMode(routed.mode)
  const mode = getSketchMode()
  dbg.noteMode(mode, routed.switched)
  let payload: unknown = messages
  if (mode === 'sketch' && routed.intent === 'mixed') payload = withSystemPreamble(SKETCH_MIXED_PREAMBLE, messages)
  else if (mode === 'sketch') payload = withSystemPreamble(SKETCH_TURN_PREAMBLE, messages)
  else if (routed.switched) payload = withSystemPreamble(FILES_ROUTED_PREAMBLE, messages)
  // Per-turn context (brief, map, skills) is assembled by the shared
  // builder (turnContext.ts — the same stack every chat surface uses)
  // and inserted just before the newest user message — ordered stable
  // -> volatile so the conversation history ahead of it stays a
  // cacheable prefix (see withContextBeforeLastUser). Only the
  // constant mode preambles above still lead the payload.
  let skillsUsed: { name: string, via: string }[] = []
  const turnContext = await buildTurnContext(latestUserText(messages), {
    mode,
    onSkillsUsed: used => { skillsUsed = used },
  })
  payload = withContextBeforeLastUser(turnContext, payload)
  // Server-side thread memory (one thread per project root): the first
  // turn seeds the thread from the client payload as-is; later turns
  // drop the client-sent history because recall supplies it — the same
  // history is never billed twice. Best-effort: a store failure leaves
  // the payload untouched and the turn proceeds without memory. The
  // verify-gate follow-up below deliberately runs WITHOUT this option,
  // so its synthetic messages never land in the user's thread.
  let memoryOption: { thread: string, resource: string } | undefined
  try {
    const { prepareMemoryTurn } = await import('./mastra/chatMemory.js')
    const prepared = await prepareMemoryTurn(payload)
    payload = prepared.payload
    memoryOption = prepared.memory
  } catch { /* memory is continuity, not a dependency */ }
  // Self mode (§L): snapshot the editor tree before a Files turn
  // can touch it, so the turn is always revertible from the
  // recovery page. Best-effort — a snapshot failure never breaks
  // the turn.
  if (mode === 'files') {
    const { isSelfWorkspace, createSelfSnapshot } = await import('./selfMode.js')
    if (isSelfWorkspace()) await createSelfSnapshot('chat turn')
  }
  const { send: rawSend } = beginChatSse(res, req)
  // Every client-bound event also lands in the debug recorder
  // (a no-op unless AI_LIVE_CHAT_DEBUG=1).
  const send = (obj: unknown) => {
    dbg.recordEvent(obj as ChatStreamEvent)
    rawSend(obj)
  }
  const abortSignal = abortSignalFromReq(req)
  // This turn's MCP toolsets (opt-in via opts.mcp — the HTTP chat
  // routes pass it; direct callers like the benchmark runner do
  // not, so benchmark turns never see the user's MCP servers).
  // Closed when the main stream ends, and on the error paths.
  let mcpTurn: import('./mcp/mcpClient.js').McpTurnToolsets | null = null
  const closeMcp = async () => {
    const turn = mcpTurn
    mcpTurn = null
    if (turn) await turn.close().catch(() => { /* best-effort */ })
  }
  if (routed.switched) send({ type: 'workflow', mode: routed.mode, reason: routed.reason })
  send({ type: 'status', text: mode === 'sketch' ? 'live sketch…' : routed.switched ? 'switched to Files…' : 'starting…' })
  // Skills that joined this turn (skills UI slice 1): the chat
  // renders them as a chip on the turn, so what the agent carried
  // is visible instead of silent.
  if (skillsUsed.length) send({ type: 'skills', skills: skillsUsed })
  try {
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const { activeToolsForMode, fileToolsForTurn } = await import('./agentTools.js')
    const { verifyGateEnabled } = await import('./env.js')
    const { captureBaseline, runVerifyGate, gatePrompt } = await import('./verify/runGate.js')
    const { shouldTriggerGate, gateNeedsFollowUp } = await import('./verify/gate.js')
    // P0-b pre-edit baseline on Files turns (post-edit diff needs it).
    // Never breaks the turn: failure means the gate reports "unverified".
    let baseline: import('./verify/runGate.js').GateBaseline | null = null
    let baselineError: string | null = null
    if (mode === 'files' && verifyGateEnabled()) {
      try {
        baseline = await captureBaseline()
      } catch (e: unknown) {
        baseline = null
        baselineError = e instanceof Error ? e.message : String(e)
      }
    }
    dbg.noteGateArmed(mode === 'files' && verifyGateEnabled(), { captured: Boolean(baseline), error: baselineError })
    const streamChunks = async (stream: AsyncIterable<unknown>) => {
      for await (const chunk of stream) {
        if (req?.aborted || abortSignal.aborted) break
        stepCap = trackStepCap(stepCap, chunk)
        const c = chunk as { type?: string; payload?: unknown } | null
        if (c && typeof c === 'object' && (c.type === 'start' || c.type === 'step-start')) {
          const p = asRecord(c.payload ?? chunk)
          model = firstString(p, ['modelId', 'model']) || model
        }
        const mapped = mapMastraChunk(chunk)
        if (mapped) {
          if (mapped.type === 'tool-call') toolTrace.push(mapped.name)
          dbg.noteToolChunk(mapped, chunk)
          send(mapped)
        }
      }
    }
    // Files turns send a per-turn tool set (core + the groups this turn
    // triggers) instead of all 28 schemas; Sketch keeps its fixed set.
    let turnHasActivePlan = false
    let turnHasFeatureGraph = false
    let turnHasUserFlowGraph = false
    let turnTools = activeToolsForMode(mode)
    if (mode === 'files') {
      try {
        const { getActivePlan } = await import('./plans/plans.js')
        turnHasActivePlan = Boolean(getActivePlan())
      } catch { /* plan tools stay text-triggered only */ }
      try {
        const { getFeatureGraph } = await import('./features/features.js')
        turnHasFeatureGraph = Boolean(getFeatureGraph())
      } catch { /* feature tools stay text-triggered only */ }
      try {
        const { getUserFlowGraph } = await import('./userflows/userflows.js')
        turnHasUserFlowGraph = Boolean(getUserFlowGraph())
      } catch { /* user flow tools stay text-triggered only */ }
      let searchAvailable = false
      try {
        const { getSearchBackend } = await import('./searchSession.js')
        searchAvailable = getSearchBackend() !== 'off'
      } catch { /* research tools stay off */ }
      turnTools = fileToolsForTurn({ userText: latestUserText(messages), hasActivePlan: turnHasActivePlan, hasFeatureGraph: turnHasFeatureGraph, hasUserFlowGraph: turnHasUserFlowGraph, searchAvailable })
      // MCP: connect this turn's servers and offer their enabled
      // tools alongside the built-ins. The names must join
      // activeTools — Mastra merges toolset tools into the same
      // dictionary its activeTools filter prunes by name.
      if (opts?.mcp) {
        try {
          const { getMcpToolsetsForTurn } = await import('./mcp/mcpClient.js')
          mcpTurn = await getMcpToolsetsForTurn()
          if (mcpTurn.toolNames.length) turnTools = [...turnTools, ...mcpTurn.toolNames]
        } catch { mcpTurn = null }
      }
      dbg.noteTools(turnTools, { hasActivePlan: turnHasActivePlan, hasFeatureGraph: turnHasFeatureGraph, hasUserFlowGraph: turnHasUserFlowGraph, searchAvailable })
    }
    if (mode !== 'files') dbg.noteTools(turnTools, {})
    const { runChatTurnScope, flushLocatesToWorkingMemory } = await import('./locateTurn.js')
    let model: string | undefined
    const toolTrace: string[] = []
    let stepCap = emptyStepCapState()
    const result = await runChatTurnScope(async () => {
      const stream = await agent.stream(payload as never, {
        maxSteps: CHAT_MAX_STEPS,
        abortSignal,
        activeTools: turnTools,
        memory: memoryOption,
        ...(mcpTurn?.toolNames.length ? { toolsets: mcpTurn.toolsets } : {}),
      })
      await streamChunks(stream.fullStream)
      await flushLocatesToWorkingMemory()
      return stream
    })
    // MCP clients live exactly as long as the main stream — the
    // verify-gate follow-up below deliberately runs without them.
    await closeMcp()
    // Step-cap honesty: a turn that dies at the budget mid-work must not
    // read as a finished final report — say so and how to resume.
    if (!req?.aborted && !abortSignal.aborted && hitStepCap(stepCap, CHAT_MAX_STEPS)) {
      send({ type: 'text-delta', text: STEP_CAP_NOTE })
    }
    // The verify-gate follow-up stream, kept so its usage joins the turn's.
    let followResult: unknown = null
    // P0-b host gate: Files turns that wrote files get re-checked here.
    let verification: VerifySummary = { ran: false }
    // Extracted once so the debug recorder sees the same decision the
    // branches below act on (shouldTriggerGate is pure — no behavior
    // change from computing it up front).
    const gateTriggered = mode === 'files' && shouldTriggerGate(mode, toolTrace)
    dbg.noteGateDecision(gateTriggered, [...toolTrace])
    if (
      mode === 'files' &&
      verifyGateEnabled() &&
      baseline &&
      gateTriggered &&
      !req?.aborted &&
      !abortSignal.aborted
    ) {
      send({ type: 'status', text: 'verifying layout + console…' })
      let gate: import('./verify/runGate.js').GateResult
      try {
        gate = await runVerifyGate(baseline)
      } catch (e: unknown) {
        gate = { ran: true, layout: [], expected: [], console: [], unverified: [e instanceof Error ? e.message : String(e)] }
      }
      // The follow-up stream runs only for fixable findings (new
      // layout/console). An unverified-only result skips it: the else
      // branch below still forwards the notes in the verify summary
      // with followUp: false, the shape the client already renders.
      const needsFollowUp = gateNeedsFollowUp(gate)
      const prompt = needsFollowUp ? gatePrompt(gate) : null
      if (!needsFollowUp && gate.unverified.length) dbg.noteGateFollowUpSkipped('unverified-only')
      if (prompt && !req?.aborted && !abortSignal.aborted) {
        const followPayload = Array.isArray(messages)
          ? [
            ...messages,
            { role: 'assistant', content: 'Edits applied. Running automatic verification…' },
            { role: 'user', content: prompt },
          ]
          : [{ role: 'user', content: prompt }]
        const follow = await agent.stream(followPayload as never, {
          maxSteps: 4,
          abortSignal,
          // No memory option here on purpose: the gate's synthetic
          // prompt/reply must not be persisted into the user's thread.
          // The gate prompt names the layout tools, so its own text
          // triggers the layout group; research stays off for a verify pass.
          activeTools: fileToolsForTurn({ userText: prompt, hasActivePlan: turnHasActivePlan, hasFeatureGraph: turnHasFeatureGraph, hasUserFlowGraph: turnHasUserFlowGraph }),
        })
        followResult = follow
        await streamChunks(follow.fullStream)
        verification = {
          ran: true,
          newLayout: gate.layout.length,
          newConsole: gate.console.length,
          unverified: gate.unverified,
          followUp: true,
        }
      } else {
        verification = {
          ran: true,
          clean: !gate.layout.length && !gate.console.length && !gate.unverified.length,
          newLayout: gate.layout.length,
          newConsole: gate.console.length,
          unverified: gate.unverified,
          followUp: false,
        }
      }
      if (gate.layout.length || gate.console.length || gate.unverified.length) {
        const { logServerError } = await import('./serverLog.js')
        logServerError({
          kind: 'verify-gate',
          route: 'POST /api/chat/stream',
          model,
          message: `gate findings: ${gate.layout.length} layout, ${gate.console.length} console, ${gate.unverified.length} unverified`,
          detail: gate.unverified.join(' | ') || undefined,
        })
      }
    } else if (mode === 'files' && !verifyGateEnabled()) {
      verification = { ran: false, skipped: 'AI_LIVE_VERIFY=0' }
    } else if (mode === 'files' && baselineError && gateTriggered) {
      // A baseline-capture failure must read as a skipped gate with a
      // reason, not as a silent "nothing to verify" (slice 5a).
      verification = { ran: false, skipped: `baseline capture failed: ${baselineError}` }
    }
    // Usage lives outside the chunk mapping: some gateways omit it, so a
    // missing value is "not reported", never 0.
    let usage: TurnUsage | null = null
    try {
      usage = await readStreamUsage(result)
      // The verify-gate follow-up is a second stream with its own bill —
      // it used to go uncounted, understating every verified turn.
      if (followResult) usage = sumTurnUsage(usage, await readStreamUsage(followResult))
      if (!usage) {
        console.warn('[chat] provider did not report token usage for this turn')
        const { logServerError } = await import('./serverLog.js')
        logServerError({ kind: 'chat-usage', route: 'POST /api/chat/stream', model, message: 'provider did not report token usage for this turn' })
      }
    } catch (e: unknown) {
      console.warn('[chat] usage lookup failed:', e instanceof Error ? e.message : String(e))
      const { logServerError } = await import('./serverLog.js')
      logServerError({ kind: 'chat-usage', route: 'POST /api/chat/stream', model, message: 'usage lookup failed', detail: e instanceof Error ? e.message : String(e) })
    }
    // Self mode (§L): a Files turn that wrote files gets tsc +
    // tests run against the editor itself, fire-and-forget; the
    // result rides the workflow snapshot beside the SELF badge.
    const { isWriteTool } = await import('./agentTools.js')
    if (mode === 'files' && toolTrace.some(t => isWriteTool(t))) {
      const { isSelfWorkspace, runSelfChecks } = await import('./selfMode.js')
      if (isSelfWorkspace()) {
        send({ type: 'status', text: 'self-checks running (tsc + tests)…' })
        void runSelfChecks()
      }
    }
    send({ type: 'done', usage, model, verification })
    res.end()
    dbg.finish({ aborted: Boolean(req?.aborted || abortSignal.aborted) })
  } catch (e: unknown) {
    await closeMcp()
    if (req?.aborted || abortSignal.aborted || isAbortError(e)) {
      try { send({ type: 'done' }) } catch { /* closed */ }
      try { res.end() } catch { /* closed */ }
      dbg.finish({ aborted: true })
      return
    }
    console.error(e)
    const { logServerError } = await import('./serverLog.js')
    logServerError({ kind: 'chat-error', route: 'POST /api/chat/stream', message: e instanceof Error ? e.message : String(e) })
    try { send({ type: 'error', error: describeUpstreamError(e) }) } catch { /* closed */ }
    res.end()
    dbg.finish({ error: e instanceof Error ? e.message : String(e) })
  }
}
