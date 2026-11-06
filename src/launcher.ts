import fs from 'fs'
import path from 'path'
import { execSync, spawn, type ChildProcess } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const WORKSPACE_ROOT = path.resolve(__dirname, '../projects')
export const UI_ROOT = path.resolve(__dirname, '../src/ui')
/** @deprecated workspace root — active app is getFsRoot() */
export const FS_ROOT = WORKSPACE_ROOT

const ACTIVE_FILE = path.join(WORKSPACE_ROOT, '.active')
const SKIP_DIR = new Set(['node_modules', 'dist', '.vite', '.chrome-data'])

let fsRoot = path.join(WORKSPACE_ROOT, 'lumen')
let viteChild: ChildProcess | null = null

export function getFsRoot() { return fsRoot }
export function setFsRoot(dir: string) { fsRoot = path.resolve(dir) }

export type ProjectInfo = { id: string, root: string }

export function listProjects(): ProjectInfo[] {
  if (!fs.existsSync(WORKSPACE_ROOT)) return []
  return fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIR.has(d.name))
    .filter((d) => fs.existsSync(path.join(WORKSPACE_ROOT, d.name, 'package.json')))
    .map((d) => ({ id: d.name, root: path.join(WORKSPACE_ROOT, d.name) }))
}

export function readActiveId(): string {
  try {
    const id = fs.readFileSync(ACTIVE_FILE, 'utf-8').trim()
    if (id && listProjects().some((p) => p.id === id)) return id
  } catch { /* missing */ }
  const listed = listProjects()
  return listed.some((p) => p.id === 'lumen') ? 'lumen' : listed[0]?.id || 'lumen'
}

function writeActiveId(id: string) {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true })
  fs.writeFileSync(ACTIVE_FILE, id, 'utf-8')
}

function killPort(port: number) {
  if (process.platform === 'win32') return
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf-8' }).trim()
    for (const pid of out.split(/\s+/)) {
      const n = Number(pid)
      if (n) try { process.kill(n, 'SIGTERM') } catch { /* gone */ }
    }
  } catch { /* nothing listening */ }
}

export function stopVite() {
  const child = viteChild
  viteChild = null
  if (child) {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
      else child.kill('SIGTERM')
    } catch { /* already gone */ }
  }
  killPort(5173)
}

export function startVite() {
  stopVite()
  try { execSync('sleep 0.4') } catch { /* ignore */ }
  const root = getFsRoot()
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    console.log('[vite] skip, no package.json at', root)
    return
  }
  const child = spawn('npm', ['run', 'dev'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
  })
  viteChild = child
  child.on('exit', (code, signal) => {
    if (viteChild === child) viteChild = null
    console.log('[vite] child exit', code, signal || '')
  })
  console.log('[vite] started in', root, child.pid ? `pid ${child.pid}` : '')
}

/** Adopt the project's saved default device target, if any (phase-11-06 §B). */
async function adoptProjectDevice(root: string) {
  try {
    const { readProjectConfig } = await import('./projectConfig.js')
    const { setDeviceTarget } = await import('./deviceSession.js')
    const def = readProjectConfig(root).defaultDeviceTarget
    if (def) setDeviceTarget(def)
  } catch { /* manifest is optional local config */ }
}

export function selectProject(id: string): ProjectInfo {
  const found = listProjects().find((p) => p.id === id)
  if (!found) throw new Error(`Unknown project: ${id}`)
  setFsRoot(found.root)
  void adoptProjectDevice(found.root)
  writeActiveId(found.id)
  startVite()
  return found
}

export function validProjectId(id: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(id)
}

export interface ProjectFileEntry { path: string; mtimeMs: number; size: number }

/** Directory names never synced or listed (deps, build output, caches). */
const SYNC_SKIP_DIR = new Set(['node_modules', 'dist', '.vite', '.chrome-data'])

/* Folder sync (Open-folder): list every syncable file under a project dir
 * with mtimes, using the same skip rules as /api/fs/list. Used by the sync
 * changes endpoint; unit-tested with tmp dirs. */
export function listProjectFiles(root: string): ProjectFileEntry[] {
  const out: ProjectFileEntry[] = []
  function walk(dir: string, base: string) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch { return }
    for (const e of entries) {
      if (SYNC_SKIP_DIR.has(e.name)) continue
      const full = path.join(dir, e.name)
      const rel = base ? base + '/' + e.name : e.name
      if (e.isDirectory()) walk(full, rel)
      else if (e.isFile()) {
        try {
          const st = fs.statSync(full)
          out.push({ path: '/' + rel, mtimeMs: st.mtimeMs, size: st.size })
        } catch { /* raced deletion, skip */ }
      }
    }
  }
  walk(root, '')
  return out
}

export interface DeleteSyncResult {
  deleted: number
  deleteErrors: { path: string; error: string }[]
}

/* Folder sync (Open-folder): delete caller-named files under dest only.
 * Same traversal discipline as writeImportFiles; directories are never
 * removed, missing files are reported, the batch never aborts early. */
