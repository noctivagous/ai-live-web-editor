/** Map Mastra fullStream chunks to compact SSE events for the chat UI. */

export type ChatStreamEvent =
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'text-delta'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

function summarizeArgs(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return name
  const a = args as Record<string, unknown>
  if (typeof a.path === 'string') return `${name} ${a.path}`
  if (typeof a.selector === 'string') return `${name} ${a.selector}`
  return name
}

function summarizeResult(result: unknown): string {
  if (result == null) return 'done'
  if (typeof result === 'string') return result.slice(0, 80)
  if (typeof result !== 'object') return String(result).slice(0, 80)
  const r = result as Record<string, unknown>
  if (r.error) return String(r.error).slice(0, 80)
  if (typeof r.bytes === 'number') return `${r.bytes}b`
  if (Array.isArray(r.files)) return `${r.files.length} files`
  if (r.rect && typeof r.rect === 'object') {
    const rect = r.rect as { width?: number; height?: number }
    if (rect.width != null && rect.height != null) return `${Math.round(rect.width)}×${Math.round(rect.height)}`
  }
  if (r.ok === true) return 'ok'
  return 'done'
}

export function mapMastraChunk(chunk: unknown): ChatStreamEvent | null {
  if (!chunk || typeof chunk !== 'object') return null
  const c = chunk as { type?: string; payload?: Record<string, unknown> }
  const p = c.payload ?? (chunk as Record<string, unknown>)
  const type = c.type

  if (type === 'tool-call') {
    const name = String(p.toolName || 'tool')
    return {
      type: 'tool-call',
      id: String(p.toolCallId || name),
      name,
      detail: summarizeArgs(name, p.args),
    }
  }
  if (type === 'tool-result') {
    const name = String(p.toolName || 'tool')
    return {
      type: 'tool-result',
      id: String(p.toolCallId || name),
      name,
      ok: p.isError !== true,
      detail: summarizeResult(p.result),
    }
  }
  if (type === 'text-delta') {
    const text = typeof p.text === 'string' ? p.text : ''
    if (!text) return null
    return { type: 'text-delta', text }
  }
  if (type === 'error') {
    const err = p.error
    const msg = err instanceof Error ? err.message : String(err || p.message || 'stream error')
    return { type: 'error', error: msg }
  }
  return null
}
