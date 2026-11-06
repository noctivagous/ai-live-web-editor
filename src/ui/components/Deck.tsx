import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Camera, Crosshair, FilePlus2, FileSearch, FlaskConical, FolderOpen, Globe, Inspect,
  LayoutGrid, PenLine, Search, Terminal, TerminalSquare, WandSparkles, WifiOff,
} from 'lucide-react'
import type { ToolStep } from '../lib/chatSession'
import {
  TOOL_GROUP_LABEL, fmtCost, fmtTokens, formatElapsed, looksLikeKeyError, slideTurns, stepElapsed, turnCost, turnTitle,
  type DeckCard, type DeckTurn, type TokenPricing,
} from '../lib/deck'
import { ChatComposer, ChatHeader, SketchPanel } from './chatChrome'
import { Markdown } from './Markdown'
import type { ChatWorkflow, WorkflowSnapshot } from '../lib/api'
import type { AnnotationDigest } from '../lib/annotationSync'

/* Deck rendering, ported from web-artifacts/agentic-chat-deck_* (v2):
   intent / reasoning / tool / result cards, a turn strip, and the expanded
   horizontal Deck mode with timeline, overview, Live pill and keyboard nav.
   Data comes from lib/deck.ts grouping of the real chat log — no mock data. */

/**
 * Tool icon by family (artifact tool-pill language): read / write /
 * page-observe / page-act / layout / verify / misc. Name text stays
 * beside the icon — the glyph is a scanning aid, not a replacement.
 */
const TOOL_ICONS: Record<string, typeof Search> = {
  'list-real-files': FolderOpen,
  grep: Search,
  'read-real-file': FileSearch,
  'str-replace': PenLine,
  'write-real-file': FilePlus2,
  'take-snapshot': Camera,
  'inspect-dom': Inspect,
  'patch-dom': WandSparkles,
  'eval-js': Terminal,
  'layout-snapshot': LayoutGrid,
  'layout-svg': LayoutGrid,
  'get-console': TerminalSquare,
  'get-network-failures': WifiOff,
  'resolve-source': Crosshair,
  'run-project-check': FlaskConical,
  'pool-open': Globe,
}

