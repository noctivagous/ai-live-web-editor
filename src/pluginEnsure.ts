/**
 * Plugin auto-ensure (bridge guarantee, slice 1): the editor's Vite
 * plugin is what makes a project's live page reachable — bridge ops,
 * source stamps, chat, annotations all ride on it. Before this module
 * the plugin reached a project only via the seed template or a manual
 * vite.config edit, and a plugin-less project failed silently.
 *
 * On project open the launcher now DETECTS the registration and, when
 * it is missing, ADDS it as a marked, revertable edit to the project's
 * own vite.config — never a wrapper config, never a substituted dev
 * command (the launcher still spawns the project's own `npm run dev`
 * untouched). Detection is text-level and conservative: ambiguous
 * shapes classify 'cannot' and are never guess-edited. Every edit is
 * verified in memory before it is written (the result must classify
 * 'registered' and stripping the markers must reproduce the original
 * bytes exactly), so a bad edit cannot land.
 *
 * Removing the marked addition records a per-project opt-out in
 * editor-owned state (.ai-live/plugin-ensure.json) — never in the
 * user's project files — so ensure never re-adds uninvited.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyProject } from './projectDetect.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The editor's own repo root (same value as launcher's EDITOR_ROOT,
 * computed locally so this module never imports the launcher). */
export const EDITOR_ROOT = path.resolve(HERE, '..')
/** The plugin module every ensured config imports. */
export const PLUGIN_FILE = path.join(EDITOR_ROOT, 'src', 'vite-plugin', 'aiLiveEditor.ts')

export const MARK_BEGIN = '// ai-live-editor: begin plugin'
export const MARK_END = '// ai-live-editor: end plugin'
const MARK_BEGIN_LINE = `${MARK_BEGIN} — added by the editor; remove this block to opt out`
const MARK_END_LINE = MARK_END

/** Vite's own config-file search order. */
export const VITE_CONFIG_NAMES = [
  'vite.config.js', 'vite.config.mjs', 'vite.config.ts',
  'vite.config.cjs', 'vite.config.mts', 'vite.config.cts',
]

export function launcherOrigin(): string {
  return `http://localhost:${Number(process.env.LAUNCHER_PORT) || 4112}`
}

function posix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Import specifier for the plugin, from the config's directory.
 * Projects inside the editor repo get the seed's relative style
 * ('../../src/vite-plugin/aiLiveEditor.ts'); projects anywhere else
 * get the absolute path — a relative path out of an unrelated tree
 * would be a long fragile chain of '..', and Vite's config loader
 * accepts an absolute import. Either way the specifier is explicit
 * in the user's config, where they can see and change it.
 */
export function pluginImportPath(configDir: string, pluginFile: string = PLUGIN_FILE): string {
  const dir = path.resolve(configDir)
  if (dir === EDITOR_ROOT || dir.startsWith(EDITOR_ROOT + path.sep)) {
    const rel = posix(path.relative(dir, pluginFile))
    return rel.startsWith('.') ? rel : './' + rel
  }
  return posix(pluginFile)
}

export interface EnsureSnippet {
  importLine: string
  call: string
}

export function ensureSnippet(
  configDir: string,
  opts: { apiBase?: string, envFile?: string, pluginFile?: string, cjs?: boolean } = {},
): EnsureSnippet {
  const spec = pluginImportPath(configDir, opts.pluginFile)
  const envFile = opts.envFile ?? path.join(EDITOR_ROOT, '.env')
  const apiBase = opts.apiBase ?? launcherOrigin()
  const call = `aiLiveEditor({ envFile: '${envFile.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', apiBase: '${apiBase}' })`
  const importLine = opts.cjs
    ? `const { aiLiveEditor } = require('${spec}')`
    : `import { aiLiveEditor } from '${spec}'`
  return { importLine, call }
}

/** The two blocks a user can paste by hand when the auto-edit can't. */
export function manualSnippet(configDir: string, opts: { apiBase?: string, envFile?: string, pluginFile?: string, cjs?: boolean } = {}): string {
  const s = ensureSnippet(configDir, opts)
  return `${s.importLine}\n// …and add ${s.call} to the plugins array in the exported config.`
}

