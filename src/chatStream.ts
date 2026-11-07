/** Map Mastra fullStream chunks to compact SSE events for the chat UI. */

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
}

export type ChatStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'workflow'; mode: 'files' | 'sketch'; reason?: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-delta'; id: string; name: string; text: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'text-delta'; text: string }
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

export function summarizeResult(result: unknown): string {
  if (result == null) return 'done'
  if (typeof result === 'string') return clip(result, 200)
  if (typeof result !== 'object') return clip(String(result), 200)
  const r = result as LooseRecord
  if (r.error) return clip(String(r.error), 200)
  const bits: string[] = []
  if (typeof r.path === 'string') bits.push(r.path)
  if (typeof r.bytes === 'number') bits.push(`${r.bytes}b`)
  if (typeof r.content === 'string') bits.push(`${r.content.length} chars`)
  if (Array.isArray(r.files)) bits.push(`${r.files.length} files`)
  if (Array.isArray(r.hits)) bits.push(`${r.hits.length} hits`)
  if (typeof r.matches === 'number') bits.push(`${r.matches} match${r.matches === 1 ? '' : 'es'}`)
  if (typeof r.startLine === 'number' && typeof r.endLine === 'number') bits.push(`L${r.startLine}–${r.endLine}`)
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
function latestUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string, content?: unknown }
    if (m?.role === 'user' && typeof m.content === 'string') return m.content
  }
  return ''
}

