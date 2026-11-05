import React, { useState } from 'react'
import { chat as chatApi, getConfig } from '../lib/api'

function looksLikeKeyError(text: string): boolean {
  return /api.*key|401|unauthorized|openai|invalid_api_key/i.test(text)
}

export function Chat({ activePath, keyKnown, onNeedSetup, onAfterChat }: {
  activePath: string
  keyKnown: boolean | undefined
  onNeedSetup: () => void
  onAfterChat: () => void
}) {
  const [log, setLog] = useState<{ role: string, text: string }[]>([
    { role: 'system', text: 'AI has real FS tools (read/write) + live browser tools (patch/inspect). Ask: "make this a todo app with counter"' }
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  function guidedKeyError(): string {
    return 'AI chat needs OPENAI_API_KEY on the launcher.\n\n'
      + '1. Add OPENAI_API_KEY to the launcher .env (or environment).\n'
      + '2. Restart the launcher (npm run dev).\n'
      + '3. Use “Review setup” below to re-run the checks.'
  }

  async function send() {
    if (!input.trim() || sending) return
    // Fast path: the top bar already knows the key state.
    if (keyKnown === false) {
      setLog(l => [...l, { role: 'user', text: input }, { role: 'error', text: guidedKeyError() }])
      setInput('')
      return
    }
    const userText = input
    setLog(l => [...l, { role: 'user', text: userText }])
    setInput('')
    setSending(true)
    setLog(l => [...l, { role: 'ai', text: 'thinking... (Mastra editorAgent: list-real-files -> read -> write -> patch-dom)' }])
    try {
      const res = await chatApi([{ role: 'user', content: userText + ` Current file: ${activePath}` }])
      if (res.ok === false || res.error) {
        const msg = String(res.error || 'unknown error')
        setLog(l => [...l.slice(0, -1), { role: 'error', text: looksLikeKeyError(msg) ? guidedKeyError() : `Chat failed: ${msg.slice(0, 2000)}` }])
      } else {
        setLog(l => [...l.slice(0, -1), { role: 'ai', text: res.text || JSON.stringify(res).slice(0, 3000) }])
        onAfterChat()
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setLog(l => [...l.slice(0, -1), { role: 'error', text: looksLikeKeyError(msg) ? guidedKeyError() : `Chat failed: ${msg.slice(0, 2000)}` }])
    } finally {
      setSending(false)
    }
  }

  // Keep the top-bar pill honest when the key state was unknown at send time.
  async function refreshKeyHint() {
    if (keyKnown !== undefined) return
    try {
      const c = await getConfig()
      if (!c.hasOpenAiKey) setLog(l => [...l, { role: 'error', text: guidedKeyError() }])
    } catch { /* launcher down: the send error already explains it */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid #1e1e23', fontSize: 12, fontWeight: 600, color: '#d4d4d8' }}>
        AI Chat <span style={{ fontWeight: 400, color: '#71717a' }}>· Mastra</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 10, fontSize: 12.5, minHeight: 0 }}>
        {log.map((m, i) => (
          <div key={i} className={`check-row ${m.role === 'error' ? 'bad' : m.role === 'user' ? 'wait' : 'ok'}`} style={{ display: 'block' }}>
            <b style={{ color: m.role === 'user' ? '#93c5fd' : m.role === 'error' ? '#fca5a5' : '#86efac', fontSize: 11.5 }}>{m.role}</b>
            <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', color: '#d4d4d8', fontFamily: 'inherit', fontSize: 12.5 }}>{m.text.slice(0, 4000)}</pre>
            {m.role === 'error' && looksLikeKeyError(m.text) && (
              <button className="deck-btn" style={{ marginTop: 8 }} onClick={onNeedSetup}>Review setup</button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid #1e1e23' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { void send(); void refreshKeyHint() } }}
          placeholder="Ask AI to edit files..."
          className="deck-input"
          style={{ flex: 1 }}
        />
        <button onClick={() => { void send(); void refreshKeyHint() }} className="deck-btn" disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
