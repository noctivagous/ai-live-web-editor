/**
 * Device-scope UI preferences: the chat's default view, the UI theme,
 * and the file pane's default sort and hidden-files choice. The source
 * of truth is the launcher's SQLite settings store; localStorage holds
 * one JSON record as a synchronous read cache, and every save also
 * pushes through to the server (debounced). Every read validates, so
 * a stale or hand-edited value falls back to the default instead of
 * breaking a pane. Server/project settings live elsewhere
 * (connections, project.ai.json).
 */

import { sanitizeOverrides } from './shortcuts'
import { isUiThemeId, UI_FONT_SIZE_DEFAULT, UI_FONT_SIZE_MAX, UI_FONT_SIZE_MIN, type UiThemeId } from './themes'

/** Best-effort server push (dynamic import keeps this module — and the
 * server store built on it — free of the fetch layer at load time). */
function pushToServer(patch: Partial<UiPrefs>): void {
  try {
    void import('./appSettingsSync').then(m => {
      try { m.pushAppSettings({ uiPrefs: patch }) } catch { /* offline: the local cache still applies */ }
    }).catch(() => { /* offline: the local cache still applies */ })
  } catch { /* offline: the local cache still applies */ }
}

export type ChatViewPref = 'chat' | 'panel' | 'stationary'
export type FileSortPref = 'name' | 'name-desc' | 'type' | 'type-desc' | 'modified' | 'modified-asc'
/** Menu layout: 'grid' = two-column card panels like Agent Actions and
 * Wizards; 'list' = the classic single-column rows. */
export type MenuLayoutPref = 'grid' | 'list'
/** Header bar: 'buttons' = the top button bar only; 'classic' = the
 * classic menu strip only (the AI connection/model selects move into
 * it); 'both' = the strip under the button bar. */
export type HeaderBarPref = 'buttons' | 'classic' | 'both'

export interface UiPrefs {
  /** UI theme (Settings → Themes): a design-token set in lib/themes. */
  uiTheme: UiThemeId
  /** UI font size in px: every CSS font size scales by this over the
   * default (lib/themes uiScaleFor). The code editor has its own
   * font size below; this one is for the editor's own chrome. */
  uiFontSize: number
  /** Which header bar(s) the app shows. Settings → Header Bar picks
   * buttons, classic, or both; default buttons. */
  headerBar: HeaderBarPref
  menuLayout: MenuLayoutPref
  /** Whether menu items show their description lines under the title.
   * Off hides every `.ms-row-sub` and card blurb in menu pops, leaving
   * titles (plus wizard/action tags and stub reasons) — Settings →
   * Header Bar, on by default. */
  menuDescriptions: boolean
  chatView: ChatViewPref
  fileSort: FileSortPref
  fileShowHidden: boolean
  /** Whether the preview shows its per-format AI toolbar row. The
   * preview bar's "AI toolbar" checkbox is the switch (Settings →
   * Files mirrors it); default on — the toolbar is how the preview's
   * commands are found. */
  formatToolbar: boolean
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
  uiTheme: 'gray-pro-classic',
  uiFontSize: 14,
  headerBar: 'buttons',
  menuLayout: 'grid',
  menuDescriptions: true,
  chatView: 'stationary',
  fileSort: 'name',
  fileShowHidden: false,
  formatToolbar: true,
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
    headerBar: v.headerBar === 'classic' ? 'classic' : v.headerBar === 'both' ? 'both' : v.headerBar === 'buttons' ? 'buttons'
      // Legacy: the old menuStrip toggle. Strip on meant strip + buttons
      // (both); off or absent falls through to the buttons default.
      : v.menuStrip === true ? 'both' : 'buttons',
    menuLayout: v.menuLayout === 'list' ? 'list' : 'grid',
    menuDescriptions: v.menuDescriptions !== false,
    chatView: v.chatView === 'panel' ? 'panel' : v.chatView === 'chat' ? 'chat' : 'stationary',
    fileSort: v.fileSort === 'name-desc' || v.fileSort === 'type' || v.fileSort === 'type-desc' || v.fileSort === 'modified' || v.fileSort === 'modified-asc' ? v.fileSort : 'name',
    fileShowHidden: v.fileShowHidden === true,
    formatToolbar: v.formatToolbar !== false,
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

export function saveUiPrefs(patch: Partial<UiPrefs>, store: Store | null = defaultStore(), opts: { sync?: boolean } = {}): UiPrefs {
  const usedDefault = store !== null && store === defaultStore()
  const next = validateUiPrefs({ ...loadUiPrefs(store), ...patch })
  if (store) {
    try { store.setItem(KEY, JSON.stringify(next)) } catch { /* private mode etc. — prefs just don't persist */ }
  }
  announceChange(usedDefault)
  if (usedDefault && opts.sync !== false) pushToServer(next)
  return next
}

/** Replace the whole record (settings import), validated. */
export function replaceUiPrefs(value: unknown, store: Store | null = defaultStore(), opts: { sync?: boolean } = {}): UiPrefs {
  const usedDefault = store !== null && store === defaultStore()
  const next = validateUiPrefs(value)
  if (store) {
    try { store.setItem(KEY, JSON.stringify(next)) } catch { /* as above */ }
  }
  announceChange(usedDefault)
  if (usedDefault && opts.sync !== false) pushToServer(next)
  return next
}
