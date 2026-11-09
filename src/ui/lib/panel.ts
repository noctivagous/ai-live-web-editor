import { classifyTool, filesFromSteps, looksLikeKeyError, skillsOfTurn, type DeckTurn, type ToolGroup } from './deck.js'
import type { ToolStep } from './chatSession.js'

/**
 * Panel view derivation: compress a Deck turn into the stationary
 * instrument panel — phases, tool tiles, file states, gauges, one
 * attention slot and three summary slots. Pure functions only;
 * rendering lives in components/Panel.tsx. Nothing here invents data:
 * every indicator is derived from the turn's real cards and steps,
 * and a phase with no evidence in the turn reads as skipped, never
 * as done.
 */

export type PhaseId = 'understand' | 'plan' | 'edit' | 'verify' | 'done'
export type PhaseState = 'done' | 'active' | 'pending' | 'skipped' | 'error'

export interface PanelPhase { id: PhaseId, label: string, state: PhaseState }

export const PHASE_LABEL: Record<PhaseId, string> = {
  understand: 'Understand',
  plan: 'Plan',
  edit: 'Edit',
  verify: 'Verify',
  done: 'Done',
}

const PHASE_ORDER: PhaseId[] = ['understand', 'plan', 'edit', 'verify', 'done']

/** Panel tile groups: the Deck's tool groups, plus plan tools split out. */
export type TileGroup = ToolGroup | 'plan'

export interface PanelTile {
  group: TileGroup
  label: string
  count: number
  active: boolean
  error: boolean
}

const TILE_LABEL: Record<TileGroup, string> = {
  inspect: 'Inspect',
  plan: 'Plan',
  edit: 'Edit files',
  live: 'Live page',
  check: 'Test',
  other: 'Tools',
}

const TILE_ORDER: TileGroup[] = ['inspect', 'plan', 'edit', 'live', 'check', 'other']

export function tileGroup(step: ToolStep): TileGroup {
  if (step.name.startsWith('plan-')) return 'plan'
  return classifyTool(step.name)
}

/** Which phase a step's activity belongs to. */
function stepPhase(step: ToolStep): PhaseId {
  const g = tileGroup(step)
  if (g === 'inspect' || g === 'other') return 'understand'
  if (g === 'plan') return 'plan'
  if (g === 'edit' || g === 'live') return 'edit'
  return 'verify'
}

export type PanelFileState = 'reading' | 'editing' | 'edited' | 'read' | 'checked' | 'touched'
export interface PanelFile { path: string, state: PanelFileState }

export interface PanelState {
  /** One line: what is happening right now. Replaced, never appended. */
  now: string
  nowState: 'idle' | 'running' | 'done' | 'error'
  phases: PanelPhase[]
  tiles: PanelTile[]
  files: PanelFile[]
  /** Steps done / total for the turn (0 when the turn has no steps). */
  progress: { done: number, total: number, pct: number }
  checks: { passed: number, failed: number, running: number }
  tokens: number | null
  /** First line of the turn's error, or null when nothing needs the user. */
  attention: string | null
  attentionIsKeyError: boolean
  summary: { task: string, result: string, changes: string, skills: string }
}

function clip(text: string, max = 140): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : one.slice(0, max - 1) + '…'
}

function firstLine(text: string): string {
  return clip(text.split('\n').find(l => l.trim()) || '')
}

export function panelFileState(turn: DeckTurn): PanelFile[] {
  return turn.files.map(path => {
    let state: PanelFileState = 'touched'
    for (const step of turn.steps) {
      if (!filesFromSteps([step]).includes(path)) continue
      const g = tileGroup(step)
      if (g === 'edit' || g === 'live') state = step.status === 'running' ? 'editing' : 'edited'
      else if (g === 'check') state = 'checked'
      else if (g === 'inspect') state = step.status === 'running' ? 'reading' : (state === 'touched' ? 'read' : state)
    }
    return { path, state }
  })
}

