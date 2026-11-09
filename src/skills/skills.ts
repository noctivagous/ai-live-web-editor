/**
 * Skills / knowledge packs (phase-11-05 §2, phase-11-06 §H,
 * TASKS-token-efficiency §4): progressive disclosure for guidance.
 *
 * A skill is a folder `skills/<name>/SKILL.md`: YAML-ish
 * frontmatter (name, description, triggers, types, dependsOn) plus
 * a concise body (<5k tokens) that cites catalog/template names,
 * never file bodies. The format contract lives in skills/README.md.
 *
 * Disclosure tiers, cheapest first:
 * 1. Metadata (~100 tokens per skill) is always visible — the
 *    agent instructions carry the index.
 * 2. A body loads only when the task triggers it: an explicit
 *    keyword trigger in the user's ask, evidence in the project
 *    (package.json actually depends on the pack's library), or the
 *    project type. A plain copy fix matches nothing and pays
 *    nothing.
 * 3. The agent can also pull a body mid-turn with the read-skill
 *    tool when it recognises the need itself.
 *
 * Matched bodies are injected into the turn preamble under a
 * combined budget so several packs cannot stack unboundedly.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFsRoot } from '../launcher.js'
import { readProjectConfig } from '../projectConfig.js'
import { disabledSkillNames } from './skillSettings.js'

export const SKILL_BODY_TOKEN_BUDGET = 5000
export const SKILL_INJECTION_TOKEN_BUDGET = 5000
/**
 * Soft budget for the resident index (tier 1): the token cost the
 * Skills panel warns past. Nothing is ever dropped at this line —
 * the panel shows the overage and lets the user decide (skills UI
 * slice 1). Enforcement through per-skill toggles is a later slice.
 */
export const SKILL_INDEX_TOKEN_BUDGET = 1200

export const SKILLS_DIR = process.env.AI_LIVE_SKILLS_DIR
  ? path.resolve(process.env.AI_LIVE_SKILLS_DIR)
  : path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'skills',
  )

export interface SkillMeta {
  name: string
  description: string
  /** Display grouping in the Skills panel (an ALE field, not part
   *  of the agentskills.io spec's six). Defaults to 'General'. */
  category: string
  /** Phrases/words in the user's ask that trigger this skill. */
  triggers: string[]
  /** Project types (project.ai.json) this skill applies to. */
  types: string[]
  /** Package names: the skill triggers when the project depends on one. */
  dependsOn: string[]
}

export interface Skill extends SkillMeta {
  body: string
  bodyTokens: number
  overBudget: boolean
  dir: string
}

/** chars/4 estimate, the same yardstick the map and trimmer use. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return []
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '')
  return inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

/**
 * Parse one SKILL.md. Returns null when the frontmatter is missing
 * or incomplete — a skill without metadata cannot be indexed, so
 * it does not exist as far as the loader is concerned.
 */
