/**
 * Device-scope UI preferences: the settings that belong to this
 * browser, not the project or the launcher — the chat's default view,
 * and the file pane's default sort and hidden-files choice. Stored as
 * one JSON record in localStorage; every read validates, so a stale
 * or hand-edited value falls back to the default instead of breaking
 * a pane. Server/project settings live elsewhere (connections,
 * project.ai.json); this module is only for per-device choices.
 */

export type ChatViewPref = 'chat' | 'panel'
export type FileSortPref = 'name' | 'type' | 'modified'

export interface UiPrefs {
  chatView: ChatViewPref
  fileSort: FileSortPref
  fileShowHidden: boolean
}

export const UI_PREFS_DEFAULTS: UiPrefs = {
  chatView: 'chat',
  fileSort: 'name',
  fileShowHidden: false,
}

const KEY = 'ai-live-editor.uiPrefs'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function defaultStore(): Store | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

export function validateUiPrefs(value: unknown): UiPrefs {
  const v = (value && typeof value === 'object') ? value as Record<string, unknown> : {}
  return {
    chatView: v.chatView === 'panel' ? 'panel' : 'chat',
    fileSort: v.fileSort === 'type' || v.fileSort === 'modified' ? v.fileSort : 'name',
    fileShowHidden: v.fileShowHidden === true,
  }
}

export function loadUiPrefs(store: Store | null = defaultStore()): UiPrefs {
  if (!store) return { ...UI_PREFS_DEFAULTS }
  try {
    const raw = store.getItem(KEY)
    if (!raw) return { ...UI_PREFS_DEFAULTS }
    return validateUiPrefs(JSON.parse(raw))
  } catch {
    return { ...UI_PREFS_DEFAULTS }
  }
}

export function saveUiPrefs(patch: Partial<UiPrefs>, store: Store | null = defaultStore()): UiPrefs {
  const next = validateUiPrefs({ ...loadUiPrefs(store), ...patch })
  if (store) {
    try { store.setItem(KEY, JSON.stringify(next)) } catch { /* private mode etc. — prefs just don't persist */ }
  }
  return next
}
