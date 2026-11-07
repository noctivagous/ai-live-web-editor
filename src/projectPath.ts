import path from 'node:path'

/**
 * The one project-path resolver (basics audit slice 1). Every caller —
 * agent tools, the HTTP fs endpoints — resolves caller-supplied paths
 * through here so they all agree on what a path means.
 *
 * Paths are project-relative in any of the forms callers actually
 * produce: "/src/a.ts", "src/a.ts", "./src/a.ts". Interior "." and ".."
 * segments are folded ("src/../a.ts" → "/a.ts"); a path that would
 * escape the project root is refused. The result carries the canonical
 * project path ("/src/a.ts", "/" for the root itself) alongside the
 * absolute filesystem path.
 *
 * This never throws: a bad path is a value the caller can hand back as
 * a readable error, not an exception and never a silent relocation
 * (the old `'.' + p` resolution wrote "src/x" into a hidden ".src/"
 * folder while reporting success).
 */

export type ProjectPathResult =
  | { ok: true; full: string; rel: string }
  | { ok: false; error: string }

export function resolveProjectPath(root: string, p: unknown): ProjectPathResult {
  if (typeof p !== 'string' || !p.trim()) return { ok: false, error: 'Path must be a non-empty string' }
  const segments: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (segments.length === 0) {
        return { ok: false, error: `Path escapes the project root: ${p}` }
      }
      segments.pop()
      continue
    }
    segments.push(seg)
  }
  const rel = '/' + segments.join('/')
  const full = segments.length === 0 ? root : path.join(root, ...segments)
  // Defence in depth: the segment walk above cannot escape, but keep
  // the invariant explicit and checked with a separator-aware prefix.
  if (full !== root && !full.startsWith(root + path.sep)) {
    return { ok: false, error: `Path escapes the project root: ${p}` }
  }
  return { ok: true, full, rel }
}

/** Throwing form for the HTTP layer, whose routes already turn an
 * Error into a 400. Agent tools use resolveProjectPath directly. */
export function projectPathOrThrow(root: string, p: unknown): string {
  const r = resolveProjectPath(root, p)
  if (r.ok === false) throw new Error(r.error)
  return r.full
}