/* ── Tolerant scanning ───────────────────────────────────────────
 * Just enough lexical awareness to find the exported config object
 * and its top-level keys without a real parser: strings, template
 * literals (with ${} nesting) and comments are skipped, brackets are
 * matched. Anything the scanner can't follow makes the caller
 * classify 'cannot' rather than guess. */

function skipTrivia(src: string, i: number): number {
  const c = src[i]
  if (c === '/' && src[i + 1] === '/') {
    const e = src.indexOf('\n', i)
    return e === -1 ? src.length : e + 1
  }
  if (c === '/' && src[i + 1] === '*') {
    const e = src.indexOf('*/', i + 2)
    return e === -1 ? src.length : e + 2
  }
  if (c === "'" || c === '"') {
    let j = i + 1
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue }
      if (src[j] === c) return j + 1
      j++
    }
    return src.length
  }
  if (c === '`') return skipTemplate(src, i)
  return -1
}

function skipTemplate(src: string, i: number): number {
  let j = i + 1
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue }
    if (src[j] === '`') return j + 1
    if (src[j] === '$' && src[j + 1] === '{') {
      const close = findMatchingClose(src, j + 1)
      if (close === -1) return src.length
      j = close + 1
      continue
    }
    j++
  }
  return src.length
}

const CLOSE_FOR: Record<string, string> = { '(': ')', '{': '}', '[': ']' }

export function findMatchingClose(src: string, openIdx: number): number {
  const first = src[openIdx]
  if (!CLOSE_FOR[first]) return -1
  const stack = [first]
  let i = openIdx + 1
  while (i < src.length) {
    const t = skipTrivia(src, i)
    if (t !== -1) { i = t; continue }
    const c = src[i]
    if (CLOSE_FOR[c]) stack.push(c)
    else if (c === ')' || c === '}' || c === ']') {
      const open = stack.pop()
      if (!open || CLOSE_FOR[open] !== c) return -1
      if (!stack.length) return i
    }
    i++
  }
  return -1
}

/** Whitespace + comments only (strings are values, never trivia here). */
function skipWsComments(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i)
      i = e === -1 ? src.length : e + 1
      continue
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e === -1 ? src.length : e + 2
      continue
    }
    return i
  }
}

interface ExportObject { objOpen: number, objClose: number }

/** Locate the exported config object for the two editable shapes:
 * `export default { … }` / `module.exports = { … }` and
 * `defineConfig({ … })` around either. Anything else (function
 * configs, identifiers, spreads we can't follow) returns null. */
function findExportObject(src: string): ExportObject | null {
  const esm = /(^|[^\w$.])export\s+default\b/.exec(src)
  const cjs = /(^|[^\w$.])module\s*\.\s*exports\s*=/.exec(src)
  let i = -1
  if (esm && cjs) i = Math.min(esm.index + esm[0].length, cjs.index + cjs[0].length)
  else if (esm) i = esm.index + esm[0].length
  else if (cjs) i = cjs.index + cjs[0].length
  else return null
  i = skipWsComments(src, i)
  if (src.startsWith('defineConfig', i) && !/[\w$]/.test(src[i + 'defineConfig'.length] ?? '')) {
    const paren = skipWsComments(src, i + 'defineConfig'.length)
    if (src[paren] !== '(') return null
    const arg = skipWsComments(src, paren + 1)
    if (src[arg] !== '{') return null // defineConfig(fn) / defineConfig(async…) — a function config
    const close = findMatchingClose(src, arg)
    return close === -1 ? null : { objOpen: arg, objClose: close }
  }
  if (src[i] !== '{') return null // identifier, call, arrow/function — not a plain object we may edit
  const close = findMatchingClose(src, i)
  return close === -1 ? null : { objOpen: i, objClose: close }
}

interface PropInfo { key: string, valueStart: number, keyStart: number }

/** Top-level keys of the object; null when a key position holds
 * something we can't parse (spread, computed key, method…). */
