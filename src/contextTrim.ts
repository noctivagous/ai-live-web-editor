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
 * - Fresh results with uniform arrays get the payload diet
 *   instead of raw JSON (the structured-payload analysis): the
 *   array — uniform objects re-paying their keys per item —
 *   becomes legend + rows text. layout-snapshot elements (styles
 *   keep only non-default values; rows group under their
 *   page-section headers when annotated), grep hits (grouped by
 *   file), find-component tier-1 summaries (one row each; full
 *   entries are never dieted). Stored results keep the objects;
 *   only the provider-bound copy changes shape.
 *
 * The pure core (trimPrompt) works on the LanguageModelV2 prompt
 * shape so it is unit-testable without a model.
 */
import type { ProcessLLMRequestArgs, ProcessLLMRequestResult, Processor } from '@mastra/core/processors'
import { parseFile } from './codebaseMap/extract.js'
import { currentAgentSettings } from './agentSettings.js'

/** Results at or below this size are never worth folding. */
export const TRIM_THRESHOLD_CHARS = 1500
/**
 * The diet has its own, lower floor: folding and dieting are
 * different decisions (a 1.4k catalog-summary result is far too
 * small to fold but still worth serializing), and the diet's
 * no-win guard (it only applies when it actually shrinks the
 * result) is the real safety.
 */
export const DIET_MIN_CHARS = 600
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

/**
 * CSS initial values for the layout style preset's properties. A
 * computed style equal to its initial value carries no information
 * (position:static, overflow:visible, inset:auto…), so the diet
 * drops it. `display` is deliberately absent — its initial value
 * differs per element.
 */
const DEFAULT_COMPUTED_STYLES: Record<string, string> = {
  'position': 'static', 'top': 'auto', 'right': 'auto', 'bottom': 'auto', 'left': 'auto',
  'z-index': 'auto', 'flex-direction': 'row', 'flex-wrap': 'nowrap', 'flex': '0 1 auto',
  'flex-basis': 'auto', 'flex-grow': '0', 'flex-shrink': '1',
  'grid-template-columns': 'none', 'grid-template-rows': 'none', 'grid-auto-flow': 'row',
  'grid-auto-columns': 'auto', 'grid-auto-rows': 'auto',
  'justify-content': 'normal', 'align-items': 'normal', 'align-content': 'normal',
  'place-content': 'normal', 'place-items': 'normal', 'place-self': 'auto',
  'gap': 'normal', 'row-gap': 'normal', 'column-gap': 'normal',
  'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
  'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
  'width': 'auto', 'height': 'auto', 'max-width': 'none', 'max-height': 'none',
  'box-sizing': 'content-box', 'overflow': 'visible', 'overflow-x': 'visible', 'overflow-y': 'visible',
  'contain': 'none', 'content-visibility': 'visible',
  'opacity': '1', 'visibility': 'visible', 'pointer-events': 'auto', 'transform': 'none',
}

/**
 * Properties whose no-information value varies by engine: Chrome's
 * computed min-width/min-height surface as '0px' where the spec
 * initial is 'auto', and an all-auto inset serializes as 'auto'.
 * Any of the listed values drops.
 */
const DEFAULT_COMPUTED_STYLE_SETS: Record<string, string[]> = {
  'min-width': ['auto', '0px'],
  'min-height': ['auto', '0px'],
  'inset': ['auto'],
}

const LAYOUT_ROW_LEGEND = '[elements as rows · legend: stableId tag#id.classes depth x,y wxh "text" {styles — non-default values only} · rows group under ## section headers]'

/**
 * Serialize a layout-snapshot result's elements array as legend +
 * rows. Returns null when the value is not a layout result with
 * elements, or when the diet would not actually shrink it.
 */
export function dietLayoutResult(value: unknown): { value: Record<string, unknown>, savedChars: number } | null {
  const obj = asObject(value)
  if (!obj || !Array.isArray(obj.elements) || !obj.elements.length) return null
  const lines: string[] = [LAYOUT_ROW_LEGEND]
  let currentSection: string | null = null
  for (const raw of obj.elements) {
    const el = asObject(raw)
    if (!el) continue
    const section = typeof el.section === 'string' && el.section ? el.section : null
    if (section !== currentSection) {
      currentSection = section
      if (section) lines.push(`## ${section}`)
    }
    const rect = asObject(el.rect)
    const num = (v: unknown) => Math.round(typeof v === 'number' && Number.isFinite(v) ? v : 0)
    const tag = String(el.tagName || '?').toLowerCase()
    const idPart = typeof el.id === 'string' && el.id ? `#${el.id}` : ''
    const classes = Array.isArray(el.classList) ? el.classList.slice(0, 2).map(c => `.${String(c)}`).join('') : ''
    const depth = typeof el.depth === 'number' ? String(el.depth) : '-'
    const text = typeof el.textSnippet === 'string' && el.textSnippet
      ? ` "${clip(el.textSnippet.replace(/"/g, "'"), 40)}"`
      : ''
    let styles = ''
    const stylesObj = asObject(el.computedStyles)
    if (stylesObj) {
      const kept = Object.entries(stylesObj)
        .filter(([k, v]) => {
          const value = String(v)
          if (!value) return false // the engine emits '' for n/a properties — no information
          if (DEFAULT_COMPUTED_STYLES[k] === value) return false
          if (DEFAULT_COMPUTED_STYLE_SETS[k]?.includes(value)) return false
          return true
        })
        .map(([k, v]) => `${k}:${String(v)}`)
      if (kept.length) styles = ` {${kept.join('; ')}}`
    }
    const changed = el.changed === true ? ' ~changed' : ''
    lines.push(`${String(el.stableId || '-')} ${tag}${idPart}${classes} ${depth} ${num(rect?.x)},${num(rect?.y)} ${num(rect?.width)}x${num(rect?.height)}${text}${styles}${changed}`)
  }
  const dieted = { ...obj, elements: lines.join('\n') }
  const savedChars = JSON.stringify(obj).length - JSON.stringify(dieted).length
  return savedChars > 0 ? { value: dieted, savedChars } : null
}

