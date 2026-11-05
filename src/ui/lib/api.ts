const API = import.meta.env.VITE_API_URL || 'http://localhost:4112'

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
export async function patchDOM(selector: string, html: string, url?: string) {
  const r = await fetch(`${API}/api/browser/patch`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({selector, html, url})
  })
  return r.json()
}
export async function inspectDOM(selector: string, url?: string) {
  const r = await fetch(`${API}/api/browser/inspect`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({selector, url})
  })
  return r.json()
}
export async function heartbeat(client = 'web') {
  try {
    await fetch(`${API}/api/ui/heartbeat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({client})
    })
  } catch {}
}
export async function evalJS(code: string, url?: string) {
  const r = await fetch(`${API}/api/browser/eval`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({code, url})
  })
  return r.json()
}
export async function openBrowser(url: string) {
  const r = await fetch(`${API}/api/browser/open`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({url})
  })
  return r.json()
}
export interface LauncherConfig {
  ok: boolean
  hasApiKey: boolean
  hasOpenAiKey: boolean
  model: string
  modelName: string
  baseUrl: string
  launcherUrl: string
  poolUrl: string
  previewStaticUrl: string
  previewHmrUrl: string
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
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'text-delta'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

export async function chatStream(
  messages: { role: string, content: string }[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
) {
  const r = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
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
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
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
