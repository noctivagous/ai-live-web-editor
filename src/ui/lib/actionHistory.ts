/**
 * Pins and recents for the Actions palette (slice 2): pure list
 * helpers over action ids. The palette stores the two lists in
 * localStorage; everything testable lives here.
 */

/** Parse a stored JSON id list; anything malformed becomes []. */
export function parseIdList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of v) {
      if (typeof item === 'string' && !seen.has(item)) { seen.add(item); out.push(item) }
    }
    return out
  } catch {
    return []
  }
}

export function serializeIdList(ids: string[]): string {
  return JSON.stringify(ids)
}

/** Pin when absent, unpin when present. Order is pin order. */
export function togglePin(pins: string[], id: string): string[] {
  return pins.includes(id) ? pins.filter(p => p !== id) : [...pins, id]
}

/** Most-recent-first, deduped, capped. */
export function pushRecent(recents: string[], id: string, cap = 6): string[] {
  return [id, ...recents.filter(r => r !== id)].slice(0, cap)
}

export const ACTION_PINS_KEY = 'ai-live-editor.actionPins'
export const ACTION_RECENTS_KEY = 'ai-live-editor.actionRecents'

export function loadIdList(key: string): string[] {
  try { return parseIdList(localStorage.getItem(key)) } catch { return [] }
}

export function saveIdList(key: string, ids: string[]): void {
  try { localStorage.setItem(key, serializeIdList(ids)) } catch { /* storage unavailable */ }
}

/** Record a run in the shared recents list (palette and ⌘K both call this). */
export function recordRecent(id: string): void {
  saveIdList(ACTION_RECENTS_KEY, pushRecent(loadIdList(ACTION_RECENTS_KEY), id))
}
