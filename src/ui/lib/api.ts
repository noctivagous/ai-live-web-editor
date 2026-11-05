const API = import.meta.env.VITE_API_URL ?? ''

export function staticPreviewUrl(): string {
  return API.replace(/\/*$/, '') + '/projects/'
}

export async function listFiles() {
  const r = await fetch(`${API}/api/fs/list`)
  return r.json() as Promise<{files: string[], root: string}>
}
export async function readFile(path: string) {
  const r = await fetch(`${API}/api/fs/read?path=${encodeURIComponent(path)}`)
  return r.json() as Promise<{path: string, content?: string, error?: string}>
}
export async function writeFile(path: string, content: string) {
  const r = await fetch(`${API}/api/fs/write`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({path, content})
  })
  return r.json()
}
export interface LauncherConfig {
  ok: boolean
  hasApiKey: boolean
  hasOpenAiKey: boolean
  model: string
  modelName: string
  modelId?: string
  providerId?: string | null
  providerName?: string | null
  baseUrl: string
  launcherUrl: string
  previewStaticUrl: string
  previewHmrUrl: string
  workspace?: string
  activeProject?: string
  fsRoot?: string
  playwrightPool?: boolean
  liveTarget?: 'bridge' | 'pool'
}

export interface ProjectInfo { id: string, root: string }

export async function listProjects() {
  const r = await fetch(`${API}/api/projects`)
  return r.json() as Promise<{ ok: boolean, workspace: string, active: string, projects: ProjectInfo[] }>
}

export async function selectProject(id: string) {
  const r = await fetch(`${API}/api/projects/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await r.json() as { ok: boolean, active?: string, root?: string, projects?: ProjectInfo[], error?: string }
  if (!r.ok || data.ok === false) throw new Error(data.error || `Select failed (${r.status})`)
  return data
}

export async function createProject(id: string) {
  const r = await fetch(`${API}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await r.json() as { ok: boolean, active?: string, root?: string, projects?: ProjectInfo[], error?: string }
  if (!r.ok || data.ok === false) throw new Error(data.error || `Create failed (${r.status})`)
  return data
}

export async function getConfig() {
  const r = await fetch(`${API}/api/config`)
  return r.json() as Promise<LauncherConfig>
}

export interface ProviderModels {
  ok: boolean
  provider?: string
  providerName?: string
  baseUrl?: string
  models: string[]
  suggested?: string
  error?: string
}

export async function probeModels(input: { key?: string, baseUrl?: string } = {}) {
  const r = await fetch(`${API}/api/config/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json() as ProviderModels
  if (!r.ok || data.ok === false) throw new Error(data.error || `Could not list models (${r.status})`)
  return data
}

export async function setPlaywrightPool(enabled: boolean) {
  const r = await fetch(`${API}/api/config/pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const data = await r.json() as LauncherConfig & { saved?: boolean, error?: string }
  if (!r.ok) throw new Error(data.error || `Save failed (${r.status})`)
  return data
}

export async function saveAiConfig(input: { key?: string, baseUrl?: string, model?: string }) {
  const r = await fetch(`${API}/api/config/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json() as LauncherConfig & { saved?: boolean, error?: string }
  if (!r.ok) throw new Error(data.error || `Save failed (${r.status})`)
  return data
}

export async function chat(messages: {role:string, content:string}[]) {
  const r = await fetch(`${API}/api/chat`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({messages})
  })
  return r.json()
}

export type ChatStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'workflow'; mode: ChatWorkflow; reason?: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-delta'; id: string; name: string; text: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'text-delta'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

export type ChatWorkflow = 'files' | 'sketch'

export interface WorkflowSnapshot {
  ok: boolean
  mode: ChatWorkflow
  accepted: boolean
  patches: { id: string, selector: string, op: string, ok: boolean, detail: string }[]
  error?: string
}

export async function getWorkflow() {
  const r = await fetch(`${API}/api/workflow`)
  return r.json() as Promise<WorkflowSnapshot>
}

export async function postWorkflow(body: { mode?: ChatWorkflow, action?: 'undo' | 'discard' | 'accept' }) {
  const r = await fetch(`${API}/api/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json() as Promise<WorkflowSnapshot>
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

export async function chatStream(
  messages: { role: string, content: string }[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  workflow?: ChatWorkflow,
) {
  const r = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages, workflow }),
    signal,
  })
  if (!r.ok || !r.body) {
    let error = `Chat stream failed (${r.status})`
    try {
      const data = await r.json() as { error?: string }
      if (data.error) error = data.error
    } catch { /* ignore */ }
    throw new Error(error)
  }
  const reader = r.body.getReader()
  const onAbort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() || ''
      for (const part of parts) {
        const line = part.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue
        try { onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent) } catch { /* ignore malformed */ }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export interface PageNote { selector: string, text: string, type?: string, targetSelector?: string }

export async function submitLiveEdit(annotations: PageNote[], pageNotes: string, url?: string) {
  const r = await fetch(`${API}/api/live-edit/submit`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ annotations, pageNotes, url })
  })
  return r.json()
}

export async function fetchOverlaySource(): Promise<string> {
  const r = await fetch(`${API}/live-edit/overlay.js`)
  if (!r.ok) throw new Error(`overlay fetch failed: ${r.status}`)
  return r.text()
}
