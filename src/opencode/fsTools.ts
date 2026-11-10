/**
 * ALE fs tools as plain host functions (re-platform slice 5,
 * tool wave 4 — group B).
 *
 * The nine filesystem tools — list-real-files, grep,
 * read-real-file, str-replace, write-real-file, delete-file,
 * rename-file, make-dir, run-project-check — served to the
 * OpenCode plugin through their own dispatch endpoint,
 * POST /api/fs/tool (registered in both server.ts and apiApp.ts).
 *
 * Each function below is the Mastra tool's execute body
 * (src/mastra/tools/realFsTools.ts) with the wrapper removed —
 * the same fsEdit core, path resolution, fs ops and write guards
 * (sketchWriteGuard, selfWriteGuard), resolving against the
 * active fs root exactly as the Mastra bodies do, so results and
 * on-disk effects match the Mastra path's exactly, including the
 * str-replace miss windows. The Mastra module wraps its tools in
 * withToolLog (a tool-call logging side effect); logging is not
 * part of a tool's result or disk effect, so the bodies below
 * stay unwrapped — slice 9 closes that gap one layer up instead:
 * runFsTool (bottom of this module) records every dispatch
 * execution through chatDebug's withDispatchDebugLog when
 * AI_LIVE_CHAT_DEBUG is on, as do all the plugin dispatch
 * endpoints' run* functions.
 *
 * REGISTRATION IS CONDITIONAL (owner decision, slice 5): these
 * tools overlap OpenCode's native fs tools, and the owner wants
 * OpenCode performing as itself by default. The plugin registers
 * this table only when the supervisor spawned the server with
 * ALE_OPENCODE_FS_TOOLS=1 — which it does only when the
 * `aleFsTools` agent setting is on (default off; the Settings →
 * Advanced door lands in a later slice). The host functions and
 * this endpoint exist regardless: parity is what makes the
 * toggle meaningful.
 */
import { execFileSync } from 'node:child_process'
import { withDispatchDebugLog } from '../chatDebug.js'
import fs from 'node:fs'
import path from 'node:path'
import { deletePath, mkdirPath, renamePath } from '../fsOps.js'
import { getFsRoot } from '../launcher.js'
import {
  applyStrReplace, compileGrep, countLines, GREP_MAX_HITS, grepText, isPlaceholderWrite,
  lineRangeOf, matchWindows, nearestWindow, sliceLines, snippetAround, type GrepHit,
} from '../mastra/tools/fsEdit.js'
import { resolveProjectPath } from '../projectPath.js'
import { selfWriteGuard } from '../selfMode.js'
import { sketchWriteGuard } from '../sketchSession.js'

type Input = Record<string, any>

const SKIP_DIR = new Set(['node_modules', '.vite', '.chrome-data'])

type ToolPath = { ok: true; full: string; rel: string } | { ok: false; error: string; path: string }

/** Resolve a tool path argument (any form: /src/x, src/x, ./src/x) to
 * the canonical project path. A bad path becomes an error result —
 * tools never throw and never silently relocate a file. */
function toolPath(p: string): ToolPath {
  const r = resolveProjectPath(getFsRoot(), p)
  if (r.ok === false) return { ok: false, error: r.error, path: p }
  return r
}

function relFromRoot(full: string): string {
  const root = getFsRoot()
  return '/' + path.relative(root, full).replace(/\\/g, '/')
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      /* Dot-directories (.git, .ai-live, .vite, …) are tooling state,
       * not project source — never walked. Dot-files are still
       * listed: .gitignore and friends are real project files. */
      if (e.name.startsWith('.')) continue
      walkFiles(full, acc)
    }
    else acc.push(full)
  }
  return acc
}

/** Cap on list-real-files output: beyond this the result carries
 * totalFiles + truncated so the agent narrows with grep or
 * codebase-map instead of paying for the whole tree. */
export const LIST_FILES_CAP = 1000

async function listRealFiles() {
  const root = getFsRoot()
  const all = walkFiles(root).map(relFromRoot)
  const truncated = all.length > LIST_FILES_CAP
  return { files: truncated ? all.slice(0, LIST_FILES_CAP) : all, root, totalFiles: all.length, truncated }
}

async function readRealFile(input: Input) {
  const { path: p, offset, limit } = input ?? {}
  const r = toolPath(p)
  if (r.ok === false) return { error: r.error, path: p }
  if (!fs.existsSync(r.full)) return { error: 'Not found: ' + r.rel, path: r.rel }
  if (fs.statSync(r.full).isDirectory()) return { error: 'Is a directory: ' + r.rel, path: r.rel }
  const buf = fs.readFileSync(r.full)
  /* Binary content read as UTF-8 is garbled noise the agent may act
   * on — refuse it readably, the same NUL check grep already uses. */
  if (buf.subarray(0, 8192).includes(0)) {
    return { error: `Binary file: ${r.rel} (${buf.length} bytes) — cannot be read as text`, path: r.rel }
  }
  const raw = buf.toString('utf-8')
  const slice = sliceLines(raw, offset, limit)
  /* charTruncated is the Mastra body's internal signal (its
   * read-cover bookkeeping); the tool result strips it — mirror
   * the strip so the ported result stays byte-identical. */
  const { charTruncated: _c, ...rest } = slice
  return { path: r.rel, ...rest }
}

