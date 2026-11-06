import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getFsRoot } from '../../launcher.js'
import { livePageOp, poolOpen } from '../../liveTarget.js'
import { applyStrReplace, compileGrep, GREP_MAX_HITS, grepText, isPlaceholderWrite, sliceLines, snippetAround, type GrepHit } from './fsEdit.js'
import { sketchWriteGuard } from '../../sketchSession.js'

const SKIP_DIR = new Set(['node_modules', '.vite', '.chrome-data'])

function safe(p: string) {
  const root = getFsRoot()
  const full = path.resolve(root, '.' + p)
  if (!full.startsWith(root)) throw new Error('traversal')
  return full
}

function relFromRoot(full: string): string {
  const root = getFsRoot()
  return '/' + path.relative(root, full).replace(/\\/g, '/')
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.chrome-data') || SKIP_DIR.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(full, acc)
    else acc.push(full)
  }
  return acc
}

export const listRealFilesTool = createTool({
  id: 'list-real-files',
  description: 'List files from real FS projects/',
  inputSchema: z.object({}),
  execute: async () => {
    const root = getFsRoot()
    const files = walkFiles(root).map(relFromRoot)
    return { files, root }
  }
})

export const readRealFileTool = createTool({
  id: 'read-real-file',
  description: 'Read a source file. Prefer offset+limit (1-based lines) for existing files instead of the whole file.',
  inputSchema: z.object({
    path: z.string(),
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  }),
  execute: async ({ path: p, offset, limit }) => {
    const full = safe(p)
    if (!fs.existsSync(full)) return { error: 'Not found: ' + p }
    const raw = fs.readFileSync(full, 'utf-8')
    const slice = sliceLines(raw, offset, limit)
    return { path: p, ...slice }
  }
})

export const grepTool = createTool({
  id: 'grep',
  description: 'Regex search in the project. Returns path:line hits. Skip node_modules. Use before ranged read.',
  inputSchema: z.object({
    pattern: z.string(),
    path: z.string().optional(),
    caseInsensitive: z.boolean().optional(),
    maxHits: z.number().int().positive().optional(),
  }),
  execute: async ({ pattern, path: p, caseInsensitive, maxHits }) => {
    const re = compileGrep(pattern, caseInsensitive)
    if ('error' in re) return { error: 'invalid pattern: ' + re.error }
    const cap = Math.min(maxHits || GREP_MAX_HITS, 200)
    const root = getFsRoot()
    const start = p ? safe(p) : root
    if (!fs.existsSync(start)) return { error: 'Not found: ' + (p || '/') }
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
    const full = safe(p)
    if (!fs.existsSync(full)) return { error: 'Not found: ' + p, path: p }
    const before = fs.readFileSync(full, 'utf-8')
    const result = applyStrReplace(before, old_string, new_string, replace_all === true)
    if (result.ok === false) return { error: result.error, path: p, matches: result.matches }
    fs.writeFileSync(full, result.content, 'utf-8')
    return {
      ok: true,
      path: p,
      matches: result.matches,
      bytes: result.content.length,
      snippet: snippetAround(result.content, new_string),
      mode: 'str-replace',
    }
  }
})

export const writeRealFileTool = createTool({
  id: 'write-real-file',
  description: 'Create or fully overwrite a file. Use for new files and scaffolds. For existing files, use str-replace. Do not write placeholders like "[original content]".',
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path: p, content }) => {
    const blocked = sketchWriteGuard()
    if (blocked) return blocked
    if (isPlaceholderWrite(content)) {
      return { error: 'Refusing placeholder write. Use str-replace with an exact hunk.', path: p }
    }
    const full = safe(p)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
    return { ok: true, path: p, bytes: content.length, mode: 'real-fs', elapsedMs: 1 }
  }
})

export const inspectDOMTool = createTool({
  id: 'inspect-dom',
  description: 'Inspect a live element. Default: the Vite app page. Pass url (another origin) to use the optional Playwright pool.',
  inputSchema: z.object({ selector: z.string().optional(), url: z.string().optional() }),
  execute: async ({ selector, url }) => livePageOp('inspect', { selector, url }),
})

export const takeSnapshotTool = createTool({
  id: 'take-snapshot',
  description:
    'Accessibility-style text snapshot of the live page (roles, names, CSS selectors). Prefer this over inspect-dom to see page structure. Use the selector on each line with patch-dom. verbose includes generic nodes. Pass url for the Playwright pool.',
  inputSchema: z.object({
    verbose: z.boolean().optional().describe('Include generic nodes, not only landmarks/controls/headings'),
    scopeSelector: z.string().optional().describe('Only snapshot under this selector'),
    url: z.string().optional(),
  }),
  execute: async (input) => livePageOp('snapshot', input as Record<string, unknown>),
})

export const patchDOMTool = createTool({
  id: 'patch-dom',
  description: 'Patch a live element. Ops: text, style, class, attr, html, insert, move, remove. insert needs html + position (before|after|prepend|append). move needs target + position. Recorded in Live sketch. Pass url for the Playwright pool.',
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
  execute: async (input) => livePageOp('patch', input as Record<string, unknown>),
})

export const evalTool = createTool({
  id: 'eval-js',
  description: 'Run JavaScript in the live Vite app, or in the Playwright pool when url is another origin.',
  inputSchema: z.object({ code: z.string(), url: z.string().optional() }),
  execute: async ({ code, url }) => livePageOp('eval', { code, url }),
})

export const poolOpenTool = createTool({
  id: 'pool-open',
  description: 'Open a URL in the optional Playwright Chrome pool (headed, persistent profile). Requires Playwright pool enabled in Settings.',
  inputSchema: z.object({ url: z.string() }),
  execute: async ({ url }) => poolOpen(url),
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
    if (!fs.existsSync(pkgPath)) return { ok: false, error: 'No package.json in the active project' }
    let scripts: Record<string, string> = {}
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: unknown }
      if (parsed.scripts && typeof parsed.scripts === 'object') {
        scripts = parsed.scripts as Record<string, string>
      }
    } catch (e: unknown) {
      return { ok: false, error: 'Could not parse package.json: ' + (e instanceof Error ? e.message : String(e)) }
    }
    if (typeof scripts.build !== 'string' || !scripts.build) {
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
      return {
        ok: false,
        script: 'build',
        timedOut: err.killed === true,
        error: tail(combined) || (err.message ?? 'build failed'),
      }
    }
  },
})
