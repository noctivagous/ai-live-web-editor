import type { LogItem, ToolStep } from './chatSession.js'

/**
 * Deck grouping: turn the flat chat log into the Agentic Deck structure
 * (turns made of intent / reasoning / tool-group / result / error cards).
 * Pure functions only — rendering lives in components/Deck.tsx, and the
 * log persisted by chatSession.ts is unchanged apart from optional
 * startedAt/endedAt on tool steps.
 */

export type ToolGroup = 'inspect' | 'edit' | 'live' | 'other'

export const TOOL_GROUP_LABEL: Record<ToolGroup, string> = {
  inspect: 'Inspect',
  edit: 'Edit files',
  live: 'Live page',
  other: 'Tools',
}

const INSPECT_TOOLS = new Set([
  'list-real-files', 'read-real-file', 'grep',
  'inspect-dom', 'take-snapshot', 'layout-snapshot', 'layout-svg', 'pool-open',
])
const EDIT_TOOLS = new Set(['str-replace', 'write-real-file', 'writeRealFileTool'])
const LIVE_TOOLS = new Set(['patch-dom', 'eval-js'])

export function classifyTool(name: string): ToolGroup {
  if (INSPECT_TOOLS.has(name)) return 'inspect'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (LIVE_TOOLS.has(name)) return 'live'
  return 'other'
}

export type DeckCard =
  | { kind: 'intent', text: string }
  | { kind: 'reasoning', text: string }
  | { kind: 'tools', group: ToolGroup, steps: ToolStep[] }
  | { kind: 'result', text: string }
  | { kind: 'error', text: string }
  | { kind: 'system', text: string }

export type TurnStatus = 'done' | 'running' | 'error' | 'pending'

export interface DeckTurn {
  /** 0-based position in the log's turn sequence (preamble included). */
  index: number
  /** The user's ask, or null for the preamble before the first ask. */
  intent: string | null
  cards: DeckCard[]
  steps: ToolStep[]
  status: TurnStatus
  /** Tool steps finished / total, and the same as a 0–100 percentage. */
  progress: { done: number, total: number, pct: number }
  /** File paths the agent touched in this turn, in first-seen order. */
  files: string[]
}

const FILE_RE = /(?:^|[\s"'(])(\/[^\s"'()]+\.[A-Za-z0-9]+)/g

export function filesFromSteps(steps: ToolStep[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of steps) {
    for (const text of [s.detail, s.result || '']) {
      FILE_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = FILE_RE.exec(text)) !== null) {
        const p = m[1]
        if (!seen.has(p)) { seen.add(p); out.push(p) }
      }
    }
  }
  return out
}

/** All files touched anywhere in the log, in first-seen order. */
export function workingSet(log: LogItem[]): string[] {
  const steps: ToolStep[] = []
  for (const item of log) if (item.role === 'tools') steps.push(...item.steps)
  return filesFromSteps(steps)
}

function turnStatus(cards: DeckCard[], steps: ToolStep[], isLast: boolean, sending: boolean): TurnStatus {
  if (cards.some(c => c.kind === 'error') || steps.some(s => s.status === 'error')) return 'error'
  if (steps.some(s => s.status === 'running')) return 'running'
  if (sending && isLast) return 'running'
  if (cards.some(c => c.kind === 'result') || (steps.length > 0 && steps.every(s => s.status === 'done'))) return 'done'
  return 'pending'
}

export function groupTurns(log: LogItem[], opts: { sending?: boolean } = {}): DeckTurn[] {
  const sending = Boolean(opts.sending)
  const raw: { intent: string | null, cards: DeckCard[], steps: ToolStep[] }[] = []
  let cur: { intent: string | null, cards: DeckCard[], steps: ToolStep[] } | null = null

  const ensure = () => {
    if (!cur) { cur = { intent: null, cards: [], steps: [] }; raw.push(cur) }
    return cur
  }
  const pushTools = (steps: ToolStep[]) => {
    const turn = ensure()
    turn.steps.push(...steps)
    // Group consecutive steps of the same class into one card, keeping order:
    // an inspect → edit → inspect sequence stays three cards, not two.
    for (const step of steps) {
      const group = classifyTool(step.name)
      const last = turn.cards[turn.cards.length - 1]
      if (last && last.kind === 'tools' && last.group === group) last.steps.push(step)
      else turn.cards.push({ kind: 'tools', group, steps: [step] })
    }
  }

  for (const item of log) {
    if (item.role === 'user') {
      cur = { intent: item.text, cards: [{ kind: 'intent', text: item.text }], steps: [] }
      raw.push(cur)
    } else if (item.role === 'tools') {
      pushTools(item.steps)
    } else if (item.role === 'think') {
      ensure().cards.push({ kind: 'reasoning', text: item.text })
    } else if (item.role === 'ai') {
      ensure().cards.push({ kind: 'result', text: item.text })
    } else if (item.role === 'error') {
      ensure().cards.push({ kind: 'error', text: item.text })
    } else {
      ensure().cards.push({ kind: 'system', text: item.text })
    }
  }

  return raw.map((t, i) => {
    const total = t.steps.length
    const done = t.steps.filter(s => s.status === 'done').length
    return {
      index: i,
      intent: t.intent,
      cards: t.cards,
      steps: t.steps,
      status: turnStatus(t.cards, t.steps, i === raw.length - 1, sending),
      progress: { done, total, pct: total ? Math.round((done / total) * 100) : (t.cards.some(c => c.kind === 'result') ? 100 : 0) },
      files: filesFromSteps(t.steps),
    }
  })
}

/** Turns worth a slide in Deck mode: a real ask, or any tools/result. */
export function slideTurns(turns: DeckTurn[]): DeckTurn[] {
  return turns.filter(t => t.intent !== null || t.steps.length > 0 || t.cards.some(c => c.kind === 'result'))
}

/** Deck never opens empty: fall back to a default-message slide. */
export function slideTurnsOrDefault(turns: DeckTurn[], defaultText: string): DeckTurn[] {
  const slides = slideTurns(turns)
  if (slides.length) return slides
  return [{
    index: 0,
    intent: null,
    cards: [{ kind: 'system', text: defaultText }],
    steps: [],
    status: 'pending',
    progress: { done: 0, total: 0, pct: 0 },
    files: [],
  }]
}

/** Split card indices into slides that fit `capacity` px: as soon as an item
 * would overflow, a new slide starts. An oversize single item keeps its own
 * slide (the slide scrolls it internally as a fallback). */
export function packHeights(heights: number[], capacity: number): number[][] {
  const slides: number[][] = []
  let cur: number[] = []
  let used = 0
  for (let i = 0; i < heights.length; i++) {
    const h = Math.max(0, heights[i])
    if (cur.length && used + h > capacity) {
      slides.push(cur)
      cur = []
      used = 0
    }
    cur.push(i)
    used += h
  }
  if (cur.length) slides.push(cur)
  return slides
}

/** Short slide title: the ask, clipped; a fallback for intent-less turns. */
export function turnTitle(turn: DeckTurn, max = 64): string {
  const text = (turn.intent || 'Session').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

export function formatElapsed(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function looksLikeKeyError(text: string): boolean {
  return /api.?key|401|unauthorized|invalid_api_key|incorrect api key/i.test(text)
}

export function stepElapsed(step: ToolStep): string {
  if (step.startedAt == null) return ''
  const end = step.endedAt ?? (step.status === 'running' ? Date.now() : step.startedAt)
  return formatElapsed(end - step.startedAt)
}
