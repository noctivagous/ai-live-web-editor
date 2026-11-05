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
  hasOpenAiKey: boolean
  model: string
  launcherUrl: string
  poolUrl: string
  previewStaticUrl: string
  previewHmrUrl: string
}

export async function getConfig() {
  const r = await fetch(`${API}/api/config`)
  return r.json() as Promise<LauncherConfig>
}

export async function chat(messages: {role:string, content:string}[]) {
  const r = await fetch(`${API}/api/chat`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({messages})
  })
  return r.json()
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
