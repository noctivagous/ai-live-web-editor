import { classifyTool, TOOL_GROUP_LABEL, type DeckCard, type DeckTurn, type ToolGroup } from './deck.js'
import type { ToolStep } from './chatSession.js'

/**
 * Stationary view derivation — a pure read over deck.ts groupTurns
 * output, like panel.ts. The view's shape:
 *
 *   pinned    the ONE message that holds the top edge of the chat.
 *             While a turn runs it is the latest text segment, an
 *             interim WORKING NOTE; when the turn completes, its
 *             last result becomes the FINAL REPORT and stays
 *             pinned. A terminal error pins instead.
 *   notes     the current turn's earlier segments, in order —
 *             working notes (and reasoning), numbered as the
 *             prototype numbered them ("Working note 2 of 7").
 *   activity  the current turn's tool steps grouped by the Deck
 *             categories (Inspect / Edit files / Live page / Test /
 *             Tools), every category present, counts per column.
 *   earlier   everything from previous turns, newest turn first:
 *             each contributes its intent, its working notes and
 *             its final report, so nothing is lost by pinning.
 */

export type PinnedKind = 'working' | 'final' | 'error'
export interface PinnedMessage {
  kind: PinnedKind
  text: string
  reasoning: boolean
  turnIndex: number
  /** Stable per segment (turn + card index), NOT per text: the
   * view keys the pinned card by it so streaming deltas update the
   * card in place while a genuinely new segment remounts and plays
   * the fade transition. */
  key: string
}

export interface StationaryNote {
  text: string
  reasoning: boolean
  /** 1-based position among the current turn's working notes. */
  n?: number
  /** Total working notes in the current turn (for "n of total"). */
  total?: number
}

export type EarlierKind = 'intent' | 'working' | 'final' | 'error' | 'system'
export interface EarlierEntry {
  kind: EarlierKind
  text: string
  reasoning: boolean
  turnIndex: number
}

export interface ActivityColumn {
  group: ToolGroup
  label: string
  steps: ToolStep[]
  done: number
  errors: number
  total: number
}

export interface StationaryModel {
  /** The current (last) turn's intent, shown as the pinned card's context line. */
  intent: string | null
  pinned: PinnedMessage | null
  notes: StationaryNote[]
  activity: ActivityColumn[]
  activityTotals: { total: number, done: number, errors: number, running: boolean }
  earlier: EarlierEntry[]
  /** True while the current turn is still in flight. */
  live: boolean
}

export const ACTIVITY_GROUP_ORDER: ToolGroup[] = ['inspect', 'edit', 'live', 'check', 'other']

type Segment = { text: string, reasoning: boolean, cardIndex: number }

function segmentsOf(turn: DeckTurn): Segment[] {
  const out: Segment[] = []
  turn.cards.forEach((card: DeckCard, cardIndex) => {
    if (card.kind === 'result') out.push({ text: card.text, reasoning: false, cardIndex })
    else if (card.kind === 'reasoning') out.push({ text: card.text, reasoning: true, cardIndex })
  })
  return out
}

function lastResultOf(turn: DeckTurn): Segment | null {
  const segs = segmentsOf(turn).filter(s => !s.reasoning)
  return segs.length ? segs[segs.length - 1] : null
}

function earlierOfTurn(turn: DeckTurn): EarlierEntry[] {
  const out: EarlierEntry[] = []
  const final = lastResultOf(turn)
  turn.cards.forEach((card: DeckCard, cardIndex) => {
    if (card.kind === 'intent') out.push({ kind: 'intent', text: card.text, reasoning: false, turnIndex: turn.index })
    else if (card.kind === 'result') out.push({ kind: final && cardIndex === final.cardIndex ? 'final' : 'working', text: card.text, reasoning: false, turnIndex: turn.index })
    else if (card.kind === 'reasoning') out.push({ kind: 'working', text: card.text, reasoning: true, turnIndex: turn.index })
    else if (card.kind === 'error') out.push({ kind: 'error', text: card.text, reasoning: false, turnIndex: turn.index })
    else if (card.kind === 'system') out.push({ kind: 'system', text: card.text, reasoning: false, turnIndex: turn.index })
  })
  return out
}

export function deriveStationary(turns: DeckTurn[], opts: { sending?: boolean } = {}): StationaryModel {
  const activity: ActivityColumn[] = ACTIVITY_GROUP_ORDER.map(group => ({
    group, label: TOOL_GROUP_LABEL[group], steps: [], done: 0, errors: 0, total: 0,
  }))
  const empty: StationaryModel = {
    intent: null, pinned: null, notes: [], activity,
    activityTotals: { total: 0, done: 0, errors: 0, running: false },
    earlier: [], live: false,
  }
  const current = turns[turns.length - 1]
  if (!current) return empty

  const live = Boolean(opts.sending) || current.status === 'running' || current.status === 'pending'
  const segs = segmentsOf(current)
  const errorCard = [...current.cards].reverse().find(c => c.kind === 'error')

  let pinned: PinnedMessage | null = null
  let noteSegs: Segment[] = []
  if (!live && current.status === 'error' && errorCard && errorCard.kind === 'error') {
    pinned = { kind: 'error', text: errorCard.text, reasoning: false, turnIndex: current.index, key: `${current.index}:error` }
    noteSegs = segs
  } else if (live) {
    const last = segs[segs.length - 1]
    if (last) {
      pinned = { kind: 'working', text: last.text, reasoning: last.reasoning, turnIndex: current.index, key: `${current.index}:${last.cardIndex}` }
      noteSegs = segs.slice(0, -1)
    }
  } else {
    const final = lastResultOf(current)
    if (final) {
      pinned = { kind: 'final', text: final.text, reasoning: false, turnIndex: current.index, key: `${current.index}:${final.cardIndex}` }
      noteSegs = segs.filter(s => s.cardIndex !== final.cardIndex)
    } else {
      noteSegs = segs
    }
  }
  const notes: StationaryNote[] = noteSegs.map((s, i) => ({
    text: s.text, reasoning: s.reasoning, n: i + 1, total: noteSegs.length,
  }))

  for (const step of current.steps) {
    const col = activity[ACTIVITY_GROUP_ORDER.indexOf(classifyTool(step.name))]
    col.steps.push(step)
    col.total += 1
    if (step.status === 'done') col.done += 1
    if (step.status === 'error') col.errors += 1
  }
  const activityTotals = {
    total: current.steps.length,
    done: current.steps.filter(s => s.status === 'done').length,
    errors: current.steps.filter(s => s.status === 'error').length,
    running: current.steps.some(s => s.status === 'running'),
  }

  const earlier: EarlierEntry[] = []
  for (let i = turns.length - 2; i >= 0; i--) earlier.push(...earlierOfTurn(turns[i]))

  return { intent: current.intent, pinned, notes, activity, activityTotals, earlier, live }
}