const GREP_ROW_LEGEND = '[hits as rows · file path once per file, then "line text" per hit]'

/**
 * Serialize a grep result's hits as rows grouped by file (hits
 * arrive in walk order, so same-file hits are consecutive; a file
 * that recurs gets its header again). Null when the value is not a
 * hits result, or the diet would not shrink it.
 */
export function dietGrepResult(value: unknown): { value: Record<string, unknown>, savedChars: number } | null {
  const obj = asObject(value)
  if (!obj || !Array.isArray(obj.hits) || !obj.hits.length) return null
  const lines: string[] = [GREP_ROW_LEGEND]
  let currentPath: string | null = null
  for (const raw of obj.hits) {
    const hit = asObject(raw)
    if (!hit || typeof hit.path !== 'string') return null
    if (hit.path !== currentPath) {
      currentPath = hit.path
      lines.push(hit.path)
    }
    const line = typeof hit.line === 'number' ? hit.line : 0
    const text = typeof hit.text === 'string' ? hit.text.replace(/\s+/g, ' ').trim() : ''
    lines.push(`  ${line} ${text}`)
  }
  const dieted = { ...obj, hits: lines.join('\n') }
  const savedChars = JSON.stringify(obj).length - JSON.stringify(dieted).length
  return savedChars > 0 ? { value: dieted, savedChars } : null
}

const COMPONENT_ROW_LEGEND = '[components as rows · tag [stock/category] — description (props: names)]'

/**
 * Serialize a find-component TIER-1 result's summaries as one row
 * each. Full entries (tier 'full') are irregular one-offs and are
 * never dieted. Null when not a summary result, or no win.
 */
export function dietFindComponentResult(value: unknown): { value: Record<string, unknown>, savedChars: number } | null {
  const obj = asObject(value)
  if (!obj || obj.tier !== 'summary' || !Array.isArray(obj.components) || !obj.components.length) return null
  const lines: string[] = [COMPONENT_ROW_LEGEND]
  for (const raw of obj.components) {
    const c = asObject(raw)
    if (!c || typeof c.tag !== 'string') return null
    const where = [typeof c.stock === 'string' ? c.stock : '', typeof c.category === 'string' ? c.category : '']
      .filter(Boolean).join('/')
    const runtime = typeof c.runtime === 'string' ? ` · ${c.runtime}` : ''
    const desc = typeof c.description === 'string' ? c.description.replace(/\s+/g, ' ').trim() : ''
    const props = Array.isArray(c.props) && c.props.length ? ` (props: ${c.props.map(String).join(', ')})` : ''
    lines.push(`${c.tag}${where ? ` [${where}${runtime}]` : ''} — ${desc}${props}`)
  }
  const dieted = { ...obj, components: lines.join('\n') }
  const savedChars = JSON.stringify(obj).length - JSON.stringify(dieted).length
  return savedChars > 0 ? { value: dieted, savedChars } : null
}

/** The payload diet, dispatched by tool. Null = leave the result as JSON. */
function dietForTool(toolName: string | undefined, value: unknown): { value: Record<string, unknown>, savedChars: number } | null {
  switch (toolName) {
    case 'layout-snapshot': return dietLayoutResult(value)
    case 'grep': return dietGrepResult(value)
    case 'find-component': return dietFindComponentResult(value)
    default: return null
  }
}

export interface TrimStats { trimmed: number, savedChars: number, dieted?: number }
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

  // Fresh zone (results answering the newest calls): no folding —
  // but a fresh result with a uniform array still goes out in diet
  // form (layout elements, grep hits, catalog summaries).
  const dieted = next.map((msg, i) => {
    if (i <= lastCallIdx || !Array.isArray(msg.content)) return msg
    const parts = msg.content as LoosePart[]
    if (!parts.some(p => p.type === 'tool-result' && p.output)) return msg
    let touched = false
    const newParts = parts.map(p => {
      if (p.type !== 'tool-result' || !p.output) return p
      if (resultText(p.output).length <= DIET_MIN_CHARS) return p
      const out = dietForTool(p.toolName, p.output.value)
      if (!out) return p
      stats.dieted = (stats.dieted || 0) + 1
      stats.savedChars += out.savedChars
      touched = true
      return p.output.type === 'text'
        ? { ...p, output: { type: 'text', value: JSON.stringify(out.value) } }
        : { ...p, output: { type: 'json', value: out.value } }
    })
    return touched ? { ...msg, content: newParts } : msg
  })
  return { prompt: dieted as T, stats, changed: stats.trimmed > 0 || (stats.dieted || 0) > 0 }
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
      console.log(`[trim] folded ${stats.trimmed} tool result(s), dieted ${stats.dieted || 0} result(s), saved ~${stats.savedChars} chars this call`)
    }
    return { prompt: next as unknown as typeof prompt }
  }

  /** Required companion hook for LLM-request processors; trimming needs no response-side work. */
  async processLLMResponse(): Promise<void> {
    return undefined
  }
}

export const toolResultTrimProcessor = new ToolResultTrimProcessor()
