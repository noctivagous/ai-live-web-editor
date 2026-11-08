import React, { useState } from 'react'
import { stepElapsed } from '../lib/deck.js'
import type { ToolStep } from '../lib/chatSession.js'

function Overlay({ onClose, children }: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, maxWidth: 900, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

function Header({ title, onClose }: { title: string, onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
      <b>{title}</b>
      <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
    </div>
  )
}

export function NoticeDialog({ notice, onClose }: {
  notice: string | null
  onClose: () => void
}) {
  if (notice === null) return null
  return (
    <Overlay onClose={onClose}>
      <Header title="Inspect result" onClose={onClose} />
      <pre style={{ overflow: 'auto', fontSize: 'calc(12px * var(--ui-scale, 1))', color: '#ccc', margin: 0, fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}>{notice}</pre>
    </Overlay>
  )
}

/* Failure details: a failed tool step or chat error, opened from a
 * Details button next to the failure. The report is plain selectable
 * text plus a one-click copy, so the user can paste it back into chat. */

export interface FailureReport {
  /** Headline — the tool name, or 'Chat error'. */
  title: string
  /** One-line args preview, when the failure is a tool step. */
  detail?: string
  /** Full error/result text. */
  result: string
  /** Extra context lines, e.g. turn intent and elapsed time. */
  meta?: string[]
}

export function stepFailureReport(step: ToolStep, turn?: { index: number, intent: string | null }): FailureReport {
  const meta: string[] = [`Status: ${step.status}`]
  if (turn) meta.push(`Turn ${turn.index}${turn.intent ? ` — ${turn.intent}` : ''}`)
  const elapsed = stepElapsed(step)
  if (elapsed) meta.push(`Elapsed: ${elapsed}`)
  return { title: step.name, detail: step.detail || undefined, result: step.result || step.detail, meta }
}

export function errorFailureReport(text: string, turn?: { index: number, intent: string | null }): FailureReport {
  const meta: string[] = []
  if (turn) meta.push(`Turn ${turn.index}${turn.intent ? ` — ${turn.intent}` : ''}`)
  return { title: 'Chat error', result: text, meta }
}

/** The same report as chat-ready markdown for copy/paste. */
export function formatFailureReport(r: FailureReport): string {
  const head = [`Agent failure: ${r.title}`]
  if (r.detail) head.push(`Args: ${r.detail}`)
  for (const m of r.meta ?? []) head.push(m)
  return `${head.join('\n')}\n\n\`\`\`\n${r.result}\n\`\`\`\n`
}

export function requestInsertChat(text: string): void {
  window.dispatchEvent(new CustomEvent('ai-live:insert-chat', { detail: { text } }))
}

export function FailureDetailsDialog({ report, onClose, onInsert = requestInsertChat }: {
  report: FailureReport | null
  onClose: () => void
  onInsert?: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  if (report === null) return null
  const text = formatFailureReport(report)
  function copy() {
    try {
      const p = navigator.clipboard?.writeText(text)
      void p?.then(() => setCopied(true)).catch(() => setCopied(false))
    } catch { /* clipboard unavailable */ }
  }
  return (
    <Overlay onClose={onClose}>
      <Header title="Failure details" onClose={onClose} />
      <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--muted)', marginBottom: 8 }}>
        <div><b style={{ color: 'var(--text-strong)' }}>{report.title}</b>{report.detail ? ` — ${report.detail}` : ''}</div>
        {(report.meta ?? []).map((m, i) => <div key={i}>{m}</div>)}
      </div>
      <pre style={{ overflow: 'auto', maxHeight: '50vh', fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--text-soft)', margin: '0 0 12px', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', whiteSpace: 'pre-wrap', userSelect: 'text' }}>{report.result}</pre>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="deck-btn" onClick={copy}>{copied ? 'Copied' : 'Copy report'}</button>
        <button type="button" className="deck-btn" onClick={() => { onInsert(text); onClose() }}>Insert into chat</button>
      </div>
    </Overlay>
  )
}
