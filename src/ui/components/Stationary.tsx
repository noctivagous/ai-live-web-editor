import React from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { formatElapsed, type DeckTurn } from '../lib/deck'
import { deriveStationary, type EarlierEntry, type StationaryNote } from '../lib/stationary'
import type { ToolStep } from '../lib/chatSession'
import { Markdown } from './Markdown'

/* Stationary view: the chat with fixed homes instead of a scroll.
   The latest message holds the top edge of the pane — a WORKING
   NOTE while the turn runs (interim text, replaced as the work
   proceeds), the FINAL REPORT once it completes. Directly beneath
   it, the Activity section: the turn's tool steps in one column
   per Deck category, updating in place, columns reflowing with
   the pane width. Everything earlier fades into a quiet stack
   below. Header and composer are the chat's own (chatChrome.tsx);
   only the middle changes. Data: lib/stationary.ts over the real
   grouped turns — no separate source. */

function StepGlyph({ step }: { step: ToolStep }) {
  if (step.status === 'running') return <Loader2 size={11} aria-hidden className="st-spin" />
  if (step.status === 'error') return <X size={11} aria-hidden />
  return <Check size={11} aria-hidden />
}

function stepElapsed(step: ToolStep): string {
  if (step.startedAt == null || step.endedAt == null) return ''
  return formatElapsed(step.endedAt - step.startedAt)
}

const EARLIER_LABEL: Record<EarlierEntry['kind'], string> = {
  intent: 'You',
  working: 'Working note',
  final: 'Final report',
  error: 'Error',
  system: 'Note',
}

export function StationaryView({ turns, sending, workingLabel }: {
  turns: DeckTurn[]
  sending: boolean
  workingLabel: string
}) {
  const m = deriveStationary(turns, { sending })
  const t = m.activityTotals

  const earlierCount = m.notes.length + m.earlier.length
  const fadeFor = (i: number) => Math.max(0.45, 0.92 - i * 0.06)

  return (
    <div className="statview" aria-label="Stationary view">
      {m.intent !== null && (
        <div className="st-intent" title={m.intent}><span className="st-intent-label">You</span>{m.intent}</div>
      )}

      {m.pinned ? (
        <div key={m.pinned.key} className={`st-pin ${m.pinned.kind}`}>
          <div className="st-pin-head">
            {m.pinned.kind === 'final' && <span className="st-tag final">Final report</span>}
            {m.pinned.kind === 'error' && <span className="st-tag error">Error</span>}
            {m.pinned.kind === 'working' && (
              <span className="st-tag working">{m.pinned.reasoning ? 'Reasoning' : 'Working note'}</span>
            )}
            {m.live && <Loader2 size={11} aria-hidden className="st-spin" />}
          </div>
          {m.pinned.kind === 'error' ? (
            <pre className="st-pin-text">{m.pinned.text}</pre>
          ) : (
            <div className="st-pin-text"><Markdown text={m.pinned.text} /></div>
          )}
          {m.pinned.kind === 'working' && (
            <div className="st-pin-sub">Interim — this note is replaced as the work proceeds. The final report takes this place when the turn finishes.</div>
          )}
        </div>
      ) : (
        <div className="st-pin working">
          <div className="st-pin-head"><span className="st-tag working">Working</span>{sending && <Loader2 size={11} aria-hidden className="st-spin" />}</div>
          <pre className="st-pin-text">{turns.length === 0 ? 'No messages yet — ask for something below.' : (workingLabel || 'starting…')}</pre>
        </div>
      )}

      <div className="st-act" aria-label="Activity">
        <div className="st-act-head">
          <span className="st-act-title">Activity</span>
          <span className="st-act-count">
            {t.total > 0 ? `${t.total} steps · ${t.done} done` : 'No steps yet'}
            {t.errors > 0 ? ` · ${t.errors} failed` : ''}
            {t.running ? ' · running' : ''}
          </span>
        </div>
        <div className="st-act-grid">
          {m.activity.map(col => (
            <div key={col.group} className={`st-col${col.steps.some(s => s.status === 'running') ? ' active' : ''}${col.errors > 0 ? ' error' : ''}`}>
              <div className="st-col-head"><span>{col.label}</span><span className="st-col-count">{col.done}/{col.total}</span></div>
              {col.steps.length === 0 ? (
                <div className="st-col-empty">—</div>
              ) : col.steps.map(step => (
                <div key={step.id} className={`st-step ${step.status}`} title={step.result || step.detail}>
                  <span className="st-step-glyph"><StepGlyph step={step} /></span>
                  <span className="st-step-name">{step.name}</span>
                  <span className="st-step-detail">{step.detail}</span>
                  <span className="st-step-ms">{stepElapsed(step)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {earlierCount > 0 && (
        <div className="st-earlier" aria-label="Earlier in this chat">
          {m.notes.map((n: StationaryNote, i: number) => (
            <div key={`note-${i}`} className="st-old" style={{ opacity: fadeFor(i) }}>
              <span className="st-old-label">{n.reasoning ? 'Reasoning' : `Working note ${n.n} of ${n.total}`}</span>
              <div className="st-old-text"><Markdown text={n.text} /></div>
            </div>
          ))}
          {m.earlier.map((e: EarlierEntry, j: number) => (
            <div key={`earlier-${e.turnIndex}-${j}`} className="st-old" style={{ opacity: fadeFor(m.notes.length + j) }}>
              <span className={`st-old-label ${e.kind}`}>{e.kind === 'working' && e.reasoning ? 'Reasoning' : EARLIER_LABEL[e.kind]}</span>
              {(e.kind === 'working' || e.kind === 'final') ? (
                <div className="st-old-text"><Markdown text={e.text} /></div>
              ) : (
                <pre className="st-old-text">{e.text}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
