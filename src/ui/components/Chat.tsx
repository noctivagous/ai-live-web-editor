import React, { useEffect, useRef, useState } from 'react'
import { chatStream, getConfig, getWorkflow, isAbortError, postWorkflow, type ChatStreamEvent, type ChatWorkflow, type WorkflowSnapshot } from '../lib/api'
import { groupTurns, looksLikeKeyError, slideTurns, workingSet } from '../lib/deck'
import { DeckMode, TurnStrip, TurnView, WorkingSet } from './Deck'
import {
  DEFAULT_CHAT_LOG,
  historyForAgent,
  loadChat,
  publishChat,
  publishChatAbort,
  subscribeChat,
  withStopped,
  type LogItem,
  type ToolStep,
} from '../lib/chatSession'
import {
  parseWorkflowSnapshot,
  publishWorkflowChanged,
  subscribeWorkflow,
  workflowSnapshotsEqual,
} from '../lib/workflowSync'
import {
  annotationDigestsEqual,
  emptyAnnotationDigest,
  loadAnnotationDigest,
  parseAnnotationDigest,
  publishAnnotations,
  subscribeAnnotations,
  type AnnotationDigest,
} from '../lib/annotationSync'
import { abbreviateSelector, elementToken, noteToken } from '../lib/annotateChips'

function isWriteTool(name: string): boolean {
  return name === 'write-real-file' || name === 'str-replace' || name === 'writeRealFileTool'
}

