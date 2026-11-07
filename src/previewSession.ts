/**
 * Preview session state (Open slice B): which file the preview is
 * OF, and where inside it the user currently is. Server-global like
 * the device-target session, mirrored through the workflow snapshot.
 *
 * Two levels, deliberately distinct:
 *   mark     — the file the user marked in the file pane (or the
 *              seeded start page). Session state: it designates
 *              nothing; the manifest's `entry` is the designation.
 *   location — the page the preview has drifted to by following
 *              links inside the marked page. Setting a mark clears
 *              it; clearing it returns the preview to the mark.
 *
 * Paths are UI-style ('/landing.html', leading slash), matching the
 * /api/fs/list shape the file pane already speaks.
 */

let mark: string | null = null
let location: string | null = null

/** A safe preview path: leading slash, no traversal, bounded length. */
export function parsePreviewPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v.startsWith('/') || v.includes('..') || v.includes('\\') || v.length > 300) return null
  return v
}

export function getPreviewMark(): string | null {
  return mark
}

export function getPreviewLocation(): string | null {
  return location
}

/** Mark a file for preview; a new mark always clears any drift. */
export function setPreviewMark(next: string | null): void {
  mark = next
  location = null
}

export function setPreviewLocation(next: string | null): void {
  location = next
}

/**
 * Seed the session when a project opens: the designated start page
 * (manifest entry) wins; otherwise the classifier's entry candidate;
 * otherwise no mark. Root-relative names become UI paths here.
 */
export function seedPreviewSession(designatedEntry: string | null, candidateEntry: string | null): void {
  const entry = designatedEntry ?? candidateEntry
  mark = entry ? `/${entry.replace(/^\/+/, '')}` : null
  location = null
}

export function resetPreviewSession(): void {
  mark = null
  location = null
}
