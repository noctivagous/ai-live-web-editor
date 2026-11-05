import React, { useEffect, useRef, useState } from 'react'
import type { ToolStep } from '../lib/chatSession'
import {
  TOOL_GROUP_LABEL, formatElapsed, looksLikeKeyError, stepElapsed, turnTitle,
  type DeckCard, type DeckTurn,
} from '../lib/deck'

/* Deck rendering, ported from web-artifacts/agentic-chat-deck_* (v2):
   intent / reasoning / tool / result cards, a turn strip, and the expanded
   horizontal Deck mode with timeline, overview, Live pill and keyboard nav.
   Data comes from lib/deck.ts grouping of the real chat log — no mock data. */

function StatusGlyph({ status }: { status: ToolStep['status'] | DeckTurn['status'] }) {
  if (status === 'done') return <span className="step-glyph done">✓</span>
  if (status === 'error') return <span className="step-glyph error">✕</span>
  if (status === 'running') return <span className="step-glyph running">…</span>
  return <span className="step-glyph pending">○</span>
}

function StepRow({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false)
  const hasResult = Boolean(step.result && step.result !== step.detail)
  const elapsed = stepElapsed(step)
  return (
    <div className={`step-row ${step.status}`}>
      <button
        type="button"
        className="step-head"
        onClick={() => hasResult && setOpen(o => !o)}
        title={hasResult ? (open ? 'Hide result' : 'Show result') : step.detail}
      >
        <StatusGlyph status={step.status} />
        <span className="tool-pill">{step.name}</span>
        <span className="step-detail">{step.detail}</span>
        {elapsed && <span className="step-time">{elapsed}</span>}
        {hasResult && <span className="step-chev">{open ? '▾' : '▸'}</span>}
      </button>
      {open && hasResult && <div className="step-result">{step.result}</div>}
    </div>
  )
}

export function DeckCardView({ card, onNeedSetup, embed }: {
  card: DeckCard
  onNeedSetup: () => void
  embed?: boolean
}) {
  const [open, setOpen] = useState(false)
  switch (card.kind) {
    case 'intent':
      return (
        <div className="dcard dcard-intent">
          <div className="dcard-label">Intent</div>
          <div className="dcard-intent-text">{card.text}</div>
        </div>
      )
    case 'reasoning':
      return (
        <div className="dcard dcard-reason">
          <button type="button" className="dcard-toggle" onClick={() => setOpen(o => !o)}>
            <span className="dcard-label" style={{ margin: 0 }}>Reasoning</span>
            <span className="step-chev">{open ? '▾' : '▸'}</span>
          </button>
          {open && <pre className="dcard-pre">{card.text.slice(0, 4000)}</pre>}
        </div>
      )
    case 'tools':
      return (
        <div className="dcard dcard-tools">
          <div className="dcard-label">{TOOL_GROUP_LABEL[card.group]} <span className="dcard-count">{card.steps.length}</span></div>
          <div className="step-list">
            {card.steps.map(s => <StepRow key={s.id} step={s} />)}
          </div>
        </div>
      )
    case 'result':
      return (
        <div className="dcard dcard-result">
          <div className="dcard-label">Result</div>
          <pre className="dcard-pre plain">{card.text.slice(0, 8000)}</pre>
        </div>
      )
    case 'error':
      return (
        <div className="dcard dcard-error">
          <div className="dcard-label error">Error</div>
          <pre className="dcard-pre plain">{card.text.slice(0, 8000)}</pre>
          {looksLikeKeyError(card.text) && (
            <button className="deck-btn" style={{ marginTop: 8 }} onClick={onNeedSetup}>
              {embed ? 'Open launcher Settings' : 'Review setup'}
            </button>
          )}
        </div>
      )
    case 'system':
      return <div className="dcard-system">{card.text}</div>
  }
}

export function TurnView({ turn, anchorId, onNeedSetup, embed }: {
  turn: DeckTurn
  anchorId?: string
  onNeedSetup: () => void
  embed?: boolean
}) {
  return (
    <section className="deck-turn" id={anchorId}>
      {turn.cards.map((c, i) => (
        <DeckCardView key={i} card={c} onNeedSetup={onNeedSetup} embed={embed} />
      ))}
    </section>
  )
}

/** Compact task rail for the sidebar: one chip per turn + current progress. */
export function TurnStrip({ turns, onJump }: {
  turns: DeckTurn[]
  onJump: (turn: DeckTurn) => void
}) {
  const shown = turns.filter(t => t.intent !== null)
  if (!shown.length) return null
  const last = shown[shown.length - 1]
  return (
    <div className="turn-strip">
      <div className="ts-items">
        {shown.map(t => (
          <button
            key={t.index}
            type="button"
            className={`ts-item ${t.status}`}
            onClick={() => onJump(t)}
            title={turnTitle(t, 120)}
          >
            <StatusGlyph status={t.status} />
            <span className="ts-num">{t.index}</span>
            <span className="ts-title">{turnTitle(t, 26)}</span>
          </button>
        ))}
      </div>
      {last.progress.total > 0 && (
        <div className="ts-prog" title={`Current turn: ${last.progress.done}/${last.progress.total} steps done`}>
          <div className="ts-prog-bar"><span style={{ width: `${last.progress.pct}%` }} /></div>
          <span className="ts-prog-text">{last.progress.pct}%</span>
        </div>
      )}
    </div>
  )
}

