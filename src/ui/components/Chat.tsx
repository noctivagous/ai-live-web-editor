import React, { useEffect, useMemo, useRef, useState } from 'react'
import { chatStream, getConfig, getWorkflow, isAbortError, postWorkflow, type ChatStreamEvent, type ChatWorkflow, type DeviceTarget, type SearchBackendId, type WorkflowSnapshot } from '../lib/api'
import { groupTurns, looksLikeKeyError, slideTurns, workingSet, type TokenPricing } from '../lib/deck'
import { DeckMode, TurnStrip, TurnView, WorkingSet } from './Deck'
import {
  DEFAULT_CHAT_LOG,
  createSendGuard,
  historyForAgent,
  loadChat,
  publishChat,
  publishChatAbort,
  rebaseLocalUserItems,
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
import { ChatComposer, ChatHeader, SketchPanel } from './chatChrome'
import { slideTurnsOrDefault } from '../lib/deck'

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

const defaultSystemText = (() => {
  const first = DEFAULT_CHAT_LOG[0]
  return first && 'text' in first ? first.text : ''
})()

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

export function Chat({ activePath, keyKnown, onNeedSetup, onAfterChat, embed, projectId = '', onOpenPath, pricing }: {
  activePath: string
  keyKnown: boolean | undefined
  onNeedSetup: () => void
  onAfterChat: () => void
  embed?: boolean
  projectId?: string
  onOpenPath?: (path: string) => void
  /** Optional per-1M-token USD pricing for cost estimates; absent = tokens only. */
  pricing?: TokenPricing | null
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

  function postChatCommand(cmd: 'pick' | 'submit' | 'notes' | 'highlight' | 'unhighlight' | 'deck-open' | 'deck-close', args?: { selector?: string }) {
    try {
      window.parent.postMessage({ ns: 'ai-live-chat-cmd', cmd, ...args }, '*')
    } catch { /* no live page above us (sidebar) */ }
  }

  function openDeck() {
    setDeckOpen(true)
    // In the overlay iframe the page expands the chat window to fit the deck.
    if (inIframe) postChatCommand('deck-open')
  }

  function closeDeck() {
    setDeckOpen(false)
    if (inIframe) postChatCommand('deck-close')
  }

  function sendAndHint() {
    void send()
    void refreshKeyHint()
  }

  function insertToken(token: string) {
    setInput(v => (v && !v.endsWith(' ') ? `${v} ${token}` : `${v}${token}`))
  }
  const scroller = useRef<HTMLDivElement>(null)
  const fingerprint = useRef('')
  const sendGuardRef = useRef(createSendGuard())
  const abortRef = useRef<AbortController | null>(null)
  // Highest chat revision seen or published: receivers apply only newer revs,
  // and publishes that lose the compare-and-swap resync instead of clobbering.
  const revRef = useRef(0)
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

  async function setDeviceTarget(target: DeviceTarget) {
    // Same pattern as the workflow control: the server snapshot decides.
    try {
      const data = await postWorkflow({ deviceTarget: target })
      applySnapshot(data)
      publishWorkflowChanged()
    } catch { /* ignore */ }
  }

  async function setSearchBackend(backend: SearchBackendId) {
    try {
      const data = await postWorkflow({ searchBackend: backend })
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

  function send() {
    // /plan (§O): the planner opens as an overlay; the command itself
    // is not a chat turn. /plan, /plan-1|2|3, optionally + a goal.
    const planCmd = input.trim().match(/^\/plan(?:-([123]))?(?:\s+(.+))?$/)
    if (planCmd) {
      setInput('')
      window.dispatchEvent(new CustomEvent('ai-live:plan-open', {
        detail: { level: planCmd[1] ? Number(planCmd[1]) : undefined, goal: planCmd[2]?.trim() || undefined },
      }))
      setLog(l => [...l, { role: 'system', text: 'Planner opened — it floats over the files and preview, and this chat stays live. Ask here anytime to add, drop or reword a plan question.' }])
      return
    }
    void sendText(input)
  }

  // The plan overlay's Approve button hands execution to the chat:
  // the work happens here, in the open, with the plan tools.
  const sendTextRef = useRef<(text: string) => Promise<void>>(async () => {})
  useEffect(() => {
    const onExecute = (e: Event) => {
      const d = (e as CustomEvent).detail as { slug?: string, title?: string } | undefined
      if (!d?.slug) return
      void sendTextRef.current(
        `Execute the plan "${d.title || d.slug}" now. Read ai-plans/${d.slug}.md first, then work its tasks in order. ` +
        'For each task: call plan-update-task with status "doing" when you start it and "done" (one-line detail of what was produced) when it lands. ' +
        'Unanswered questions proceed with their default proposals. ' +
        'When every task is done, call plan-finish with the review summary.',
      )
    }
    window.addEventListener('ai-live:plan-execute', onExecute)
    return () => window.removeEventListener('ai-live:plan-execute', onExecute)
  }, [])

  async function sendText(userText: string) {
    if (!userText.trim() || sending) return
    // Synchronous double-submit guard: `sending` state arrives a render
    // late, so a second Enter/click would otherwise open a second stream
    // and both replies would append to one log.
    if (!sendGuardRef.current.tryStart()) return
    // Fast path: the top bar already knows the key state.
    if (keyKnown === false) {
      setLog(l => [...l, { role: 'user', text: userText }, { role: 'error', text: guidedKeyError(false) }])
      setInput('')
      return
    }
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
      } else if (ev.type === 'done' && ev.usage) {
        // Attach usage to the turn's last ai/tools entry; tool-only turns
        // get a usage-only marker (Deck renders no empty result card).
        const usage = ev.usage
        setLog(l => {
          for (let i = l.length - 1; i >= 0; i--) {
            const item = l[i]
            if (item.role === 'ai' || item.role === 'tools') {
              const next = [...l]
              next[i] = { ...item, usage } as LogItem
              return next
            }
            if (item.role === 'user') break
          }
          return [...l, { role: 'ai', text: '', usage }]
        })
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
      sendGuardRef.current.release()
      setSending(false)
      setWorkingLabel('')
    }
  }
  sendTextRef.current = sendText

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
      const data = ev.data as { ns?: unknown; text?: unknown; selector?: unknown } | null
      if (!data || typeof data !== 'object') return
      if (data.ns === 'ai-live-chat-insert') {
        // Overlay Ref button: drop a reference token straight into the input
        // so the user can type about it — no menu selection needed.
        if (!inIframe) return
        const text = typeof data.text === 'string' ? data.text : ''
        const selector = typeof data.selector === 'string' ? data.selector : ''
        const token = text ? `note: "${text}"` : selector ? `@${selector}` : ''
        if (token) setInput(token)
        return
      }
      if (data.ns !== 'ai-live-annotations') return
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
    revRef.current = loaded.rev
    fingerprint.current = JSON.stringify({ log: loaded.log, sending: loaded.sending, workingLabel: loaded.workingLabel })
    setLog(loaded.log)
    setSending(loaded.sending)
    setWorkingLabel(loaded.workingLabel)
    return subscribeChat(projectId, (state) => {
      // Stale or echo: only newer revisions move the log.
      if (state.rev <= revRef.current) return
      revRef.current = state.rev
      fingerprint.current = JSON.stringify({ log: state.log, sending: state.sending, workingLabel: state.workingLabel })
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
      const winner = publishChat({ v: 1, projectId: projectId || 'default', log, sending, workingLabel, updatedAt: Date.now(), rev: revRef.current + 1 })
      if (winner.rev === revRef.current + 1) {
        revRef.current = winner.rev
        return
      }
      // Refused: a newer state won elsewhere. Resync to it, keeping any
      // local user message it lacks, then publish the merge once. If that
      // merge is refused too, keep it locally — the effect re-fires and
      // republishes at the new rev, so the message still lands.
      const merged = rebaseLocalUserItems(log, winner.log)
      const final = merged === winner.log
        ? winner
        : publishChat({ ...winner, log: merged, updatedAt: Date.now(), rev: winner.rev + 1 })
      revRef.current = final.rev
      fingerprint.current = JSON.stringify({ log: final.log, sending: final.sending, workingLabel: final.workingLabel })
      const viewLog = final.log !== merged && merged !== winner.log ? merged : final.log
      if (viewLog !== log) setLog(viewLog)
      if (final.sending !== sending) setSending(final.sending)
      if (final.workingLabel !== workingLabel) setWorkingLabel(final.workingLabel)
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

  const chatTokens = useMemo(() => {
    let total = 0
    let seen = false
    for (const item of log) {
      if (item.usage) {
        seen = true
        total += item.usage.total
      }
    }
    return seen ? total : null
  }, [log])
  const turns = useMemo(() => groupTurns(log, { sending }), [log, sending])
  const slides = useMemo(() => slideTurnsOrDefault(turns, defaultSystemText), [turns])
  const touchedFiles = useMemo(() => workingSet(log), [log])
  const turnAnchor = (index: number) => `deck-turn-${projectId || 'default'}-${index}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ChatHeader
        workflow={workflow}
        deviceTarget={sketch?.deviceTarget ?? 'desktop'}
        selfMode={sketch?.selfMode}
        selfCheck={sketch?.selfCheck}
        searchBackend={sketch?.searchBackend}
        searchOptions={sketch?.searchOptions}
        plan={sketch?.plan}
        onOpenPlan={() => window.dispatchEvent(new CustomEvent('ai-live:plan-open', { detail: {} }))}
        sending={sending}
        workingLabel={workingLabel}
        showDeckButton
        tokenTotal={chatTokens}
        onWorkflowMode={(mode) => void setWorkflowMode(mode)}
        onDeviceTarget={(target) => void setDeviceTarget(target)}
        onSearchBackend={(backend) => void setSearchBackend(backend)}
        onClear={clearChat}
        onOpenDeck={openDeck}
      />
      <SketchPanel
        workflow={workflow}
        sketch={sketch}
        sending={sending}
        onSketchAction={(action) => void sketchAction(action)}
      />
      <TurnStrip turns={turns} pricing={pricing} onJump={(turn) => {
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
      <ChatComposer
        input={input}
        sending={sending}
        workflow={workflow}
        annot={annot}
        inIframe={inIframe}
        onInput={setInput}
        onSend={sendAndHint}
        onStop={stop}
        onPick={() => postChatCommand('pick')}
        onSubmit={() => postChatCommand('submit')}
        onInsertToken={insertToken}
        onHighlightChip={(selector) => postChatCommand(selector ? 'highlight' : 'unhighlight', selector ? { selector } : undefined)}
      />
      {deckOpen && (
        <DeckMode
          turns={slides}
          sending={sending}
          workingLabel={workingLabel}
          onClose={closeDeck}
          onNeedSetup={onNeedSetup}
          onOpenPath={onOpenPath}
          workflow={workflow}
          onWorkflowMode={(mode) => void setWorkflowMode(mode)}
          deviceTarget={sketch?.deviceTarget ?? 'desktop'}
          onDeviceTarget={(target) => void setDeviceTarget(target)}
          onSearchBackend={(backend) => void setSearchBackend(backend)}
          onClear={clearChat}
          sketch={sketch}
          onSketchAction={(action) => void sketchAction(action)}
          input={input}
          onInput={setInput}
          onSend={sendAndHint}
          onStop={stop}
          annot={annot}
          inIframe={inIframe}
          onPick={() => postChatCommand('pick')}
          onSubmit={() => postChatCommand('submit')}
          onInsertToken={insertToken}
          pricing={pricing}
        />
      )}
    </div>
  )
}