/**
 * A null-ish search path (JSON null, blank, or the literal strings
 * "null"/"undefined" the model copies out of a `Current file: null`
 * line) means the whole project — never a file literally named that.
 */
function grepStartPath(p: unknown): string | undefined {
  if (p == null) return undefined
  if (typeof p !== 'string') return undefined
  const trimmed = p.trim().toLowerCase()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined
  return p
}

async function grep(input: Input) {
  const { pattern, path: p, caseInsensitive, maxHits } = ((input ?? {}) as { pattern?: unknown, path?: unknown, caseInsensitive?: boolean, maxHits?: number })
  if (typeof pattern !== 'string' || !pattern) return { error: 'pattern must be a non-empty string' }
  const re = compileGrep(pattern, caseInsensitive)
  if ('error' in re) return { error: 'invalid pattern: ' + re.error }
  const cap = Math.min(maxHits || GREP_MAX_HITS, 200)
  const root = getFsRoot()
  const at = grepStartPath(p)
  let start = root
  if (at) {
    const r = toolPath(at)
    if (r.ok === false) return { error: r.error, path: at }
    start = r.full
  }
  if (!fs.existsSync(start)) return { error: 'Not found: ' + (at || '/') }
  const files = fs.statSync(start).isDirectory() ? walkFiles(start) : [start]
  const hits: GrepHit[] = []
  let truncated = false
  for (const file of files) {
    const st = fs.statSync(file)
    if (st.size > 1_000_000) continue
    const buf = fs.readFileSync(file)
    if (buf.includes(0)) continue
    if (grepText(buf.toString('utf-8'), relFromRoot(file), re, cap, hits)) {
      truncated = true
      break
    }
  }
  return { hits, count: hits.length, truncated }
}

async function strReplace(input: Input) {
  const { path: p, old_string, new_string, replace_all } = input ?? {}
  const blocked = sketchWriteGuard()
  if (blocked) return blocked
  const r = toolPath(p)
  if (r.ok === false) return { error: r.error, path: p }
  const selfBlocked = selfWriteGuard(r.full)
  if (selfBlocked) return selfBlocked
  if (!fs.existsSync(r.full)) return { error: 'Not found: ' + r.rel, path: r.rel }
  if (fs.statSync(r.full).isDirectory()) return { error: 'Is a directory: ' + r.rel, path: r.rel }
  const before = fs.readFileSync(r.full, 'utf-8')
  const result = applyStrReplace(before, old_string, new_string, replace_all === true)
  // Line facts ride the result so a failure report can say what the
  // file actually looked like (e.g. a miss on a 124-line file).
  if (result.ok === false) {
    const base = { ok: false, error: result.error, path: r.rel, matches: result.matches, fileLines: countLines(before) }
    if (result.matches === 0) {
      const near = nearestWindow(before, old_string)
      return near
        ? { ...base, ...near, hint: 'window is exact file source around the closest line. Copy from it as the next old_string. Do not re-read this file.' }
        : base
    }
    const windows = matchWindows(before, old_string)
    return windows.length
      ? { ...base, windows, hint: 'Each window is exact file source around one match. Widen old_string from one window, or set replace_all. Do not re-read this file.' }
      : base
  }
  fs.writeFileSync(r.full, result.content, 'utf-8')
  const range = lineRangeOf(result.content, new_string)
  return {
    ok: true,
    path: r.rel,
    matches: result.matches,
    bytes: result.content.length,
    fileLines: countLines(result.content),
    ...(range ? { range } : null),
    snippet: snippetAround(result.content, new_string),
    mode: 'str-replace',
  }
}

async function writeRealFile(input: Input) {
  const { path: p, content } = input ?? {}
  const blocked = sketchWriteGuard()
  if (blocked) return blocked
  if (isPlaceholderWrite(content)) {
    return { error: 'Refusing placeholder write. Use str-replace with an exact hunk.', path: p }
  }
  const r = toolPath(p)
  if (r.ok === false) return { error: r.error, path: p }
  const selfBlocked = selfWriteGuard(r.full)
  if (selfBlocked) return selfBlocked
  const existing = fs.existsSync(r.full) ? fs.statSync(r.full) : null
  if (existing?.isDirectory()) return { error: 'Is a directory: ' + r.rel, path: r.rel }
  const created = !existing
  fs.mkdirSync(path.dirname(r.full), { recursive: true })
  fs.writeFileSync(r.full, content, 'utf-8')
  return { ok: true, path: r.rel, created, bytes: content.length, mode: 'real-fs', elapsedMs: 1 }
}

async function deleteFile(input: Input) {
  const { path: p, recursive } = input ?? {}
  const blocked = sketchWriteGuard()
  if (blocked) return blocked
  const r = toolPath(p)
  if (r.ok === false) return { error: r.error, path: p }
  const selfBlocked = selfWriteGuard(r.full)
  if (selfBlocked) return selfBlocked
  try {
    const res = deletePath(getFsRoot(), r.rel, recursive === true)
    return { ok: true, path: res.path, isDir: res.isDir, mode: 'delete' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), path: r.rel }
  }
}

