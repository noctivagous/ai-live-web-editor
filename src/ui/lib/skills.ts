/**
 * Skills panel client (skills UI slice 1) — mirrors the server
 * state from GET /api/skills/state (src/skills/skillsApi.ts).
 * Read-only in this slice: toggles/editing arrive later.
 */

export interface SkillCriterion {
  id: string
  say: string
  check: 'layout' | 'console' | 'project-check' | 'file' | 'heuristic'
  expect?: string
  axis?: 'x' | 'y'
  px?: number
  at?: string[]
  orientation?: 'portrait' | 'landscape' | 'both'
  path?: string
  text?: string
  measure?: string
  pass?: string
}

export interface CriterionResult {
  id: string
  say: string
  check: string
  verdict: 'pass' | 'fail' | 'couldnt-check'
  evidence: string
  score?: number
  details?: string[]
}

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
  criteria: SkillCriterion[]
  criteriaError?: string
  lastRun: { at: number, results: CriterionResult[] } | null
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

export function runSkillChecks(name: string): Promise<SkillsState> {
  return postSkills('/api/skills/check', { name })
}

/** What a criterion actually inspects, in plain words. */
export function criterionHow(c: SkillCriterion): string {
  const scope = [
    c.at?.length ? `at ${c.at.join(', ')}` : 'at every device target',
    c.orientation && c.orientation !== 'both' ? `${c.orientation} only` : 'both orientations',
  ]
  switch (c.check) {
    case 'layout':
      if (c.expect === 'min-touch-target') return `Layout · interactive elements at least ${c.px ?? 44}px, ${scope[0]}, ${scope[1]}`
      return `Layout · ${c.expect?.replace('no-', 'no ')}${c.axis ? ` (${c.axis} axis)` : ''}, ${scope[0]}, ${scope[1]}`
    case 'console': return 'Console · no errors while the page runs'
    case 'project-check': return "Project · the project's own build check passes"
    case 'file': return `File · ${c.path} ${c.expect === 'exists' ? 'exists' : `${c.expect === 'contains' ? 'contains' : 'does not contain'} "${(c.text ?? '').slice(0, 40)}"`}`
    case 'heuristic': return `Feel, measured · ${c.measure} scores ${c.pass}, ${scope[0]}, ${scope[1]}`
  }
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
