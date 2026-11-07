/**
 * Device-scope UI preferences: the settings that belong to this
 * browser, not the project or the launcher — the chat's default view,
 * and the file pane's default sort and hidden-files choice. Stored as
 * one JSON record in localStorage; every read validates, so a stale
 * or hand-edited value falls back to the default instead of breaking
 * a pane. Server/project settings live elsewhere (connections,
 * project.ai.json); this module is only for per-device choices.
 */

import { sanitizeOverrides } from './shortcuts'
import { isUiThemeId, UI_FONT_SIZE_DEFAULT, UI_FONT_SIZE_MAX, UI_FONT_SIZE_MIN, type UiThemeId } from './themes'

export type ChatViewPref = 'chat' | 'panel'
export type FileSortPref = 'name' | 'type' | 'modified'
/** How the preview's file gets chosen in the file pane (slice B):
 * 'marked' = only an explicit mark moves the preview (default);
 * 'follow' = clicking a file marks it too. */
export type FilePreviewModePref = 'marked' | 'follow'

export interface UiPrefs {
  /** UI theme (Settings → Themes): a design-token set in lib/themes. */
  uiTheme: UiThemeId
  /** UI font size in px: every CSS font size scales by this over the
   * default (lib/themes uiScaleFor). The code editor has its own
   * font size below; this one is for the editor's own chrome. */
  uiFontSize: number
  chatView: ChatViewPref
  fileSort: FileSortPref
  fileShowHidden: boolean
  filePreviewMode: FilePreviewModePref
  /** Code editor (Monaco) options. Defaults match the editor's
   * long-standing hardcoded behavior. */
  editorFontSize: number
  editorTabSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  editorLineNumbers: boolean
  /** Keyboard shortcut overrides by registry id (shortcuts.ts). */
  shortcutOverrides: Record<string, string>
}

export const UI_PREFS_DEFAULTS: UiPrefs = {
  uiTheme: 'dark-2020s',
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  chatView: 'chat',
  fileSort: 'name',
  fileShowHidden: false,
  filePreviewMode: 'marked',
  editorFontSize: 13,
  editorTabSize: 4,
  editorWordWrap: true,
  editorMinimap: false,
  editorLineNumbers: true,
  shortcutOverrides: {},
}

export const UI_PREFS_KEY = 'ai-live-editor.uiPrefs'
const KEY = UI_PREFS_KEY

/** Fired on window whenever the default store's prefs change, so
 * mounted surfaces (App's editor, panes) can re-read them live. */
export const UI_PREFS_CHANGED_EVENT = 'ai-live:ui-prefs-changed'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function defaultStore(): Store | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
}

export function validateUiPrefs(value: unknown): UiPrefs {
  const v = (value && typeof value === 'object') ? value as Record<string, unknown> : {}
  return {
    uiTheme: isUiThemeId(v.uiTheme) ? v.uiTheme : UI_PREFS_DEFAULTS.uiTheme,
    uiFontSize: clampInt(v.uiFontSize, UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX, UI_PREFS_DEFAULTS.uiFontSize),
    chatView: v.chatView === 'panel' ? 'panel' : 'chat',
    fileSort: v.fileSort === 'type' || v.fileSort === 'modified' ? v.fileSort : 'name',
    fileShowHidden: v.fileShowHidden === true,
    filePreviewMode: v.filePreviewMode === 'follow' ? 'follow' : 'marked',
    editorFontSize: clampInt(v.editorFontSize, 10, 20, UI_PREFS_DEFAULTS.editorFontSize),
    editorTabSize: v.editorTabSize === 2 ? 2 : 4,
    editorWordWrap: v.editorWordWrap !== false,
    editorMinimap: v.editorMinimap === true,
    editorLineNumbers: v.editorLineNumbers !== false,
    shortcutOverrides: sanitizeOverrides(v.shortcutOverrides),
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

function announceChange(usedDefaultStore: boolean) {
  if (!usedDefaultStore) return
  try { globalThis.dispatchEvent(new CustomEvent(UI_PREFS_CHANGED_EVENT)) } catch { /* non-window env */ }
}

export function saveUiPrefs(patch: Partial<UiPrefs>, store: Store | null = defaultStore()): UiPrefs {
  const usedDefault = store !== null && store === defaultStore()
  const next = validateUiPrefs({ ...loadUiPrefs(store), ...patch })
  if (store) {
    try { store.setItem(KEY, JSON.stringify(next)) } catch { /* private mode etc. — prefs just don't persist */ }
  }
  announceChange(usedDefault)
  return next
}

/** Replace the whole record (settings import), validated. */
export function replaceUiPrefs(value: unknown, store: Store | null = defaultStore()): UiPrefs {
  const usedDefault = store !== null && store === defaultStore()
  const next = validateUiPrefs(value)
  if (store) {
    try { store.setItem(KEY, JSON.stringify(next)) } catch { /* as above */ }
  }
  announceChange(usedDefault)
  return next
}
