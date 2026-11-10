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

/** Which chat engine serves /api/chat/stream turns: the in-house
 * Mastra agent, or the OpenCode sidecar (opencode/ supervisor +
 * translator). Read at turn start; switching takes effect on the
 * next turn, never mid-stream. */
export type ChatEngine = 'mastra' | 'opencode'

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
  /** Chat engine for streamed turns (OpenCode re-platform slice 1).
   * Slice 10 flipped the default: unset/fresh state resolves to
   * 'opencode'; an explicitly saved 'mastra' keeps resolving to
   * mastra — the legacy engine stays reachable behind this setting. */
  chatEngine: ChatEngine
  /** Check the page console around every chat turn (turn-start
   * capture + post-turn findings/footer detail, both engines). Off =
   * no capture, no read, no console detail, no console follow-ups;
   * layout verification is unaffected. The agent's manual get-console
   * tool stays available either way. Slice 6: honored on the
   * OpenCode path exactly as on the Mastra path. */
  consoleCheck: boolean
  /** ALE fs tools as OpenCode overrides (re-platform slice 5): when
   * on, the supervisor spawns the sidecar with ALE_OPENCODE_FS_TOOLS=1
   * and the plugin registers ALE's fs tool set (str-replace & co)
   * alongside OpenCode's natives. Default OFF — by default OpenCode
   * performs as itself, with its own native fs tools only. The
   * Settings door is the Advanced subsection of Agent & Chat
   * (slice 8). */
  aleFsTools: boolean
  /** ALE web tools as OpenCode overrides (re-platform slice 8):
   * when on, the supervisor spawns the sidecar with
   * ALE_OPENCODE_WEB_TOOLS=1 and the plugin registers ALE's web
   * group — web-search, fetch-page and research — alongside
   * OpenCode's native websearch/webfetch. The group travels
   * together because agentTools gates the three as one research
   * set, and research is built on the other two's backends: an
   * override that left research registered while its primitives
   * were off would be a back door around the switch. Default OFF. */
  aleWebTools: boolean
  /** ALE read-skill as an OpenCode override (re-platform slice 8):
   * when on, the supervisor spawns the sidecar with
   * ALE_OPENCODE_SKILL_TOOLS=1 and the plugin registers ALE's
   * read-skill alongside OpenCode's native skill tool. Both load
   * a SKILL.md body by name from the same skills directory (the
   * generated config registers it — see opencode/config.ts), so
   * off loses nothing but ALE's own loader. run-skill-checks has
   * no native counterpart and is NOT part of this switch — it
   * stays registered either way. Default OFF. */
  aleSkillTools: boolean
}

export const AGENT_SETTINGS_DEFAULTS: AgentSettings = {
  defaultWorkflow: 'files',
  contextTrim: true,
  mapInjection: 'auto',
  chatEngine: 'opencode',
  aleFsTools: false,
  aleWebTools: false,
  aleSkillTools: false,
  consoleCheck: true,
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
    chatEngine: v.chatEngine === 'mastra' ? 'mastra' : 'opencode',
    aleFsTools: v.aleFsTools === true,
    aleWebTools: v.aleWebTools === true,
    aleSkillTools: v.aleSkillTools === true,
    consoleCheck: v.consoleCheck !== false,
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
