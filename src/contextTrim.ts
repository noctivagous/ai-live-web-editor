/**
 * In-turn tool-result trimming (agent-context Layer 2,
 * TASKS-token-efficiency §2) — the real compaction manager, living
 * inside the existing agent run. No second agent.
 *
 * A Mastra processor whose processLLMRequest runs immediately
 * before every provider call. Its rewrites are transient (the
 * stored message list and the chat UI keep full results); only
 * what the model is sent changes:
 *
 * - The newest tool results stay in full — the model acts on them
 *   in the step right after they land.
 * - From the following step on, any older tool result larger than
 *   TRIM_THRESHOLD_CHARS is replaced by a compact summary. File
 *   reads fold Roo-style: path + line range + the file's signature
 *   (components/exports from the §1 extractor), not the body.
 *   inspect-dom HTML and snapshot dumps clip to a head + a note.
 *
 * The pure core (trimPrompt) works on the LanguageModelV2 prompt
 * shape so it is unit-testable without a model.
 */
import type { ProcessLLMRequestArgs, ProcessLLMRequestResult, Processor } from '@mastra/core/processors'
import { parseFile } from './codebaseMap/extract.js'
import { currentAgentSettings } from './agentSettings.js'

/** Results at or below this size are never worth folding. */
export const TRIM_THRESHOLD_CHARS = 1500
/** Hard ceiling for one folded summary. */
export const TRIM_SUMMARY_CHARS = 640

type LoosePart = {
  type: string
  toolCallId?: string
  toolName?: string
  output?: { type: string, value: unknown }
  [key: string]: unknown
}
type LooseMessage = { role: string, content: unknown, [key: string]: unknown }

function resultText(output: { type: string, value: unknown }): string {
  if (output.type === 'text' || output.type === 'error-text') return String(output.value ?? '')
  if (output.type === 'content' && Array.isArray(output.value)) {
    return output.value.map(p => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('')
  }
  try { return JSON.stringify(output.value) ?? '' } catch { return String(output.value ?? '') }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); return p && typeof p === 'object' ? p as Record<string, unknown> : null } catch { return null }
  }
  return null
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : t.slice(0, max - 1) + '…'
}

/** Fold a file read: range + signature (components/exports), never the body. */
function summarizeRead(obj: Record<string, unknown>, originalChars: number): string {
  const p = typeof obj.path === 'string' ? obj.path : '(file)'
  const range = typeof obj.startLine === 'number' && typeof obj.endLine === 'number'
    ? ` lines ${obj.startLine}–${obj.endLine}${typeof obj.totalLines === 'number' ? ` of ${obj.totalLines}` : ''}`
    : ''
  let signature = ''
  if (typeof obj.content === 'string' && obj.content) {
    try {
      const info = parseFile({ path: p, content: obj.content })
      const parts: string[] = []
      if (info.components.length) parts.push('components ' + info.components.map(c => c.props ? `${c.name}(${c.props.join(', ')})` : c.name).join(', '))
      if (info.exports.length) parts.push('exports ' + info.exports.slice(0, 8).join(', '))
      if (parts.length) signature = ` Signature: ${parts.join('; ')}.`
    } catch { /* signature is a bonus, not a requirement */ }
  }
  return clip(`[trimmed: read-real-file ${p}${range}, ${originalChars} chars folded to this summary.${signature} Re-read with read-real-file offset/limit if you need the body.]`, TRIM_SUMMARY_CHARS)
}

