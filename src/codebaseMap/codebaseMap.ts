/**
 * Codebase map + per-project component registry (phase-11-05 §8
 * Rungs 1–2, TASKS-token-efficiency §1). Pure: builds the map from
 * { path, content } inputs, same contract as the Rung 0 resolver.
 * The fs/store layer (mapStore.ts) scans disk, persists the map to
 * .ai-live/map.json, and feeds declared-registry inputs.
 *
 * The map is generated marker data — source files stay clean.
 * Models read the map; nobody hand-writes marker comments.
 */
import { parseFile, type ComponentInfo, type FileInfo, type SourceInput } from './extract.js'

export type { SourceInput }

export type FileKind = 'entry' | 'component' | 'style' | 'token' | 'source'

export interface MapFile {
  path: string
  kind: FileKind
  /** Project-internal imports, resolved to project paths. */
  imports: string[]
  /** External package names imported (deduped, react omitted only if purely internal view needs it — kept here). */
  externals: string[]
  exports: string[]
  components: Array<{ name: string, props: string[] | null }>
  renders: string[]
  /** How many other project files import this file. */
  inDegree: number
  importedBy: string[]
}

export type RegistryOrigin = 'catalog' | 'shadcn' | 'manifest' | 'declared' | 'inferred'
export type RegistryConfidence = 'declared' | 'inferred'

export interface ProjectComponent {
  name: string
  file: string
  /** Prop names; empty when propsKnown is false (file-only listing — never fabricated). */
  props: string[]
  propsKnown: boolean
  origin: RegistryOrigin
  confidence: RegistryConfidence
  /** Only ever set from declared data; inferred entries carry no prose. */
  description?: string
  template?: string
  usedBy: number
  usedByFiles: string[]
  renders: string[]
}

/** A component declared by a manifest / catalog / shadcn scan, supplied by the store layer. */
export interface DeclaredComponentInput {
  name: string
  file?: string
  props?: string[]
  description?: string
  template?: string
  origin: Exclude<RegistryOrigin, 'inferred'>
}

export interface CodebaseMap {
  version: 1
  fileCount: number
  /** Project entry file (route entry), when one is recognisable. */
  entry?: { file: string, component?: string }
  files: MapFile[]
  components: ProjectComponent[]
  styleFiles: string[]
}

const RESOLVE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '.css']

