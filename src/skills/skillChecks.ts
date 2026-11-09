/**
 * Recorded criteria runs — the durable verdict history.
 *
 * The per-turn chip and a tool result are ephemeral; this store
 * keeps the LAST run per skill (when, and every criterion's
 * verdict + evidence) in .ai-live/skill-checks.json beside the
 * other editor state, so the Skills panel can show "checked 10
 * minutes ago: 5 pass, 1 fail" without re-running anything.
 * Missing/corrupt file → no runs recorded, never an error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CriterionResult } from './criteria.js'

export interface SkillCheckRun {
  at: number
  results: CriterionResult[]
}

interface SkillChecksFile {
  version: 1
  runs: Record<string, SkillCheckRun>
}

export function skillChecksPath(): string {
  const fromEnv = process.env.AI_LIVE_SKILL_CHECKS_PATH
  if (fromEnv) return path.resolve(fromEnv)
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  return path.join(pkgRoot, '.ai-live', 'skill-checks.json')
}

export function loadSkillCheckRuns(file: string = skillChecksPath()): Record<string, SkillCheckRun> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<SkillChecksFile>
    if (!parsed || typeof parsed !== 'object' || !parsed.runs || typeof parsed.runs !== 'object') return {}
    return parsed.runs as Record<string, SkillCheckRun>
  } catch {
    return {}
  }
}

export function recordSkillCheckRun(skill: string, results: CriterionResult[], file: string = skillChecksPath()): SkillCheckRun {
  const runs = loadSkillCheckRuns(file)
  const run: SkillCheckRun = { at: Date.now(), results }
  runs[skill] = run
  const data: SkillChecksFile = { version: 1, runs }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
  return run
}

export function lastSkillCheckRun(skill: string, file: string = skillChecksPath()): SkillCheckRun | null {
  return loadSkillCheckRuns(file)[skill] ?? null
}
