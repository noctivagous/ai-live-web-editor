/** Persist and sync Chat across the 4112 sidebar and /chat-embed (same origin). */

export type ToolStep = { id: string, name: string, detail: string, result?: string, status: 'running' | 'done' | 'error', startedAt?: number, endedAt?: number }
export type LogItem =
  | { role: 'system' | 'user' | 'ai' | 'error' | 'think', text: string }
  | { role: 'tools', steps: ToolStep[] }

export type ChatShared = {
  v: 1
  projectId: string
  log: LogItem[]
  sending: boolean
  workingLabel: string
  updatedAt: number
}

export const CHAT_CHANNEL = 'ai-live-editor.chat'
export const STOPPED_TEXT = 'Stopped.'
export const DEFAULT_CHAT_LOG: LogItem[] = [
  { role: 'system', text: 'AI has real FS tools (read/write) and live-page inspect/patch/eval on the Vite app. Ask: "inspect the page" or "make this a todo app"' },
]

const LOG_CAP = 80

export function chatStorageKey(projectId: string) {
  return `ai-live-editor.chat.${projectId || 'default'}`
}

function clipLog(log: LogItem[]): LogItem[] {
  const next = log.slice(-LOG_CAP).map((item) => {
    if (item.role === 'tools') return item
    return { ...item, text: item.text.slice(0, item.role === 'think' ? 4000 : 8000) }
  })
  return next.length ? next : DEFAULT_CHAT_LOG
}

export function parseChat(raw: unknown, projectId: string): ChatShared | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (row.v !== 1 || !Array.isArray(row.log)) return null
  const id = projectId || 'default'
  if (typeof row.projectId === 'string' && row.projectId !== id) return null
  return {
    v: 1,
    projectId: id,
    log: clipLog(row.log as LogItem[]),
    sending: Boolean(row.sending),
    workingLabel: typeof row.workingLabel === 'string' ? row.workingLabel : '',
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  }
}

export function serializeChat(state: ChatShared): string {
  return JSON.stringify({
    v: 1,
    projectId: state.projectId || 'default',
    log: clipLog(state.log),
    sending: state.sending,
    workingLabel: state.workingLabel,
    updatedAt: state.updatedAt,
  })
}

export function emptyChat(projectId: string): ChatShared {
  return {
    v: 1,
    projectId: projectId || 'default',
    log: DEFAULT_CHAT_LOG,
    sending: false,
    workingLabel: '',
    updatedAt: Date.now(),
  }
}

export function loadChat(projectId: string): ChatShared {
  try {
    const raw = localStorage.getItem(chatStorageKey(projectId))
    if (!raw) return emptyChat(projectId)
    return parseChat(JSON.parse(raw), projectId) || emptyChat(projectId)
  } catch {
    return emptyChat(projectId)
  }
}

export function saveChat(state: ChatShared) {
  try {
    localStorage.setItem(chatStorageKey(state.projectId), serializeChat(state))
  } catch { /* quota / private mode */ }
}

export function withStopped(log: LogItem[]): LogItem[] {
  let next = log
  const last = log[log.length - 1]
  if (last && last.role === 'tools' && last.steps.some((s) => s.status === 'running')) {
    next = [...log.slice(0, -1), {
      role: 'tools',
      steps: last.steps.map((s) => s.status === 'running'
        ? { ...s, status: 'error', result: s.result || 'stopped' }
        : s),
    }]
  }
  const tail = next[next.length - 1]
  if (tail && tail.role === 'system' && tail.text === STOPPED_TEXT) return next
  return [...next, { role: 'system', text: STOPPED_TEXT }]
}

export function subscribeChat(
  projectId: string,
  onChange: (state: ChatShared) => void,
  onAbort?: () => void,
): () => void {
  const id = projectId || 'default'
  const apply = (raw: unknown) => {
    const parsed = parseChat(raw, projectId)
    if (parsed) onChange(parsed)
  }
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(CHAT_CHANNEL)
    ch.onmessage = (ev) => {
      const data = ev.data as { type?: string, projectId?: string } | ChatShared | null
      if (data && typeof data === 'object' && (data as { type?: string }).type === 'abort') {
        const pid = typeof (data as { projectId?: string }).projectId === 'string'
          ? (data as { projectId: string }).projectId
          : 'default'
        if (pid === id) onAbort?.()
        return
      }
      apply(ev.data)
    }
  } catch { /* unsupported */ }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== chatStorageKey(projectId) || !e.newValue) return
    try { apply(JSON.parse(e.newValue)) } catch { /* ignore */ }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('storage', onStorage)
    try { ch?.close() } catch { /* ignore */ }
  }
}

export function publishChatAbort(projectId: string) {
  try {
    const ch = new BroadcastChannel(CHAT_CHANNEL)
    ch.postMessage({ type: 'abort', projectId: projectId || 'default' })
    ch.close()
  } catch { /* unsupported */ }
}

export function publishChat(state: ChatShared) {
  saveChat(state)
  try {
    const ch = new BroadcastChannel(CHAT_CHANNEL)
    ch.postMessage(state)
    ch.close()
  } catch { /* unsupported */ }
}

export function historyForAgent(log: LogItem[], userText: string, activePath: string) {
  const turns = log.filter((m) => m.role === 'user' || m.role === 'ai').slice(-12)
  const messages = turns.map((m) => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: (m as { text: string }).text,
  }))
  messages.push({ role: 'user', content: `${userText} Current file: ${activePath}` })
  return messages
}