async function renameFile(input: Input) {
  const { from, to } = input ?? {}
  const blocked = sketchWriteGuard()
  if (blocked) return blocked
  const rFrom = toolPath(from)
  if (rFrom.ok === false) return { error: rFrom.error, path: from }
  const rTo = toolPath(to)
  if (rTo.ok === false) return { error: rTo.error, path: to }
  const selfBlocked = selfWriteGuard(rFrom.full) ?? selfWriteGuard(rTo.full)
  if (selfBlocked) return selfBlocked
  try {
    const res = renamePath(getFsRoot(), rFrom.rel, rTo.rel)
    return { ok: true, from: res.from, to: res.to, isDir: res.isDir, mode: 'rename' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), from: rFrom.rel, to: rTo.rel }
  }
}

async function makeDir(input: Input) {
  const { path: p } = input ?? {}
  const blocked = sketchWriteGuard()
  if (blocked) return blocked
  const r = toolPath(p)
  if (r.ok === false) return { error: r.error, path: p }
  const selfBlocked = selfWriteGuard(r.full)
  if (selfBlocked) return selfBlocked
  try {
    const res = mkdirPath(getFsRoot(), r.rel)
    return { ok: true, path: res.path, mode: 'mkdir' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), path: r.rel }
  }
}

const CHECK_TIMEOUT_MS = 120_000
const CHECK_TAIL_CHARS = 4_000

function tail(text: string): string {
  const t = String(text || '')
  return t.length > CHECK_TAIL_CHARS ? '…(truncated)\n' + t.slice(-CHECK_TAIL_CHARS) : t
}

/**
 * Run the active project's own build script and return the tail of its
 * output. The ONLY tool whose result may render a Deck Test card —
 * never invent test results elsewhere.
 */
async function runProjectCheck() {
  const root = getFsRoot()
  const pkgPath = path.join(root, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    const { logServerError } = await import('../serverLog.js')
    logServerError({ kind: 'project-check', message: 'No package.json in the active project' })
    return { ok: false, error: 'No package.json in the active project' }
  }
  let scripts: Record<string, string> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: unknown }
    if (parsed.scripts && typeof parsed.scripts === 'object') {
      scripts = parsed.scripts as Record<string, string>
    }
  } catch (e: unknown) {
    const { logServerError } = await import('../serverLog.js')
    logServerError({ kind: 'project-check', message: 'Could not parse package.json', detail: e instanceof Error ? e.message : String(e) })
    return { ok: false, error: 'Could not parse package.json: ' + (e instanceof Error ? e.message : String(e)) }
  }
  if (typeof scripts.build !== 'string' || !scripts.build) {
    const { logServerError } = await import('../serverLog.js')
    logServerError({ kind: 'project-check', message: 'No build script in package.json' })
    return { ok: false, error: 'No build script in package.json' }
  }
  try {
    const out = execFileSync('npm', ['run', 'build'], {
      cwd: root,
      timeout: CHECK_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, script: 'build', outputTail: tail(out) }
  } catch (e: unknown) {
    const err = e as { stdout?: unknown; stderr?: unknown; message?: string; killed?: boolean }
    const combined = [err.stdout, err.stderr].filter(Boolean).join('\n')
    const { logServerError } = await import('../serverLog.js')
    logServerError({ kind: 'project-check', message: 'project build failed', detail: tail(combined) || (err.message ?? 'build failed') })
    return {
      ok: false,
      script: 'build',
      timedOut: err.killed === true,
      error: tail(combined) || (err.message ?? 'build failed'),
    }
  }
}

/** The wave-4 group-B fs tools by their (Mastra-identical) names. */
export const FS_TOOL_HANDLERS: Record<string, (input: Input) => Promise<unknown>> = {
  'list-real-files': listRealFiles,
  'grep': grep,
  'read-real-file': readRealFile,
  'str-replace': strReplace,
  'write-real-file': writeRealFile,
  'delete-file': deleteFile,
  'rename-file': renameFile,
  'make-dir': makeDir,
  'run-project-check': runProjectCheck,
}

export const FS_TOOL_NAMES = Object.keys(FS_TOOL_HANDLERS)

/** Run one fs tool by name; unknown names are an error value,
 * never a throw (the dispatch endpoint's contract). */
async function runFsToolImpl(name: string, input: Input): Promise<unknown> {
  const handler = FS_TOOL_HANDLERS[name]
  if (!handler) {
    return { ok: false, error: `unknown fs tool "${name}". Available: ${FS_TOOL_NAMES.join(', ')}` }
  }
  return handler(input ?? {})
}

/** The exported dispatch: the impl above, plus its per-tool debug
 * record when chat debug is on (slice 9 — chatDebug.ts). */
export async function runFsTool(name: string, input: Input): Promise<unknown> {
  return withDispatchDebugLog(name, input, () => runFsToolImpl(name, input))
}
