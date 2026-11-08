import { getAppSettings, putAppSettings } from './api'
import type { UiPrefs } from './uiPrefs'

/**
 * Server sync for app settings: the launcher's SQLite store is the
 * source of truth; localStorage stays as a synchronous read cache.
 * Pushes are debounced and merged, so rapid settings edits (sliders,
 * toggles) land as one write. Pulls converge this browser on boot;
 * an empty server leaves local settings alone (no migration), and the
 * first save after that pushes them up.
 */

export interface AppSettingsPatch {
  uiPrefs?: Partial<UiPrefs>
  editorTheme?: string
  setupDone?: boolean
}

let pending: AppSettingsPatch | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  if (!pending) return
  const patch = pending
  pending = null
  timer = null
  void putAppSettings(patch).catch(() => { /* launcher down: local cache still applies */ })
}

/** Queue a settings patch for the server (debounced, merged). */
export function pushAppSettings(patch: AppSettingsPatch): void {
  pending = {
    ...(pending ?? {}),
    ...patch,
    ...(patch.uiPrefs && pending?.uiPrefs ? { uiPrefs: { ...pending.uiPrefs, ...patch.uiPrefs } } : {}),
  }
  if (timer) return
  timer = setTimeout(flush, 500)
}
