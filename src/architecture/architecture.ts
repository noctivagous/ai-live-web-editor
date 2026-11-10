/**
 * The architecture declaration (Facets design §4.2): how the
 * app is built, declared in `ai-architecture/` — a structured
 * plan (layers, module inventory, allowed dependency
 * directions) in architecture.json, the philosophy and briefed
 * rules as prose in guide.md, and checkable rules the gate can
 * run. Absence = undesignated: the facet shows detected
 * structure instead, and nothing is ever flagged for a project
 * that has not designated a plan (§4.4).
 *
 * Checkable rules (v1 kinds):
 * - no-import: files under module `from` must not import files
 *   under module `to`.
 * - naming: files under `path` (default: every module path)
 *   have basenames matching `pattern`.
 * Both report pass/fail with file evidence, verify-criteria
 * style (§8.3).
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot, listProjectFiles } from '../launcher.js'

export interface ArchModule { name: string, path: string, responsibility?: string }
export interface ArchRule {
  id: string
  say: string
  kind: 'no-import' | 'naming'
  from?: string
  to?: string
  path?: string
  pattern?: string
}
export interface ArchitectureDeclaration {
  version: 1
  name?: string
  layers: string[]
  modules: ArchModule[]
  /** Allowed dependency directions, by module name. */
  allowedDependencies: { from: string, to: string }[]
  rules: ArchRule[]
  provenance?: string
}

const str = (v: unknown, cap = 300): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, cap) : undefined

export function sanitizeArchitecture(raw: unknown): ArchitectureDeclaration | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const modules: ArchModule[] = []
  if (Array.isArray(r.modules)) {
    for (const m of r.modules.slice(0, 60)) {
      if (!m || typeof m !== 'object') continue
      const rec = m as Record<string, unknown>
      const name = str(rec.name, 80)
      const p = str(rec.path, 200)
      if (name && p) modules.push({ name, path: p, ...(str(rec.responsibility) ? { responsibility: str(rec.responsibility) } : {}) })
    }
  }
  const rules: ArchRule[] = []
  if (Array.isArray(r.rules)) {
    for (const rule of r.rules.slice(0, 40)) {
      if (!rule || typeof rule !== 'object') continue
      const rec = rule as Record<string, unknown>
      const id = str(rec.id, 60)
      const say = str(rec.say)
      const kind = rec.kind === 'naming' ? 'naming' : rec.kind === 'no-import' ? 'no-import' : null
      if (id && say && kind) {
        rules.push({
          id, say, kind,
          ...(str(rec.from, 80) ? { from: str(rec.from, 80) } : {}),
          ...(str(rec.to, 80) ? { to: str(rec.to, 80) } : {}),
          ...(str(rec.path, 200) ? { path: str(rec.path, 200) } : {}),
          ...(str(rec.pattern, 120) ? { pattern: str(rec.pattern, 120) } : {}),
        })
      }
    }
  }
  const allowedDependencies: { from: string, to: string }[] = []
  if (Array.isArray(r.allowedDependencies)) {
    for (const d of r.allowedDependencies.slice(0, 80)) {
      if (!d || typeof d !== 'object') continue
      const rec = d as Record<string, unknown>
      const from = str(rec.from, 80)
      const to = str(rec.to, 80)
      if (from && to) allowedDependencies.push({ from, to })
    }
  }
  return {
    version: 1,
    ...(str(r.name, 120) ? { name: str(r.name, 120) } : {}),
    layers: Array.isArray(r.layers) ? r.layers.filter((l): l is string => typeof l === 'string').map(l => l.slice(0, 80)).slice(0, 20) : [],
    modules,
    allowedDependencies,
    rules,
    ...(str(r.provenance, 80) ? { provenance: str(r.provenance, 80) } : {}),
  }
}

export function architecturePath(root: string): string {
  return path.join(root, 'ai-architecture', 'architecture.json')
}
export function architectureGuidePath(root: string): string {
  return path.join(root, 'ai-architecture', 'guide.md')
}

export function getArchitecture(root: string = getFsRoot()): ArchitectureDeclaration | null {
  try {
    return sanitizeArchitecture(JSON.parse(fs.readFileSync(architecturePath(root), 'utf-8')))
  } catch {
    return null
  }
}

export function saveArchitecture(decl: unknown, root: string = getFsRoot()): ArchitectureDeclaration | null {
  const clean = sanitizeArchitecture(decl)
  if (!clean) return null
  fs.mkdirSync(path.join(root, 'ai-architecture'), { recursive: true })
  fs.writeFileSync(architecturePath(root), JSON.stringify(clean, null, 2) + '\n', 'utf-8')
  return clean
}

export function getArchitectureGuide(root: string = getFsRoot()): string {
  try { return fs.readFileSync(architectureGuidePath(root), 'utf-8') } catch { return '' }
}

export function saveArchitectureGuide(text: string, root: string = getFsRoot()): string {
  fs.mkdirSync(path.join(root, 'ai-architecture'), { recursive: true })
  const clean = text.slice(0, 40_000)
  fs.writeFileSync(architectureGuidePath(root), clean, 'utf-8')
  return clean
}

