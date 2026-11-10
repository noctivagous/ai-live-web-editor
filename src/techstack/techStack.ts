/**
 * Tech Stack derivation (Facets design §6): what the project
 * is built with, READ from the project on disk — never declared
 * into being, never invented. Languages from file extensions,
 * packages from manifests with declared (manifest range) and
 * installed (lockfile) versions kept apart, files of note, and
 * framework/runtime facts from packages + config presence.
 *
 * Other ecosystems (Python, Rust, Go) are read by the same
 * manifest pattern at summary level: their manifests name the
 * project and its requirements, but per-package installed
 * versions come from npm's lockfile shape only in v1 — the
 * report says so rather than guessing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot, listProjectFiles } from '../launcher.js'

export interface StackLanguage { name: string, files: number, locations: string[] }
export interface StackPackage { name: string, declared?: string, installed?: string, kind: 'runtime' | 'dev', usedBy: string[] }
export interface TechStack {
  derivedAt: number
  languages: StackLanguage[]
  packages: StackPackage[]
  filesOfNote: { path: string, what: string }[]
  facts: string[]
  ecosystems: string[]
  report: {
    declaredNotInstalled: string[]
    installedNotDeclared: string[]
    versionMismatches: { name: string, declared: string, installed: string }[]
    candidateUnused: string[]
  }
}

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.rb': 'Ruby', '.java': 'Java', '.css': 'CSS', '.html': 'HTML', '.md': 'Markdown',
}

const FILES_OF_NOTE: { match: RegExp, what: string }[] = [
  { match: /(^|\/)package\.json$/, what: 'npm manifest — packages and scripts' },
  { match: /(^|\/)package-lock\.json$/, what: 'npm lockfile — installed versions' },
  { match: /(^|\/)(pnpm-lock\.yaml|yarn\.lock)$/, what: 'Lockfile — installed versions' },
  { match: /(^|\/)tsconfig[^/]*\.json$/, what: 'TypeScript configuration' },
  { match: /(^|\/)vite\.config\.[^/]+$/, what: 'Vite bundler configuration' },
  { match: /(^|\/)tailwind\.config\.[^/]+$/, what: 'Tailwind configuration' },
  { match: /(^|\/)(requirements\.txt|pyproject\.toml)$/, what: 'Python manifest' },
  { match: /(^|\/)Cargo\.toml$/, what: 'Rust manifest' },
  { match: /(^|\/)go\.mod$/, what: 'Go manifest' },
]

function readJson(root: string, rel: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch { return null }
}

/** Installed versions from package-lock.json (v2/v3 `packages`
 * shape, with the v1 `dependencies` shape as fallback). */
export function installedFromLockfile(lock: Record<string, unknown> | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!lock) return out
  const pkgs = lock.packages as Record<string, unknown> | undefined
  if (pkgs && typeof pkgs === 'object') {
    for (const [key, val] of Object.entries(pkgs)) {
      const m = /(?:^|\/)node_modules\/([^/]+(?:\/[^/]+)?)$/.exec(key)
      const v = (val as Record<string, unknown>)?.version
      if (m && typeof v === 'string' && !out.has(m[1])) out.set(m[1], v)
    }
  }
  const deps = lock.dependencies as Record<string, unknown> | undefined
  if (deps && typeof deps === 'object') {
    for (const [name, val] of Object.entries(deps)) {
      const v = (val as Record<string, unknown>)?.version
      if (typeof v === 'string' && !out.has(name)) out.set(name, v)
    }
  }
  return out
}

const FRAMEWORK_FACTS: { pkg: string, fact: string }[] = [
  { pkg: 'react', fact: 'React UI library' },
  { pkg: 'vue', fact: 'Vue UI framework' },
  { pkg: 'svelte', fact: 'Svelte UI framework' },
  { pkg: 'lit', fact: 'Lit web components' },
  { pkg: 'vite', fact: 'Vite bundler/dev server' },
  { pkg: 'express', fact: 'Express server' },
  { pkg: 'typescript', fact: 'TypeScript compiler' },
  { pkg: 'tailwindcss', fact: 'Tailwind CSS' },
]

/** The major version a range allows, for mismatch comparison:
 * the first version-looking token in the range. */
function rangeFloor(range: string): string | null {
  const m = /(\d+\.\d+\.\d+|\d+\.\d+|\d+)/.exec(range)
  return m ? m[1] : null
}

function satisfiesFloor(installed: string, range: string): boolean {
  if (/^\*$|^x$|latest/i.test(range.trim())) return true
  const floor = rangeFloor(range)
  if (!floor) return true
  const [aMaj, aMin = 0, aPat = 0] = installed.split('.').map(n => parseInt(n, 10) || 0)
  const [fMaj, fMin = 0, fPat = 0] = floor.split('.').map(n => parseInt(n, 10) || 0)
  if (range.includes('>=')) return aMaj > fMaj || (aMaj === fMaj && (aMin > fMin || (aMin === fMin && aPat >= fPat)))
  // Caret/tilde/exact: installed major must match the floor's,
  // and the installed version must not be below the floor.
  if (aMaj !== fMaj) return false
  if (aMin !== fMin) return aMin > fMin
  return aPat >= fPat
}

