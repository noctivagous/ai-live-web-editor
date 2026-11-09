import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getFsRoot } from '../../launcher.js'
import { livePageOp, poolOpen } from '../../liveTarget.js'
import { applyStrReplace, compileGrep, countLines, GREP_MAX_HITS, grepText, isPlaceholderWrite, lineRangeOf, sliceLines, snippetAround, type GrepHit } from './fsEdit.js'
import { logToolCall, type ToolCallEntry } from '../../serverLog.js'
import { sketchWriteGuard } from '../../sketchSession.js'
import { selfWriteGuard } from '../../selfMode.js'
import { resolveProjectPath } from '../../projectPath.js'
import { deletePath, mkdirPath, renamePath } from '../../fsOps.js'

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

/** Cap for the logging re-read (mirrors grep's 1MB skip). */
const LOG_READ_CAP = 1_000_000

/** Best-effort current line count for a canonical project path. */
function liveLineCount(canonicalPath: string): number | undefined {
  try {
    const r = resolveProjectPath(getFsRoot(), canonicalPath)
    if (r.ok === false) return undefined
    const st = fs.statSync(r.full)
    if (!st.isFile() || st.size > LOG_READ_CAP) return undefined
    const buf = fs.readFileSync(r.full)
    if (buf.subarray(0, 8192).includes(0)) return undefined
    return countLines(buf.toString('utf-8'))
  } catch { return undefined }
}

/**
 * Tool-call logging for the file tools: every call appends tool name,
 * canonical path, line range, the file's actual line count, and outcome
 * to logs/ as JSONL — counts and ranges only, never file contents.
 * Applied by mutation so tool identity (and mastra registration) is
 * unchanged; logging never breaks or alters the wrapped call.
 */
function withToolLog<T extends { execute?: (...args: any[]) => Promise<any> }>(toolId: string, tool: T): T {
  const inner = tool.execute?.bind(tool)
  if (!inner) return tool
  const wrapped = async (...args: any[]): Promise<any> => {
    const t0 = Date.now()
    const finish = (out: unknown, thrown: string | null): void => {
      try {
        const rec = (out ?? {}) as Record<string, unknown>
        const err = thrown ?? (typeof rec.error === 'string' ? rec.error : null)
        const entry: ToolCallEntry = { tool: toolId, ok: !err, elapsedMs: Date.now() - t0 }
        if (err) entry.error = err
        const argPath = (args[0] as { path?: unknown } | undefined)?.path
        const p = typeof rec.path === 'string' ? rec.path
          : typeof rec.to === 'string' ? rec.to
          : typeof rec.from === 'string' ? rec.from
          : typeof argPath === 'string' ? argPath : undefined
        if (p) entry.path = p
        if (typeof rec.matches === 'number') entry.matches = rec.matches
        if (typeof rec.created === 'boolean') entry.created = rec.created
        if (Array.isArray(rec.range) && rec.range.length === 2 && typeof rec.range[0] === 'number' && typeof rec.range[1] === 'number') {
          entry.range = [rec.range[0], rec.range[1]]
        } else if (typeof rec.startLine === 'number' && typeof rec.endLine === 'number') {
          entry.range = [rec.startLine, rec.endLine]
        }
        if (typeof rec.totalLines === 'number') entry.fileLines = rec.totalLines
        else if (typeof rec.fileLines === 'number') entry.fileLines = rec.fileLines
        else if (entry.path) {
          const live = liveLineCount(entry.path)
          if (typeof live === 'number') entry.fileLines = live
        }
        logToolCall(entry)
      } catch { /* logging never breaks the tool call */ }
    }
    try {
      const out = await inner(...args)
      finish(out, null)
      return out
    } catch (e) {
      finish(undefined, e instanceof Error ? e.message : String(e))
      throw e
    }
  }
  ;(tool as { execute: (...args: any[]) => Promise<any> }).execute = wrapped
  return tool
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      /* Dot-directories (.git, .ai-live, .vite, …) are tooling state,
       * not project source — never walked (slice 4). Dot-files are
       * still listed: .gitignore and friends are real project files. */
      if (e.name.startsWith('.')) continue
      walkFiles(full, acc)
    }
    else acc.push(full)
  }
  return acc
}

/** Cap on list-real-files output (slice 4): beyond this the result
 * carries totalFiles + truncated so the agent narrows with grep or
 * codebase-map instead of paying for the whole tree. */
export const LIST_FILES_CAP = 1000