function ToolIcon({ name }: { name: string }) {
  const Icon = TOOL_ICONS[name]
  if (!Icon) return null
  return <Icon size={12} aria-hidden />
}

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
        <span className="tool-pill"><ToolIcon name={step.name} />{step.name}</span>
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
          {open && <div className="dcard-pre"><Markdown text={card.text.slice(0, 4000)} /></div>}
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
          <div className="dcard-pre plain"><Markdown text={card.text.slice(0, 8000)} /></div>
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
export function TurnStrip({ turns, onJump, pricing }: {
  turns: DeckTurn[]
  onJump: (turn: DeckTurn) => void
  pricing?: TokenPricing | null
}) {
  const shown = turns.filter(t => t.intent !== null)
  if (!shown.length) return null
  const last = shown[shown.length - 1]
  const withUsage = shown.filter(t => t.usage)
  const sessionTotal = withUsage.reduce((n, t) => n + (t.usage?.total || 0), 0)
  const sessionCost = pricing ? withUsage.reduce((n, t) => n + (turnCost(t.usage, pricing) || 0), 0) : null
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
      {withUsage.length > 0 && (
        <div
          className="ts-tokens"
          title={withUsage.length < shown.length
            ? `Tokens so far (some turns did not report usage)`
            : 'Tokens so far this session'}
        >
          Σ {fmtTokens(sessionTotal)} tok{sessionCost !== null && sessionCost > 0 ? ` · ${fmtCost(sessionCost)} est` : ''}
        </div>
      )}
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

export type DeckSlide = {
  turn: DeckTurn
  cards: DeckCard[]
  slice: number
  slices: number
}

/** Merge stored slice boundaries with the current cards (streaming appends). */
function reconcilePack(prev: Record<number, number[][]>, turns: DeckTurn[]): Record<number, number[][]> {
  const next: Record<number, number[][]> = {}
  for (const t of turns) {
    const total = t.cards.length
    const seen = new Set<number>()
    const slices: number[][] = []
    for (const s of prev[t.index] || []) {
      const kept = s.filter(i => i < total && !seen.has(i))
      kept.forEach(i => seen.add(i))
      if (kept.length) slices.push(kept)
    }
    const missing: number[] = []
    for (let i = 0; i < total; i++) if (!seen.has(i)) missing.push(i)
    if (missing.length) {
      if (slices.length) slices[slices.length - 1].push(...missing)
      else slices.push(missing)
    }
    next[t.index] = slices
  }
  return next
}

function packKey(pack: Record<number, number[][]>): string {
  return Object.keys(pack).sort().map(k => `${k}:${pack[Number(k)].map(s => s.join(',')).join('|')}`).join(';')
}

export function DeckMode({ turns, sending, workingLabel, onClose, onNeedSetup, onOpenPath, workflow, onWorkflowMode, onClear, sketch, onSketchAction, input, onInput, onSend, onStop, annot, inIframe, onPick, onSubmit, onInsertToken, pricing }: {
  turns: DeckTurn[]
  sending: boolean
  workingLabel: string
  onClose: () => void
  onNeedSetup: () => void
  onOpenPath?: (path: string) => void
  workflow: ChatWorkflow
  onWorkflowMode: (mode: ChatWorkflow) => void
  onClear: () => void
  sketch: WorkflowSnapshot | null
  onSketchAction: (action: 'undo' | 'discard' | 'accept') => void
  input: string
  onInput: (value: string) => void
  onSend: () => void
  onStop: () => void
  annot: AnnotationDigest
  inIframe: boolean
  onPick: () => void
  onSubmit: () => void
  onInsertToken: (token: string) => void
  pricing?: TokenPricing | null
}) {
  const [active, setActive] = useState(0)
  const [overview, setOverview] = useState(false)
  // Slice boundaries per turn: pack[turnIndex] = array of card-index slices.
  const [pack, setPack] = useState<Record<number, number[][]>>({})
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const packViewport = useRef({ w: 0, h: 0 })
  const scrollRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<(HTMLElement | null)[]>([])

  const slides: DeckSlide[] = []
  for (const t of turns) {
    const slices = pack[t.index] || (t.cards.length ? [t.cards.map((_, i) => i)] : [])
    slices.forEach((idxs, k) => {
      const cards = idxs.map(i => t.cards[i]).filter(Boolean)
      if (cards.length) slides.push({ turn: t, cards, slice: k, slices: slices.length })
    })
  }
  const realCount = slideTurns(turns).length
  const firstSlideOfTurn = new Map<number, number>()
  slides.forEach((s, i) => {
    if (!firstSlideOfTurn.has(s.turn.index)) firstSlideOfTurn.set(s.turn.index, i)
  })

  const cardsEl = (i: number): HTMLElement | null => {
    const article = slideRefs.current[i]
    return (article?.querySelector('.dslide-cards') as HTMLElement | null) || null
  }

  // Vertical-fit packing: after render, any slide whose cards overflow donates
  // its last card to the next slice — one card per slide per pass, converging
  // over successive renders. A width change resets to single slices and repacks.
  useLayoutEffect(() => {
    setPack(prev => {
      const base = viewport.w !== packViewport.current.w ? {} : prev
      packViewport.current = { ...viewport }
      const next = reconcilePack(base, turns)
      // Measure against the just-rendered DOM (prev pack) and move one card
      // per overflowing slide. The rendered order matches turn/slice order, so
      // a running position addresses the right element; verify identity first
      // since slice counts can shift between passes.
      let order = 0
      for (const t of turns) {
        const arr = next[t.index]
        if (!arr) continue
        arr.forEach((slice, k) => {
          const rendered = slides[order]
          order += 1
          if (rendered?.turn.index !== t.index || rendered.slice !== k) return
          const el = cardsEl(order - 1)
          if (el && slice.length > 1 && el.scrollHeight > el.clientHeight + 4) {
            const moved = slice.pop() as number
            if (k + 1 < arr.length) arr[k + 1].unshift(moved)
            else arr.push([moved])
          }
        })
      }
      return packKey(next) === packKey(prev) ? prev : next
    })
  }, [turns, viewport]) // eslint-disable-line react-hooks/exhaustive-deps

  // Repack when the slide area resizes (card wrapping changes heights).
  useEffect(() => {
    const wrap = scrollRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect()
      setViewport(prev => (
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev : { w: r.width, h: r.height }
      ))
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // Keep the active slide in range as packing shifts.
  useEffect(() => {
    if (active > slides.length - 1) setActive(Math.max(0, slides.length - 1))
  }, [slides.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (i: number, closeOverview = false) => {
    const idx = Math.min(Math.max(0, i), slides.length - 1)
    setActive(idx)
    if (closeOverview) setOverview(false)
    requestAnimationFrame(() => {
      const el = slideRefs.current[idx]
      const wrap = scrollRef.current
      if (el && wrap) wrap.scrollTo({ left: el.offsetLeft - 24, behavior: 'smooth' })
    })
  }

  // Start on the newest slide.
  useEffect(() => { goTo(slides.length - 1) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the live slide while sending, unless the user navigated away on
  // purpose: the Live pill is the way back, so only auto-follow when already
  // on the last slide.
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (sending && activeRef.current >= slides.length - 2) goTo(slides.length - 1)
  }, [slides.length, sending]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const last = slides.length - 1

  return (
    <div className="deckmode" role="dialog" aria-label="Chat deck">
      <ChatHeader
        workflow={workflow}
        sending={sending}
        workingLabel={workingLabel}
        showDeckButton={false}
        onWorkflowMode={onWorkflowMode}
        onClear={onClear}
        onOpenDeck={() => {}}
      />
      <SketchPanel
        workflow={workflow}
        sketch={sketch}
        sending={sending}
        onSketchAction={onSketchAction}
      />
      <div className="deckmode-head">
        <span className="brand-mark" aria-hidden="true">◧</span>
        <b>Deck</b>
        <span className="deckmode-sub">{realCount} turn{realCount === 1 ? '' : 's'} · {slides.length} slide{slides.length === 1 ? '' : 's'}{sending ? ` · ${workingLabel || 'working…'}` : ''}</span>
        <span className="deckmode-hint">← → navigate · O overview · Esc close</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" className="deck-btn" disabled={!realCount} onClick={() => setOverview(o => !o)}>{overview ? 'Deck' : 'Overview'}</button>
          <button type="button" className="deck-btn" onClick={onClose}>Close</button>
        </span>
      </div>

      {overview ? (
        <div className="overview-grid">
          {turns.map((t) => (
            <button key={t.index} type="button" className={`ov-tile ${t.status}`} onClick={() => goTo(firstSlideOfTurn.get(t.index) ?? 0, true)}>
              <span className="ov-head">
                <span className="dslide-num">{String((firstSlideOfTurn.get(t.index) ?? 0) + 1).padStart(2, '0')}</span>
                <span className="ov-title">{turnTitle(t, 48)}</span>
                <StatusGlyph status={t.status} />
              </span>
              <span className="ov-meta">
                {t.progress.total ? `${t.progress.done}/${t.progress.total} steps · ` : ''}
                {t.cards.filter(c => c.kind === 'tools').length} tool card{t.cards.filter(c => c.kind === 'tools').length === 1 ? '' : 's'}
                {t.files.length ? ` · ${t.files.length} file${t.files.length === 1 ? '' : 's'}` : ''}
                {t.usage ? ` · ${fmtTokens(t.usage.total)} tok` : ''}
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
            {slides.map((s, i) => (
              <article
                key={`${s.turn.index}:${s.slice}`}
                className={`dslide ${s.turn.status === 'error' ? 'sealed' : ''}`}
                ref={el => { slideRefs.current[i] = el }}
              >
                <div className="dslide-head">
                  <span className="dslide-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="dslide-title">{turnTitle(s.turn)}{s.slices > 1 ? ` · ${s.slice + 1}/${s.slices}` : ''}</span>
                  {s.turn.progress.total > 0 && <span className="dslide-prog">{s.turn.progress.done}/{s.turn.progress.total}</span>}
                  {s.turn.usage && (
                    <span className="dslide-tokens" title={s.turn.usage ? `in ${s.turn.usage.input.toLocaleString()} / out ${s.turn.usage.output.toLocaleString()}` : 'tokens used'}>
                      {fmtTokens(s.turn.usage.total)} tok{(() => {
                        const c = turnCost(s.turn.usage, pricing)
                        return c !== null && c > 0 ? ` · ${fmtCost(c)} est` : ''
                      })()}
                    </span>
                  )}
                  <span className={`dslide-status ${s.turn.status}`}><StatusGlyph status={s.turn.status} /></span>
                </div>
                <div className="dslide-cards">
                  {s.cards.map((c, j) => (
                    <DeckCardView key={j} card={c} onNeedSetup={onNeedSetup} />
                  ))}
                  {s.slice === s.slices - 1 && s.turn.files.length > 0 && (
                    <WorkingSet files={s.turn.files} onOpen={onOpenPath} />
                  )}
                </div>
              </article>
            ))}
          </div>

          {realCount > 0 && (
            <div className="timeline-wrap">
              <div className="timeline">
                {slides.map((s, i) => (
                  <button
                    key={`${s.turn.index}:${s.slice}`}
                    type="button"
                    className={`timeline-item ${s.turn.status} ${i === active ? 'active' : ''}`}
                    onClick={() => goTo(i)}
                    title={turnTitle(s.turn, 120)}
                  >{i + 1}</button>
                ))}
              </div>
            </div>
          )}

          {sending && active !== last && slides.length > 0 && (
            <button type="button" className="live-pill" onClick={() => goTo(last)}>
              <span className="dot-live" /> Live
            </button>
          )}
        </>
      )}
      <ChatComposer
        input={input}
        sending={sending}
        workflow={workflow}
        annot={annot}
        inIframe={inIframe}
        onInput={onInput}
        onSend={onSend}
        onStop={onStop}
        onPick={onPick}
        onSubmit={onSubmit}
        onInsertToken={onInsertToken}
      />
    </div>
  )
}

export { formatElapsed }