/** One line for the agent brief (§4.4). */
export function architectureSummary(root: string = getFsRoot()): string {
  const decl = getArchitecture(root)
  if (!decl) return ''
  const bits = [
    decl.name ? `Architecture: ${decl.name}.` : 'Architecture declared.',
    decl.modules.length ? `Modules: ${decl.modules.map(m => m.name).join(', ')}.` : '',
    decl.rules.length ? `${decl.rules.length} checkable rule${decl.rules.length === 1 ? '' : 's'} — run architecture-check before finishing structural work.` : '',
    decl.provenance ? `From the ${decl.provenance} architecture plan pack.` : '',
  ].filter(Boolean)
  return bits.join(' ')
}

/* ── Checking (§4.4) ───────────────────────────────────────── */

export interface ArchRuleResult { id: string, say: string, verdict: 'pass' | 'fail' | 'couldnt-check', evidence: string }
export interface ArchitectureReport {
  designated: boolean
  rules: ArchRuleResult[]
  drift: { declaredNotFound: string[], foundNotDeclared: string[] }
  guidePresent: boolean
}

const SRC_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i

function moduleOf(file: string, decl: ArchitectureDeclaration): ArchModule | undefined {
  return decl.modules.find(m => file === m.path || file.startsWith(m.path.replace(/\/?$/, '/')))
}

function resolveImport(fromFile: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`]
  for (const c of candidates) if (files.has(c)) return c
  // Extension-swapped imports (./x.js for x.ts) are the house norm.
  const swapped = base.replace(/\.(js|jsx|mjs)$/, '.ts')
  if (files.has(swapped)) return swapped
  const swappedX = base.replace(/\.(js|jsx)$/, '.tsx')
  if (files.has(swappedX)) return swappedX
  return null
}

export function checkArchitecture(root: string = getFsRoot(), decl: ArchitectureDeclaration | null = getArchitecture(root)): ArchitectureReport {
  const guidePresent = getArchitectureGuide(root).trim().length > 0
  if (!decl) return { designated: false, rules: [], drift: { declaredNotFound: [], foundNotDeclared: [] }, guidePresent }

  const entries = listProjectFiles(root).map(e => e.path.replace(/^\//, ''))
  const fileSet = new Set(entries)
  const declaredNotFound = decl.modules.filter(m => !entries.some(f => f === m.path || f.startsWith(m.path.replace(/\/?$/, '/')))).map(m => m.name)
  const topDirs = new Set(entries.filter(f => f.includes('/')).map(f => f.split('/')[0]))
  const declaredDirs = new Set(decl.modules.map(m => m.path.split('/')[0]))
  const foundNotDeclared = [...topDirs].filter(d => !declaredDirs.has(d) && !d.startsWith('.') && d !== 'ai-architecture' && d !== 'ai-design' && d !== 'ai-features' && d !== 'ai-plans' && d !== 'node_modules')

  const results: ArchRuleResult[] = []
  for (const rule of decl.rules) {
    if (rule.kind === 'no-import') {
      const fromMod = decl.modules.find(m => m.name === rule.from)
      const toMod = decl.modules.find(m => m.name === rule.to)
      if (!fromMod || !toMod) {
        results.push({ id: rule.id, say: rule.say, verdict: 'couldnt-check', evidence: `Module ${!fromMod ? rule.from : rule.to} is not in the declaration.` })
        continue
      }
      const violations: string[] = []
      for (const file of entries) {
        if (!SRC_EXT.test(file) || moduleOf(file, decl)?.name !== fromMod.name) continue
        let text = ''
        try { text = fs.readFileSync(path.join(root, file), 'utf-8') } catch { continue }
        for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
          const target = resolveImport(file, m[1], fileSet)
          if (target && moduleOf(target, decl)?.name === toMod.name) violations.push(`${file} imports ${target}`)
        }
      }
      results.push({
        id: rule.id, say: rule.say,
        verdict: violations.length ? 'fail' : 'pass',
        evidence: violations.length ? violations.slice(0, 5).join('; ') : `No file under ${fromMod.path} imports ${toMod.name}.`,
      })
    } else {
      // naming
      if (!rule.pattern) {
        results.push({ id: rule.id, say: rule.say, verdict: 'couldnt-check', evidence: 'The rule names no pattern.' })
        continue
      }
      let re: RegExp
      try { re = new RegExp(rule.pattern) } catch {
        results.push({ id: rule.id, say: rule.say, verdict: 'couldnt-check', evidence: `The pattern ${rule.pattern} is not a regular expression.` })
        continue
      }
      const scope = rule.path ? entries.filter(f => f.startsWith(rule.path.replace(/\/?$/, '/'))) : entries
      const bad = scope.filter(f => SRC_EXT.test(f) && !re.test(path.posix.basename(f)))
      results.push({
        id: rule.id, say: rule.say,
        verdict: bad.length ? 'fail' : 'pass',
        evidence: bad.length ? `Not matching: ${bad.slice(0, 5).join(', ')}` : `Every source file in scope matches ${rule.pattern}.`,
      })
    }
  }
  return { designated: true, rules: results, drift: { declaredNotFound, foundNotDeclared }, guidePresent }
}