function topLevelProps(src: string, obj: ExportObject): PropInfo[] | null {
  const props: PropInfo[] = []
  let i = obj.objOpen + 1
  let depth = 0
  let expectKey = true
  while (i < obj.objClose) {
    const t = skipTrivia(src, i)
    if (t !== -1) { i = t; continue }
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if (depth === 0 && expectKey) {
      if (c === ',') { i++; continue }
      let key: string | null = null
      let j = i
      if (c === "'" || c === '"') {
        const e = skipTrivia(src, i)
        key = src.slice(i + 1, e - 1)
        j = e
      } else {
        const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, obj.objClose))
        if (m) { key = m[0]; j = i + m[0].length }
      }
      if (key === null) return null
      const colon = skipWsComments(src, j)
      if (src[colon] !== ':') return null // method shorthand / getter — not a plain property
      const valueStart = skipWsComments(src, colon + 1)
      props.push({ key, valueStart, keyStart: i })
      i = valueStart
      expectKey = false
      continue
    }
    if (CLOSE_FOR[c]) depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (c === ',' && depth === 0) expectKey = true
    i++
  }
  return props
}

function lineStartOf(src: string, idx: number): number {
  return src.lastIndexOf('\n', idx - 1) + 1
}

function lineIndentOf(src: string, idx: number): string {
  const start = lineStartOf(src, idx)
  const m = /^[ \t]*/.exec(src.slice(start, idx + 1))
  return m ? m[0] : ''
}

/* ── Classification ────────────────────────────────────────────── */

export type ConfigClassName = 'registered' | 'present-not-called' | 'missing' | 'cannot'

export interface ConfigClass {
  cls: ConfigClassName
  detail?: string
  /** Local name the config binds the plugin to (rename-aware). */
  binding?: string
}

function isPluginSpecifier(spec: string): boolean {
  if (spec.includes('vite-plugin/aiLiveEditor')) return true
  const base = spec.split('/').pop() ?? ''
  return /^aiLiveEditor(\.(ts|js|mts|mjs|cts|cjs))?$/.test(base)
}

interface FoundImport { binding: string | null, spec: string }