export function deriveTechStack(root: string = getFsRoot()): TechStack {
  const entries = listProjectFiles(root).map(e => e.path.replace(/^\//, ''))

  const langMap = new Map<string, { files: number, locations: Set<string> }>()
  for (const f of entries) {
    const lang = LANG_BY_EXT[path.extname(f).toLowerCase()]
    if (!lang) continue
    const rec = langMap.get(lang) ?? { files: 0, locations: new Set<string>() }
    rec.files++
    rec.locations.add(f.split('/').slice(0, -1).join('/') || '.')
    langMap.set(lang, rec)
  }
  const languages = [...langMap.entries()]
    .map(([name, r]) => ({ name, files: r.files, locations: [...r.locations].slice(0, 6) }))
    .sort((a, b) => b.files - a.files)

  const filesOfNote = entries
    .filter(f => FILES_OF_NOTE.some(n => n.match.test(f)))
    .map(f => ({ path: f, what: FILES_OF_NOTE.find(n => n.match.test(f))!.what }))
    .slice(0, 30)

  const ecosystems: string[] = []
  const packages: StackPackage[] = []
  const pkgJsonPath = entries.find(f => f === 'package.json')
  const installed = installedFromLockfile(entries.includes('package-lock.json') ? readJson(root, 'package-lock.json') : null)
  const declaredNames = new Set<string>()

  if (pkgJsonPath) {
    ecosystems.push('npm')
    const manifest = readJson(root, pkgJsonPath) ?? {}
    const collect = (obj: unknown, kind: 'runtime' | 'dev') => {
      if (!obj || typeof obj !== 'object') return
      for (const [name, range] of Object.entries(obj as Record<string, unknown>)) {
        declaredNames.add(name)
        packages.push({
          name,
          ...(typeof range === 'string' ? { declared: range } : {}),
          ...(installed.get(name) ? { installed: installed.get(name) } : {}),
          kind,
          usedBy: [],
        })
      }
    }
    collect(manifest.dependencies, 'runtime')
    collect(manifest.devDependencies, 'dev')
  }
  if (entries.some(f => /(^|\/)(requirements\.txt|pyproject\.toml)$/.test(f))) ecosystems.push('Python')
  if (entries.some(f => /(^|\/)Cargo\.toml$/.test(f))) ecosystems.push('Rust')
  if (entries.some(f => /(^|\/)go\.mod$/.test(f))) ecosystems.push('Go')

  // used-by: which project files import each package (§8.1's
  // link source). Bare specifiers only; scoped names handled.
  const srcFiles = entries.filter(f => /\.(tsx?|jsx?|mjs|cjs)$/i.test(f) && !f.startsWith('node_modules/'))
  const texts = new Map<string, string>()
  for (const f of srcFiles.slice(0, 500)) {
    try { texts.set(f, fs.readFileSync(path.join(root, f), 'utf-8')) } catch { /* raced deletion */ }
  }
  for (const pkg of packages) {
    const re = new RegExp(`['"]${pkg.name.replace(/[.*+?^${'{}'}()|[\]\\]/g, '\\$&')}(/[^'"]*)?['"]`)
    for (const [file, text] of texts) if (re.test(text)) pkg.usedBy.push(file)
    pkg.usedBy = pkg.usedBy.slice(0, 8)
  }

  const facts: string[] = []
  for (const f of FRAMEWORK_FACTS) {
    if (packages.some(p => p.name === f.pkg)) facts.push(f.fact)
  }
  const engines = (readJson(root, 'package.json')?.engines ?? null) as Record<string, unknown> | null
  if (engines && typeof engines.node === 'string') facts.push(`Node ${engines.node} (declared in engines)`)

  const declaredNotInstalled = packages.filter(p => !p.installed && installed.size > 0).map(p => p.name)
  const installedNotDeclared = [...installed.keys()].filter(n => !declaredNames.has(n)).slice(0, 40)
  const versionMismatches = packages
    .filter(p => p.declared && p.installed && !satisfiesFloor(p.installed, p.declared))
    .map(p => ({ name: p.name, declared: p.declared!, installed: p.installed! }))
  const candidateUnused = packages.filter(p => p.kind === 'runtime' && p.usedBy.length === 0).map(p => p.name)

  return {
    derivedAt: Date.now(),
    languages, packages, filesOfNote, facts, ecosystems,
    report: { declaredNotInstalled, installedNotDeclared, versionMismatches, candidateUnused },
  }
}

/** One line for the agent brief (§6). */
export function techStackSummary(root: string = getFsRoot()): string {
  try {
    const stack = deriveTechStack(root)
    if (!stack.packages.length && !stack.languages.length) return ''
    const top = stack.languages.slice(0, 3).map(l => l.name).join(', ')
    const facts = stack.facts.slice(0, 4).join('; ')
    return `Tech stack: ${top}${facts ? ` — ${facts}` : ''}. ${stack.packages.length} packages declared.`
  } catch { return '' }
}
