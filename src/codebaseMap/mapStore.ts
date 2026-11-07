/**
 * Store layer for the codebase map (TASKS-token-efficiency §1):
 * scans the active project, loads declared-registry inputs,
 * builds the map (codebaseMap.ts), persists it as generated
 * marker data at .ai-live/map.json, and owns Adopt / Install.
 * Nothing here ever edits source files except Install's one
 * copy-own write, which refuses to replace an existing file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFsRoot } from '../launcher.js'
import { getComponent, loadCatalog } from '../catalog/catalog.js'
import {
  buildCodebaseMap, type CodebaseMap, type DeclaredComponentInput, type SourceInput,
} from './codebaseMap.js'
import { parseFile } from './extract.js'

const SKIP_DIR = new Set(['node_modules', '.vite', '.chrome-data', 'dist', 'dist-verify', '.git', '.ai-live'])
const SCAN_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.css'])
const MAX_FILE_BYTES = 1_000_000

export const MAP_REL_PATH = '.ai-live/map.json'
export const REGISTRY_REL_PATH = '.ai-live/components.json'

function walk(dir: string, root: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, root, acc)
    else if (SCAN_EXT.has(path.extname(e.name))) acc.push(full)
  }
  return acc
}

function rel(root: string, full: string): string {
  return '/' + path.relative(root, full).replace(/\\/g, '/')
}

/** Scan the project root into { path, content } inputs (source + css). */
export function scanProject(root: string = getFsRoot()): SourceInput[] {
  const out: SourceInput[] = []
  for (const full of walk(root, root)) {
    try {
      const st = fs.statSync(full)
      if (st.size > MAX_FILE_BYTES) continue
      const buf = fs.readFileSync(full)
      if (buf.includes(0)) continue
      out.push({ path: rel(root, full), content: buf.toString('utf-8') })
    } catch { /* unreadable — skip */ }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

function propsOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const names = raw.map(p => typeof p === 'string' ? p : (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string' ? (p as { name: string }).name : '')).filter(Boolean)
  return names.length ? names : undefined
}

/** Declared entries from a catalog-shaped manifest ({ components: [...] } or a bare array). */
function declaredFromManifest(parsed: unknown, origin: DeclaredComponentInput['origin']): DeclaredComponentInput[] {
  const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { components?: unknown }).components) ? (parsed as { components: unknown[] }).components : [])
  const out: DeclaredComponentInput[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name : typeof r.tag === 'string' ? r.tag : ''
    if (!name) continue
    const fileRaw = typeof r.file === 'string' ? r.file : typeof r.sourceFile === 'string' ? r.sourceFile : undefined
    out.push({
      name,
      file: fileRaw ? (fileRaw.startsWith('/') ? fileRaw : '/' + fileRaw.replace(/^\.\//, '')) : undefined,
      props: propsOf(r.props),
      description: typeof r.description === 'string' ? r.description : undefined,
      template: typeof r.template === 'string' ? r.template : undefined,
      origin: (typeof r.origin === 'string' && ['catalog', 'shadcn', 'manifest', 'declared'].includes(r.origin) ? r.origin : origin) as DeclaredComponentInput['origin'],
    })
  }
  return out
}

/**
 * Registry loader inputs, in precedence order:
 * 1. .ai-live/components.json — Adopt output / our installed manifest (declared)
 * 2. catalog/components.json + catalog/shadcn.json carried by the project (catalog)
 * 3. shadcn: components.json at the root is CONFIG, not a component
 *    list — the installed components are the files under its ui dir.
 */
export function declaredInputsForRoot(root: string = getFsRoot()): DeclaredComponentInput[] {
  const out: DeclaredComponentInput[] = []
  const adopted = readJson(path.join(root, REGISTRY_REL_PATH))
  if (adopted) out.push(...declaredFromManifest(adopted, 'declared'))
  for (const name of ['components.json', 'shadcn.json']) {
    const parsed = readJson(path.join(root, 'catalog', name))
    if (parsed) out.push(...declaredFromManifest(parsed, 'catalog'))
  }
  // shadcn (theirs): config at root, components on disk under the ui dir.
  const cfg = readJson(path.join(root, 'components.json'))
  if (cfg && typeof cfg === 'object' && !Array.isArray((cfg as { components?: unknown }).components)) {
    const aliases = (cfg as { aliases?: Record<string, unknown> }).aliases || {}
    const uiAlias = typeof aliases.ui === 'string' ? aliases.ui : typeof aliases.components === 'string' ? (aliases.components as string) + '/ui' : '@/components/ui'
    const uiDir = uiAlias.replace(/^@\//, 'src/')
    const abs = path.join(root, uiDir)
    if (fs.existsSync(abs)) {
      for (const full of walk(abs, root)) {
        if (/\.css$/i.test(full)) continue
        try {
          const info = parseFile({ path: rel(root, full), content: fs.readFileSync(full, 'utf-8') })
          for (const c of info.components) {
            if (c.exported) out.push({ name: c.name, file: rel(root, full), origin: 'shadcn' })
          }
        } catch { /* skip unreadable */ }
      }
    }
  }
  return out
}

/** Build the map for a root (fresh scan; cheap at starter scale). */
export function buildMapForRoot(root: string = getFsRoot()): CodebaseMap {
  return buildCodebaseMap(scanProject(root), declaredInputsForRoot(root))
}

/** Persist the map as generated marker data. Source stays clean. */
export function persistMap(root: string, map: CodebaseMap): string {
  const file = path.join(root, MAP_REL_PATH)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...map, generatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf-8')
  return file
}

export function buildAndPersistMap(root: string = getFsRoot()): CodebaseMap {
  const map = buildMapForRoot(root)
  try { persistMap(root, map) } catch { /* persistence is best-effort; the map still serves the turn */ }
  return map
}

export function readPersistedMap(root: string = getFsRoot()): CodebaseMap | null {
  const parsed = readJson(path.join(root, MAP_REL_PATH)) as CodebaseMap | null
  return parsed && parsed.version === 1 ? parsed : null
}

/**
 * Adopt (opt-in, never silent): write the inferred registry to
 * .ai-live/components.json, where the loader treats it as declared
 * thereafter. Returns how many components were adopted.
 */
export function adoptRegistry(root: string = getFsRoot()): { ok: boolean, adopted: number, path: string, error?: string } {
  const map = buildMapForRoot(root)
  const inferred = map.components.filter(c => c.origin === 'inferred')
  if (!inferred.length) return { ok: false, adopted: 0, path: REGISTRY_REL_PATH, error: 'No inferred components to adopt' }
  const doc = {
    version: 1,
    generatedFrom: 'codebase-map adopt (inferred registry, user-confirmed)',
    components: inferred.map(c => ({
      name: c.name,
      file: c.file,
      props: c.propsKnown ? c.props : undefined,
      origin: 'declared',
    })),
  }
  const file = path.join(root, REGISTRY_REL_PATH)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
  buildAndPersistMap(root)
  return { ok: true, adopted: inferred.length, path: REGISTRY_REL_PATH }
}

const EDITOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Install a catalog component alongside the project's own
 * components (copy-own, never replacing): the vendored stock file
 * lands under src/components/ui/ and appears in the registry/map
 * on the next build, so later turns import it by name.
 */
export function installCatalogComponent(
  tag: string,
  root: string = getFsRoot(),
): { ok: boolean, tag: string, dest?: string, error?: string } {
  const entry = getComponent(tag, loadCatalog())
  if (!entry) return { ok: false, tag, error: `No catalog component tagged ${tag}` }
  if (!entry.sourceFile || !entry.sourceFile.startsWith('catalog/stock/')) {
    return { ok: false, tag, error: `${tag} is not vendored in this repo (source ${entry.sourceFile || 'unknown'}), so it cannot be copy-installed` }
  }
  const src = path.join(EDITOR_ROOT, entry.sourceFile)
  if (!fs.existsSync(src)) return { ok: false, tag, error: `Catalog source missing on disk: ${entry.sourceFile}` }
  const destRel = '/src/components/ui/' + path.basename(entry.sourceFile)
  const dest = path.join(root, '.' + destRel)
  if (fs.existsSync(dest)) return { ok: false, tag, error: `Already present at ${destRel} — install never replaces a project file` }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  // Record the install in the declared registry (.ai-live/components.json)
  // so the component carries origin 'catalog' in the map, alongside the
  // project's own components. This write is the install action itself —
  // explicit, never a silent side effect of opening a project.
  const manifestFile = path.join(root, REGISTRY_REL_PATH)
  const existing = readJson(manifestFile)
  const doc = existing && typeof existing === 'object' && Array.isArray((existing as { components?: unknown }).components)
    ? existing as { version?: number, components: Array<Record<string, unknown>> }
    : { version: 1, components: [] as Array<Record<string, unknown>> }
  const names = entry.exports?.length ? entry.exports : [entry.tag]
  for (const name of names) {
    if (!doc.components.some(c => c.file === destRel && (c.name === name || c.tag === name))) {
      doc.components.push({ name, file: destRel, props: entry.props.map(pr => pr.name), description: entry.description, origin: 'catalog' })
    }
  }
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true })
  fs.writeFileSync(manifestFile, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
  buildAndPersistMap(root)
  return { ok: true, tag, dest: destRel }
}

/**
 * Debounced map rebuilder for the launcher watcher: rebuilds the
 * active root's .ai-live/map.json on add/change/unlink, ignoring
 * the map file itself (its own write must not retrigger it).
 */
export function createMapRebuilder(
  getRoot: () => string,
  delayMs = 600,
  rebuild: (root: string) => void = (root) => { buildAndPersistMap(root) },
): { schedule: (changedPath?: string) => void, dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    schedule(changedPath?: string) {
      if (changedPath && path.resolve(changedPath) === path.join(getRoot(), MAP_REL_PATH)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; try { rebuild(getRoot()) } catch { /* best-effort */ } }, delayMs)
    },
    dispose() { if (timer) clearTimeout(timer) },
  }
}
