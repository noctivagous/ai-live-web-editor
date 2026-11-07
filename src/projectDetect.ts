import fs from 'fs'
import path from 'path'

/**
 * Project classification (Open/Import slice A): what IS this folder?
 *
 * Opening a folder must never dead-end on "not an app project", so the
 * launcher classifies whatever it finds instead of gating on it:
 *
 *   ready — has package.json; its own dev server serves the preview.
 *   html  — no package.json, but at least one .html file at the root;
 *           `entry` names the unambiguous preview candidate when there
 *           is one (index.html, or the only .html file).
 *   loose — files, but no HTML page: there is nothing to preview yet.
 *   empty — no files at all.
 *
 * Detection only SUGGESTS (the candidate entry, the stack); nothing
 * here designates or writes anything — designation is the manifest's
 * job (project.ai.json), exactly like project types. Pure reads, safe
 * to run on every project-list request.
 */

export type ProjectKind = 'ready' | 'html' | 'loose' | 'empty'
export type ProjectStack = 'react' | 'lit' | 'vanilla' | 'static' | 'none'

export interface ProjectSetup {
  kind: ProjectKind
  /** Root-relative preview candidate ('index.html', 'landing.html'), or null when there is none or it is ambiguous. */
  entry: string | null
  /** Every root-level .html file, sorted — the candidates a setup step chooses among. */
  htmlFiles: string[]
  stack: ProjectStack
  hasPackageJson: boolean
}

const SKIP_DIR = new Set(['node_modules', 'dist', '.vite', '.chrome-data'])
const READ_CAP = 64 * 1024

function readHead(file: string): string {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(READ_CAP)
      const n = fs.readSync(fd, buf, 0, READ_CAP, 0)
      return buf.toString('utf-8', 0, n)
    } finally { fs.closeSync(fd) }
  } catch { return '' }
}

/** Root-level file names (no recursion, no skipped dirs' contents). */
function rootFiles(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isFile() && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch { return [] }
}

/** Any file anywhere shallow (root + one level), for the loose/empty call. */
function hasAnyFile(root: string): boolean {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return false }
  for (const e of entries) {
    if (e.isFile() && !e.name.startsWith('.')) return true
    if (e.isDirectory() && !SKIP_DIR.has(e.name) && !e.name.startsWith('.')) {
      try {
        if (fs.readdirSync(path.join(root, e.name), { withFileTypes: true }).some((c) => c.isFile())) return true
      } catch { /* unreadable subdir */ }
    }
  }
  return false
}

function packageDeps(root: string): Set<string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>
    }
    return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})])
  } catch { return new Set() }
}

const LIT_MARKERS = [/from\s+['"]lit['"]/, /from\s+['"]lit\//, /['"]@lit\//, /<script[^>]+src=["'][^"']*lit/i]

function detectStack(root: string, files: string[], htmlFiles: string[], entry: string | null, hasPkg: boolean): ProjectStack {
  if (hasPkg) {
    const deps = packageDeps(root)
    if (deps.has('react') || deps.has('react-dom')) return 'react'
    if (deps.has('lit') || [...deps].some((d) => d.startsWith('@lit/'))) return 'lit'
    return 'vanilla'
  }
  // No package.json: read the entry page and root scripts for markers.
  const texts: string[] = []
  if (entry) texts.push(readHead(path.join(root, entry)))
  for (const f of files) {
    if (/\.(m?[jt]s|m?[jt]sx)$/.test(f) && !f.endsWith('.test.ts')) texts.push(readHead(path.join(root, f)))
  }
  // Follow one hop: a module script the entry page loads by relative src.
  if (entry) {
    const m = texts[0]?.match(/<script[^>]+type=["']module["'][^>]+src=["']\.?\/?([\w./-]+)["']/) ||
      texts[0]?.match(/<script[^>]+src=["']\.?\/?([\w./-]+\.[jt]s)["'][^>]+type=["']module["']/)
    const rel = m?.[1]?.replace(/^\.\//, '').replace(/^\//, '')
    if (rel && !rel.includes('..') && fs.existsSync(path.join(root, rel))) texts.push(readHead(path.join(root, rel)))
  }
  const joined = texts.join('\n')
  if (LIT_MARKERS.some((re) => re.test(joined))) return 'lit'
  if (htmlFiles.length === 0) return 'none'
  return /<script[^>]+type=["']module["']/.test(joined) ? 'vanilla' : 'static'
}

export function classifyProject(root: string): ProjectSetup {
  const files = rootFiles(root)
  const hasPackageJson = files.includes('package.json')
  const htmlFiles = files.filter((f) => f.toLowerCase().endsWith('.html')).sort()
  const entry = htmlFiles.includes('index.html')
    ? 'index.html'
    : htmlFiles.length === 1
      ? htmlFiles[0]
      : null
  const stack = detectStack(root, files, htmlFiles, entry, hasPackageJson)
  if (hasPackageJson) return { kind: 'ready', entry, htmlFiles, stack, hasPackageJson }
  if (htmlFiles.length > 0) return { kind: 'html', entry, htmlFiles, stack, hasPackageJson }
  if (files.length > 0 || hasAnyFile(root)) return { kind: 'loose', entry: null, htmlFiles, stack, hasPackageJson }
  return { kind: 'empty', entry: null, htmlFiles, stack: 'none', hasPackageJson }
}