export const listRealFilesTool = createTool({
  id: 'list-real-files',
  description: 'List files from real FS projects/ (dot-directories like .git are skipped; capped at 1000 with totalFiles + truncated when the project is larger)',
  inputSchema: z.object({}),
  execute: async () => {
    const root = getFsRoot()
    const all = walkFiles(root).map(relFromRoot)
    const truncated = all.length > LIST_FILES_CAP
    return { files: truncated ? all.slice(0, LIST_FILES_CAP) : all, root, totalFiles: all.length, truncated }
  }
})

export const readRealFileTool = createTool({
  id: 'read-real-file',
  description: 'Read a source file. Paths may be /src/x, src/x, or ./src/x; results return the canonical /… path. Prefer offset+limit (1-based lines) for existing files instead of the whole file.',
  inputSchema: z.object({
    path: z.string(),
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  }),
  execute: async ({ path: p, offset, limit }) => {
    const r = toolPath(p)
    if (r.ok === false) return { error: r.error, path: p }
    if (!fs.existsSync(r.full)) return { error: 'Not found: ' + r.rel, path: r.rel }
    if (fs.statSync(r.full).isDirectory()) return { error: 'Is a directory: ' + r.rel, path: r.rel }
    const buf = fs.readFileSync(r.full)
    /* Binary content read as UTF-8 is garbled noise the agent may act
     * on — refuse it readably, the same NUL check grep already uses
     * (slice 5b). */
    if (buf.subarray(0, 8192).includes(0)) {
      return { error: `Binary file: ${r.rel} (${buf.length} bytes) — cannot be read as text`, path: r.rel }
    }
    const raw = buf.toString('utf-8')
    const slice = sliceLines(raw, offset, limit)
    return { path: r.rel, ...slice }
  }
})

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

