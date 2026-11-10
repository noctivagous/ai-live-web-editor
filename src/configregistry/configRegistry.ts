/**
 * The configuration registry (Facets design §7.2): one
 * recognizer per repo kind, mirroring the renderer/profile
 * registries. A recognizer reads file presence/contents and
 * contributes entries — the config file, the aspect it
 * controls, the profile/form that edits it (a configProfiles /
 * jsonProfiles id, the same forms the preview pane renders),
 * and a one-line summary. Recognizers are NOT exclusive: a
 * Vite app inside a monorepo with a Python tool fires three,
 * and the facet shows the mix grouped by recognizer.
 *
 * Server-side twin of the facet-facing half: the agent reads
 * the same inventory through config-inventory (§7.4).
 *
 * Secrets rule (§7.3): .env files appear as existence + variable
 * NAMES only. Values are never read into the inventory.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot, listProjectFiles } from '../launcher.js'

export interface ConfigEntry {
  file: string
  aspect: string
  profileId?: string
  summary: string
  /** .env entries: variable names only, never values (§7.3). */
  envKeys?: string[]
}
export interface RecognizerMatch {
  id: string
  label: string
  entries: ConfigEntry[]
  /** Aspects this kind usually has, for the missing report. */
  missingAspects: string[]
}
export interface ConfigInventory {
  derivedAt: number
  groups: RecognizerMatch[]
  unrecognised: string[]
  projectRecord?: { format?: string, deviceTargets?: string[], entry?: string, type?: string }
}

interface Ctx {
  files: string[]
  read: (rel: string) => string
  json: (rel: string) => Record<string, unknown> | null
  has: (re: RegExp) => boolean
  find: (re: RegExp) => string | undefined
}

function makeCtx(root: string): Ctx {
  const files = listProjectFiles(root).map(e => e.path.replace(/^\//, ''))
  const cache = new Map<string, string>()
  const read = (rel: string): string => {
    if (!cache.has(rel)) {
      try { cache.set(rel, fs.readFileSync(path.join(root, rel), 'utf-8')) } catch { cache.set(rel, '') }
    }
    return cache.get(rel)!
  }
  return {
    files,
    read,
    json: (rel) => {
      try {
        const p = JSON.parse(read(rel)) as unknown
        return p && typeof p === 'object' ? p as Record<string, unknown> : null
      } catch { return null }
    },
    has: (re) => files.some(f => re.test(f)),
    find: (re) => files.find(f => re.test(f)),
  }
}

function envEntry(ctx: Ctx, file: string): ConfigEntry {
  const keys = ctx.read(file).split('\n')
    .map(l => /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l.trim())?.[1])
    .filter((k): k is string => Boolean(k))
  return {
    file, aspect: 'Environment variables', profileId: 'env-generic',
    summary: `${keys.length} variable${keys.length === 1 ? '' : 's'} — names only here; values stay in the file`,
    envKeys: keys,
  }
}

function commonEntries(ctx: Ctx): { entries: ConfigEntry[], missing: string[] } {
  const entries: ConfigEntry[] = []
  const missing: string[] = []
  for (const f of ctx.files.filter(f => /(^|\/)\.env[^/]*$/.test(f) && !f.includes('node_modules'))) {
    entries.push(envEntry(ctx, f))
  }
  const ci = ctx.files.filter(f => f.startsWith('.github/workflows/') && /\.ya?ml$/.test(f))
  for (const f of ci) entries.push({ file: f, aspect: 'CI workflow', profileId: 'github-workflow', summary: 'A GitHub Actions workflow' })
  if (!ci.length) missing.push('CI config (no .github/workflows file)')
  const lint = ctx.find(/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[^/]+|\.prettierrc[^/]*|prettier\.config\.[^/]+|biome\.json)$/)
  if (lint) entries.push({ file: lint, aspect: 'Lint & format', summary: 'Lint and formatting rules' })
  else missing.push('Lint/format config')
  const vscode = ctx.find(/(^|\/)\.vscode\/settings\.json$/)
  if (vscode) entries.push({ file: vscode, aspect: 'Editor settings', profileId: 'generic', summary: 'VS Code workspace settings' })
  return { entries, missing }
}

export interface ConfigRecognizer {
  id: string
  label: string
  detect: (ctx: Ctx) => ConfigEntry[] | null
  usualAspects?: string[]
}