function findPluginImport(src: string): { found: FoundImport | null, foreign: boolean } {
  let foreign = false
  // ESM imports of the plugin module.
  const importRe = /import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g
  for (let m; (m = importRe.exec(src)) !== null;) {
    const clause = m[1].trim()
    const spec = m[2]
    if (!spec.includes('aiLiveEditor') && !isPluginSpecifier(spec)) continue
    if (!isPluginSpecifier(spec)) { foreign = true; continue }
    let binding: string | null = null
    if (clause.startsWith('{')) {
      const inner = clause.slice(1, clause.lastIndexOf('}'))
      const named = /(^|,)\s*aiLiveEditor(\s+as\s+([A-Za-z_$][\w$]*))?\s*(,|$)/.exec(inner)
      if (named) binding = named[3] ?? 'aiLiveEditor'
    } else if (clause.startsWith('*')) {
      const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)
      if (ns) binding = `${ns[1]}.aiLiveEditor`
    } else {
      const def = /^([A-Za-z_$][\w$]*)/.exec(clause)
      if (def) binding = def[1]
    }
    return { found: { binding, spec }, foreign }
  }
  // CJS requires of the plugin module.
  const requireRe = /(?:const|let|var)\s+(\{[\s\S]*?\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g
  for (let m; (m = requireRe.exec(src)) !== null;) {
    const lhs = m[1].trim()
    const spec = m[2]
    if (!spec.includes('aiLiveEditor') && !isPluginSpecifier(spec)) continue
    if (!isPluginSpecifier(spec)) { foreign = true; continue }
    let binding: string | null = null
    if (lhs.startsWith('{')) {
      const inner = lhs.slice(1, lhs.lastIndexOf('}'))
      const named = /(^|,)\s*aiLiveEditor(\s*:\s*([A-Za-z_$][\w$]*))?\s*(,|$)/.exec(inner)
      if (named) binding = named[3] ?? 'aiLiveEditor'
    } else {
      binding = `${lhs}.aiLiveEditor`
    }
    return { found: { binding, spec }, foreign }
  }
  return { found: null, foreign }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Classify one config file's source. 'missing' is returned ONLY for
 * shapes buildEnsuredSource can edit — every other unregistered
 * shape is 'cannot', never a guess.
 */
export function classifyConfigSource(source: string): ConfigClass {
  const { found, foreign } = findPluginImport(source)
  if (found) {
    if (found.binding === null) {
      return { cls: 'cannot', detail: 'the config imports the plugin module but not the aiLiveEditor function' }
    }
    const called = new RegExp(`\\b${escapeRegExp(found.binding)}\\s*\\(`).test(source)
    return called
      ? { cls: 'registered', binding: found.binding }
      : { cls: 'present-not-called', binding: found.binding, detail: 'the plugin is imported but never called' }
  }
  if (foreign) {
    return { cls: 'cannot', detail: 'aiLiveEditor is imported from an unrecognized source' }
  }
  if (/\baiLiveEditor\b/.test(source)) {
    return { cls: 'cannot', detail: 'the config mentions aiLiveEditor without a recognizable import' }
  }
  const obj = findExportObject(source)
  if (!obj) return { cls: 'cannot', detail: 'no editable exported config object (function or indirect export)' }
  const props = topLevelProps(source, obj)
  if (!props) return { cls: 'cannot', detail: 'the exported config has properties we cannot parse safely' }
  const plugins = props.find(p => p.key === 'plugins')
  if (plugins && source[plugins.valueStart] !== '[') {
    return { cls: 'cannot', detail: 'plugins is not an array literal' }
  }
  return { cls: 'missing' }
}

/* ── The marked edit ───────────────────────────────────────────── */

function eolOf(src: string): string {
  return src.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Insert a marker-bracketed block of lines right after `anchorIdx`
 * (the '[' of a plugins array or the '{' of the config object).
 * The inserted text is ALWAYS `EOL + lines + EOL` at the raw anchor
 * position — one uniform shape, so stripEnsuredSource has one
 * uniform inverse (delete from the EOL before the begin line
 * through the EOL after the end line) that restores the original
 * bytes in every anchor position: line-start, mid-line, empty
 * array, top of file. The cost is a blank line after the block
 * when the anchor sat at a line end — acceptable inside a marked,
 * removable addition.
 */
function insertBlock(src: string, anchorIdx: number, lines: string[], baseIndent: string): string {
  const eol = eolOf(src)
  const text = lines.map(l => baseIndent + l).join(eol)
  const pos = anchorIdx + 1
  return src.slice(0, pos) + eol + text + eol + src.slice(pos)
}

/** End of the last top-level import / require statement, or 0. */
function lastImportEnd(src: string): number {
  let end = 0
  const importRe = /(^|\n)[ \t]*import\s+(?:[^;]*?\s+from\s+)?['"][^'"]+['"][ \t]*;?/g
  for (let m; (m = importRe.exec(src)) !== null;) end = Math.max(end, m.index + m[0].length)
  const requireRe = /(^|\n)[ \t]*(?:const|let|var)\s+[^=\n]*=\s*require\([^)]*\)[ \t]*;?/g
  for (let m; (m = requireRe.exec(src)) !== null;) end = Math.max(end, m.index + m[0].length)
  return end
}

function insertImportBlock(src: string, importLine: string): string {
  const eol = eolOf(src)
  const lines = [MARK_BEGIN_LINE, importLine, MARK_END_LINE]
  const pos = lastImportEnd(src)
  const text = lines.join(eol)
  return src.slice(0, pos) + eol + text + eol + src.slice(pos)
}

/**
 * Add the marked registration to a config classified 'missing'.
 * Returns the new source, or null when the shape defeats the edit.
 * Pure: callers re-verify (classify → 'registered', strip → original)
 * before writing anything.
 */
export function buildEnsuredSource(source: string, snippet: EnsureSnippet): string | null {
  const obj = findExportObject(source)
  if (!obj) return null
  const props = topLevelProps(source, obj)
  if (!props) return null
  const plugins = props.find(p => p.key === 'plugins')
  if (plugins && source[plugins.valueStart] !== '[') return null

  let out = source
  // Registration first (its anchor sits after the import anchor;
  // inserting it first keeps the import position valid).
  if (plugins) {
    const arrayOpen = plugins.valueStart
    const arrayClose = findMatchingClose(source, arrayOpen)
    if (arrayClose === -1) return null
    // Element indent: the first element's line, when there is one.
    let indent = lineIndentOf(source, plugins.keyStart) + '  '
    const firstEl = skipWsComments(source, arrayOpen + 1)
    if (firstEl < arrayClose) indent = lineIndentOf(source, firstEl) || indent
    out = insertBlock(out, arrayOpen, [MARK_BEGIN_LINE, `${snippet.call},`, MARK_END_LINE], indent)
  } else {
    const base = props.length ? lineIndentOf(source, props[0].keyStart) : '  '
    const lines = [
      MARK_BEGIN_LINE,
      'plugins: [',
      `  ${snippet.call},`,
      '],',
      MARK_END_LINE,
    ]
    out = insertBlock(out, obj.objOpen, lines, base)
  }
  out = insertImportBlock(out, snippet.importLine)
  return out
}

export interface StripResult { source: string, removed: boolean }

/**
 * Remove every marked block, restoring the pre-edit bytes. A block
 * spans from the EOL before its begin line through the EOL after
 * its end line — the exact inverse of the uniform insertion
 * (EOL + lines + EOL) in insertBlock/insertImportBlock. Refuses
 * (removed: false) when the markers are unpaired, interleaved,
 * or edited.
 */
export function stripEnsuredSource(source: string): StripResult {
  interface MarkLine { kind: 'begin' | 'end', start: number, end: number }
  const marks: MarkLine[] = []
  let idx = 0
  for (const line of source.split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim()
    // `end` is the index of the line's '\n' (or EOF): the span math
    // below deletes up to it and keeps it, so a block's own trailing
    // newline becomes the separator the original text had.
    if (trimmed === MARK_BEGIN_LINE) marks.push({ kind: 'begin', start: idx, end: idx + line.length })
    else if (trimmed === MARK_END_LINE) marks.push({ kind: 'end', start: idx, end: idx + line.length })
    else if (trimmed.startsWith(MARK_BEGIN) || trimmed.startsWith(MARK_END)) return { source, removed: false }
    idx += line.length + 1
  }
  if (!marks.length) return { source, removed: false }
  if (marks.length % 2 !== 0) return { source, removed: false }
  const spans: Array<[number, number]> = []
  for (let k = 0; k < marks.length; k += 2) {
    const begin = marks[k]
    const end = marks[k + 1]
    if (!begin || !end || begin.kind !== 'begin' || end.kind !== 'end') return { source, removed: false }
    // CRLF files: the EOL before the begin line is a two-char unit
    // (its '\r' sits at the end of the previous split line); the
    // end line's last raw char says which style this file uses.
    const crlf = source[end.end - 1] === '\r'
    const spanStart = begin.start > 0 ? begin.start - (crlf ? 2 : 1) : 0
    const spanEnd = source[end.end] === '\n' ? end.end + 1 : end.end
    spans.push([spanStart, spanEnd])
  }
  let out = source
  for (const [s, e] of spans.reverse()) out = out.slice(0, s) + out.slice(e)
  return { source: out, removed: true }
}

/** The file ensure CREATES for a 'no-config' project. */
export function createdConfigSource(snippet: EnsureSnippet): string {
  return [
    `import { defineConfig } from 'vite'`,
    MARK_BEGIN_LINE,
    snippet.importLine,
    MARK_END_LINE,
    '',
    'export default defineConfig({',
    '  plugins: [',
    `    ${MARK_BEGIN_LINE}`,
    `    ${snippet.call},`,
    `    ${MARK_END_LINE}`,
    '  ],',
    '})',
    '',
  ].join('\n')
}

/** True when a stripped file is just the skeleton ensure created —
 * i.e. the file itself was created by ensure and should be deleted
 * on removal rather than left behind as an empty config. */
export function isCreatedConfigSkeleton(source: string): boolean {
  return /^\s*import\s*\{\s*defineConfig\s*\}\s*from\s*['"]vite['"]\s*;?\s*export\s+default\s+defineConfig\(\s*\{\s*plugins\s*:\s*\[\s*\]\s*,?\s*\}\s*\)\s*;?\s*$/.test(source)
}

/* ── Detection on disk ─────────────────────────────────────────── */

export type PluginDetectionClass = ConfigClassName | 'no-config' | 'not-vite'

export interface PluginDetection {
  cls: PluginDetectionClass
  configFile?: string
  detail?: string
}

export function findViteConfig(dir: string): string | null {
  for (const name of VITE_CONFIG_NAMES) {
    const full = path.join(dir, name)
    if (fs.existsSync(full)) return full
  }
  return null
}

function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as Record<string, unknown>
  } catch { return null }
}

function packageHasVite(pkg: Record<string, unknown>): boolean {
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[key]
    if (deps && typeof deps === 'object' && 'vite' in (deps as Record<string, unknown>)) return true
  }
  return false
}