export const grepTool = createTool({
  id: 'grep',
  description: 'Regex search in the project. Returns path:line hits. Skip node_modules. Use before ranged read. Omit path to search the whole project — never pass null or the string "null".',
  inputSchema: z.object({
    pattern: z.string(),
    path: z.string().optional(),
    caseInsensitive: z.boolean().optional(),
    maxHits: z.number().int().positive().optional(),
  }),
  execute: async (input) => {
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
})

export const strReplaceTool = createTool({
  id: 'str-replace',
  description: 'Exact unique string replace in an existing file. Fails closed if old_string is missing or not unique. Never writes on miss. Prefer this over write-real-file for edits.',
  inputSchema: z.object({
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  execute: async ({ path: p, old_string, new_string, replace_all }) => {
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
    if (result.ok === false) return { ok: false, error: result.error, path: r.rel, matches: result.matches, fileLines: countLines(before) }
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
})

export const writeRealFileTool = createTool({
  id: 'write-real-file',
  description: 'Create or fully overwrite a file. Paths may be /src/x, src/x, or ./src/x; the result returns the canonical /… path and whether the file was created. Use for new files and scaffolds. For existing files, use str-replace. Do not write placeholders like "[original content]".',
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path: p, content }) => {
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
})

export const deleteFileTool = createTool({
  id: 'delete-file',
  description: 'Delete a file, or a folder with recursive:true (a folder with contents is refused without it, with the entry count). Paths may be /src/x, src/x, or ./src/x.',
  inputSchema: z.object({ path: z.string(), recursive: z.boolean().optional() }),
  execute: async ({ path: p, recursive }) => {
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
  },
})

export const renameFileTool = createTool({
  id: 'rename-file',
  description: 'Rename or move a file or folder. The target must not exist yet; missing target folders are created. Paths may be /src/x, src/x, or ./src/x.',
  inputSchema: z.object({ from: z.string(), to: z.string() }),
  execute: async ({ from, to }) => {
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
  },
})

export const makeDirTool = createTool({
  id: 'make-dir',
  description: 'Create a folder (and any missing parents). Refused when a file or folder already exists at the path. Paths may be /src/x, src/x, or ./src/x.',
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path: p }) => {
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
  },
})

export const inspectDOMTool = createTool({
  id: 'inspect-dom',
  description: 'Deep-dive ONE known element on the live page: capped HTML and text, rect, a child summary (count + tags, so you can tell a leaf from a subtree), and the data-ai-loc source stamp (sourceLoc) when the element carries one. This is the LAST step of the page senses, on one selector — for structure use page-sections first, for geometry layout-snapshot. Default: the Vite app page. Pass url (another origin) to use the optional Playwright pool.',
  inputSchema: z.object({ selector: z.string().optional(), url: z.string().optional() }),
  execute: async (input) => {
    const { selector, url } = ((input ?? {}) as { selector?: string, url?: string })
    return livePageOp('inspect', { selector, url })
  },
})

export const takeSnapshotTool = createTool({
  id: 'take-snapshot',
  description:
    'Accessibility-style text snapshot of the live page (roles, names, CSS selectors) — the selector harvest for patch-dom, and the accessibility view. For page STRUCTURE use page-sections first (cheaper, semantic); snapshot when you need per-element selectors or accessible names, and scope it with scopeSelector when you only need one region. Use the selector on each line with patch-dom. verbose includes generic nodes. Snapshot sees DOM text only: canvas/WebGL-painted content never appears here — when the target text is absent, the content may be painted or in page runtime state (runtime-state-scan covers the stores). Pass url for the Playwright pool.',
  inputSchema: z.object({
    verbose: z.boolean().optional().describe('Include generic nodes, not only landmarks/controls/headings'),
    scopeSelector: z.string().optional().describe('Only snapshot under this selector'),
    url: z.string().optional(),
  }),
  execute: async (input) => livePageOp('snapshot', ((input ?? {}) as Record<string, unknown>)),
})

export const patchDOMTool = createTool({
  id: 'patch-dom',
  description: 'Patch a live element. Ops: text, style, class, attr, html, insert, move, remove. insert needs html + position (before|after|prepend|append). move needs target + position. Cannot change canvas-painted pixels: painted content lives in page runtime state (runtime-state-scan finds it, runtime-state-set changes it). Recorded in Live sketch. Pass url for the Playwright pool.',
  inputSchema: z.object({
    selector: z.string(),
    op: z.enum(['html', 'text', 'style', 'attr', 'class', 'remove', 'insert', 'move']).optional(),
    html: z.string().optional().describe('For html/insert: fragment. insert must have exactly one root element.'),
    text: z.string().optional(),
    style: z.string().optional(),
    className: z.string().optional(),
    attr: z.object({ name: z.string(), value: z.string() }).optional(),
    target: z.string().optional().describe('move: destination selector'),
    position: z.enum(['before', 'after', 'prepend', 'append']).optional().describe('insert/move placement; default append'),
    url: z.string().optional(),
  }),
  execute: async (input) => livePageOp('patch', ((input ?? {}) as Record<string, unknown>)),
})

export const evalTool = createTool({
  id: 'eval-js',
  description: 'Run JavaScript in the live Vite app, or in the Playwright pool when url is another origin.',
  inputSchema: z.object({ code: z.string(), url: z.string().optional() }),
  execute: async (input) => {
    const { code, url } = ((input ?? {}) as { code?: string, url?: string })
    return livePageOp('eval', { code, url })
  },
})

export const poolOpenTool = createTool({
  id: 'pool-open',
  description: 'Open a URL in the optional Playwright Chrome pool (headed, persistent profile). Requires Playwright pool enabled in Settings.',
  inputSchema: z.object({ url: z.string() }),
  execute: async (input) => {
    const url = typeof ((input ?? {}) as { url?: unknown }).url === 'string'
      ? ((input ?? {}) as { url: string }).url
      : ''
    return poolOpen(url)
  },
})

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
export const runProjectCheckTool = createTool({
  id: 'run-project-check',
  description: 'Run the active project\'s build script (from its package.json) with a timeout and return the tail of the output. Use to verify behaviour changes before claiming done.',
  inputSchema: z.object({}),
  execute: async () => {
    const root = getFsRoot()
    const pkgPath = path.join(root, 'package.json')
    if (!fs.existsSync(pkgPath)) {
      const { logServerError } = await import('../../serverLog.js')
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
      const { logServerError } = await import('../../serverLog.js')
      logServerError({ kind: 'project-check', message: 'Could not parse package.json', detail: e instanceof Error ? e.message : String(e) })
      return { ok: false, error: 'Could not parse package.json: ' + (e instanceof Error ? e.message : String(e)) }
    }
    if (typeof scripts.build !== 'string' || !scripts.build) {
      const { logServerError } = await import('../../serverLog.js')
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
      const { logServerError } = await import('../../serverLog.js')
      logServerError({ kind: 'project-check', message: 'project build failed', detail: tail(combined) || (err.message ?? 'build failed') })
      return {
        ok: false,
        script: 'build',
        timedOut: err.killed === true,
        error: tail(combined) || (err.message ?? 'build failed'),
      }
    }
  },
})

/* Tool-call logging for the file tools (see withToolLog above): applied
 * here, after every tool is defined, by mutation — tool identity and
 * mastra registration are unchanged. run-project-check keeps its own
 * server-error logging; live-page tools carry no file/line facts. */
withToolLog('list-real-files', listRealFilesTool)
withToolLog('read-real-file', readRealFileTool)
withToolLog('grep', grepTool)
withToolLog('str-replace', strReplaceTool)
withToolLog('write-real-file', writeRealFileTool)
withToolLog('delete-file', deleteFileTool)
withToolLog('rename-file', renameFileTool)
withToolLog('make-dir', makeDirTool)
