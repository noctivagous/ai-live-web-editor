import React from 'react'
import { Coins, Eraser, Folder, Gauge, Layers, MessageSquarePlus, Monitor, MousePointerClick, PenTool, Pin, Search, SendHorizontal, Smartphone, Square, StickyNote, Tablet, Waves } from 'lucide-react'
import type { ChatViewPref } from '../lib/uiPrefs'
import type { ChatWorkflow, DeviceTarget, SearchBackendId, SearchOption, SelfCheck, WorkflowSnapshot } from '../lib/api'
import type { AnnotationDigest } from '../lib/annotationSync'
import { ButtonGrid } from './ButtonGrid'
import { abbreviateSelector, elementToken, noteToken } from '../lib/annotateChips'
import { fmtTokens } from '../lib/deck'

/** Header bar shared by the single-pane chat and Deck mode. */
export function ChatHeader({ workflow, deviceTarget, selfMode, selfCheck, searchBackend, searchOptions, plan, onOpenPlan, sending, workingLabel, showDeckButton, tokenTotal, onWorkflowMode, onDeviceTarget, onSearchBackend, onClear, onOpenDeck, chatView, onChatView }: {
  workflow: ChatWorkflow
  deviceTarget: DeviceTarget
  /** Self mode (§L): the workspace is this editor itself. */
  selfMode?: boolean
  selfCheck?: SelfCheck | null
  /** Web search (§N): resolved backend + available options. */
  searchBackend?: SearchBackendId
  searchOptions?: SearchOption[]
  /** Planning (§O): the active plan's summary; click reopens the overlay. */
  plan?: WorkflowSnapshot['plan']
  onOpenPlan?: () => void
  sending: boolean
  workingLabel: string
  showDeckButton: boolean
  tokenTotal: number | null
  onWorkflowMode: (mode: ChatWorkflow) => void
  onDeviceTarget: (target: DeviceTarget) => void
  onSearchBackend?: (backend: SearchBackendId) => void
  onClear: () => void
  onOpenDeck: () => void
  /** Chat presentation: Stream (scrolling), Panel (indicators) or
   * Stationary (pinned latest message + activity columns). */
  chatView?: ChatViewPref
  onChatView?: (view: ChatViewPref) => void
}) {
  const availableSearch = (searchOptions || []).filter(o => o.available)
  return (
    <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 'calc(12px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
      AI Chat
      <div className="seg" role="group" aria-label="Chat workflow">
        <button type="button" className={workflow === 'files' ? 'on' : ''} disabled={sending} onClick={() => onWorkflowMode('files')}><Folder size={12} />Files</button>
        <button type="button" className={workflow === 'sketch' ? 'on' : ''} disabled={sending} onClick={() => onWorkflowMode('sketch')}><PenTool size={12} />Live sketch</button>
      </div>
      <div className="seg" role="group" aria-label="Device target" title="Device target: the design surface. The app must still work at every declared target.">
        <button type="button" className={deviceTarget === 'phone' ? 'on' : ''} disabled={sending} onClick={() => onDeviceTarget('phone')} title="Phone (375px)"><Smartphone size={13} /></button>
        <button type="button" className={deviceTarget === 'tablet' ? 'on' : ''} disabled={sending} onClick={() => onDeviceTarget('tablet')} title="Tablet (768px)"><Tablet size={13} /></button>
        <button type="button" className={deviceTarget === 'desktop' ? 'on' : ''} disabled={sending} onClick={() => onDeviceTarget('desktop')} title="Desktop (1280px)"><Monitor size={13} /></button>
      </div>
      {availableSearch.length > 0 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Web search source for the agent's web-search and research tools">
          <Search size={13} />
          <select
            className="deck-select"
            style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', padding: '2px 6px' }}
            value={searchBackend || 'off'}
            disabled={sending}
            onChange={e => onSearchBackend?.(e.target.value as SearchBackendId)}
            aria-label="Web search source"
          >
            {availableSearch.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            <option value="off">Search off</option>
          </select>
        </label>
      )}
      {plan && (
        <button type="button" className="pill" onClick={onOpenPlan}
          title={`Active plan: ${plan.title} (${plan.status}). Reopen the planner.`}
          style={{ cursor: 'pointer', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Plan · {plan.title} · {plan.status}
        </button>
      )}
      {selfMode && (
        <span className="pill warn" title="Self mode: the workspace is this editor's own repo, served from source. Writes are confined to src/ui. Recovery: /self-recovery">
          SELF — editing this editor
          {selfCheck?.running
            ? ' · checks…'
            : selfCheck
              ? ` · tsc ${selfCheck.tscOk ? '✓' : '✗'} tests ${selfCheck.testsOk ? '✓' : '✗'}`
              : ''}
        </span>
      )}
      <span className="pill mono" title={tokenTotal != null ? 'Total tokens used in this chat across all turns' : 'No token usage reported yet'} style={{ marginLeft: 'auto' }}><Coins size={12} />{tokenTotal != null ? fmtTokens(tokenTotal) : '—'}</span>
      <ButtonGrid style={{ flex: '1 1 240px' }}>
      <button type="button" className="deck-btn btn-icon" disabled={sending} onClick={onClear} title="Clear this chat" style={{ padding: '4px 8px' }}><Eraser size={12} />Clear</button>
      {showDeckButton && (
        <button type="button" className="deck-btn btn-icon" onClick={onOpenDeck} title="Open Deck mode — turns as horizontal slides (← → navigate, O overview)" style={{ padding: '4px 8px' }}><Layers size={12} />Deck</button>
      )}
      {onChatView && (
        <>
          <button type="button" className={`deck-btn btn-icon${chatView === 'stationary' ? ' on' : ''}`} onClick={() => onChatView('stationary')} title="Stationary view — the latest message stays pinned at the top, activity in fixed columns below, fades instead of scrolling" style={{ padding: '4px 8px' }} aria-pressed={chatView === 'stationary'}><Pin size={12} />Stationary</button>
          <button type="button" className={`deck-btn btn-icon${chatView === 'chat' ? ' on' : ''}`} onClick={() => onChatView('chat')} title="Stream view — the chat as a scrolling stream of messages" style={{ padding: '4px 8px' }} aria-pressed={chatView === 'chat'}><Waves size={12} />Stream</button>
          <button type="button" className={`deck-btn btn-icon${chatView === 'panel' ? ' on' : ''}`} onClick={() => onChatView('panel')} title="Panel view — stationary indicators instead of text" style={{ padding: '4px 8px' }} aria-pressed={chatView === 'panel'}><Gauge size={12} />Panel</button>
        </>
      )}
      </ButtonGrid>
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
export function ChatComposer({ input, sending, workflow, annot, inIframe, onInput, onSend, onStop, onPick, onSubmit, onInsertToken, onHighlightChip }: {
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
  onHighlightChip?: (selector: string | null) => void
}) {
  return (
    <>
      <div className="ws-chips" title="Page annotations from the live page — click a chip to insert it">
        <span className="ws-label">Annotate</span>
        {inIframe && (
          <button type="button" className="deck-btn btn-icon" style={{ padding: '2px 8px', fontSize: 'calc(11px * var(--ui-scale, 1))' }} disabled={sending} onClick={onPick} title="Pick an element on the live page">
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
            onMouseEnter={() => { if (a.selector) onHighlightChip?.(a.selector) }}
            onMouseLeave={() => { if (a.selector) onHighlightChip?.(null) }}
            title={`${a.selector}${a.component ? ` <${a.component}>` : ''}${a.text ? ` — ${a.text}` : ''}`}
          ><StickyNote size={12} style={{ flexShrink: 0 }} />{a.abbr || abbreviateSelector(a.selector)}{a.component ? ` · ${a.component}` : ''}</button>
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
          <button type="button" className="deck-btn primary btn-icon" style={{ padding: '2px 8px', fontSize: 'calc(11px * var(--ui-scale, 1))' }} disabled={sending} onClick={onSubmit} title="Send page notes to the AI">
            <MessageSquarePlus size={12} />Submit
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--border-soft)', flexShrink: 0 }}>
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
    </>
  )
}