export const CONFIG_RECOGNIZERS: ConfigRecognizer[] = [
  {
    id: 'vite-web-app', label: 'Vite web app',
    detect(ctx) {
      const pkg = ctx.json('package.json')
      const deps = { ...(pkg?.dependencies as object ?? {}), ...(pkg?.devDependencies as object ?? {}) }
      const viteConfig = ctx.find(/(^|\/)vite\.config\.[^/]+$/)
      if (!viteConfig && !('vite' in deps)) return null
      const entries: ConfigEntry[] = []
      if (viteConfig) entries.push({ file: viteConfig, aspect: 'Build & dev server', summary: 'Vite configuration — edited as code' })
      if (pkg) entries.push({ file: 'package.json', aspect: 'Package & scripts', profileId: 'package', summary: 'Scripts, engines, and package fields' })
      for (const f of ctx.files.filter(f => /(^|\/)tsconfig[^/]*\.json$/.test(f))) {
        entries.push({ file: f, aspect: 'TypeScript', profileId: 'tsconfig', summary: 'TypeScript compiler configuration' })
      }
      const tailwind = ctx.find(/(^|\/)tailwind\.config\.[^/]+$/)
      if (tailwind) entries.push({ file: tailwind, aspect: 'Tailwind', summary: 'Tailwind configuration — edited as code' })
      return entries
    },
  },
  {
    id: 'plain-html', label: 'Plain HTML site',
    detect(ctx) {
      if (ctx.has(/(^|\/)package\.json$/)) return null
      const html = ctx.files.filter(f => /\.html?$/i.test(f))
      if (!html.length) return null
      return html.slice(0, 12).map(f => ({ file: f, aspect: 'Page', summary: 'A page of the site — its markup is its configuration' }))
    },
  },
  {
    id: 'node-tool', label: 'Node tool / library',
    detect(ctx) {
      const pkg = ctx.json('package.json')
      if (!pkg) return null
      const deps = { ...(pkg?.dependencies as object ?? {}), ...(pkg?.devDependencies as object ?? {}) }
      const isApp = 'vite' in deps || 'react' in deps || 'vue' in deps || 'next' in deps
      const isTool = typeof pkg.bin !== 'undefined' || typeof pkg.main === 'string' || typeof pkg.exports !== 'undefined'
      if (isApp || !isTool) return null
      const entries: ConfigEntry[] = [
        { file: 'package.json', aspect: 'Package & scripts', profileId: 'package', summary: 'Entry points, bin, scripts, and engines' },
      ]
      for (const f of ctx.files.filter(f => /(^|\/)tsconfig[^/]*\.json$/.test(f))) {
        entries.push({ file: f, aspect: 'TypeScript', profileId: 'tsconfig', summary: 'TypeScript compiler configuration' })
      }
      return entries
    },
  },
  {
    id: 'monorepo', label: 'Monorepo / workspaces',
    detect(ctx) {
      const pkg = ctx.json('package.json')
      const workspaceFile = ctx.find(/(^|\/)pnpm-workspace\.yaml$/)
      const subManifests = ctx.files.filter(f => f !== 'package.json' && /(^|\/)package\.json$/.test(f) && !f.includes('node_modules'))
      const declared = Array.isArray(pkg?.workspaces) || (pkg?.workspaces as Record<string, unknown>)?.packages !== undefined
      if (!declared && !workspaceFile && subManifests.length < 2) return null
      const entries: ConfigEntry[] = []
      if (workspaceFile) entries.push({ file: workspaceFile, aspect: 'Workspace', profileId: 'yaml-generic', summary: 'pnpm workspace packages' })
      if (pkg) entries.push({ file: 'package.json', aspect: 'Workspace root', profileId: 'package', summary: 'The workspace root manifest' })
      for (const f of subManifests.slice(0, 20)) {
        entries.push({ file: f, aspect: 'Workspace package', profileId: 'package', summary: 'A package in the workspace' })
      }
      return entries
    },
  },
]

const CONFIGISH = /(^|\/)(\.env[^/]*|[^/]*\.config\.[^/]+|tsconfig[^/]*\.json|package\.json|project\.ai\.json|\.eslintrc[^/]*|\.prettierrc[^/]*|biome\.json|docker-compose\.ya?ml|compose\.ya?ml|\.babelrc|babel\.config\.[^/]+|\.editorconfig|\.gitignore|\.npmrc|pnpm-workspace\.yaml)$/

export function deriveConfigInventory(root: string = getFsRoot()): ConfigInventory {
  const ctx = makeCtx(root)
  const groups: RecognizerMatch[] = []
  const claimed = new Set<string>()
  const common = commonEntries(ctx)
  for (const rec of CONFIG_RECOGNIZERS) {
    const entries = rec.detect(ctx)
    if (!entries) continue
    for (const e of entries) claimed.add(e.file)
    groups.push({ id: rec.id, label: rec.label, entries, missingAspects: [] })
  }
  for (const e of common.entries) claimed.add(e.file)
  if (common.entries.length) {
    groups.push({ id: 'project-setup', label: 'Project setup', entries: common.entries, missingAspects: common.missing })
  } else if (groups.length) {
    groups[0].missingAspects = common.missing
  }

  let projectRecord: ConfigInventory['projectRecord']
  const ai = ctx.json('project.ai.json')
  if (ai) {
    claimed.add('project.ai.json')
    projectRecord = {
      ...(typeof ai.format === 'string' ? { format: ai.format } : {}),
      ...(Array.isArray(ai.deviceTargets) ? { deviceTargets: ai.deviceTargets.filter((t): t is string => typeof t === 'string') } : {}),
      ...(typeof ai.entry === 'string' ? { entry: ai.entry } : {}),
      ...(typeof ai.type === 'string' ? { type: ai.type } : {}),
    }
    groups.push({
      id: 'ale-project', label: 'ALE project record',
      entries: [{ file: 'project.ai.json', aspect: 'Project record', profileId: 'ai-project', summary: 'Format, device targets, start page, and project type — the rows that moved here from Architecture' }],
      missingAspects: [],
    })
  }

  const unrecognised = ctx.files
    .filter(f => CONFIGISH.test(f) && !claimed.has(f) && !f.includes('node_modules'))
    .slice(0, 30)

  return { derivedAt: Date.now(), groups, unrecognised, ...(projectRecord ? { projectRecord } : {}) }
}