export function detectPlugin(dir: string): PluginDetection {
  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) return { cls: 'not-vite', detail: 'no package.json' }
  const pkg = readPackageJson(dir)
  if (!pkg) return { cls: 'not-vite', detail: 'package.json is not readable JSON' }
  if (!packageHasVite(pkg)) return { cls: 'not-vite', detail: 'vite is not a dependency of this project' }
  const configFile = findViteConfig(dir)
  if (!configFile) return { cls: 'no-config' }
  let source: string
  try {
    source = fs.readFileSync(configFile, 'utf-8')
  } catch {
    return { cls: 'cannot', configFile, detail: 'the vite config could not be read' }
  }
  const c = classifyConfigSource(source)
  return { cls: c.cls, configFile, ...(c.detail ? { detail: c.detail } : {}) }
}

/* ── Opt-out record (editor-owned state) ───────────────────────── */

export function ensureStateFile(): string {
  const override = process.env.AI_LIVE_PLUGIN_ENSURE_FILE
  if (override) return path.resolve(override)
  return path.join(EDITOR_ROOT, '.ai-live', 'plugin-ensure.json')
}

interface EnsureRecord { declined: string[] }

function readRecord(stateFile: string): EnsureRecord {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Partial<EnsureRecord>
    return { declined: Array.isArray(raw.declined) ? raw.declined.filter((d): d is string => typeof d === 'string') : [] }
  } catch { return { declined: [] } }
}

