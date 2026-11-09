/** Pure file-edit helpers for ranged read, grep, and fail-closed str-replace. */

export const READ_CHAR_CAP = 20_000
export const GREP_MAX_HITS = 50
export const SNIPPET_RADIUS = 4

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  let from = 0
  while (from <= haystack.length) {
    const i = haystack.indexOf(needle, from)
    if (i < 0) break
    n += 1
    from = i + needle.length
  }
  return n
}

export function applyStrReplace(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll = false,
): { ok: true, content: string, matches: number } | { ok: false, error: string, matches: number } {
  if (!oldStr) return { ok: false, error: 'old_string is empty', matches: 0 }
  const matches = countOccurrences(content, oldStr)
  if (matches === 0) {
    return { ok: false, error: 'old_string not found — file unchanged', matches: 0 }
  }
  if (matches > 1 && !replaceAll) {
    return {
      ok: false,
      error: `old_string is not unique (${matches} matches) — file unchanged. Widen the hunk or set replace_all.`,
      matches,
    }
  }
  const next = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr)
  return { ok: true, content: next, matches: replaceAll ? matches : 1 }
}

export function snippetAround(content: string, needle: string, radius = SNIPPET_RADIUS): string {
  const idx = content.indexOf(needle)
  if (idx < 0) return ''
  const lines = content.split('\n')
  let pos = 0
  let line = 0
  for (let i = 0; i < lines.length; i++) {
    const end = pos + lines[i].length
    if (idx <= end) { line = i; break }
    pos = end + 1
  }
  const from = Math.max(0, line - radius)
  const to = Math.min(lines.length, line + radius + needle.split('\n').length)
  return lines.slice(from, to).map((t, i) => `${from + i + 1}| ${t}`).join('\n')
}

export function sliceLines(content: string, offset?: number, limit?: number): {
  content: string
  startLine: number
  endLine: number
  totalLines: number
  truncated: boolean
} {
  const lines = content.split('\n')
  const totalLines = lines.length
  const startLine = offset && offset > 0 ? offset : 1
  const take = limit && limit > 0 ? limit : totalLines - startLine + 1
  const slice = lines.slice(startLine - 1, startLine - 1 + take)
  let text = slice.join('\n')
  let truncated = startLine > 1 || startLine - 1 + slice.length < totalLines
  if (text.length > READ_CHAR_CAP) {
    text = text.slice(0, READ_CHAR_CAP)
    truncated = true
  }
  return {
    content: text,
    startLine,
    endLine: startLine + slice.length - 1,
    totalLines,
    truncated,
  }
}

/** Lines of exact source kept on each side of a grep hit. */
export const GREP_WINDOW_RADIUS = 2

export type SourceWindow = { window: string, windowStart: number, windowEnd: number }

/** Exact file lines around a 1-based line. No prefixes — copyable as old_string. */
export function lineWindow(lines: string[], line1: number, radius: number): SourceWindow {
  const start = Math.max(1, line1 - radius)
  const end = Math.min(lines.length, line1 + radius)
  return {
    window: lines.slice(start - 1, end).join('\n'),
    windowStart: start,
    windowEnd: end,
  }
}

export type GrepHit = { path: string, line: number, text: string } & SourceWindow

export function grepText(content: string, relPath: string, re: RegExp, cap: number, hits: GrepHit[]): boolean {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    if (!re.test(lines[i])) continue
    hits.push({ path: relPath, line: i + 1, text: lines[i].slice(0, 240), ...lineWindow(lines, i + 1, GREP_WINDOW_RADIUS) })
    if (hits.length >= cap) return true
  }
  return false
}

/** Exact file lines around each occurrence of needle, capped. */
export function matchWindows(content: string, needle: string, limit = 3, radius = 3): SourceWindow[] {
  if (!needle) return []
  const lines = content.split('\n')
  const out: SourceWindow[] = []
  let from = 0
  while (out.length < limit) {
    const idx = content.indexOf(needle, from)
    if (idx < 0) break
    out.push(lineWindow(lines, countLines(content.slice(0, idx)) + 1, radius))
    from = idx + needle.length
  }
  return out
}

/**
 * old_string missed the file. Find a line from it that does exist
 * (trimmed, so an indentation miss still lands) and return the exact
 * file lines around that spot.
 */
function lineNearScore(fileLine: string, candidate: string): number {
  if (fileLine.includes(candidate)) return 1000 + candidate.length
  const tokens = candidate.split(/[^A-Za-z0-9_]+/).filter(t => t.length >= 4)
  let hit = 0
  for (const t of tokens) if (fileLine.includes(t)) hit++
  if (!tokens.length || hit === 0) return 0
  return hit * 10 + Math.min(candidate.length, 80)
}

export function nearestWindow(content: string, oldStr: string, radius = 4): SourceWindow | null {
  const lines = content.split('\n')
  const candidates = oldStr.split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 8)
    .sort((a, b) => b.length - a.length)
    .slice(0, 12)
  let best: { line: number, score: number } | null = null
  for (const cand of candidates) {
    for (let i = 0; i < lines.length; i++) {
      const score = lineNearScore(lines[i], cand)
      if (score > 0 && (!best || score > best.score)) best = { line: i + 1, score }
    }
  }
  if (!best) return null
  return lineWindow(lines, best.line, radius)
}

export function compileGrep(pattern: string, caseInsensitive?: boolean): RegExp | { error: string } {
  try {
    return new RegExp(pattern, caseInsensitive ? 'i' : '')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'invalid pattern' }
  }
}

export function isPlaceholderWrite(content: string): boolean {
  return /\[original content\]/i.test(content)
}

/** Line count of text (a trailing newline does not add a phantom line). */
export function countLines(text: string): number {
  if (!text) return 0
  const parts = text.split('\n')
  return parts.length - (text.endsWith('\n') ? 1 : 0)
}

/** 1-based [start, end] line range of needle's first occurrence in content, or null. */
export function lineRangeOf(content: string, needle: string): [number, number] | null {
  if (!needle) return null
  const idx = content.indexOf(needle)
  if (idx < 0) return null
  const start = countLines(content.slice(0, idx)) + 1
  const end = start + countLines(needle) - 1
  return [start, Math.max(start, end)]
}
