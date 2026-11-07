/**
 * Settings export/import (Privacy & Data): the portable form of the
 * settings instances — device prefs plus the active project's
 * config. API keys and connections are NOT settings in this sense:
 * they live server-side and never enter either store, so an export
 * cannot contain a secret by construction.
 */
import { validateUiPrefs, type UiPrefs } from './uiPrefs'
import type { ProjectConfig } from './api'

export interface SettingsExport {
  app: 'ai-live-editor-settings'
  version: 1
  exportedAt: string
  prefs: UiPrefs
  project?: ProjectConfig
}

export function buildSettingsExport(prefs: UiPrefs, project?: ProjectConfig, now = new Date()): SettingsExport {
  return {
    app: 'ai-live-editor-settings',
    version: 1,
    exportedAt: now.toISOString(),
    prefs: validateUiPrefs(prefs),
    ...(project ? { project } : {}),
  }
}

const PROJECT_KEYS = ['type', 'format', 'deviceTargets', 'defaultDeviceTarget', 'styleSet', 'features', 'appkit', 'planLevel', 'planMutability'] as const

export interface SettingsImport {
  prefs: UiPrefs
  /** Only known project keys, still server-sanitized on save. */
  project?: Record<string, unknown>
}

/** Parse an export file's text. Throws with a user-readable message
 * for anything that is not a settings export. */
export function parseSettingsImport(text: string): SettingsImport {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('That file is not valid JSON') }
  const v = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  if (v.app !== 'ai-live-editor-settings') throw new Error('That file is not an AI Live Editor settings export')
  if (!('prefs' in v)) throw new Error('The export has no device settings (prefs) section')
  const out: SettingsImport = { prefs: validateUiPrefs(v.prefs) }
  if (v.project && typeof v.project === 'object') {
    const src = v.project as Record<string, unknown>
    const project: Record<string, unknown> = {}
    for (const k of PROJECT_KEYS) if (k in src) project[k] = src[k]
    if (Object.keys(project).length) out.project = project
  }
  return out
}

/** localStorage keys holding saved chat sessions (chatSession.ts). */
export function chatSessionKeys(allKeys: string[]): string[] {
  return allKeys.filter(k => k.startsWith('ai-live-editor.chat.'))
}