export function deleteSyncFiles(dest: string, paths: unknown[]): DeleteSyncResult {
  const deleteErrors: { path: string; error: string }[] = []
  let deleted = 0
  for (const entry of paths) {
    try {
      if (typeof entry !== 'string' || !entry.startsWith('/')) throw new Error('path must be an absolute project path')
      const full = path.resolve(dest, '.' + entry)
      if (!full.startsWith(dest + path.sep) && full !== dest) throw new Error('Path traversal')
      let st
      try {
        st = fs.statSync(full)
      } catch {
        throw new Error('Not found')
      }
      if (!st.isFile()) throw new Error('Not a file')
      fs.unlinkSync(full)
      deleted += 1
    } catch (e: any) {
      deleteErrors.push({ path: String(entry ?? '?'), error: e.message })
    }
  }
  return { deleted, deleteErrors }
}

export interface ImportWriteError { path: string; error: string }

/* Folder-import batch writer (Step 10): writes caller-supplied text files
 * under dest only. Used by POST /api/projects/import; unit-tested. */
export function writeImportFiles(
  dest: string,
  files: { path: unknown; content: unknown }[],
): { received: number; writeErrors: ImportWriteError[] } {
  const writeErrors: ImportWriteError[] = []
  let received = 0
  for (const f of files) {
    try {
      const rec = f as { path?: unknown; content?: unknown }
      const p = typeof rec?.path === 'string' ? rec.path : ''
      const content = typeof rec?.content === 'string' ? rec.content : null
      if (!p || content === null) throw new Error('path and content required')
      const full = path.resolve(dest, '.' + p)
      if (!full.startsWith(dest + path.sep) && full !== dest) throw new Error('Path traversal')
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content, 'utf-8')
      received += 1
    } catch (e: any) {
      const rec = f as { path?: unknown }
      writeErrors.push({ path: String(rec?.path ?? '?'), error: e.message })
    }
  }
  return { received, writeErrors }
}

export function createProject(id: string): ProjectInfo {
  const name = id.trim()
  if (!validProjectId(name)) throw new Error('Project name: letters, numbers, dash, underscore')
  if (SKIP_DIR.has(name) || name.startsWith('.')) throw new Error('Reserved name')
  const dest = path.join(WORKSPACE_ROOT, name)
  if (fs.existsSync(dest)) throw new Error(`Project already exists: ${name}`)
  seedProjectDir(dest)
  try {
    execSync('npm install', { cwd: dest, stdio: 'inherit' })
  } catch (e) {
    console.error('[workspace] npm install failed for', name, e)
  }
  return selectProject(name)
}

const SEED_FILES: Record<string, string> = {
  'index.html': `<!doctype html>
<html><head><meta charset="utf-8"/><style>body{font-family:system-ui;padding:24px}</style></head><body><div id="root"><h1>Real FS works ⚡</h1><p>Edit this project and it patches instantly without reload.</p></div><script type="module" src="/main.jsx"></script></body></html>`,
  'App.jsx': `export default function App(){
  return <div style={{padding:24}}>
    <h1>Real FS works ⚡</h1>
    <p>This file lives on your real disk under <code>projects/</code>.</p>
    <p>Edit it in the launcher UI or ask AI: "make this a todo app"</p>
    <div style={{marginTop:24,padding:16,background:'#f5f5f5',borderRadius:8}}>
      <b>Try:</b> Ask AI "Add a counter button that increments"
    </div>
  </div>
}
`,
  'main.jsx': `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App/>)
`,
  'package.json': `{
  "name": "user-project",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "vite": "8.3.5",
    "@vitejs/plugin-react": "6.2.1",
    "@vitejs/devtools": "0.8.2",
    "@vitejs/devtools-kit": "0.8.2"
  }
}
`,
  'vite.config.js': `import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aiLiveEditor } from '../../src/vite-plugin/aiLiveEditor.ts'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    aiLiveEditor({
      envFile: path.resolve(dir, '../../.env'),
      apiBase: 'http://localhost:4112',
    }),
  ],
  server: {
    port: 5173,
    host: true,
    headers: {
      'Content-Security-Policy': "frame-ancestors http://localhost:4112 http://127.0.0.1:4112",
    },
  },
  devtools: {
    apply: 'serve',
    builtinDevTools: false,
    embeddedVisibility: 'passive',
  },
})
`,
}

export function seedProjectDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(SEED_FILES)) {
    const full = path.join(dir, rel)
    if (!fs.existsSync(full)) fs.writeFileSync(full, content, 'utf-8')
  }
}

/** Ensure workspace exists, seed lumen if empty, point fsRoot at the active child, start Vite. */
export function ensureWorkspace() {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true })
  if (!listProjects().length) seedProjectDir(path.join(WORKSPACE_ROOT, 'lumen'))
  const id = readActiveId()
  const dest = path.join(WORKSPACE_ROOT, id)
  if (!fs.existsSync(path.join(dest, 'package.json'))) seedProjectDir(dest)
  setFsRoot(dest)
  void adoptProjectDevice(dest)
  writeActiveId(id)
  startVite()
  return getFsRoot()
}

/** @deprecated use ensureWorkspace */
export function ensureFsRoot() {
  return ensureWorkspace()
}

process.on('exit', stopVite)
process.on('SIGINT', () => { stopVite(); process.exit(0) })
process.on('SIGTERM', () => { stopVite(); process.exit(0) })
