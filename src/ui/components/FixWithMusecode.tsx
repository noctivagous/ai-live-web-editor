import { useState } from 'react'
import { Wrench } from 'lucide-react'

/**
 * "Fix with Muse Code" (Muse Code design §13, slice
 * 10): the headless-dispatch entry point. Lives on failed
 * skill-check criteria (SkillsPanel) and on chat turns whose
 * gate verdict came back unclean (Deck 'fix' card). The
 * dispatch runs synchronously server-side (minutes, like a
 * long turn); when it settles, the gate's verdict and the
 * changed-file list show here with Accept / Reject — reject
 * restores the pre-dispatch tree.
 */

interface DispatchRecordView {
  id: string
  status: string
  changedFiles: string[]
  verdict: { ok: boolean } | null
  error?: string
  finalText?: string
}

export function FixWithMusecodeButton({ title, evidence, criteria, source, label }: {
  title: string
  evidence: string
  criteria?: string[]
  source: 'criteria' | 'console' | 'gate' | 'manual'
  label?: string
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'settled' | 'error'>('idle')
  const [record, setRecord] = useState<DispatchRecordView | null>(null)
  const [note, setNote] = useState('')

  const run = async () => {
    setPhase('running')
    setNote('')
    try {
      const res = await fetch('/api/musecode/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, evidence, criteria, source }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean, record?: DispatchRecordView } | null
      if (!data?.record) throw new Error(`dispatch failed (${res.status})`)
      setRecord(data.record)
      setPhase(data.record.status === 'error' ? 'error' : 'settled')
    } catch (e) {
      setPhase('error')
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const settle = async (how: 'accept' | 'reject') => {
    if (!record) return
    try {
      const res = await fetch(`/api/musecode/dispatch/${how}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: record.id }),
      })
      const data = await res.json().catch(() => null) as { record?: DispatchRecordView } | null
      if (data?.record) setRecord(data.record)
    } catch { /* the record stays as shown */ }
  }

  if (phase === 'idle') {
    return (
      <button type="button" className="deck-btn" onClick={() => void run()}>
        <Wrench size={12} /> {label ?? 'Fix with Muse Code'}
      </button>
    )
  }
  if (phase === 'running') {
    return <span className="skills-check-evidence">Muse Code is on it — running headlessly, judged by the gate when it settles…</span>
  }
  if (!record) {
    return <span className="skills-check-evidence">Dispatch failed{note ? `: ${note}` : ''}.</span>
  }
  const pending = record.status === 'fixed' || record.status === 'not-fixed'
  return (
    <span className="fix-dispatch-result">
      <span className="skills-check-evidence">
        {record.status === 'error'
          ? `Dispatch error: ${record.error ?? 'unknown'}`
          : record.status === 'accepted'
            ? 'Fix accepted — changes kept.'
            : record.status === 'rejected'
              ? 'Fix rejected — the tree was restored to its pre-dispatch state.'
              : record.verdict?.ok
                ? `Dispatch done: the gate is clean now. Changed: ${record.changedFiles.join(', ') || 'nothing'}.`
                : `Dispatch done, but the gate still fails. Changed: ${record.changedFiles.join(', ') || 'nothing'}.`}
      </span>
      {pending && (
        <>
          <button type="button" className="deck-btn" onClick={() => void settle('accept')}>Accept</button>
          <button type="button" className="deck-btn" onClick={() => void settle('reject')}>Reject</button>
        </>
      )}
    </span>
  )
}