function writeRecord(stateFile: string, rec: EnsureRecord) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(rec, null, 2) + '\n', 'utf-8')
}

export function isDeclined(root: string, stateFile: string = ensureStateFile()): boolean {
  return readRecord(stateFile).declined.includes(path.resolve(root))
}

export function recordDeclined(root: string, stateFile: string = ensureStateFile()): void {
  const rec = readRecord(stateFile)
  const key = path.resolve(root)
  if (!rec.declined.includes(key)) {
    rec.declined.push(key)
    writeRecord(stateFile, rec)
  }
}

export function clearDeclined(root: string, stateFile: string = ensureStateFile()): void {
  const rec = readRecord(stateFile)
  const key = path.resolve(root)
  if (rec.declined.includes(key)) writeRecord(stateFile, { declined: rec.declined.filter(d => d !== key) })
}

/* ── Session state + the ensure/remove operations ──────────────── */

export type EnsureUiState = 'registered' | 'added' | 'missing-declined' | 'cannot' | 'not-vite' | 'standalone'

export interface EnsureState {
  state: EnsureUiState
  configFile?: string
  detail?: string
  /** The exact lines to add by hand (present for 'cannot'). */
  snippet?: string
}

const sessionStates = new Map<string, EnsureState>()

export function getEnsureState(root: string): EnsureState | undefined {
  return sessionStates.get(path.resolve(root))
}

function setState(root: string, state: EnsureState): EnsureState {
  sessionStates.set(path.resolve(root), state)
  return state
}

export interface EnsureOptions {
  apiBase?: string
  envFile?: string
  pluginFile?: string
  stateFile?: string
}

