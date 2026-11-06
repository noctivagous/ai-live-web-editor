import React from 'react'
import { MessageSquarePlus, MousePointerClick, SendHorizontal, Square } from 'lucide-react'
import type { ChatWorkflow, WorkflowSnapshot } from '../lib/api'
import type { AnnotationDigest } from '../lib/annotationSync'
import { abbreviateSelector, elementToken, noteToken } from '../lib/annotateChips'

/** Header bar shared by the single-pane chat and Deck mode. */
export function ChatHeader({ workflow, sending, workingLabel, showDeckButton, onWorkflowMode, onClear, onOpenDeck }: {
  workflow: ChatWorkflow
  sending: boolean
  workingLabel: string
  showDeckButton: boolean
  onWorkflowMode: (mode: ChatWorkflow) => void
  onClear: () => void
  onOpenDeck: () => void
}) {
  return (
    <div style={{ padding: '9px 12px', borderBottom: '1px solid #1e1e23', fontSize: 12, fontWeight: 600, color: '#d4d4d8', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
      AI Chat <span style={{ fontWeight: 400, color: '#71717a' }}>· Mastra</span>
      <div className="seg" role="group" aria-label="Chat workflow">
        <button type="button" className={workflow === 'files' ? 'on' : ''} disabled={sending} onClick={() => onWorkflowMode('files')}>Files</button>
        <button type="button" className={workflow === 'sketch' ? 'on' : ''} disabled={sending} onClick={() => onWorkflowMode('sketch')}>Live sketch</button>
      </div>
      <button type="button" className="deck-btn" disabled={sending} onClick={onClear} title="Clear this chat" style={{ marginLeft: 'auto', padding: '4px 8px' }}>Clear</button>
      {showDeckButton && (
        <button type="button" className="deck-btn" onClick={onOpenDeck} title="Open Deck mode — turns as horizontal slides (← → navigate, O overview)" style={{ padding: '4px 8px' }}>Deck ⤢</button>
      )}
      {sending && (
        <span className="pill warn" style={{ maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span className="dot" />{workingLabel || 'working'}
        </span>
      )}
    </div>
  )
}

/** Live-sketch banner + patch list + actions. Renders nothing outside sketch mode. */
export function SketchPanel({ workflow, sketch, sending, onSketchAction }: {
  workflow: ChatWorkflow
  sketch: WorkflowSnapshot | null
  sending: boolean
  onSketchAction: (action: 'undo' | 'discard' | 'accept') => void
}) {
  if (workflow !== 'sketch') return null
  return (
    <div className="sketch-panel">
      <div className="sketch-banner">Disk writes paused. Patches stay on the page until Discard or HMR.</div>
      {(sketch?.patches || []).map(p => (
        <div key={p.id} className="sketch-patch">{p.detail || `${p.op} ${p.selector}`}</div>
      ))}
      <div className="sketch-actions">
        <button type="button" className="deck-btn" disabled={!sketch?.patches?.length || sending} onClick={() => onSketchAction('undo')}>Undo last</button>
        <button type="button" className="deck-btn" disabled={!sketch?.patches?.length || sending} onClick={() => onSketchAction('discard')}>Discard</button>
        <button type="button" className="deck-btn primary" disabled={!sketch?.patches?.length || sending} onClick={() => onSketchAction('accept')}>Accept (keep on page)</button>
      </div>
    </div>
  )
}

/** Composer shared by the pane and the deck: input row + annotation chips. */
export function ChatComposer({ input, sending, workflow, annot, inIframe, onInput, onSend, onStop, onPick, onSubmit, onInsertToken }: {
  input: string
  sending: boolean
  workflow: ChatWorkflow
  annot: AnnotationDigest
  inIframe: boolean
  onInput: (value: string) => void
  onSend: () => void
  onStop: () => void
  onPick: () => void
  onSubmit: () => void
  onInsertToken: (token: string) => void
}) {
  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid #1e1e23', flexShrink: 0 }}>
        <input
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && sending) {
              e.preventDefault()
              onStop()
              return
            }
            if (e.key === 'Enter' && !sending) onSend()
          }}
          placeholder={workflow === 'sketch' ? 'Patch the live page…' : 'Ask AI to edit files...'}
          className="deck-input"
          style={{ flex: 1 }}
        />
        {sending ? (
          <button type="button" onClick={onStop} className="deck-btn danger btn-icon" title="Stop this turn (Esc)">
            <Square size={12} />Stop
          </button>
        ) : (
          <button type="button" onClick={onSend} className="deck-btn btn-icon">
            <SendHorizontal size={13} />Send
          </button>
        )}
      </div>
      <div className="ws-chips" title="Page annotations from the live page — click a chip to insert it">
        <span className="ws-label">Annotate</span>
        {inIframe && (
          <button type="button" className="deck-btn btn-icon" style={{ padding: '2px 8px', fontSize: 11 }} disabled={sending} onClick={onPick} title="Pick an element on the live page">
            <MousePointerClick size={12} />Pick
          </button>
        )}
        {annot.selection && (
          <button
            type="button"
            className="ws-chip mono"
            onClick={() => onInsertToken(elementToken(annot.selection || ''))}
            title={`Insert ${annot.selection}`}
          >@{abbreviateSelector(annot.selection)}</button>
        )}
        {annot.annotations.map(a => (
          <button
            type="button"
            key={a.id || `${a.selector}-${a.text}`}
            className="ws-chip"
            onClick={() => onInsertToken(noteToken(a.text || a.selector))}
            title={`${a.selector}${a.text ? ` — ${a.text}` : ''}`}
          >{a.abbr || abbreviateSelector(a.selector)}</button>
        ))}
        {annot.pageNote.present && (
          <button
            type="button"
            className="ws-chip"
            onClick={() => onInsertToken(noteToken(annot.pageNote.abbr))}
            title={`Page note (${annot.pageNote.len} chars) — inserts the visible summary`}
          >note: {annot.pageNote.abbr || `${annot.pageNote.len} chars`}</button>
        )}
        {!annot.selection && !annot.annotations.length && !annot.pageNote.present && (
          <span className="field-hint" style={{ marginTop: 0 }}>
            {inIframe ? 'Pick an element on the live page to attach notes.' : 'Annotate on the live page — chips appear here.'}
          </span>
        )}
        {inIframe && (annot.selection || annot.annotations.length || annot.pageNote.present) && (
          <button type="button" className="deck-btn primary btn-icon" style={{ padding: '2px 8px', fontSize: 11 }} disabled={sending} onClick={onSubmit} title="Send page notes to the AI">
            <MessageSquarePlus size={12} />Submit
          </button>
        )}
      </div>
    </>
  )
}