export async function pipeAgentChatStream(
  messages: unknown,
  res: ChatSseResponse,
  req?: ChatStreamReq,
  workflow?: unknown,
) {
  const { parseSketchMode, setSketchMode, getSketchMode, SKETCH_TURN_PREAMBLE } = await import('./sketchSession.js')
  const {
    FILES_ROUTED_PREAMBLE,
    SKETCH_MIXED_PREAMBLE,
    routeChatTurn,
    withContextBeforeLastUser,
    withSystemPreamble,
  } = await import('./workflowRoute.js')
  const parsed = parseSketchMode(workflow)
  if (parsed) setSketchMode(parsed)
  const routed = routeChatTurn(getSketchMode(), messages)
  if (routed.switched) setSketchMode(routed.mode)
  const mode = getSketchMode()
  let payload: unknown = messages
  if (mode === 'sketch' && routed.intent === 'mixed') payload = withSystemPreamble(SKETCH_MIXED_PREAMBLE, messages)
  else if (mode === 'sketch') payload = withSystemPreamble(SKETCH_TURN_PREAMBLE, messages)
  else if (routed.switched) payload = withSystemPreamble(FILES_ROUTED_PREAMBLE, messages)
  // Per-turn context (brief, map, skills) is collected here and inserted
  // just before the newest user message further down — ordered stable ->
  // volatile so the conversation history ahead of it stays a cacheable
  // prefix (see withContextBeforeLastUser). Only the constant mode
  // preambles above still lead the payload.
  const turnContext: string[] = []
  // Project brief (phase-11-06): type, device targets, style set —
  // every agent turn knows what kind of project it is building.
  const { projectBrief } = await import('./projectConfig.js')
  turnContext.push(projectBrief())
  // Rung 2 (§1): inject top map signatures on Files turns only above
  // the file-count threshold — below it the greps are cheaper than
  // the map. Best-effort: a map failure never breaks the turn.
  if (mode === 'files') {
    try {
      const { currentAgentSettings } = await import('./agentSettings.js')
      const injectionMode = currentAgentSettings().mapInjection
      if (injectionMode !== 'off') {
        const { buildMapForRoot } = await import('./codebaseMap/mapStore.js')
        const { mapInjectionText } = await import('./codebaseMap/codebaseMap.js')
        const injection = mapInjectionText(buildMapForRoot(), injectionMode === 'always' ? 0 : undefined)
        if (injection) turnContext.push(injection)
      }
    } catch { /* map injection is an optimisation, not a requirement */ }
  }
  // Skills (§4): a body loads only when this turn triggers it —
  // an explicit ask trigger, library evidence in package.json, or
  // the project type. Untriggered turns pay nothing. Best-effort.
  if (mode === 'files') {
    try {
      const { skillInjectionForTurn } = await import('./skills/skills.js')
      const userText = latestUserText(messages)
      const injection = userText ? skillInjectionForTurn(userText) : null
      if (injection) turnContext.push(injection)
    } catch { /* skill injection is an optimisation, not a requirement */ }
  }
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
  const { send } = beginChatSse(res, req)
  const abortSignal = abortSignalFromReq(req)
  if (routed.switched) send({ type: 'workflow', mode: routed.mode, reason: routed.reason })
  send({ type: 'status', text: mode === 'sketch' ? 'live sketch…' : routed.switched ? 'switched to Files…' : 'starting…' })
  try {
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const { activeToolsForMode, fileToolsForTurn } = await import('./agentTools.js')
    const { verifyGateEnabled } = await import('./env.js')
    const { captureBaseline, runVerifyGate, gatePrompt } = await import('./verify/runGate.js')
    const { shouldTriggerGate } = await import('./verify/gate.js')
    // P0-b pre-edit baseline on Files turns (post-edit diff needs it).
    // Never breaks the turn: failure means the gate reports "unverified".
    let baseline: import('./verify/runGate.js').GateBaseline | null = null
    if (mode === 'files' && verifyGateEnabled()) {
      try {
        baseline = await captureBaseline()
      } catch {
        baseline = null
      }
    }
    const streamChunks = async (stream: AsyncIterable<unknown>) => {
      for await (const chunk of stream) {
        if (req?.aborted || abortSignal.aborted) break
        const c = chunk as { type?: string; payload?: unknown } | null
        if (c && typeof c === 'object' && (c.type === 'start' || c.type === 'step-start')) {
          const p = asRecord(c.payload ?? chunk)
          model = firstString(p, ['modelId', 'model']) || model
        }
        const mapped = mapMastraChunk(chunk)
        if (mapped) {
          if (mapped.type === 'tool-call') toolTrace.push(mapped.name)
          send(mapped)
        }
      }
    }
    // Files turns send a per-turn tool set (core + the groups this turn
    // triggers) instead of all 28 schemas; Sketch keeps its fixed set.
    let turnHasActivePlan = false
    let turnTools = activeToolsForMode(mode)
    if (mode === 'files') {
      try {
        const { getActivePlan } = await import('./plans/plans.js')
        turnHasActivePlan = Boolean(getActivePlan())
      } catch { /* plan tools stay text-triggered only */ }
      let searchAvailable = false
      try {
        const { getSearchBackend } = await import('./searchSession.js')
        searchAvailable = getSearchBackend() !== 'off'
      } catch { /* research tools stay off */ }
      turnTools = fileToolsForTurn({ userText: latestUserText(messages), hasActivePlan: turnHasActivePlan, searchAvailable })
    }
    const result = await agent.stream(payload as never, {
      maxSteps: 12,
      abortSignal,
      activeTools: turnTools,
      memory: memoryOption,
    })
    let model: string | undefined
    const toolTrace: string[] = []
    await streamChunks(result.fullStream)
    // The verify-gate follow-up stream, kept so its usage joins the turn's.
    let followResult: unknown = null
    // P0-b host gate: Files turns that wrote files get re-checked here.
    let verification: VerifySummary = { ran: false }
    if (
      mode === 'files' &&
      verifyGateEnabled() &&
      baseline &&
      shouldTriggerGate(mode, toolTrace) &&
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
      const prompt = gatePrompt(gate)
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
          activeTools: fileToolsForTurn({ userText: prompt, hasActivePlan: turnHasActivePlan }),
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
    if (mode === 'files' && toolTrace.some(t => t === 'str-replace' || t === 'write-real-file')) {
      const { isSelfWorkspace, runSelfChecks } = await import('./selfMode.js')
      if (isSelfWorkspace()) {
        send({ type: 'status', text: 'self-checks running (tsc + tests)…' })
        void runSelfChecks()
      }
    }
    send({ type: 'done', usage, model, verification })
    res.end()
  } catch (e: unknown) {
    if (req?.aborted || abortSignal.aborted || isAbortError(e)) {
      try { send({ type: 'done' }) } catch { /* closed */ }
      try { res.end() } catch { /* closed */ }
      return
    }
    console.error(e)
    const { logServerError } = await import('./serverLog.js')
    logServerError({ kind: 'chat-error', route: 'POST /api/chat/stream', message: e instanceof Error ? e.message : String(e) })
    try { send({ type: 'error', error: describeUpstreamError(e) }) } catch { /* closed */ }
    res.end()
  }
}
