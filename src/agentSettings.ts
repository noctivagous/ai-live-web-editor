/**
 * Launcher-global agent behavior settings (Settings → Agent & Chat):
 * the switches for machinery that used to be fixed constants —
 * context trimming (§2) and codebase-map injection (§1). Persisted
 * as JSON next to .env (beside providers.json), read through a
 * cache so hot paths (the trim processor, the chat stream) consult
 * the current value synchronously on every call.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getEnvPath } from './env.js'

export type MapInjectionMode = 'auto' | 'always' | 'off'

export interface AgentSettings {
  /** The workflow a fresh launcher session starts chats in. The
   * live workflow is a launcher-side session (both chat surfaces
   * converge on it), so the default lives here, not on the device. */
  defaultWorkflow: 'files' | 'sketch'
  /** §2 in-turn trimming of older tool results. */
  contextTrim: boolean
  /** §1 Rung 2 map injection: auto = only at/above the file-count
   * threshold, always = every Files turn, off = never. */
  mapInjection: MapInjectionMode
}

export const AGENT_SETTINGS_DEFAULTS: AgentSettings = {
  defaultWorkflow: 'files',
  contextTrim: true,
  mapInjection: 'auto',
}

let settingsPath = path.join(path.dirname(getEnvPath()), 'agent-settings.json')
let cache: AgentSettings | null = null

export function getAgentSettingsPath(): string { return settingsPath }

/** Test hook, mirroring env.ts's setEnvPath: point at a temp file. */
export function setAgentSettingsPath(file: string): void {
  settingsPath = path.resolve(file)
  cache = null
}

export function sanitizeAgentSettings(value: unknown): AgentSettings {
  const v = (value && typeof value === 'object') ? value as Record<string, unknown> : {}
  return {
    defaultWorkflow: v.defaultWorkflow === 'sketch' ? 'sketch' : 'files',
    contextTrim: v.contextTrim !== false,
    mapInjection: v.mapInjection === 'always' || v.mapInjection === 'off' ? v.mapInjection : 'auto',
  }
}

export function loadAgentSettings(): AgentSettings {
  if (cache) return cache
  let parsed: unknown = null
  try { parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch { /* absent or unreadable → defaults */ }
  cache = sanitizeAgentSettings(parsed)
  return cache
}

/** The settings in force right now (loads on first use). */
export function currentAgentSettings(): AgentSettings {
  return loadAgentSettings()
}

export function saveAgentSettings(patch: Partial<AgentSettings>): AgentSettings {
  const next = sanitizeAgentSettings({ ...loadAgentSettings(), ...patch })
  cache = next
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch { /* persistence is best-effort; the in-memory value still applies */ }
  return next
}
