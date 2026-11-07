import React, { useCallback, useEffect, useState } from 'react'
import { getResearchConfig, saveBraveKey, testBraveKey, type BraveStatus } from '../lib/api'

/**
 * The Search card (phase-11-06 §N): one Brave Search key powers
 * the agent's web-search and research tools. The same card is
 * the wizard's Search slide and the Settings Search section —
 * one surface, like ProviderSetup. The key is stored in the
 * editor's .env on this machine and only ever sent to Brave.
 */
export function SearchSetup({ onStatus }: { onStatus?: (status: BraveStatus) => void }) {
  const [status, setStatus] = useState<BraveStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null)
  const [note, setNote] = useState<{ ok: boolean, text: string } | null>(null)

  const apply = useCallback((next: BraveStatus) => {
    setStatus(next)
    onStatus?.(next)
  }, [onStatus])

  useEffect(() => {
    let live = true
    void getResearchConfig()
      .then(r => { if (live) apply(r.brave) })
      .catch(() => { if (live) apply({ configured: false }) })
    return () => { live = false }
  }, [apply])

  const save = async () => {
    if (!key.trim()) return
    setBusy('save')
    setNote(null)
    try {
      const r = await saveBraveKey(key.trim())
      apply(r.brave)
      setKey('')
      setNote({ ok: true, text: 'Saved. The agent can use web search and research now.' })
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setNote(null)
    try {
      const r = await testBraveKey(key.trim() || undefined)
      setNote(r.ok
        ? { ok: true, text: 'The key works — Brave answered a test search.' }
        : { ok: false, text: r.error || 'Brave rejected the key.' })
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    setNote(null)
    try {
      const r = await saveBraveKey('')
      apply(r.brave)
      setKey('')
      setNote({ ok: true, text: 'Removed. Web search and research are off until a key is saved.' })
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="peditor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span className="plogo letter" style={{ width: 30, height: 30, background: '#ff5a1f', color: '#fff' }}>B</span>
        <div>
          <b>Brave Search</b>
          <div className="field-hint">Powers the agent's web-search and research tools.</div>
        </div>
        <span className={`pill ${status?.configured ? 'good' : 'warn'}`} style={{ marginLeft: 'auto' }}>
          <span className="dot" />
          {status === null ? 'checking…' : status.configured ? `key saved (…${status.keyLast4})` : 'no key'}
        </span>
      </div>

      <label className="field-label" htmlFor="brave-key">API key</label>
      <input
        id="brave-key"
        type="password"
        autoComplete="off"
        className="deck-input"
        value={key}
        onChange={e => { setKey(e.target.value); setNote(null) }}
        placeholder={status?.configured ? `Saved (…${status.keyLast4})` : 'Paste your Brave key'}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="deck-btn" disabled={busy !== null || !key.trim()} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save key'}
        </button>
        <button type="button" className="deck-btn" disabled={busy !== null || (!key.trim() && !status?.configured)} onClick={() => void test()}>
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        {status?.configured && (
          <button type="button" className="deck-btn" disabled={busy !== null} onClick={() => void remove()} style={{ marginLeft: 'auto' }}>
            {busy === 'remove' ? 'Removing…' : 'Remove'}
          </button>
        )}
      </div>

      {note && (
        <div className="field-hint" style={{ marginTop: 8, color: note.ok ? 'var(--green-text)' : 'var(--red-text)' }}>{note.text}</div>
      )}
      <div className="field-hint" style={{ marginTop: 8 }}>
        Get a free key at <a href="https://brave.com/search/api" target="_blank" rel="noreferrer">brave.com/search/api</a>.
        The key is stored in this editor's .env on this machine and only sent to Brave.
      </div>
    </div>
  )
}
