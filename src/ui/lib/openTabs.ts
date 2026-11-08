/** Pinned editor tabs, per project. Device-local like other UI prefs:
 * the tree's eye pins a file as a kept-open tab; the tab bar lists them.
 * The active file is separate transient state (App's activePath) — a tab
 * need not be pinned to be open in the editor or the URL. */

const KEY = 'ai-live:open-tabs'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function backend(store?: Store): Store | null {
  if (store) return store
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch { /* no DOM */ }
  return null
}

export function loadPinnedTabs(projectId: string, store?: Store): string[] {
  const b = backend(store)
  if (!b || !projectId) return []
  try {
    const raw = b.getItem(KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as Record<string, unknown>
    const list = data[projectId]
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch { return [] }
}

export function savePinnedTabs(projectId: string, tabs: string[], store?: Store): void {
  const b = backend(store)
  if (!b || !projectId) return
  try {
    const raw = b.getItem(KEY)
    const data = (raw ? JSON.parse(raw) as Record<string, string[]> : {}) as Record<string, string[]>
    data[projectId] = tabs
    b.setItem(KEY, JSON.stringify(data))
  } catch { /* private mode etc. — tabs just don't persist */ }
}