function snippetFor(dir: string, configFile: string | undefined, opts: EnsureOptions): string {
  const cjs = configFile ? configFile.endsWith('.cjs') : false
  return manualSnippet(dir, { ...opts, cjs })
}

function hasHtmlPreview(root: string): boolean {
  try { return classifyProject(root).htmlFiles.length > 0 } catch { return false }
}

/** Read-only state for the UI when no ensure has run this session. */
export function ensureDisplayState(root: string, opts: EnsureOptions = {}): EnsureState {
  const dir = path.resolve(root)
  if (dir === EDITOR_ROOT) return { state: 'registered', detail: 'the editor itself' }
  const stateFile = opts.stateFile ?? ensureStateFile()
  const det = detectPlugin(dir)
  const base = det.configFile ? { configFile: path.basename(det.configFile) } : {}
  if (det.cls === 'registered') return { state: 'registered', ...base }
  if (isDeclined(dir, stateFile)) return { state: 'missing-declined', ...base }
  switch (det.cls) {
    case 'not-vite':
      return hasHtmlPreview(dir) && !(det.detail ?? '').startsWith('vite is not')
        ? { state: 'standalone', ...(det.detail ? { detail: det.detail } : {}) }
        : { state: 'not-vite', ...(det.detail ? { detail: det.detail } : {}) }
    case 'no-config':
      return { state: 'cannot', detail: 'no vite config found — add one with the plugin lines below', snippet: snippetFor(dir, undefined, opts) }
    case 'missing':
      return { state: 'cannot', ...base, detail: 'the plugin is not registered in this project yet', snippet: snippetFor(dir, det.configFile, opts) }
    default:
      return { state: 'cannot', ...base, ...(det.detail ? { detail: det.detail } : {}), snippet: snippetFor(dir, det.configFile, opts) }
  }
}

/**
 * Ensure the plugin for a project being opened. Never throws and
 * never blocks the open: every failure lands in the returned state.
 * Writes happen only for 'missing' / 'no-config', and only after
 * the in-memory verification (classify + byte-exact strip) passes.
 */
export function ensureProjectPlugin(root: string, opts: EnsureOptions = {}): EnsureState {
  const dir = path.resolve(root)
  try {
    if (dir === EDITOR_ROOT) return setState(dir, { state: 'registered', detail: 'the editor itself' })
    const stateFile = opts.stateFile ?? ensureStateFile()
    const det = detectPlugin(dir)
    const base = det.configFile ? { configFile: path.basename(det.configFile) } : {}

    if (det.cls === 'registered') return setState(dir, { state: 'registered', ...base })

    if (isDeclined(dir, stateFile)) return setState(dir, { state: 'missing-declined', ...base })

    switch (det.cls) {
      case 'not-vite': {
        const standalone = hasHtmlPreview(dir) && (det.detail ?? '') === 'no package.json'
        return setState(dir, standalone
          ? { state: 'standalone', detail: 'no package.json — the editor serves this folder with its own Vite, plugin included' }
          : { state: 'not-vite', ...(det.detail ? { detail: det.detail } : {}) })
      }
      case 'present-not-called':
      case 'cannot':
        return setState(dir, { state: 'cannot', ...base, ...(det.detail ? { detail: det.detail } : {}), snippet: snippetFor(dir, det.configFile, opts) })
      case 'no-config': {
        const target = path.join(dir, 'vite.config.js')
        const snippet = ensureSnippet(dir, opts)
        const content = createdConfigSource(snippet)
        if (classifyConfigSource(content).cls !== 'registered') {
          return setState(dir, { state: 'cannot', detail: 'the generated config failed verification; nothing was written' })
        }
        fs.writeFileSync(target, content, 'utf-8')
        return setState(dir, { state: 'added', configFile: path.basename(target), detail: 'created a vite config with the plugin registration' })
      }
      case 'missing': {
        const configFile = det.configFile as string
        const original = fs.readFileSync(configFile, 'utf-8')
        const snippet = ensureSnippet(dir, { ...opts, cjs: configFile.endsWith('.cjs') })
        const candidate = buildEnsuredSource(original, snippet)
        const verified = candidate !== null
          && classifyConfigSource(candidate).cls === 'registered'
          && stripEnsuredSource(candidate).source === original
        if (!verified || candidate === null) {
          return setState(dir, { state: 'cannot', ...base, detail: 'the config could not be edited safely; nothing was changed', snippet: snippetFor(dir, configFile, opts) })
        }
        fs.writeFileSync(configFile, candidate, 'utf-8')
        return setState(dir, { state: 'added', ...base })
      }
    }
  } catch (e) {
    return setState(dir, { state: 'cannot', detail: e instanceof Error ? e.message : String(e) })
  }
}