/* ── config-get / config-set (§7.4) ────────────────────────── */

/** Replace one top-level value in a JSON file by offset: only
 * the value's bytes change (the profiles' rule). */
export function setJsonTopLevel(text: string, key: string, value: unknown): string | null {
  const open = text.indexOf('{')
  if (open < 0) return null
  let depth = 0
  let i = open
  let inStr = false
  let esc = false
  let keyStart = -1
  // Find `"key"` at depth 1, then its value span.
  for (; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      if (depth === 1 && keyStart < 0) {
        const end = text.indexOf('"', i + 1)
        if (end > i && text.slice(i + 1, end) === key) {
          keyStart = i
          // skip to colon
          let j = end + 1
          while (j < text.length && /\s/.test(text[j])) j++
          if (text[j] !== ':') return null
          j++
          while (j < text.length && /\s/.test(text[j])) j++
          // value span: string / object / array / literal
          const start = j
          let d = 0
          let s2 = false
          let e2 = false
          for (; j < text.length; j++) {
            const ch = text[j]
            if (s2) { if (e2) e2 = false; else if (ch === '\\') e2 = true; else if (ch === '"') s2 = false; continue }
            if (ch === '"') s2 = true
            else if (ch === '{' || ch === '[') d++
            else if (ch === '}' || ch === ']') { if (d === 0) break; d--; if (d === 0) { j++; break } }
            else if (ch === ',' && d === 0) break
          }
          // Whitespace after a literal value is layout, not value.
          while (j > start && /\s/.test(text[j - 1]) && !s2) j--
          return text.slice(0, start) + JSON.stringify(value) + text.slice(j)
        }
      }
      continue
    }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth--
  }
  return null
}

export function configGet(root: string, file: string, key?: string): { ok: true, value: unknown } | { ok: false, error: string } {
  if (/(^|\/)\.env/.test(file)) return { ok: false, error: 'Environment values are never shown here — open the file itself to see or change a value (§7.3).' }
  let text: string
  try { text = fs.readFileSync(path.join(root, file), 'utf-8') } catch { return { ok: false, error: `${file} could not be read.` } }
  if (!file.endsWith('.json')) return { ok: false, error: `${file} is not a JSON config — read and edit it as text or code.` }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, error: `${file} is not valid JSON.` } }
  if (!key) return { ok: true, value: parsed }
  const value = (parsed as Record<string, unknown>)?.[key]
  return { ok: true, value: value ?? null }
}

export function configSet(root: string, file: string, key: string, value: unknown): { ok: true } | { ok: false, error: string } {
  if (/(^|\/)\.env/.test(file)) return { ok: false, error: 'Environment values are changed in the file itself, not through the facet (§7.3).' }
  if (!file.endsWith('.json')) return { ok: false, error: `${file} is not a JSON config — edit it as text or code.` }
  const filePath = path.join(root, file)
  let text: string
  try { text = fs.readFileSync(filePath, 'utf-8') } catch { return { ok: false, error: `${file} could not be read.` } }
  const next = setJsonTopLevel(text, key, value)
  if (next === null) return { ok: false, error: `Key "${key}" was not found at the top level of ${file} — adding new keys goes through the file's form.` }
  try { JSON.parse(next) } catch { return { ok: false, error: 'That change would not leave valid JSON, so nothing was written.' } }
  fs.writeFileSync(filePath, next, 'utf-8')
  return { ok: true }
}

/** One line for the agent brief (§7.4). */
export function configSummary(root: string = getFsRoot()): string {
  try {
    const inv = deriveConfigInventory(root)
    if (!inv.groups.length) return ''
    return `Configuration: ${inv.groups.map(g => g.label).join(' + ')}. ${inv.groups.reduce((n, g) => n + g.entries.length, 0)} config files recognised${inv.unrecognised.length ? `, ${inv.unrecognised.length} unrecognised` : ''}.`
  } catch { return '' }
}
