/**
 * Markdown block model for the markdown editor — the same pattern as
 * the CSS boxes and the JSON form: the FILE stays canonical, this
 * module parses just enough structure to locate each block (and the
 * editable text inside it) by exact offsets, and an edit splices the
 * replacement into those offsets. Everything the parser does not
 * model — tables, raw HTML, link definitions — is carried as a
 * 'raw' block: shown rendered, never spliced by the block editor.
 *
 * Blocks: frontmatter, heading, paragraph, list (with task items),
 * quote, code fence, table, thematic break, raw. Blank lines are
 * separators, not blocks; insert/delete helpers manage them so the
 * file's spacing stays conventional (one blank line between blocks).
 */

export interface MdListItem {
  /** Absolute offsets of the item's first-line text (after marker). */
  textStart: number
  textEnd: number
  text: string
  /** Task checkbox state: true/false when the item has one, else null. */
  checked: boolean | null
  /** Absolute offset of the 'x'/' ' inside [ ], when checked != null. */
  checkStart: number
}

export type MdBlock =
  | { kind: 'frontmatter'; start: number; end: number; raw: string }
  | { kind: 'heading'; start: number; end: number; raw: string; level: number; textStart: number; textEnd: number; text: string }
  | { kind: 'paragraph'; start: number; end: number; raw: string; textStart: number; textEnd: number; text: string }
  | { kind: 'list'; start: number; end: number; raw: string; ordered: boolean; items: MdListItem[] }
  | { kind: 'quote'; start: number; end: number; raw: string; text: string }
  | { kind: 'code'; start: number; end: number; raw: string; lang: string; langStart: number; langEnd: number; codeStart: number; codeEnd: number; code: string }
  | { kind: 'table'; start: number; end: number; raw: string }
  | { kind: 'hr'; start: number; end: number; raw: string }
  | { kind: 'raw'; start: number; end: number; raw: string }

interface Line { start: number; end: number; text: string; next: number }

function linesOf(src: string): Line[] {
  const lines: Line[] = []
  let i = 0
  while (i < src.length) {
    const nl = src.indexOf('\n', i)
    const end = nl === -1 ? src.length : nl
    lines.push({ start: i, end, text: src.slice(i, end), next: nl === -1 ? src.length : nl + 1 })
    i = nl === -1 ? src.length : nl + 1
  }
  if (src.length === 0) lines.push({ start: 0, end: 0, text: '', next: 0 })
  return lines
}

