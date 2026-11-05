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

export type GrepHit = { path: string, line: number, text: string }

export function grepText(content: string, relPath: string, re: RegExp, cap: number, hits: GrepHit[]): boolean {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    if (!re.test(lines[i])) continue
    hits.push({ path: relPath, line: i + 1, text: lines[i].slice(0, 240) })
    if (hits.length >= cap) return true
  }
  return false
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
