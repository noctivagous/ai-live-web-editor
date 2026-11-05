/** Map Mastra fullStream chunks to compact SSE events for the chat UI. */

export type ChatStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-delta'; id: string; name: string; text: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'text-delta'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

type LooseRecord = Record<string, unknown>

export type ChatSseResponse = {
  setHeader: (name: string, value: string) => void
  flushHeaders?: () => void
  write: (chunk: string) => unknown
  flush?: () => void
  end: () => void
  socket?: { setNoDelay?: (v: boolean) => void } | null
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

function chunkText(p: LooseRecord): string {
  return firstString(p, ['text', 'textDelta', 'delta', 'argsTextDelta'])
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
    return {
      type: 'tool-result',
      id: toolIdOf(p, name),
      name,
      ok: p.isError !== true,
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
    return { type: 'error', error: errorMessage(p.error ?? p.message) }
  }
  return null
}

export function beginChatSse(
  res: ChatSseResponse,
  req?: { aborted?: boolean; socket?: ChatSseResponse['socket'] | null },
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

export async function pipeAgentChatStream(
  messages: unknown,
  res: ChatSseResponse,
  req?: { aborted?: boolean; socket?: ChatSseResponse['socket'] | null },
) {
  const { send } = beginChatSse(res, req)
  send({ type: 'status', text: 'starting…' })
  try {
    const { mastra } = await import('./mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const result = await agent.stream(messages as never, { maxSteps: 12 })
    for await (const chunk of result.fullStream) {
      if (req?.aborted) break
      const mapped = mapMastraChunk(chunk)
      if (mapped) send(mapped)
    }
    send({ type: 'done' })
    res.end()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(e)
    try { send({ type: 'error', error: message }) } catch { /* closed */ }
    res.end()
  }
}
