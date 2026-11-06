/** Persisted collapse state for the editor / preview stacked panes. */

export type Collapse = { editor: boolean, preview: boolean }

export const COLLAPSE_KEY = 'ai-live-editor.collapse'

export function parseCollapse(raw: unknown): Collapse {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    editor: row.editor === true,
    preview: row.preview === true,
  }
}

export function loadCollapse(): Collapse {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return parseCollapse(null)
    const raw = window.localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return parseCollapse(null)
    return parseCollapse(JSON.parse(raw))
  } catch {
    return parseCollapse(null)
  }
}

export function saveCollapse(next: Collapse): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
    }
  } catch { /* quota / private mode */ }
}
