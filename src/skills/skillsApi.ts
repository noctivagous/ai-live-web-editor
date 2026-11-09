/**
 * Skills API — the surface behind the Skills panel.
 *
 * GET /api/skills/state returns everything the panel renders: the
 * skills with their categories, trigger rules, body costs, bundled
 * files and on/off state, plus the budget numbers — the resident
 * index cost (ENABLED skills only: what every turn actually pays)
 * and the per-turn body-injection cap.
 *
 * Slice 2 mutations, each returning the fresh state:
 * - POST /api/skills/toggle { name, enabled } — off removes the
 *   skill from the index, matching and read-skill entirely.
 * - POST /api/skills/update { name, description, category,
 *   triggers, types, dependsOn, body } — rewrites the skill's
 *   SKILL.md in the canonical field order.
 * - POST /api/skills/create { name, … } — a new skill folder;
 *   the name must satisfy the spec's rules and not already exist.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import {
  loadSkills, resetSkillsCache, skillIndexTokens, SKILL_INDEX_TOKEN_BUDGET,
  SKILL_INJECTION_TOKEN_BUDGET, SKILLS_DIR, type Skill,
} from './skills.js'
import { disabledSkillNames, setSkillEnabled } from './skillSettings.js'

export interface SkillStateEntry {
  name: string
  description: string
  category: string
  triggers: string[]
  types: string[]
  dependsOn: string[]
  body: string
  bodyTokens: number
  overBodyBudget: boolean
  /** Tokens this skill's one index line costs on every turn. */
  indexTokens: number
  /** Bundled files beside SKILL.md (scripts/, references/, assets/…). */
  files: string[]
  /** Off = out of the index, matching and read-skill entirely. */
  enabled: boolean
}

/** Files bundled with a skill, as relative paths, SKILL.md excluded. */
function bundledFiles(skill: Skill): string[] {
  const root = path.join(SKILLS_DIR, skill.name)
  const out: string[] = []
  const walk = (dir: string, prefix: string, depth: number) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (prefix === '' && e.name === 'SKILL.md') continue
      if (e.isDirectory() && depth < 1) walk(path.join(dir, e.name), `${prefix}${e.name}/`, depth + 1)
      else if (e.isFile()) out.push(`${prefix}${e.name}`)
    }
  }
  walk(root, '', 0)
  return out.sort()
}

export function skillsState(skills: Skill[] = loadSkills()) {
  const disabled = disabledSkillNames()
  const entries: SkillStateEntry[] = skills.map(s => ({
    name: s.name,
    description: s.description,
    category: s.category,
    triggers: s.triggers,
    types: s.types,
    dependsOn: s.dependsOn,
    body: s.body,
    bodyTokens: s.bodyTokens,
    overBodyBudget: s.overBudget,
    indexTokens: skillIndexTokens(s),
    files: bundledFiles(s),
    enabled: !disabled.has(s.name),
  }))
  return {
    ok: true as const,
    skills: entries,
    // What every request actually pays: enabled skills' lines only.
    indexTokens: entries.reduce((n, e) => n + (e.enabled ? e.indexTokens : 0), 0),
    indexBudget: SKILL_INDEX_TOKEN_BUDGET,
    injectionBudget: SKILL_INJECTION_TOKEN_BUDGET,
  }
}

export interface SkillFields {
  name: string
  description: string
  category: string
  triggers: string[]
  types: string[]
  dependsOn: string[]
  body: string
}

/** The spec's name rules: 1–64 chars, lowercase letters, numbers
 *  and hyphens; no leading, trailing or consecutive hyphens. */
export function validateSkillName(name: string): string | null {
  if (!name || name.length > 64) return 'Name must be 1–64 characters.'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return 'Use lowercase letters, numbers and single hyphens — no leading or trailing hyphen.'
  return null
}

/** The canonical SKILL.md text for a field set (the same shape the
 *  shipped files use; the loader parses it back field-for-field). */
export function serializeSkillFile(f: SkillFields): string {
  const lines = ['---', `name: ${f.name}`, `description: ${f.description}`]
  if (f.category && f.category !== 'General') lines.push(`category: ${f.category}`)
  if (f.triggers.length) lines.push(`triggers: ${f.triggers.join(', ')}`)
  if (f.types.length) lines.push(`types: ${f.types.join(', ')}`)
  if (f.dependsOn.length) lines.push(`dependsOn: ${f.dependsOn.join(', ')}`)
  lines.push('---', '', f.body.trim(), '')
  return lines.join('\n')
}

function coerceList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

function readFields(body: Record<string, unknown>, name: string): SkillFields | { error: string } {
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return { error: 'A description is required — it is the line the agent scans to decide.' }
  if (description.length > 1024) return { error: 'Description is over the 1,024-character limit.' }
  if (/[\r\n]/.test(description)) return { error: 'Description must be one line.' }
  return {
    name,
    description,
    category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'General',
    triggers: coerceList(body.triggers),
    types: coerceList(body.types),
    dependsOn: coerceList(body.dependsOn),
    body: typeof body.body === 'string' ? body.body : '',
  }
}

function writeSkillFile(fields: SkillFields): void {
  const dir = path.join(SKILLS_DIR, fields.name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), serializeSkillFile(fields), 'utf-8')
  resetSkillsCache()
}

export function mountSkillsApi(app: Express) {
  app.get('/api/skills/state', (_req, res) => {
    res.json(skillsState())
  })

  app.post('/api/skills/toggle', (req, res) => {
    const { name, enabled } = (req.body ?? {}) as { name?: unknown, enabled?: unknown }
    if (typeof name !== 'string' || !loadSkills().some(s => s.name === name)) {
      return res.status(404).json({ ok: false, error: `No skill named ${String(name)}` })
    }
    setSkillEnabled(name, enabled !== false)
    res.json(skillsState())
  })

  app.post('/api/skills/update', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name : ''
    if (!loadSkills().some(s => s.name === name)) {
      return res.status(404).json({ ok: false, error: `No skill named ${name}` })
    }
    const fields = readFields(body, name)
    if ('error' in fields) return res.status(400).json({ ok: false, error: fields.error })
    writeSkillFile(fields)
    res.json(skillsState())
  })

  app.post('/api/skills/create', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const nameError = validateSkillName(name)
    if (nameError) return res.status(400).json({ ok: false, error: nameError })
    if (loadSkills().some(s => s.name === name) || fs.existsSync(path.join(SKILLS_DIR, name))) {
      return res.status(400).json({ ok: false, error: `A skill named ${name} already exists.` })
    }
    const fields = readFields(body, name)
    if ('error' in fields) return res.status(400).json({ ok: false, error: fields.error })
    writeSkillFile(fields)
    res.json(skillsState())
  })
}