export function parseSkillFile(text: string, dir: string): Skill | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  const fields = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (kv) fields.set(kv[1], kv[2].trim())
  }
  const name = fields.get('name')?.replace(/^['"]|['"]$/g, '')
  const description = fields.get('description')?.replace(/^['"]|['"]$/g, '')
  if (!name || !description) return null
  const body = match[2].trim()
  const bodyTokens = estimateTokens(body)
  return {
    name,
    description,
    category: fields.get('category')?.replace(/^['"]|['"]$/g, '').trim() || 'General',
    triggers: parseList(fields.get('triggers')),
    types: parseList(fields.get('types')),
    dependsOn: parseList(fields.get('dependsOn')),
    body,
    bodyTokens,
    overBudget: bodyTokens > SKILL_BODY_TOKEN_BUDGET,
    dir,
  }
}

let cached: Skill[] | null = null

/** Load every skills/<name>/SKILL.md under the skills root, sorted by name. */
export function loadSkills(dir: string = SKILLS_DIR): Skill[] {
  if (cached && dir === SKILLS_DIR) return cached
  const skills: Skill[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = path.join(dir, entry.name, 'SKILL.md')
      try {
        const parsed = parseSkillFile(fs.readFileSync(file, 'utf-8'), entry.name)
        if (parsed) skills.push(parsed)
      } catch { /* missing SKILL.md: not a skill folder */ }
    }
  } catch { /* no skills root: no skills */ }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  if (dir === SKILLS_DIR) cached = skills
  return skills
}

/** Test hook: forget the cached skills. */
export function resetSkillsCache(): void {
  cached = null
}

/**
 * The skills the agent actually carries: everything loadSkills
 * found, minus the ones the user turned off in the Skills panel
 * (slice 2). Off means entirely out — no index line, no trigger
 * matching, no read-skill. The panel itself lists ALL skills,
 * using loadSkills, so an off skill stays visible and fixable.
 */
export function activeSkills(): Skill[] {
  const disabled = disabledSkillNames()
  if (!disabled.size) return loadSkills()
  return loadSkills().filter(s => !disabled.has(s.name))
}

export function getSkill(name: string, skills: Skill[] = loadSkills()): Skill | undefined {
  return skills.find(s => s.name === name)
}

/**
 * Tier 1: the always-visible index for the agent instructions.
 * Each skill costs one line (~100 tokens): name, one-line
 * description, and how its body is reached.
 */
/** One skill's index line — the exact text that rides every turn. */
export function skillIndexLine(s: Skill): string {
  const desc = s.description.length > 220 ? s.description.slice(0, 219).trimEnd() + '…' : s.description
  const via: string[] = []
  if (s.triggers.length) via.push(`ask mentions ${s.triggers.slice(0, 4).join('/')}`)
  if (s.dependsOn.length) via.push(`project depends on ${s.dependsOn.join('/')}`)
  if (s.types.length) via.push(`project type ${s.types.join('/')}`)
  return `- ${s.name}: ${desc}${via.length ? ` (loads when: ${via.join('; ')})` : ''}`
}

/** What one skill's index line costs on every turn, in tokens. */
export function skillIndexTokens(s: Skill): number {
  return estimateTokens(skillIndexLine(s))
}

export function skillIndexText(skills: Skill[] = activeSkills()): string {
  if (!skills.length) return ''
  const lines = skills.map(skillIndexLine)
  return `\n\nSkills (progressive disclosure — these one-liners are always visible; a skill's body loads only when the task triggers it, or when you call read-skill with its name; never guess a body you have not loaded):\n${lines.join('\n')}`
}

export interface SkillMatch {
  skill: Skill
  via: 'trigger' | 'dependency' | 'type'
  score: number
}

function triggerHit(trigger: string, text: string): boolean {
  const t = trigger.toLowerCase()
  if (t.includes(' ') || t.includes('-')) return text.includes(t) || text.includes(t.replace(/-/g, ' '))
  return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text)
}

/**
 * Deterministic trigger matching — knowledge follows evidence, not
 * guesses (phase-11-06 §H). Explicit ask triggers outrank project
 * evidence, which outranks the project type.
 */
export function matchSkills(
  input: { text?: string, projectType?: string, deps?: string[] },
  skills: Skill[] = loadSkills(),
): SkillMatch[] {
  const text = (input.text || '').toLowerCase()
  const deps = new Set((input.deps || []).map(d => d.toLowerCase()))
  const matches: SkillMatch[] = []
  for (const skill of skills) {
    if (text && skill.triggers.some(t => triggerHit(t, text))) {
      matches.push({ skill, via: 'trigger', score: 3 })
    } else if (skill.dependsOn.some(d => deps.has(d.toLowerCase()))) {
      matches.push({ skill, via: 'dependency', score: 2 })
    } else if (input.projectType && skill.types.includes(input.projectType)) {
      matches.push({ skill, via: 'type', score: 1 })
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
}

/** Dependency names from the project's package.json (evidence for pack triggers). */
export function projectDependencies(root: string = getFsRoot()): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>, devDependencies?: Record<string, string>
    }
    return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]
  } catch {
    return []
  }
}

/**
 * Tier 2: the turn preamble injection. Matched bodies, headed with
 * why they loaded, under one combined token budget — whole bodies
 * only, in match order; anything past the budget stays metadata.
 * Returns null when nothing triggers (a plain copy fix pays 0).
 */
export interface SkillInjectionDetail {
  text: string | null
  /** The skills whose bodies actually joined (budget-skips excluded). */
  included: { name: string, via: SkillMatch['via'] }[]
}

/** skillInjectionText plus the record of what was included — the
 *  turn path reports `included` to the chat UI (the Skills-used
 *  chip), so what the agent carried is never invisible. */
export function skillInjectionDetail(
  input: { text?: string, projectType?: string, deps?: string[] },
  skills: Skill[] = activeSkills(),
  budgetTokens: number = SKILL_INJECTION_TOKEN_BUDGET,
): SkillInjectionDetail {
  const matches = matchSkills(input, skills)
  if (!matches.length) return { text: null, included: [] }
  const parts: string[] = []
  const included: SkillInjectionDetail['included'] = []
  let used = 0
  for (const m of matches) {
    if (used + m.skill.bodyTokens > budgetTokens) continue
    used += m.skill.bodyTokens
    included.push({ name: m.skill.name, via: m.via })
    parts.push(`Skill loaded: ${m.skill.name} (via ${m.via}). Follow it for this task.\n\n${m.skill.body}`)
  }
  return { text: parts.length ? parts.join('\n\n---\n\n') : null, included }
}

export function skillInjectionText(
  input: { text?: string, projectType?: string, deps?: string[] },
  skills: Skill[] = activeSkills(),
  budgetTokens: number = SKILL_INJECTION_TOKEN_BUDGET,
): string | null {
  return skillInjectionDetail(input, skills, budgetTokens).text
}

/** Resolve everything a turn needs from the live project and build its injection. */
export function skillInjectionForTurn(userText: string, root: string = getFsRoot()): string | null {
  return skillInjectionDetailForTurn(userText, root).text
}

/** skillInjectionForTurn with the included-skills record. */
export function skillInjectionDetailForTurn(userText: string, root: string = getFsRoot()): SkillInjectionDetail {
  let projectType: string | undefined
  try { projectType = readProjectConfig(root).type || undefined } catch { /* undesignated */ }
  return skillInjectionDetail({ text: userText, projectType, deps: projectDependencies(root) })
}