export interface RemoveResult {
  ok: boolean
  /** True when a file changed (the caller restarts the dev server). */
  changed: boolean
  detail?: string
  state: EnsureState
}

/**
 * Remove ensure's marked addition and record the opt-out. A
 * registration without markers was put there by hand (or by the
 * seed template) and is NOT touched — removal reports how to take
 * it out manually instead.
 */
export function removeProjectPlugin(root: string, opts: EnsureOptions = {}): RemoveResult {
  const dir = path.resolve(root)
  const stateFile = opts.stateFile ?? ensureStateFile()
  try {
    const det = detectPlugin(dir)
    const base = det.configFile ? { configFile: path.basename(det.configFile) } : {}
    if (!det.configFile) {
      const state = setState(dir, getEnsureState(dir) ?? ensureDisplayState(dir, opts))
      return { ok: false, changed: false, detail: 'there is no vite config to remove the plugin from', state }
    }
    const original = fs.readFileSync(det.configFile, 'utf-8')
    if (!original.includes(MARK_BEGIN)) {
      const state = setState(dir, { state: 'registered', ...base })
      return {
        ok: false, changed: false, state,
        detail: 'this registration was not added by the editor (no marker block) — remove the aiLiveEditor() call from the config by hand to opt out',
      }
    }
    const stripped = stripEnsuredSource(original)
    if (!stripped.removed) {
      const state = setState(dir, { state: 'cannot', ...base, detail: 'the marked plugin block looks damaged; nothing was changed', snippet: snippetFor(dir, det.configFile, opts) })
      return { ok: false, changed: false, detail: 'the marked plugin block looks damaged; nothing was changed', state }
    }
    if (isCreatedConfigSkeleton(stripped.source)) fs.unlinkSync(det.configFile)
    else fs.writeFileSync(det.configFile, stripped.source, 'utf-8')
    recordDeclined(dir, stateFile)
    const state = setState(dir, { state: 'missing-declined', ...base })
    return { ok: true, changed: true, state }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    const state = setState(dir, { state: 'cannot', detail })
    return { ok: false, changed: false, detail, state }
  }
}

/** Re-enable after an opt-out: clear the record and ensure again. */
export function enableProjectPlugin(root: string, opts: EnsureOptions = {}): EnsureState {
  clearDeclined(path.resolve(root), opts.stateFile ?? ensureStateFile())
  return ensureProjectPlugin(root, opts)
}

/* ── Standalone (package-less) folders ─────────────────────────── */

/**
 * The generated config the standalone Vite spawn loads with
 * --config: it lives in the editor's own .ai-live (nothing is
 * written into the user's folder) and registers the plugin inline,
 * so a package-less folder gets the same bridge as a real project.
 */
export function standaloneConfigSource(opts: EnsureOptions = {}): string {
  const snippet = ensureSnippet(EDITOR_ROOT, opts)
  return [
    '// Generated by ai-live-editor for package-less folders: registers',
    '// the editor plugin inline. Lives in the editor repo, never in',
    '// the folder being previewed.',
    snippet.importLine,
    `export default { plugins: [${snippet.call}] }`,
    '',
  ].join('\n')
}

export function writeStandalonePluginConfig(opts: EnsureOptions = {}): string {
  const file = path.join(EDITOR_ROOT, '.ai-live', 'standalone-vite.config.mjs')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, standaloneConfigSource(opts), 'utf-8')
  return file
}