/** Files the agent has touched this session; click opens the file (4112 only). */
export function WorkingSet({ files, onOpen }: {
  files: string[]
  onOpen?: (path: string) => void
}) {
  if (!files.length) return null
  return (
    <div className="ws-chips" title="Working set — files the agent touched this session">
      <span className="ws-label">Working set</span>
      {files.slice(-8).map(f => (
        <button
          key={f}
          type="button"
          className="ws-chip mono"
          disabled={!onOpen}
          onClick={() => onOpen?.(f)}
          title={onOpen ? `Open ${f}` : f}
        >{f.replace(/^\//, '')}</button>
      ))}
    </div>
  )
}

export function DeckMode({ turns, sending, workingLabel, onClose, onNeedSetup, onOpenPath }: {
  turns: DeckTurn[]
  sending: boolean
  workingLabel: string
  onClose: () => void
  onNeedSetup: () => void
  onOpenPath?: (path: string) => void
}) {
  const [active, setActive] = useState(() => Math.max(0, turns.length - 1))
  const [overview, setOverview] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<(HTMLElement | null)[]>([])

  const goTo = (i: number, closeOverview = false) => {
    const idx = Math.min(Math.max(0, i), turns.length - 1)
    setActive(idx)
    if (closeOverview) setOverview(false)
    requestAnimationFrame(() => {
      const el = slideRefs.current[idx]
      const wrap = scrollRef.current
      if (el && wrap) wrap.scrollTo({ left: el.offsetLeft - 24, behavior: 'smooth' })
    })
  }

  // Start on the newest slide.
  useEffect(() => { goTo(turns.length - 1) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the live turn while sending, unless the user navigated away on purpose:
  // the Live pill is the way back, so only auto-follow when already on the last slide.
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (sending && activeRef.current >= turns.length - 2) goTo(turns.length - 1)
  }, [turns.length, sending]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') { if (overview) setOverview(false); else onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(activeRef.current + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(activeRef.current - 1) }
      else if (e.key.toLowerCase() === 'o') setOverview(o => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overview, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const wrap = scrollRef.current
    if (!wrap) return
    let best = 0
    let bestDist = Infinity
    slideRefs.current.forEach((el, i) => {
      if (!el) return
      const d = Math.abs(el.offsetLeft - 24 - wrap.scrollLeft)
      if (d < bestDist) { bestDist = d; best = i }
    })
    if (best !== activeRef.current) setActive(best)
  }

  const last = turns.length - 1

  return (
    <div className="deckmode" role="dialog" aria-label="Chat deck">
      <div className="deckmode-head">
        <span className="brand-mark" aria-hidden="true">◧</span>
        <b>Deck</b>
        <span className="deckmode-sub">{turns.length} turn{turns.length === 1 ? '' : 's'}{sending ? ` · ${workingLabel || 'working…'}` : ''}</span>
        <span className="deckmode-hint">← → navigate · O overview · Esc close</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" className="deck-btn" onClick={() => setOverview(o => !o)}>{overview ? 'Deck' : 'Overview'}</button>
          <button type="button" className="deck-btn" onClick={onClose}>Close</button>
        </span>
      </div>

      {overview ? (
        <div className="overview-grid">
          {turns.map((t, i) => (
            <button key={t.index} type="button" className={`ov-tile ${t.status}`} onClick={() => goTo(i, true)}>
              <span className="ov-head">
                <span className="dslide-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="ov-title">{turnTitle(t, 48)}</span>
                <StatusGlyph status={t.status} />
              </span>
              <span className="ov-meta">
                {t.progress.total ? `${t.progress.done}/${t.progress.total} steps · ` : ''}
                {t.cards.filter(c => c.kind === 'tools').length} tool card{t.cards.filter(c => c.kind === 'tools').length === 1 ? '' : 's'}
                {t.files.length ? ` · ${t.files.length} file${t.files.length === 1 ? '' : 's'}` : ''}
              </span>
              {t.cards.find(c => c.kind === 'result') && (
                <span className="ov-snip">{(t.cards.find(c => c.kind === 'result') as { text: string }).text.slice(0, 140)}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="deck-scroll" ref={scrollRef} onScroll={onScroll}>
            {turns.map((t, i) => (
              <article
                key={t.index}
                className={`dslide ${t.status === 'error' ? 'sealed' : ''}`}
                ref={el => { slideRefs.current[i] = el }}
              >
                <div className="dslide-head">
                  <span className="dslide-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="dslide-title">{turnTitle(t)}</span>
                  {t.progress.total > 0 && <span className="dslide-prog">{t.progress.done}/{t.progress.total}</span>}
                  <span className={`dslide-status ${t.status}`}><StatusGlyph status={t.status} /></span>
                </div>
                <div className="dslide-cards">
                  {t.cards.map((c, j) => (
                    <DeckCardView key={j} card={c} onNeedSetup={onNeedSetup} />
                  ))}
                  {t.files.length > 0 && (
                    <WorkingSet files={t.files} onOpen={onOpenPath} />
                  )}
                </div>
              </article>
            ))}
            {!turns.length && <div className="deckmode-empty">No turns yet. Ask the agent something, then open the Deck.</div>}
          </div>

          <div className="timeline-wrap">
            <div className="timeline">
              {turns.map((t, i) => (
                <button
                  key={t.index}
                  type="button"
                  className={`timeline-item ${t.status} ${i === active ? 'active' : ''}`}
                  onClick={() => goTo(i)}
                  title={turnTitle(t, 120)}
                >{i + 1}</button>
              ))}
            </div>
          </div>

          {sending && active !== last && turns.length > 0 && (
            <button type="button" className="live-pill" onClick={() => goTo(last)}>
              <span className="dot-live" /> Live
            </button>
          )}
        </>
      )}
    </div>
  )
}

export { formatElapsed }
