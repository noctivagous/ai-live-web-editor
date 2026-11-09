/**
 * Skills settings — the editor-global on/off state behind the
 * Skills panel (skills UI slice 2). Persisted as JSON at
 * .ai-live/skills.json next to the other editor state;
 * AI_LIVE_SKILLS_PATH overrides the path (tests, drives).
 *
 * Only the DISABLED names are stored: every skill is on unless
 * the user turned it off, so a newly added skill starts on and a
 * removed skill leaves no residue that matters. A missing or
 * corrupt file means "all on" — settings never hide a skill by
 * accident.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SkillSettings {
  version: 1
  disabled: string[]
}

export function skillSettingsPath(): string {
  if (process.env.AI_LIVE_SKILLS_PATH) return process.env.AI_LIVE_SKILLS_PATH
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  return path.join(root, '.ai-live', 'skills.json')
}

export function emptySkillSettings(): SkillSettings {
  return { version: 1, disabled: [] }
}

export function loadSkillSettings(file: string = skillSettingsPath()): SkillSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<SkillSettings>
    const disabled = Array.isArray(raw.disabled)
      ? [...new Set(raw.disabled.filter((d): d is string => typeof d === 'string'))]
      : []
    return { version: 1, disabled }
  } catch {
    return emptySkillSettings()
  }
}

export function saveSkillSettings(settings: SkillSettings, file: string = skillSettingsPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, file)
}

/** The disabled-name set the engine filters by. */
export function disabledSkillNames(file: string = skillSettingsPath()): Set<string> {
  return new Set(loadSkillSettings(file).disabled)
}

export function setSkillEnabled(name: string, enabled: boolean, file: string = skillSettingsPath()): SkillSettings {
  const settings = loadSkillSettings(file)
  const disabled = new Set(settings.disabled)
  if (enabled) disabled.delete(name)
  else disabled.add(name)
  const next: SkillSettings = { version: 1, disabled: [...disabled].sort() }
  saveSkillSettings(next, file)
  return next
}