export function derivePanel(turn: DeckTurn | null, opts: { sending?: boolean, workingLabel?: string } = {}): PanelState {
  const sending = Boolean(opts.sending)
  if (!turn || (turn.intent === null && turn.steps.length === 0 && turn.cards.length === 0)) {
    return {
      now: 'No task running',
      nowState: 'idle',
      phases: PHASE_ORDER.map(id => ({ id, label: PHASE_LABEL[id], state: 'pending' as PhaseState })),
      tiles: TILE_ORDER.map(g => ({ group: g, label: TILE_LABEL[g], count: 0, active: false, error: false })),
      files: [],
      progress: { done: 0, total: 0, pct: 0 },
      checks: { passed: 0, failed: 0, running: 0 },
      tokens: null,
      attention: null,
      attentionIsKeyError: false,
      summary: { task: '—', result: '—', changes: '—', skills: '—' },
    }
  }

  const steps = turn.steps
  const resultCard = turn.cards.find(c => c.kind === 'result')
  const errorCard = turn.cards.find(c => c.kind === 'error')
  const hasReasoning = turn.cards.some(c => c.kind === 'reasoning')

  const evidence: Record<PhaseId, boolean> = {
    understand: turn.intent !== null || steps.some(s => stepPhase(s) === 'understand'),
    plan: hasReasoning || steps.some(s => stepPhase(s) === 'plan'),
    edit: steps.some(s => stepPhase(s) === 'edit'),
    verify: steps.some(s => stepPhase(s) === 'verify'),
    done: Boolean(resultCard),
  }

  const checkSteps = steps.filter(s => tileGroup(s) === 'check')
  const checks = {
    passed: checkSteps.filter(s => s.status === 'done').length,
    failed: checkSteps.filter(s => s.status === 'error').length,
    running: checkSteps.filter(s => s.status === 'running').length,
  }

  // A step error mid-turn is not the end of the turn: the agent loops
  // back and keeps working (the Deck's turn status still flags the turn
  // 'error' the moment any step fails). The panel treats an error as
  // terminal only when nothing is running anymore — an error card, or a
  // failed step with no send in flight.
  const runningStep = [...steps].reverse().find(s => s.status === 'running')
  const isErrorTurn = Boolean(errorCard) || (!sending && !runningStep && steps.some(s => s.status === 'error'))

  // The phase the turn is in right now: the running step's phase, else
  // the last step's phase (so a failed check followed by more edits
  // reads as Edit again — the verify loop going around).
  const lastStep = steps[steps.length - 1]
  let current: PhaseId = 'understand'
  if (isErrorTurn) {
    const errStep = [...steps].reverse().find(s => s.status === 'error')
    current = errStep ? stepPhase(errStep) : 'understand'
  } else if (turn.status === 'done') {
    current = 'done'
  } else if (runningStep) {
    current = stepPhase(runningStep)
  } else if (resultCard && sending) {
    current = 'done'
  } else if (lastStep) {
    current = stepPhase(lastStep)
  } else if (hasReasoning) {
    current = 'plan'
  }

  const phases: PanelPhase[] = PHASE_ORDER.map(id => {
    let state: PhaseState
    if (turn.status === 'done' && !isErrorTurn) {
      state = evidence[id] ? 'done' : 'skipped'
      if (id === 'done') state = 'done'
    } else if (isErrorTurn) {
      if (id === current) state = 'error'
      else if (PHASE_ORDER.indexOf(id) < PHASE_ORDER.indexOf(current)) state = evidence[id] ? 'done' : 'skipped'
      else state = evidence[id] ? 'done' : 'pending'
    } else {
      // Running or pending: before current = done/skipped, current =
      // active, after = pending. A failed check keeps Verify in error
      // until a later check passes — the loop is visible, not hidden.
      if (id === 'verify' && checks.failed > 0 && current !== 'verify') state = 'error'
      else if (id === current) state = 'active'
      else if (PHASE_ORDER.indexOf(id) < PHASE_ORDER.indexOf(current)) state = evidence[id] ? 'done' : 'skipped'
      else state = 'pending'
    }
    return { id, label: PHASE_LABEL[id], state }
  })

  const tiles: PanelTile[] = TILE_ORDER.map(g => {
    const gs = steps.filter(s => tileGroup(s) === g)
    return {
      group: g,
      label: TILE_LABEL[g],
      count: gs.length,
      active: gs.some(s => s.status === 'running'),
      error: gs.some(s => s.status === 'error'),
    }
  })

  const files = panelFileState(turn)

  let now: string
  let nowState: PanelState['nowState']
  if (errorCard) {
    now = firstLine(errorCard.text)
    nowState = 'error'
  } else if (isErrorTurn) {
    const errStep = [...steps].reverse().find(s => s.status === 'error')
    now = errStep ? clip(`${errStep.name} failed`) : 'Turn failed'
    nowState = 'error'
  } else if (sending || turn.status === 'running') {
    now = runningStep ? clip(runningStep.detail || runningStep.name) : clip(opts.workingLabel || 'Working…')
    nowState = 'running'
  } else if (resultCard) {
    now = firstLine(resultCard.text)
    nowState = 'done'
  } else if (turn.intent) {
    now = 'Ready'
    nowState = 'idle'
  } else {
    now = 'No task running'
    nowState = 'idle'
  }

  const editedCount = files.filter(f => f.state === 'edited' || f.state === 'editing').length
  const changes = files.length
    ? `${files.length} file${files.length === 1 ? '' : 's'} touched${editedCount ? ` · ${editedCount} edited` : ''}${checkSteps.length ? ` · ${checks.passed}/${checkSteps.length} checks passed` : ''}`
    : '—'

  return {
    now,
    nowState,
    phases,
    tiles,
    files,
    progress: turn.progress,
    checks,
    tokens: turn.usage ? turn.usage.total : null,
    attention: errorCard ? firstLine(errorCard.text) : null,
    attentionIsKeyError: errorCard ? looksLikeKeyError(errorCard.text) : false,
    summary: {
      task: turn.intent ? clip(turn.intent, 120) : '—',
      result: resultCard ? firstLine(resultCard.text) : '—',
      changes,
      skills: skillsOfTurn(turn).map(s => s.name).join(' · ') || '—',
    },
  }
}

/** The turn the panel watches: the newest turn with anything in it. */
export function panelTurn(turns: DeckTurn[]): DeckTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.intent !== null || t.steps.length > 0 || t.cards.length > 0) return t
  }
  return null
}
