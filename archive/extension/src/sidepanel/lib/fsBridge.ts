
// Real FS bridge - tries local server first, falls back to IndexedDB
import { db } from './db'

const API = 'http://localhost:4112'
let realFsAvailable = false

export async function checkRealFs() {
  try {
    const res = await fetch(`${API}/api/fs/health`, { method: 'GET' })
    if (res.ok) {
      realFsAvailable = true
      return true
    }
  } catch {}
  realFsAvailable = false
  return false
}

export function isRealFs() { return realFsAvailable }

export async function listFilesBridge() {
  if (realFsAvailable) {
    try {
      const res = await fetch(`${API}/api/fs/list`)
      if (res.ok) return (await res.json()).files as string[]
    } catch {}
  }
  // fallback IndexedDB
  const all = await db.files.toArray()
  return all.map(f => f.path)
}

export async function readFileBridge(path: string) {
  if (realFsAvailable) {
    try {
      const res = await fetch(`${API}/api/fs/read?path=${encodeURIComponent(path)}`)
      if (res.ok) {
        const data = await res.json()
        if (!data.error) {
          // sync to IndexedDB as cache
          const cnt = await db.files.where('path').equals(path).count()
          if (cnt === 0) await db.files.add({ path, content: data.content, updatedAt: Date.now() })
          else await db.files.where('path').equals(path).modify({ content: data.content, updatedAt: Date.now() })
          return data.content as string
        }
      }
    } catch {}
  }
  const f = await db.files.where('path').equals(path).first()
  return f?.content || ''
}

export async function writeFileBridge(path: string, content: string) {
  // Always write to IndexedDB for offline
  const cnt = await db.files.where('path').equals(path).count()
  if (cnt === 0) await db.files.add({ path, content, updatedAt: Date.now() })
  else await db.files.where('path').equals(path).modify({ content, updatedAt: Date.now() })

  if (realFsAvailable) {
    try {
      await fetch(`${API}/api/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content })
      })
    } catch {}
  }
  return { ok: true, path, mode: realFsAvailable ? 'real+idb' : 'idb' }
}

export async function syncFromRealFs() {
  if (!realFsAvailable) return
  try {
    const res = await fetch(`${API}/api/fs/list`)
    if (!res.ok) return
    const { files } = await res.json()
    for (const path of files) {
      const r = await fetch(`${API}/api/fs/read?path=${encodeURIComponent(path)}`)
      if (r.ok) {
        const { content } = await r.json()
        const cnt = await db.files.where('path').equals(path).count()
        if (cnt === 0) await db.files.add({ path, content, updatedAt: Date.now() })
        else await db.files.where('path').equals(path).modify({ content, updatedAt: Date.now() })
      }
    }
  } catch {}
}