function previewPartialArgs(name: string, raw: string): string {
  const n = name || 'tool'
  if (!raw) return `${n}…`
  try {
    const a = JSON.parse(raw) as Record<string, unknown>
    const bits = [n]
    if (typeof a.path === 'string') bits.push(a.path)
    else if (typeof a.selector === 'string') bits.push(a.selector)
    if (typeof a.target === 'string') bits.push(a.target)
    if (typeof a.pattern === 'string') bits.push(a.pattern.slice(0, 40))
    if (typeof a.op === 'string') bits.push(a.op)
    if (typeof a.position === 'string') bits.push(a.position)
    if (typeof a.text === 'string') bits.push(a.text.slice(0, 40))
    if (typeof a.old_string === 'string') bits.push(`${a.old_string.length}→${typeof a.new_string === 'string' ? a.new_string.length : 0}`)
    if (typeof a.content === 'string') bits.push(`${a.content.length} chars`)
    return bits.join(' ')
  } catch { /* still streaming */ }
  const path = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const selector = raw.match(/"selector"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const target = (path?.[1] || selector?.[1] || '').replace(/\\"/g, '"')
  if (target) return `${n} ${target}`
  return `${n}…`
}

function stampStep(step: ToolStep, prev?: ToolStep): ToolStep {
  const startedAt = prev?.startedAt ?? step.startedAt ?? (step.status === 'running' ? Date.now() : undefined)
  const endedAt = prev?.endedAt ?? step.endedAt ?? (startedAt != null && step.status !== 'running' ? Date.now() : undefined)
  return { ...prev, ...step, result: step.result ?? prev?.result, startedAt, endedAt }
}

function upsertToolStep(log: LogItem[], step: ToolStep): LogItem[] {
  const last = log[log.length - 1]
  if (last && last.role === 'tools') {
    const idx = last.steps.findIndex(s => s.id === step.id)
    const steps = idx >= 0
      ? last.steps.map((s, i) => i === idx ? stampStep(step, s) : s)
      : [...last.steps, stampStep(step)]
    return [...log.slice(0, -1), { role: 'tools', steps }]
  }
  return [...log, { role: 'tools', steps: [stampStep(step)] }]
}

function appendRole(log: LogItem[], role: 'ai' | 'think', text: string): LogItem[] {
  const last = log[log.length - 1]
  if (last && last.role === role) return [...log.slice(0, -1), { role, text }]
  return [...log, { role, text }]
}

export function Chat({ activePath, keyKnown, onNeedSetup, onAfterChat, embed, projectId = '', onOpenPath }: {
  activePath: string
  keyKnown: boolean | undefined
  onNeedSetup: () => void
  onAfterChat: () => void
  embed?: boolean
  projectId?: string
  onOpenPath?: (path: string) => void
}) {
  const [log, setLog] = useState<LogItem[]>(() => loadChat(projectId).log)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(() => loadChat(projectId).sending)
  const [workingLabel, setWorkingLabel] = useState(() => loadChat(projectId).workingLabel)
  const [workflow, setWorkflow] = useState<ChatWorkflow>('files')
  const [deckOpen, setDeckOpen] = useState(false)
  const [sketch, setSketch] = useState<WorkflowSnapshot | null>(null)
  // Page annotations from the live page. Only the embed iframe hears the page
  // directly (postMessage); it re-publishes so the sidebar shows the same chips.
  const [annot, setAnnot] = useState<AnnotationDigest>(() => loadAnnotationDigest() || emptyAnnotationDigest())
  const inIframe = typeof window !== 'undefined' && window.parent !== window

  function applyDigest(next: AnnotationDigest) {
    setAnnot(prev => (annotationDigestsEqual(prev, next) ? prev : next))
  }

  function postChatCommand(cmd: 'pick' | 'submit' | 'notes') {
    try {
      window.parent.postMessage({ ns: 'ai-live-chat-cmd', cmd }, '*')
    } catch { /* no live page above us (sidebar) */ }
  }

  function insertToken(token: string) {
    setInput(v => (v && !v.endsWith(' ') ? `${v} ${token}` : `${v}${token}`))
  }
  const scroller = useRef<HTMLDivElement>(null)
  const fingerprint = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  // Last server snapshot: guards polling/peer refreshes so identical snapshots
  // never reset state (which would re-render and yank the scroll position).
  const sketchRef = useRef('')

  // The launcher is the source of truth; both Chat instances (sidebar and the
  // live-window /chat-embed) converge on it, so the Files | Live sketch
  // control matches in all aspects: seg selection, sketch panel, patch list,
  // action buttons, and input placeholder.
  function applySnapshot(data: unknown): boolean {
    const parsed = parseWorkflowSnapshot(data)
    if (!parsed) return false
    setSketch(prev => (prev && workflowSnapshotsEqual(prev, parsed) ? prev : parsed))
    setWorkflow(prev => (prev === parsed.mode ? prev : parsed.mode))
    const key = JSON.stringify({ mode: parsed.mode, accepted: parsed.accepted, patches: parsed.patches })
    const changed = key !== sketchRef.current
    sketchRef.current = key
    return changed
  }

  async function refreshWorkflow() {
    try {
      const data = await getWorkflow()
      applySnapshot(data)
    } catch { /* launcher down */ }
  }

  async function setWorkflowMode(mode: ChatWorkflow) {
    // No local early-return: the click declares intent to the server, and the
    // server snapshot (broadcast to the other Chat) decides what sticks.
    try {
      const data = await postWorkflow({ mode })
      applySnapshot(data)
      publishWorkflowChanged()
    } catch { /* ignore */ }
  }

  async function sketchAction(action: 'undo' | 'discard' | 'accept') {
    try {
      const data = await postWorkflow({ action })
      applySnapshot(data)
      publishWorkflowChanged()
    } catch { /* ignore */ }
  }

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
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let aiText = ''
    let thinkText = ''
    let wroteFiles = false
    const toolArgs: Record<string, string> = {}
    const applyEvent = (ev: ChatStreamEvent) => {
      if (ev.type === 'status') {
        setWorkingLabel(ev.text)
      } else if (ev.type === 'workflow') {
        // Server auto-routed this turn: pull the full snapshot (mode + patches)
        // and tell the other Chat instance to do the same.
        void refreshWorkflow().then(() => publishWorkflowChanged())
        if (ev.reason) setLog(l => [...l, { role: 'system', text: ev.reason }])
      } else if (ev.type === 'reasoning-delta') {
        thinkText += ev.text
        setWorkingLabel('thinking…')
        setLog(l => appendRole(l, 'think', thinkText))
      } else if (ev.type === 'tool-call') {
        setWorkingLabel(ev.detail || ev.name)
        setLog(l => upsertToolStep(l, { id: ev.id, name: ev.name, detail: ev.detail, status: 'running' }))
        if (isWriteTool(ev.name)) wroteFiles = true
      } else if (ev.type === 'tool-delta') {
        toolArgs[ev.id] = (toolArgs[ev.id] || '') + ev.text
        const detail = previewPartialArgs(ev.name, toolArgs[ev.id])
        setWorkingLabel(detail)
        setLog(l => upsertToolStep(l, { id: ev.id, name: ev.name, detail, status: 'running' }))
        if (isWriteTool(ev.name)) wroteFiles = true
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
              ? stampStep({ ...s, status: ev.ok ? 'done' : 'error', result: ev.detail }, s)
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
      await chatStream(historyForAgent(log, userText, activePath), applyEvent, ctrl.signal, workflow)
      if (ctrl.signal.aborted) {
        setLog(withStopped)
      } else {
        // The agent may have added sketch patches or triggered an auto-route;
        // converge this instance and broadcast so the other Chat follows.
        await refreshWorkflow()
        publishWorkflowChanged()
        if (wroteFiles) onAfterChat()
      }
    } catch (e: unknown) {
      if (isAbortError(e) || ctrl.signal.aborted) {
        setLog(withStopped)
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        setLog(l => [...l, { role: 'error', text: looksLikeKeyError(msg) ? guidedKeyError(keyKnown === true) : `Chat failed: ${msg.slice(0, 2000)}` }])
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setSending(false)
      setWorkingLabel('')
    }
  }

  function stop() {
    publishChatAbort(projectId)
    if (abortRef.current) {
      abortRef.current.abort()
      return
    }
    setSending(false)
    setWorkingLabel('')
    setLog(withStopped)
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
    void refreshWorkflow()
  }, [])

  // Annotation bridge: hear the live page (embed only), relay to the sidebar,
  // and pick up the relayed digest (sidebar). Late joiners read the stored one.
  useEffect(() => {
    const stored = loadAnnotationDigest()
    if (stored) applyDigest(stored)
    const off = subscribeAnnotations((digest) => { applyDigest(digest) })
    const onMessage = (ev: MessageEvent) => {
      // Direct from the live page (reaches the embed iframe only): render the
      // chips here and relay to the sidebar. Sidebar relays arrive through
      // subscribeAnnotations above, never through window messages.
      const data = ev.data as { ns?: unknown } | null
      if (!data || typeof data !== 'object' || data.ns !== 'ai-live-annotations') return
      const parsed = parseAnnotationDigest(data)
      if (!parsed) return
      applyDigest(parsed)
      publishAnnotations(parsed)
    }
    window.addEventListener('message', onMessage)
    try {
      window.parent.postMessage({ ns: 'ai-live-chat-hello' }, '*')
    } catch { /* top-level window */ }
    return () => {
      off()
      window.removeEventListener('message', onMessage)
    }
  }, [])

  // Keep the Files | Live sketch control in sync with the other Chat instance:
  // instant refresh on peer changes, plus a slow poll and focus refresh to
  // catch server-side switches (auto-route, agent-added patches). Identical
  // snapshots are dropped by applySnapshot, so this never disturbs the view.
  useEffect(() => {
    const off = subscribeWorkflow(() => { void refreshWorkflow() })
    const timer = setInterval(() => { void refreshWorkflow() }, 3000)
    const onFocus = () => { void refreshWorkflow() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      off()
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  useEffect(() => {
    const loaded = loadChat(projectId)
    fingerprint.current = JSON.stringify({ log: loaded.log, sending: loaded.sending, workingLabel: loaded.workingLabel })
    setLog(loaded.log)
    setSending(loaded.sending)
    setWorkingLabel(loaded.workingLabel)
    return subscribeChat(projectId, (state) => {
      const next = JSON.stringify({ log: state.log, sending: state.sending, workingLabel: state.workingLabel })
      if (next === fingerprint.current) return
      fingerprint.current = next
      setLog(state.log)
      setSending(state.sending)
      setWorkingLabel(state.workingLabel)
    }, () => {
      abortRef.current?.abort()
    })
  }, [projectId])

  useEffect(() => {
    const next = JSON.stringify({ log, sending, workingLabel })
    if (next === fingerprint.current) return
    fingerprint.current = next
    const t = setTimeout(() => {
      publishChat({ v: 1, projectId: projectId || 'default', log, sending, workingLabel, updatedAt: Date.now() })
    }, sending ? 80 : 0)
    return () => clearTimeout(t)
  }, [log, sending, workingLabel, projectId])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, sending, workingLabel, sketch])

  function clearChat() {
    if (sending) return
    setLog(DEFAULT_CHAT_LOG)
    setWorkingLabel('')
  }

  const turns = groupTurns(log, { sending })
  const slides = slideTurns(turns)
  const touchedFiles = workingSet(log)
  const turnAnchor = (index: number) => `deck-turn-${projectId || 'default'}-${index}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid #1e1e23', fontSize: 12, fontWeight: 600, color: '#d4d4d8', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        AI Chat <span style={{ fontWeight: 400, color: '#71717a' }}>· Mastra</span>
        <div className="seg" role="group" aria-label="Chat workflow">
          <button type="button" className={workflow === 'files' ? 'on' : ''} disabled={sending} onClick={() => void setWorkflowMode('files')}>Files</button>
          <button type="button" className={workflow === 'sketch' ? 'on' : ''} disabled={sending} onClick={() => void setWorkflowMode('sketch')}>Live sketch</button>
        </div>
        <button type="button" className="deck-btn" disabled={sending} onClick={clearChat} title="Clear this chat" style={{ marginLeft: 'auto', padding: '4px 8px' }}>Clear</button>
        {!embed && (
          <button type="button" className="deck-btn" onClick={() => setDeckOpen(true)} title="Open Deck mode — turns as horizontal slides (← → navigate, O overview)" style={{ padding: '4px 8px' }}>Deck ⤢</button>
        )}
        {sending && (
          <span className="pill warn" style={{ maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span className="dot" />{workingLabel || 'working'}
          </span>
        )}
      </div>
      {workflow === 'sketch' && (
        <div className="sketch-panel">
          <div className="sketch-banner">Disk writes paused. Patches stay on the page until Discard or HMR.</div>
          {(sketch?.patches || []).map(p => (
            <div key={p.id} className="sketch-patch">{p.detail || `${p.op} ${p.selector}`}</div>
          ))}
          <div className="sketch-actions">
            <button type="button" className="deck-btn" disabled={!sketch?.patches?.length || sending} onClick={() => void sketchAction('undo')}>Undo last</button>
            <button type="button" className="deck-btn" disabled={!sketch?.patches?.length || sending} onClick={() => void sketchAction('discard')}>Discard</button>
            <button type="button" className="deck-btn primary" disabled={!sketch?.patches?.length || sending} onClick={() => void sketchAction('accept')}>Accept (keep on page)</button>
          </div>
        </div>
      )}
      <TurnStrip turns={turns} onJump={(turn) => {
        document.getElementById(turnAnchor(turn.index))?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }} />
      <div ref={scroller} style={{ flex: 1, overflow: 'auto', padding: 10, fontSize: 12.5, minHeight: 0 }}>
        {turns.map(turn => (
          <TurnView key={turn.index} turn={turn} anchorId={turnAnchor(turn.index)} onNeedSetup={onNeedSetup} embed={embed} />
        ))}
        {sending && !log.some((item, idx) => idx === log.length - 1 && (item.role === 'tools' || item.role === 'ai' || item.role === 'think')) && (
          <div className="dcard dcard-reason"><div className="dcard-label">Working</div><pre className="dcard-pre plain">{workingLabel || 'starting…'}</pre></div>
        )}
      </div>
      <WorkingSet files={touchedFiles} onOpen={onOpenPath} />
      <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid #1e1e23' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && sending) {
              e.preventDefault()
              stop()
              return
            }
            if (e.key === 'Enter' && !sending) { void send(); void refreshKeyHint() }
          }}
          placeholder={workflow === 'sketch' ? 'Patch the live page…' : 'Ask AI to edit files...'}
          className="deck-input"
          style={{ flex: 1 }}
        />
        {sending ? (
          <button type="button" onClick={stop} className="deck-btn danger" title="Stop this turn (Esc)">
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => { void send(); void refreshKeyHint() }} className="deck-btn">
            Send
          </button>
        )}
      </div>
      <div className="ws-chips" title="Page annotations from the live page — click a chip to insert it">
        <span className="ws-label">Annotate</span>
        {inIframe && (
          <button type="button" className="deck-btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={sending} onClick={() => postChatCommand('pick')} title="Pick an element on the live page">
            Pick
          </button>
        )}
        {annot.selection && (
          <button
            type="button"
            className="ws-chip mono"
            onClick={() => insertToken(elementToken(annot.selection || ''))}
            title={`Insert ${annot.selection}`}
          >@{abbreviateSelector(annot.selection)}</button>
        )}
        {annot.annotations.map(a => (
          <button
            type="button"
            key={a.id || `${a.selector}-${a.text}`}
            className="ws-chip"
            onClick={() => insertToken(noteToken(a.text || a.selector))}
            title={`${a.selector}${a.text ? ` — ${a.text}` : ''}`}
          >{a.abbr || abbreviateSelector(a.selector)}</button>
        ))}
        {annot.pageNote.present && (
          <button
            type="button"
            className="ws-chip"
            onClick={() => insertToken(noteToken(annot.pageNote.abbr))}
            title={`Page note (${annot.pageNote.len} chars) — inserts the visible summary`}
          >note: {annot.pageNote.abbr || `${annot.pageNote.len} chars`}</button>
        )}
        {!annot.selection && !annot.annotations.length && !annot.pageNote.present && (
          <span className="field-hint" style={{ marginTop: 0 }}>
            {inIframe ? 'Pick an element on the live page to attach notes.' : 'Annotate on the live page — chips appear here.'}
          </span>
        )}
        {inIframe && (annot.selection || annot.annotations.length || annot.pageNote.present) && (
          <button type="button" className="deck-btn primary" style={{ padding: '2px 8px', fontSize: 11 }} disabled={sending} onClick={() => postChatCommand('submit')} title="Send page notes to the AI">
            Submit
          </button>
        )}
      </div>
      {deckOpen && (
        <DeckMode
          turns={slides}
          sending={sending}
          workingLabel={workingLabel}
          onClose={() => setDeckOpen(false)}
          onNeedSetup={onNeedSetup}
          onOpenPath={onOpenPath}
        />
      )}
    </div>
  )
}
