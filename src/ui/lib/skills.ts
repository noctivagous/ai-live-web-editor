/**
 * Skills panel client (skills UI slice 1) — mirrors the server
 * state from GET /api/skills/state (src/skills/skillsApi.ts).
 * Read-only in this slice: toggles/editing arrive later.
 */

export interface SkillEntry {
  name: string
  description: string
  category: string
  triggers: string[]
  types: string[]
  dependsOn: string[]
  body: string
  bodyTokens: number
  overBodyBudget: boolean
  indexTokens: number
  files: string[]
  enabled: boolean
}

export interface SkillFieldsInput {
  name: string
  description: string
  category: string
  triggers: string[]
  types: string[]
  dependsOn: string[]
  body: string
}

export interface SkillsState {
  ok: true
  skills: SkillEntry[]
  indexTokens: number
  indexBudget: number
  injectionBudget: number
}

export async function fetchSkillsState(): Promise<SkillsState> {
  const r = await fetch('/api/skills/state')
  if (!r.ok) throw new Error(`skills state failed: ${r.status}`)
  return r.json() as Promise<SkillsState>
}

async function postSkills(path: string, payload: unknown): Promise<SkillsState> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json() as SkillsState & { error?: string }
  if (!r.ok || data.ok !== true) throw new Error(data.error || `request failed: ${r.status}`)
  return data
}

export function toggleSkill(name: string, enabled: boolean): Promise<SkillsState> {
  return postSkills('/api/skills/toggle', { name, enabled })
}

export function updateSkill(fields: SkillFieldsInput): Promise<SkillsState> {
  return postSkills('/api/skills/update', fields)
}

export function createSkill(fields: SkillFieldsInput): Promise<SkillsState> {
  return postSkills('/api/skills/create', fields)
}

/** "Fires when" for one skill, in plain words. */
export function firesWhen(skill: SkillEntry): string[] {
  const out: string[] = []
  if (skill.triggers.length) out.push(`your ask mentions ${skill.triggers.join(', ')}`)
  if (skill.dependsOn.length) out.push(`the project uses ${skill.dependsOn.join(', ')}`)
  if (skill.types.length) out.push(`the project type is ${skill.types.join(' or ')}`)
  if (!out.length) out.push('only when the agent asks for it by name (read-skill)')
  return out
}