/** Resolve a relative import specifier against the known file set. */
export function resolveRelativeImport(fromPath: string, spec: string, fileSet: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const dir = fromPath.slice(0, fromPath.lastIndexOf('/'))
  const parts: string[] = []
  for (const seg of `${dir}/${spec}`.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const base = '/' + parts.join('/')
  if (fileSet.has(base)) return base
  for (const ext of RESOLVE_EXTS) if (fileSet.has(base + ext)) return base + ext
  for (const ext of RESOLVE_EXTS) if (fileSet.has(`${base}/index${ext}`)) return `${base}/index${ext}`
  return null
}

function fileKind(path: string, info: FileInfo | null, isEntry: boolean): FileKind {
  if (isEntry) return 'entry'
  if (/\.css$/i.test(path)) return /token|theme|variables/i.test(path) ? 'token' : 'style'
  if (info && info.components.length) return 'component'
  return 'source'
}

const ENTRY_BASENAMES = ['main.tsx', 'main.jsx', 'main.ts', 'main.js', 'index.tsx', 'index.jsx']

function pickEntry(infos: Map<string, FileInfo>): { file: string, component?: string } | undefined {
  const candidates = [...infos.keys()]
    .filter(p => ENTRY_BASENAMES.includes(p.split('/').pop() || ''))
    .sort((a, b) => {
      const rank = (p: string) => (p.startsWith('/src/') ? 0 : 1) + (p.includes('/main.') ? 0 : 2)
      return rank(a) - rank(b) || a.localeCompare(b)
    })
  const file = candidates[0]
  if (!file) return undefined
  const info = infos.get(file)!
  // Route-entry vocabulary: main.jsx -> App (the default import it renders).
  const appImport = info.imports.find(i => i.names.includes('App') || i.imported.includes('default') && /App/.test(i.source))
  const component = info.renders.find(r => r === 'App') || appImport?.names[0] || info.renders[0]
  return { file, component }
}

/**
 * Build the registry: declared inputs win over inferred components,
 * deduped by file+name. Inferred entries never gain description or
 * template prose — names + prop shapes only.
 */
export function buildRegistry(
  infos: Map<string, FileInfo>,
  mapFiles: MapFile[],
  declared: DeclaredComponentInput[] = [],
): ProjectComponent[] {
  const byFile = new Map(mapFiles.map(f => [f.path, f]))
  const usedByOf = (name: string, file: string): string[] => {
    const users: string[] = []
    for (const [p, info] of infos) {
      if (p === file) continue
      const fileSet = new Set(infos.keys())
      const importsFile = info.imports.some(i => resolveRelativeImport(p, i.source, fileSet) === file
        && (i.names.includes(name) || i.names.length === 0))
      const rendersIt = info.renders.includes(name)
        && info.imports.some(i => resolveRelativeImport(p, i.source, fileSet) === file)
      if (importsFile || rendersIt) users.push(p)
    }
    return users.sort()
  }

  const out: ProjectComponent[] = []
  const claimed = new Set<string>() // file::name claimed by a declared entry
  const key = (file: string, name: string) => `${file}::${name}`

  for (const d of declared) {
    // Match by file+name when a file is given, else by first inferred name match.
    let matchFile = d.file
    let inferred: ComponentInfo | undefined
    if (matchFile) inferred = infos.get(matchFile)?.components.find(c => c.name === d.name)
    if (!matchFile) {
      for (const [p, info] of infos) {
        const c = info.components.find(x => x.name === d.name)
        if (c) { matchFile = p; inferred = c; break }
      }
    }
    const file = matchFile || d.file || ''
    if (!file) continue
    claimed.add(key(file, d.name))
    const props = d.props ?? inferred?.props ?? null
    const usedByFiles = usedByOf(d.name, file)
    out.push({
      name: d.name,
      file,
      props: props ?? [],
      propsKnown: props !== null,
      origin: d.origin,
      confidence: 'declared',
      description: d.description,
      template: d.template,
      usedBy: usedByFiles.length,
      usedByFiles,
      renders: infos.get(file)?.renders ?? [],
    })
  }

  for (const [p, info] of infos) {
    for (const c of info.components) {
      if (claimed.has(key(p, c.name))) continue
      claimed.add(key(p, c.name))
      const usedByFiles = usedByOf(c.name, p)
      out.push({
        name: c.name,
        file: p,
        props: c.props ?? [],
        propsKnown: c.props !== null,
        origin: 'inferred',
        confidence: 'inferred',
        usedBy: usedByFiles.length,
        usedByFiles,
        renders: info.renders,
      })
    }
  }
  void byFile
  const inComponentsDir = (f: string) => /(^|\/)src\/components\//.test(f) || /(^|\/)components\//.test(f) ? 0 : 1
  return out.sort((a, b) => b.usedBy - a.usedBy || inComponentsDir(a.file) - inComponentsDir(b.file) || a.name.localeCompare(b.name))
}

/** Build the full map from source inputs (+ optional CSS inputs, which parse to empty FileInfo). */
export function buildCodebaseMap(inputs: SourceInput[], declared: DeclaredComponentInput[] = []): CodebaseMap {
  const infos = new Map<string, FileInfo>()
  const styleFiles: string[] = []
  for (const input of inputs) {
    if (/\.css$/i.test(input.path)) { styleFiles.push(input.path); continue }
    infos.set(input.path, parseFile(input))
  }
  const fileSet = new Set([...infos.keys(), ...styleFiles])
  const entry = pickEntry(infos)

  const importedBy = new Map<string, string[]>()
  const mapFiles: MapFile[] = []
  for (const [p, info] of infos) {
    const internal: string[] = []
    const externals: string[] = []
    for (const imp of info.imports) {
      const resolved = resolveRelativeImport(p, imp.source, fileSet)
      if (resolved) { if (!internal.includes(resolved)) internal.push(resolved) }
      else if (!imp.source.startsWith('.') && !externals.includes(imp.source)) externals.push(imp.source)
    }
    for (const target of internal) {
      const list = importedBy.get(target) || []
      if (!list.includes(p)) list.push(p)
      importedBy.set(target, list)
    }
    mapFiles.push({
      path: p,
      kind: fileKind(p, info, entry?.file === p),
      imports: internal,
      externals,
      exports: info.exports,
      components: info.components.map(c => ({ name: c.name, props: c.props })),
      renders: info.renders,
      inDegree: 0,
      importedBy: [],
    })
  }
  for (const f of mapFiles) {
    f.importedBy = (importedBy.get(f.path) || []).sort()
    f.inDegree = f.importedBy.length
  }
  // Deterministic default order: entry first, then in-degree, then path.
  mapFiles.sort((a, b) => (a.path === entry?.file ? -1 : b.path === entry?.file ? 1 : 0) || b.inDegree - a.inDegree || a.path.localeCompare(b.path))

  return {
    version: 1,
    fileCount: mapFiles.length + styleFiles.length,
    entry,
    files: mapFiles,
    components: buildRegistry(infos, mapFiles, declared),
    styleFiles: styleFiles.sort(),
  }
}

/** Rough token estimate used for budgeting (the field's chars/4 heuristic). */
export function estimateTokens(text: string): number { return Math.ceil(text.length / 4) }

const DEFAULT_BUDGET_TOKENS = 1000

function signatureLine(f: MapFile, registry: Map<string, ProjectComponent>): string {
  const bits: string[] = [`${f.path} [in:${f.inDegree}]`]
  if (f.components.length) {
    bits.push(f.components.map(c => c.props ? `${c.name}(${c.props.join(', ')})` : c.name).join(', '))
  } else if (f.exports.length) {
    bits.push(`exports ${f.exports.slice(0, 6).join(', ')}`)
  }
  if (f.renders.length) {
    bits.push('renders ' + f.renders.map(r => {
      const reg = registry.get(r)
      return reg?.template ? `<${r} (template ${reg.template})>` : `<${r}>`
    }).join(', '))
  }
  if (f.imports.length) bits.push(`imports ${f.imports.slice(0, 5).join(', ')}`)
  const origins = f.components.map(c => registry.get(c.name)).filter(Boolean)
    .map(r => r!.origin).filter((v, i, a) => a.indexOf(v) === i)
  if (origins.length && !(origins.length === 1 && origins[0] === 'inferred')) bits.push(`[${origins.join(', ')}]`)
  return bits.join(' — ')
}

/**
 * Budgeted signature output for the codebase-map tool (Aider's
 * --map-tokens idea): entry first, most-imported next, explicit
 * truncation note, total size held to the budget including the note.
 */
export function formatCodebaseMap(map: CodebaseMap, budgetTokens: number = DEFAULT_BUDGET_TOKENS): string {
  const budgetChars = Math.max(200, budgetTokens * 4)
  const registry = new Map(map.components.map(c => [c.name, c]))
  const header = map.entry
    ? `Codebase map (${map.fileCount} files). Entry: ${map.entry.file}${map.entry.component ? ` → ${map.entry.component}` : ''}`
    : `Codebase map (${map.fileCount} files).`
  const lines = map.files.map(f => signatureLine(f, registry))
  if (map.styleFiles.length) lines.push(`Styles/tokens: ${map.styleFiles.join(', ')}`)

  const kept: string[] = []
  let used = header.length + 1
  let truncated = 0
  for (let i = 0; i < lines.length; i++) {
    const noteReserve = truncated || i < lines.length - 1 ? 90 : 0
    if (used + lines[i].length + 1 + (i === lines.length - 1 ? 0 : noteReserve) > budgetChars && kept.length) {
      truncated = lines.length - i
      break
    }
    kept.push(lines[i])
    used += lines[i].length + 1
  }
  if (!kept.length && lines.length) { kept.push(lines[0].slice(0, Math.max(0, budgetChars - header.length - 100))); truncated = lines.length - 1; used = budgetChars }
  let out = [header, ...kept].join('\n')
  if (truncated > 0) {
    out += `\n[truncated: ${truncated} of ${lines.length} entries omitted to fit the ${budgetTokens}-token budget — grep or read-real-file for the rest]`
  }
  return out
}

/**
 * Rung 2 injection threshold: below this many project files the map
 * costs more tokens than the greps it saves (lumen-scale starters
 * are 2–6 files). PROVISIONAL at 15, pending the §5 yardstick —
 * record the measured replacement here when §5 lands.
 */
export const MAP_INJECTION_THRESHOLD = 15

/** Top-N signatures for Files-turn injection, or null below the threshold. */
export function mapInjectionText(map: CodebaseMap, threshold: number = MAP_INJECTION_THRESHOLD): string | null {
  if (map.fileCount < threshold) return null
  return `Codebase map for this project (generated index — prefer it over re-grepping for "where is X / who imports Y"):\n${formatCodebaseMap(map, 800)}`
}

/** Score a registry component for a plain-words need ("existing button / card"). */
export function findRegistryComponent(components: ProjectComponent[], query: string): ProjectComponent | null {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let best: ProjectComponent | null = null
  let bestScore = 0
  for (const c of components) {
    let s = 0
    const name = c.name.toLowerCase()
    for (const t of terms) {
      if (name === t) s += 6
      else if (name.includes(t)) s += 3
      if (c.description?.toLowerCase().includes(t)) s += 2
    }
    s += Math.min(c.usedBy, 3)
    if (s > bestScore) { bestScore = s; best = c }
  }
  return bestScore >= 3 ? best : null
}
