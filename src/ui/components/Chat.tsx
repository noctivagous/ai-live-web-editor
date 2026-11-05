import React, { useEffect, useRef, useState } from 'react'
import { chatStream, getConfig, type ChatStreamEvent } from '../lib/api'

function looksLikeKeyError(text: string): boolean {
  return /api.?key|401|unauthorized|invalid_api_key|incorrect api key/i.test(text)
}

function previewPartialArgs(name: string, raw: string): string {
  const n = name || 'tool'
  if (!raw) return `${n}…`
  try {
    const a = JSON.parse(raw) as Record<string, unknown>
    const bits = [n]
    if (typeof a.path === 'string') bits.push(a.path)
    else if (typeof a.selector === 'string') bits.push(a.selector)
    if (typeof a.content === 'string') bits.push(`${a.content.length} chars`)
    return bits.join(' ')
  } catch { /* still streaming */ }
  const path = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const selector = raw.match(/"selector"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const target = (path?.[1] || selector?.[1] || '').replace(/\\"/g, '"')
  if (target) return `${n} ${target}`
  return `${n}…`
}

type ToolStep = { id: string, name: string, detail: string, result?: string, status: 'running' | 'done' | 'error' }
type LogItem =
  | { role: 'system' | 'user' | 'ai' | 'error' | 'think', text: string }
  | { role: 'tools', steps: ToolStep[] }

function upsertToolStep(log: LogItem[], step: ToolStep): LogItem[] {
  const last = log[log.length - 1]
  if (last && last.role === 'tools') {
    const idx = last.steps.findIndex(s => s.id === step.id)
    const steps = idx >= 0
      ? last.steps.map((s, i) => i === idx ? { ...s, ...step, result: step.result ?? s.result } : s)
      : [...last.steps, step]
    return [...log.slice(0, -1), { role: 'tools', steps }]
  }
  return [...log, { role: 'tools', steps: [step] }]
}

function appendRole(log: LogItem[], role: 'ai' | 'think', text: string): LogItem[] {
  const last = log[log.length - 1]
  if (last && last.role === role) return [...log.slice(0, -1), { role, text }]
  return [...log, { role, text }]
}

export function Chat({ activePath, keyKnown, onNeedSetup, onAfterChat, embed }: {
  activePath: string
  keyKnown: boolean | undefined
  onNeedSetup: () => void
  onAfterChat: () => void
  embed?: boolean
}) {
  const [log, setLog] = useState<LogItem[]>([
    { role: 'system', text: 'AI has real FS tools (read/write) and live-page inspect/patch/eval on the Vite app. Ask: "inspect the page" or "make this a todo app"' }
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [workingLabel, setWorkingLabel] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  function guidedKeyError(hasKey: boolean): string {
    if (hasKey) {
      return 'The OpenAI-compatible provider rejected this API key.\n\n'
        + '1. Open Settings or Review setup.\n'
        + '2. Paste a valid key from any OpenAI-compatible provider.\n'
        + '3. Set the matching base URL and model, then Save — it applies immediately.'
    }
    return 'AI chat needs an OpenAI-compatible API key on the launcher.\n\n'
      + '1. Open Review setup and paste a key from any OpenAI-compatible provider.\n'
      + '2. Optionally set a base URL and model, then Save — it is written to .env and applied immediately.\n'
      + '3. Ask the agent to edit or generate files.'
  }

  async function send() {
    if (!input.trim() || sending) return
    // Fast path: the top bar already knows the key state.
    if (keyKnown === false) {
      setLog(l => [...l, { role: 'user', text: input }, { role: 'error', text: guidedKeyError(false) }])
      setInput('')
      return
    }
    const userText = input
    setLog(l => [...l, { role: 'user', text: userText }])
    setInput('')
    setSending(true)
    setWorkingLabel('starting…')
    let aiText = ''
    let thinkText = ''
    let wroteFiles = false
    const toolArgs: Record<string, string> = {}
    const applyEvent = (ev: ChatStreamEvent) => {
      if (ev.type === 'status') {
        setWorkingLabel(ev.text)
      } else if (ev.type === 'reasoning-delta') {
        thinkText += ev.text
        setWorkingLabel('thinking…')
        setLog(l => appendRole(l, 'think', thinkText))
      } else if (ev.type === 'tool-call') {
        setWorkingLabel(ev.detail || ev.name)
        setLog(l => upsertToolStep(l, { id: ev.id, name: ev.name, detail: ev.detail, status: 'running' }))
        if (ev.name === 'write-real-file' || ev.name === 'writeRealFileTool') wroteFiles = true
      } else if (ev.type === 'tool-delta') {
        toolArgs[ev.id] = (toolArgs[ev.id] || '') + ev.text
        const detail = previewPartialArgs(ev.name, toolArgs[ev.id])
        setWorkingLabel(detail)
        setLog(l => upsertToolStep(l, { id: ev.id, name: ev.name, detail, status: 'running' }))
        if (ev.name === 'write-real-file' || ev.name === 'writeRealFileTool') wroteFiles = true
      } else if (ev.type === 'tool-result') {
        setWorkingLabel(ev.ok ? ev.detail : ev.detail)
        setLog(l => {
          const last = l[l.length - 1]
          if (!last || last.role !== 'tools') {
            return upsertToolStep(l, {
              id: ev.id, name: ev.name, detail: ev.name, result: ev.detail, status: ev.ok ? 'done' : 'error',
            })
          }
          return [...l.slice(0, -1), {
            role: 'tools',
            steps: last.steps.map(s => s.id === ev.id
              ? { ...s, status: ev.ok ? 'done' : 'error', result: ev.detail }
              : s),
          }]
        })
      } else if (ev.type === 'text-delta') {
        aiText += ev.text
        setWorkingLabel('writing…')
        setLog(l => appendRole(l, 'ai', aiText))
      } else if (ev.type === 'error') {
        const msg = ev.error
        setLog(l => [...l, { role: 'error', text: looksLikeKeyError(msg) ? guidedKeyError(keyKnown === true) : `Chat failed: ${msg.slice(0, 2000)}` }])
      }
    }
    try {
      await chatStream([{ role: 'user', content: userText + ` Current file: ${activePath}` }], applyEvent)
      if (wroteFiles) onAfterChat()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setLog(l => [...l, { role: 'error', text: looksLikeKeyError(msg) ? guidedKeyError(keyKnown === true) : `Chat failed: ${msg.slice(0, 2000)}` }])
    } finally {
      setSending(false)
      setWorkingLabel('')
    }
  }

  // Keep the top-bar pill honest when the key state was unknown at send time.
  async function refreshKeyHint() {
    if (keyKnown !== undefined) return
    try {
      const c = await getConfig()
      if (!(c.hasApiKey ?? c.hasOpenAiKey)) setLog(l => [...l, { role: 'error', text: guidedKeyError(false) }])
    } catch { /* launcher down: the send error already explains it */ }
  }

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, sending, workingLabel])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid #1e1e23', fontSize: 12, fontWeight: 600, color: '#d4d4d8', display: 'flex', alignItems: 'center', gap: 8 }}>
        AI Chat <span style={{ fontWeight: 400, color: '#71717a' }}>· Mastra</span>
        {sending && (
          <span className="pill warn" style={{ marginLeft: 'auto', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span className="dot" />{workingLabel || 'working'}
          </span>
        )}
      </div>
      <div ref={scroller} style={{ flex: 1, overflow: 'auto', padding: 10, fontSize: 12.5, minHeight: 0 }}>
        {log.map((m, i) => (
          m.role === 'tools' ? (
            <div key={i} className="chat-tools">
              {m.steps.map(s => (
                <div key={s.id} className={`chat-tool ${s.status}`}>
                  <div>
                    {s.status === 'running' ? '…' : s.status === 'error' ? '✕' : '✓'} {s.detail || s.name}
                  </div>
                  {s.result && s.result !== s.detail && (
                    <div className="chat-tool-result">{s.result}</div>
                  )}
                </div>
              ))}
            </div>
          ) : m.role === 'think' ? (
            <div key={i} className="chat-think">
              <b>thinking</b>
              <pre>{m.text.slice(0, 8000)}</pre>
            </div>
          ) : (
            <div key={i} className={`check-row ${m.role === 'error' ? 'bad' : m.role === 'user' ? 'wait' : 'ok'}`} style={{ display: 'block' }}>
              <b style={{ color: m.role === 'user' ? '#93c5fd' : m.role === 'error' ? '#fca5a5' : '#86efac', fontSize: 11.5 }}>{m.role}</b>
              <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', color: '#d4d4d8', fontFamily: 'inherit', fontSize: 12.5 }}>{m.text.slice(0, 8000)}</pre>
              {m.role === 'error' && looksLikeKeyError(m.text) && (
                <button className="deck-btn" style={{ marginTop: 8 }} onClick={onNeedSetup}>
                  {embed ? 'Open launcher Settings' : 'Review setup'}
                </button>
              )}
            </div>
          )
        ))}
        {sending && !log.some((item, idx) => idx === log.length - 1 && (item.role === 'tools' || item.role === 'ai' || item.role === 'think')) && (
          <div className="chat-think"><b>working</b><pre>{workingLabel || 'starting…'}</pre></div>
        )}
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