const RE_HEADING = /^(#{1,6})(\s+)(.*?)\s*$/
const RE_FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/
const RE_HR = /^\s*((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})$/
const RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/
const RE_TASK = /^\[([ xX])\]\s+/
const RE_TABLE_SEP = /^\s*\|?[\s:|-]+\|?\s*$/

function isBlank(l: Line): boolean { return l.text.trim() === '' }

function startsSpecial(l: Line): boolean {
  return RE_HEADING.test(l.text) || RE_FENCE.test(l.text) || RE_HR.test(l.text)
    || RE_LIST.test(l.text) || l.text.startsWith('>') || l.text.trim().startsWith('|')
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = linesOf(src)
  const blocks: MdBlock[] = []
  let idx = 0

  // YAML frontmatter: a --- line at the very top, closed by --- or ...
  if (lines.length > 1 && lines[0].text.trim() === '---') {
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j].text.trim()
      if (t === '---' || t === '...') {
        blocks.push({ kind: 'frontmatter', start: 0, end: lines[j].end, raw: src.slice(0, lines[j].end) })
        idx = j + 1
        break
      }
    }
  }

  while (idx < lines.length) {
    const line = lines[idx]
    if (isBlank(line)) { idx++; continue }
    const start = line.start

    // Code fence
    const fence = line.text.match(RE_FENCE)
    if (fence) {
      const marker = fence[2]
      const langStart = line.start + fence[1].length + marker.length
      let j = idx + 1
      while (j < lines.length) {
        const close = lines[j].text.trim()
        if (close.startsWith(marker.slice(0, 3)) && close.length >= 3 && /^(`+|~+)\s*$/.test(close)) break
        j++
      }
      const closed = j < lines.length
      const endLine = closed ? lines[j] : lines[lines.length - 1]
      const codeStart = line.next
      const codeEnd = closed ? lines[j].start : src.length
      blocks.push({
        kind: 'code', start, end: endLine.end, raw: src.slice(start, endLine.end),
        lang: fence[3].trim(), langStart, langEnd: line.end,
        codeStart, codeEnd, code: src.slice(codeStart, Math.max(codeStart, codeEnd)).replace(/\n$/, ''),
      })
      idx = closed ? j + 1 : lines.length
      continue
    }

    // Heading
    const heading = line.text.match(RE_HEADING)
    if (heading) {
      const textStart = line.start + heading[1].length + heading[2].length
      blocks.push({
        kind: 'heading', start, end: line.end, raw: line.text,
        level: heading[1].length, textStart, textEnd: textStart + heading[3].length, text: heading[3],
      })
      idx++
      continue
    }

    // Thematic break
    if (RE_HR.test(line.text)) {
      blocks.push({ kind: 'hr', start, end: line.end, raw: line.text })
      idx++
      continue
    }

    // Table: a | line followed by a separator line
    if (line.text.trim().startsWith('|') && idx + 1 < lines.length && RE_TABLE_SEP.test(lines[idx + 1].text) && lines[idx + 1].text.includes('-')) {
      let j = idx
      while (j < lines.length && lines[j].text.trim().startsWith('|')) j++
      const end = lines[j - 1].end
      blocks.push({ kind: 'table', start, end, raw: src.slice(start, end) })
      idx = j
      continue
    }

    // Quote: consecutive > lines; text is the stripped prose
    if (line.text.startsWith('>')) {
      let j = idx
      const parts: string[] = []
      while (j < lines.length && lines[j].text.startsWith('>')) {
        parts.push(lines[j].text.replace(/^>\s?/, ''))
        j++
      }
      const end = lines[j - 1].end
      blocks.push({ kind: 'quote', start, end, raw: src.slice(start, end), text: parts.join('\n') })
      idx = j
      continue
    }

    // List: consecutive item lines (indented continuations stay raw
    // inside the block but are not separately editable in this slice)
    if (RE_LIST.test(line.text)) {
      const items: MdListItem[] = []
      let j = idx
      let ordered = false
      while (j < lines.length) {
        const m = lines[j].text.match(RE_LIST)
        if (!m) break
        if (items.length === 0) ordered = /\d/.test(m[2])
        let text = m[4]
        let textStart = lines[j].start + m[1].length + m[2].length + m[3].length
        let checked: boolean | null = null
        let checkStart = -1
        const task = text.match(RE_TASK)
        if (task) {
          checked = task[1].toLowerCase() === 'x'
          checkStart = textStart + 1
          textStart += task[0].length
          text = text.slice(task[0].length)
        }
        items.push({ textStart, textEnd: textStart + text.length, text, checked, checkStart })
        j++
      }
      const end = lines[j - 1].end
      blocks.push({ kind: 'list', start, end, raw: src.slice(start, end), ordered, items })
      idx = j
      continue
    }

    // Raw HTML block: lines starting with < until a blank line
    if (line.text.trimStart().startsWith('<')) {
      let j = idx
      while (j < lines.length && !isBlank(lines[j])) j++
      const end = lines[j - 1].end
      blocks.push({ kind: 'raw', start, end, raw: src.slice(start, end) })
      idx = j
      continue
    }

    // Paragraph: until a blank line or a special start
    let j = idx
    while (j < lines.length && !isBlank(lines[j]) && (j === idx || !startsSpecial(lines[j]))) j++
    const end = lines[j - 1].end
    blocks.push({ kind: 'paragraph', start, end, raw: src.slice(start, end), textStart: start, textEnd: end, text: src.slice(start, end) })
    idx = j
  }
  return blocks
}

/** Splice new text into a [start, end) range — the one primitive
 * every edit below is built from. */
export function spliceRange(src: string, start: number, end: number, next: string): string {
  return src.slice(0, start) + next + src.slice(end)
}

export function replaceText(src: string, range: { textStart: number; textEnd: number }, newText: string): string {
  return spliceRange(src, range.textStart, range.textEnd, newText)
}

/** Change a heading's level by replacing its # prefix. */
export function setHeadingLevel(src: string, block: Extract<MdBlock, { kind: 'heading' }>, level: number): string {
  const lvl = Math.min(6, Math.max(1, level))
  return spliceRange(src, block.start, block.start + block.level, '#'.repeat(lvl))
}

export function toggleTaskItem(src: string, item: MdListItem): string {
  if (item.checked === null || item.checkStart < 0) return src
  return spliceRange(src, item.checkStart, item.checkStart + 1, item.checked ? ' ' : 'x')
}

/** Rewrite a quote block from its stripped text, one '> ' per line. */
export function replaceQuoteText(src: string, block: Extract<MdBlock, { kind: 'quote' }>, newText: string): string {
  const raw = newText.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)).join('\n')
  return spliceRange(src, block.start, block.end, raw)
}

const NEW_BLOCK_TEXT: Record<'heading' | 'paragraph' | 'list', string> = {
  heading: '## New heading',
  paragraph: 'New paragraph.',
  list: '- New item',
}

/** Append a block of the given kind at the end of the document,
 * keeping exactly one blank line before it and a trailing newline. */
export function appendBlock(src: string, kind: 'heading' | 'paragraph' | 'list'): string {
  const text = NEW_BLOCK_TEXT[kind]
  const trimmed = src.replace(/\s+$/, '')
  if (trimmed === '') return `${text}\n`
  return `${trimmed}\n\n${text}\n`
}

/** Remove a block and re-join its neighbours with exactly one
 * blank line between them (or a single trailing newline at EOF). */
export function deleteBlock(src: string, block: MdBlock): string {
  const before = src.slice(0, block.start).replace(/\n+$/, '')
  const after = src.slice(block.end).replace(/^\n+/, '')
  if (before && after) return `${before}\n\n${after}`
  if (after) return after
  if (before) return `${before}\n`
  return ''
}
