import React from 'react'
import { Check, Circle, Loader2, Minus, X } from 'lucide-react'
import { fmtTokens, type DeckTurn } from '../lib/deck'
import { derivePanel, panelTurn, type PhaseState } from '../lib/panel'

/* Panel view: a stationary presentation of the same chat turn the Deck
   renders as cards. Every indicator has a fixed home and only changes
   state in place — nothing scrolls, nothing streams. The composer and
   header are the chat's own (chatChrome.tsx); only the middle changes.
   Data comes from lib/panel.ts over the real grouped turn — no mock data. */

const PHASE_GLYPH: Record<PhaseState, React.ReactNode> = {
  done: <Check size={12} aria-hidden />,
  active: <Loader2 size={12} aria-hidden />,
  pending: <Circle size={12} aria-hidden />,
  skipped: <Minus size={12} aria-hidden />,
  error: <X size={12} aria-hidden />,
}

export function PanelView({ turns, sending, workingLabel, onOpenPath, onNeedSetup, embed }: {
  turns: DeckTurn[]
  sending: boolean
  workingLabel: string
  onOpenPath?: (path: string) => void
  onNeedSetup: () => void
  embed?: boolean
}) {
  const watched = panelTurn(turns)
  const state = derivePanel(watched, { sending, workingLabel })

  return (
    <div className="panelview" aria-label="Panel view">
      <div className={`pv-now ${state.nowState}`}>
        <span className={`pv-orb ${state.nowState}`} aria-hidden="true" />
        <div className="pv-now-main">
          <div className="pv-now-label">
            Now{watched && watched.intent !== null ? ` · Turn ${watched.index}` : ''}
            {state.progress.total > 0 ? ` · ${state.progress.done}/${state.progress.total} steps` : ''}
          </div>
          <div className="pv-now-text" title={state.now}>{state.now}</div>
        </div>
        {state.tokens !== null && <span className="pill mono">{fmtTokens(state.tokens)} tok</span>}
      </div>

      <div className="pv-phases" role="list" aria-label="Phases">
        {state.phases.map((p, i) => (
          <React.Fragment key={p.id}>
            {i > 0 && <span className="pv-phase-link" aria-hidden="true" />}
            <div className={`pv-phase ${p.state}`} role="listitem">
              <span className={`pv-phase-dot ${p.state}`}>{PHASE_GLYPH[p.state]}</span>
              <span className="pv-phase-label">{p.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      <div className="pv-tiles" aria-label="Activity">
        {state.tiles.map(t => (
          <div key={t.group} className={`pv-tile${t.active ? ' active' : ''}${t.error ? ' error' : ''}`}>
            <span className="pv-tile-label">{t.label}</span>
            <span className="pv-tile-count">{t.count}</span>
          </div>
        ))}
      </div>

      <div className="pv-cols">
        <section className="pv-box" aria-label="Files">
          <div className="pv-box-head">Files</div>
          {state.files.length === 0
            ? <div className="pv-empty">No files yet</div>
            : (
              <ul className="pv-files">
                {state.files.slice(-8).map(f => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className="pv-file mono"
                      disabled={!onOpenPath}
                      onClick={() => onOpenPath?.(f.path)}
                      title={onOpenPath ? `Open ${f.path}` : f.path}
                    >{f.path.replace(/^\//, '')}</button>
                    <span className={`pv-file-state ${f.state}`}>{f.state}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="pv-box" aria-label="Checks and progress">
          <div className="pv-box-head">Status</div>
          <div className="pv-gauge">
            <span>Steps</span>
            <div className="ts-prog-bar pv-bar"><span style={{ width: `${state.progress.pct}%` }} /></div>
            <b className="mono">{state.progress.total ? `${state.progress.pct}%` : '—'}</b>
          </div>
          <div className="pv-gauge">
            <span>Checks</span>
            <div className="pv-gauge-val mono">
              {state.checks.passed + state.checks.failed + state.checks.running === 0
                ? '—'
                : `${state.checks.passed} passed${state.checks.failed ? ` · ${state.checks.failed} failed` : ''}${state.checks.running ? ` · ${state.checks.running} running` : ''}`}
            </div>
          </div>
          <div className="pv-gauge">
            <span>Files</span>
            <div className="pv-gauge-val mono">{state.files.length || '—'}</div>
          </div>
        </section>
      </div>

      <section className={`pv-attention${state.attention ? ' on' : ''}`} aria-label="Attention">
        <div className="pv-box-head">Attention</div>
        {state.attention
          ? (
            <>
              <div className="pv-attention-text">{state.attention}</div>
              {state.attentionIsKeyError && (
                <button type="button" className="deck-btn" style={{ marginTop: 8 }} onClick={onNeedSetup}>
                  {embed ? 'Open launcher Settings' : 'Review setup'}
                </button>
              )}
            </>
          )
          : <div className="pv-empty">All clear</div>}
      </section>

      <section className="pv-summary" aria-label="Summary">
        <div className="pv-sum">
          <span className="pv-sum-label">Task</span>
          <span className="pv-sum-val" title={state.summary.task}>{state.summary.task}</span>
        </div>
        <div className="pv-sum">
          <span className="pv-sum-label">Result</span>
          <span className="pv-sum-val" title={state.summary.result}>{state.summary.result}</span>
        </div>
        <div className="pv-sum">
          <span className="pv-sum-label">Changes</span>
          <span className="pv-sum-val" title={state.summary.changes}>{state.summary.changes}</span>
        </div>
        <div className="pv-sum">
          <span className="pv-sum-label">Skills</span>
          <span className="pv-sum-val" title={state.summary.skills}>{state.summary.skills}</span>
        </div>
      </section>
    </div>
  )
}
