/**
 * The keyboard shortcut registry: the single source of truth for
 * which keys do what. Surfaces with a key handler (the file pane,
 * the Deck) match events against this registry instead of
 * hardcoding key names, so a binding changed in Settings takes
 * effect everywhere it is used.
 *
 * A combo is a canonical string: modifiers in ctrl/alt/shift/meta
 * order, then the normalized key, joined with '+' — e.g. 'f2',
 * 'delete', 'arrowright', 'ctrl+shift+s'. 'mod' is deliberately not
 * used: what was recorded is what is stored.
 *
 * Some shortcuts are structural (Enter sends, ↑/↓ move a list) and
 * are listed with editable: false — shown in Settings so the full
 * keyboard map is discoverable, but not rebindable.
 */

export interface ShortcutDef {
  id: string
  label: string
  scope: string
  /** Canonical combo for editable entries; display text for fixed ones. */
  combo: string
  editable: boolean
  note?: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'fileRename', label: 'Rename file or folder', scope: 'Files pane', combo: 'f2', editable: true },
  { id: 'fileDelete', label: 'Delete file or folder', scope: 'Files pane', combo: 'delete', editable: true },
  { id: 'fileNavigate', label: 'Move selection, open, expand or collapse', scope: 'Files pane', combo: '↑ ↓ Enter → ←', editable: false, note: 'Navigation keys are part of how the pane works.' },
  { id: 'deckNext', label: 'Next slide', scope: 'Deck', combo: 'arrowright', editable: true },
  { id: 'deckPrev', label: 'Previous slide', scope: 'Deck', combo: 'arrowleft', editable: true },
  { id: 'deckOverview', label: 'Toggle slide overview', scope: 'Deck', combo: 'o', editable: true },
  { id: 'deckClose', label: 'Close deck, or leave the overview', scope: 'Deck', combo: 'escape', editable: false },
  { id: 'chatSend', label: 'Send message', scope: 'Chat', combo: 'enter', editable: false },
  { id: 'chatStop', label: 'Stop a running reply', scope: 'Chat', combo: 'escape', editable: false, note: 'While a reply is streaming, in the message box.' },
  { id: 'planConfirm', label: 'Add the typed question or task', scope: 'Plans', combo: 'enter', editable: false },
]

export function shortcutDef(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find(s => s.id === id)
}

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta'])

const NAMED_KEYS = new Set([
  'escape', 'delete', 'backspace', 'enter', 'space', 'tab', 'insert',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'home', 'end', 'pageup', 'pagedown', 'capslock', 'printscreen', 'contextmenu',
])

function isKeyName(key: string): boolean {
  return key.length === 1 || NAMED_KEYS.has(key) || /^f\d{1,2}$/.test(key)
}

function normalizeKey(key: string): string {
  const k = key.toLowerCase()
  if (k === ' ') return 'space'
  if (k === 'esc') return 'escape'
  if (k === 'del') return 'delete'
  return k
}

/** Canonical combo for a keyboard event, or null when the event is
 * a modifier press on its own (still waiting for the real key). */
export function comboFromEvent(e: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }): string | null {
  const key = normalizeKey(e.key)
  if (MODIFIER_KEYS.has(key)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('meta')
  parts.push(key)
  return parts.join('+')
}

/** Validate + canonicalize a stored combo; null when malformed. */
export function normalizeCombo(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const parts = raw.toLowerCase().split('+').map(p => p.trim()).filter(Boolean)
  if (!parts.length) return null
  const key = normalizeKey(parts[parts.length - 1])
  if (MODIFIER_KEYS.has(key) || !isKeyName(key)) return null
  const ALIASES: Record<string, string> = { control: 'ctrl', option: 'alt', cmd: 'meta', command: 'meta' }
  const mods = new Set(parts.slice(0, -1).map(m => ALIASES[m] ?? m))
  for (const m of mods) if (!['ctrl', 'alt', 'shift', 'meta'].includes(m)) return null
  const ordered = ['ctrl', 'alt', 'shift', 'meta'].filter(m => mods.has(m))
  return [...ordered, key].join('+')
}

export function matchShortcut(
  e: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean },
  combo: string,
): boolean {
  return comboFromEvent(e) === combo
}

/** The combo in force for an editable shortcut: the user's override
 * when present and valid, else the registry default. */
export function effectiveCombo(id: string, overrides: Record<string, string>): string {
  const def = shortcutDef(id)
  if (!def) return ''
  if (!def.editable) return def.combo
  return normalizeCombo(overrides[id]) ?? def.combo
}

/** Overrides with unknown ids, fixed ids, and malformed combos removed. */
export function sanitizeOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, combo] of Object.entries(value as Record<string, unknown>)) {
    const def = shortcutDef(id)
    if (!def?.editable) continue
    const c = normalizeCombo(combo)
    if (c && c !== def.combo) out[id] = c
  }
  return out
}

/** The id of another editable shortcut in the same scope already
 * using this combo (with the given overrides applied), or null. */
export function findConflict(id: string, combo: string, overrides: Record<string, string>): string | null {
  const def = shortcutDef(id)
  if (!def) return null
  for (const other of SHORTCUTS) {
    if (other.id === id || !other.editable || other.scope !== def.scope) continue
    if (effectiveCombo(other.id, overrides) === combo) return other.id
  }
  return null
}

const KEY_LABELS: Record<string, string> = {
  arrowright: '→', arrowleft: '←', arrowup: '↑', arrowdown: '↓',
  escape: 'Esc', delete: 'Del', backspace: '⌫', enter: 'Enter', space: 'Space', tab: 'Tab',
}

/** Human-readable form: 'ctrl+shift+s' → 'Ctrl ⇧ S', 'f2' → 'F2'. */
export function formatCombo(combo: string): string {
  return combo.split('+').map(p => {
    if (p === 'ctrl') return 'Ctrl'
    if (p === 'alt') return 'Alt'
    if (p === 'shift') return '⇧'
    if (p === 'meta') return '⌘'
    if (KEY_LABELS[p]) return KEY_LABELS[p]
    if (/^f\d{1,2}$/.test(p)) return p.toUpperCase()
    if (p.length === 1) return p.toUpperCase()
    return p.charAt(0).toUpperCase() + p.slice(1)
  }).join(' ')
}