function summarizeToolResult(toolName: string, output: { type: string, value: unknown }, originalText: string): string {
  const n = originalText.length
  const obj = asObject(output.value) ?? (output.type === 'text' ? asObject(originalText) : null)
  if (toolName === 'read-real-file' && obj) return summarizeRead(obj, n)
  if (toolName === 'inspect-dom' && obj) {
    const bits = ['[trimmed: inspect-dom']
    if (typeof obj.selector === 'string') bits.push(` ${obj.selector}`)
    if (typeof obj.tagName === 'string') bits.push(` <${obj.tagName}>`)
    bits.push(`, ${n} chars folded.`)
    const text = typeof obj.text === 'string' ? obj.text : typeof obj.textContent === 'string' ? obj.textContent : ''
    if (text) bits.push(` Text: "${clip(text, 160)}"`)
    bits.push(' HTML dropped — inspect-dom again if you need it.]')
    return clip(bits.join(''), TRIM_SUMMARY_CHARS)
  }
  if (toolName === 'take-snapshot' || toolName === 'layout-snapshot' || toolName === 'layout-svg') {
    const head = clip(originalText, 420)
    return clip(`[trimmed: ${toolName}, ${n} chars folded. Head: ${head} — re-run ${toolName} if you need the full dump.]`, TRIM_SUMMARY_CHARS)
  }
  if (obj) {
    const keys = Object.keys(obj).slice(0, 10).join(', ')
    return clip(`[trimmed: ${toolName} result, ${n} chars folded. Keys: ${keys}. Head: ${clip(originalText, 260)}]`, TRIM_SUMMARY_CHARS)
  }
  return clip(`[trimmed: ${toolName} result, ${n} chars folded. Head: ${clip(originalText, 380)}]`, TRIM_SUMMARY_CHARS)
}

export interface TrimStats { trimmed: number, savedChars: number }
export interface TrimResult<T> { prompt: T, stats: TrimStats, changed: boolean }

/**
 * Fold bulky tool results in a LanguageModelV2-shaped prompt.
 * Freshness rule: results answering the most recent tool calls
 * (everything after the last assistant message carrying tool-call
 * parts) stay in full; older results over the threshold fold.
 */
export function trimPrompt<T extends LooseMessage[]>(prompt: T, thresholdChars: number = TRIM_THRESHOLD_CHARS): TrimResult<T> {
  let lastCallIdx = -1
  prompt.forEach((msg, i) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return
    if ((msg.content as LoosePart[]).some(p => p.type === 'tool-call')) lastCallIdx = i
  })
  const stats: TrimStats = { trimmed: 0, savedChars: 0 }
  if (lastCallIdx < 0) return { prompt, stats, changed: false }

  const next = prompt.map((msg, i) => {
    if (i >= lastCallIdx || !Array.isArray(msg.content)) return msg
    const parts = msg.content as LoosePart[]
    if (!parts.some(p => p.type === 'tool-result' && p.output)) return msg
    let touched = false
    const newParts = parts.map(p => {
      if (p.type !== 'tool-result' || !p.output) return p
      const text = resultText(p.output)
      if (text.length <= thresholdChars) return p
      const summary = summarizeToolResult(p.toolName || 'tool', p.output, text)
      stats.trimmed++
      stats.savedChars += text.length - summary.length
      touched = true
      return { ...p, output: { type: 'text', value: summary } }
    })
    return touched ? { ...msg, content: newParts } : msg
  })
  return { prompt: next as T, stats, changed: stats.trimmed > 0 }
}

/**
 * The Mastra processor: transient per-call trimming inside the
 * existing agent run. Attach once on the agent; it applies to
 * every stream (chat, verify follow-up, live-edit submits) because
 * they all run through the same agent.
 */
export class ToolResultTrimProcessor implements Processor {
  readonly id = 'tool-result-trim'
  readonly name = 'Tool result trim (§2)'

  async processLLMRequest({ prompt }: ProcessLLMRequestArgs): Promise<ProcessLLMRequestResult> {
    if (!currentAgentSettings().contextTrim) return undefined
    if (!Array.isArray(prompt)) return undefined
    const { prompt: next, changed, stats } = trimPrompt(prompt as unknown as LooseMessage[])
    if (!changed) return undefined
    if (process.env.AI_LIVE_TRIM_LOG === '1') {
      console.log(`[trim] folded ${stats.trimmed} tool result(s), saved ~${stats.savedChars} chars this call`)
    }
    return { prompt: next as unknown as typeof prompt }
  }

  /** Required companion hook for LLM-request processors; trimming needs no response-side work. */
  async processLLMResponse(): Promise<void> {
    return undefined
  }
}

export const toolResultTrimProcessor = new ToolResultTrimProcessor()
