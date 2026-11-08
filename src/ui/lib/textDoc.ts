/**
 * The base text editor's model and format adapters.
 *
 * One document model for every text format, so the base editor
 * (components/BaseTextEditor) is built ONCE — its normal toolbar
 * (font size, font weight, text alignment, heading level) and its
 * block editing — and each format customises it through an adapter:
 *
 *   parse(source)            file text  -> neutral blocks
 *   setText / setStyle / …   an edit    -> new file text
 *   support(block)           which toolbar functions this format
 *                            can honestly represent for this block;
 *                            a string is the reason it cannot, shown
 *                            on the greyed control.
 *
 * Two adapters ship in this slice:
 *  - markdown: blocks and edits delegate to lib/markdownDoc's
 *    offset splices (the file stays canonical). Markdown cannot
 *    represent alignment or block weight, and its font sizes ARE
 *    heading levels — the adapter says so, per block.
 *  - rtf: a subset parser/serializer (paragraphs with \fs size,
 *    \b weight, \ql/\qc/\qr/\qj alignment). RTF is a generated
 *    format, so edits rewrite the whole file from the model —
 *    the registry records that as a 'whole-file' write, honestly
 *    different from markdown's in-place splices.
 *
 * A .docx adapter joins the same interface later (its parse is a
 * zip+XML read); until then .docx stays the registry's stub.
 */

import {
  appendBlock as mdAppend, deleteBlock as mdDelete, parseMarkdown, replaceQuoteText,
  replaceText as mdReplaceText, setHeadingLevel, spliceRange, toggleTaskItem,
  type MdBlock,
} from './markdownDoc'

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export interface BlockStyle {
  /** Font size in points, where the format carries one. */
  fontSizePt?: number
  bold?: boolean
  align?: TextAlign
}

export interface DocItem { text: string; checked: boolean | null }

export interface DocBlock {
  kind: MdBlock['kind']
  text: string
  level?: number
  style: BlockStyle
  items?: DocItem[]
  ordered?: boolean
  lang?: string
  /** The unmodelled source, for rendered display of table/raw/frontmatter. */
  raw?: string
  /** The adapter's own handle for this block (an MdBlock, an RTF index…). */
  ref: unknown
}

/** true = the control works; a string = greyed, with this reason. */
export type Support = boolean | string
export interface StyleSupport { fontSize: Support; fontWeight: Support; align: Support }

export interface TextAdapter {
  id: string
  /** Header title, e.g. 'Markdown document'. */
  label: string
  /** One honest sentence about how edits write back in this format. */
  editNote: string
  parse(source: string): DocBlock[]
  support(block: DocBlock): StyleSupport
  setText(source: string, block: DocBlock, text: string): string
  setStyle(source: string, block: DocBlock, patch: Partial<BlockStyle>): string
  setLevel?(source: string, block: DocBlock, level: number): string
  setItemText?(source: string, block: DocBlock, itemIndex: number, text: string): string
  toggleTask?(source: string, block: DocBlock, itemIndex: number): string
  setCode?(source: string, block: DocBlock, patch: { lang?: string; code?: string }): string
  deleteBlock(source: string, block: DocBlock): string
  appendBlock(source: string, kind: 'heading' | 'paragraph' | 'list'): string
}

/* ── Markdown adapter ─────────────────────────────────────────── */

/** Heading level <-> representative point size (display + the size menu). */
export const HEADING_PT = [24, 19, 16, 14, 13, 12]
export function levelForPt(pt: number): number {
  let best = 1
  let bestDiff = Infinity
  HEADING_PT.forEach((size, i) => { const d = Math.abs(size - pt); if (d < bestDiff) { bestDiff = d; best = i + 1 } })
  return best
}

export const markdownAdapter: TextAdapter = {
  id: 'markdown',
  label: 'Markdown document',
  editNote: 'Editing a block rewrites that part of the file. Everything else stays as it is.',
  parse(source) {
    return parseMarkdown(source).map((b): DocBlock => {
      const base: DocBlock = { kind: b.kind, text: '', style: {}, ref: b, raw: 'raw' in b ? b.raw : undefined }
      switch (b.kind) {
        case 'heading': return { ...base, text: b.text, level: b.level, style: { fontSizePt: HEADING_PT[b.level - 1] } }
        case 'paragraph': return { ...base, text: b.text }
        case 'list': return { ...base, ordered: b.ordered, items: b.items.map((it) => ({ text: it.text, checked: it.checked })) }
        case 'quote': return { ...base, text: b.text }
        case 'code': return { ...base, text: b.code, lang: b.lang }
        default: return base
      }
    })
  },
  support(block) {
    if (block.kind === 'heading') {
      return {
        fontSize: true,
        fontWeight: 'Headings are already the heaviest text on the page',
        align: 'Markdown has no text alignment — it would need HTML in the file',
      }
    }
    if (block.kind === 'paragraph' || block.kind === 'quote' || block.kind === 'list') {
      return {
        fontSize: 'In Markdown, size comes from heading levels — make this a heading to size it',
        fontWeight: 'Bold in Markdown is inline (**text**), not a block setting',
        align: 'Markdown has no text alignment — it would need HTML in the file',
      }
    }
    return { fontSize: 'Not a text block', fontWeight: 'Not a text block', align: 'Not a text block' }
  },
  setText(source, block, text) {
    const b = block.ref as MdBlock
    if (b.kind === 'heading' || b.kind === 'paragraph') return mdReplaceText(source, b, text)
    if (b.kind === 'quote') return replaceQuoteText(source, b, text)
    return source
  },
  setStyle(source, block, patch) {
    const b = block.ref as MdBlock
    if (b.kind === 'heading' && patch.fontSizePt !== undefined) {
      return setHeadingLevel(source, b, levelForPt(patch.fontSizePt))
    }
    return source
  },
  setLevel(source, block, level) {
    const b = block.ref as MdBlock
    return b.kind === 'heading' ? setHeadingLevel(source, b, level) : source
  },
  setItemText(source, block, itemIndex, text) {
    const b = block.ref as MdBlock
    if (b.kind !== 'list') return source
    const item = b.items[itemIndex]
    return item ? mdReplaceText(source, item, text) : source
  },
  toggleTask(source, block, itemIndex) {
    const b = block.ref as MdBlock
    if (b.kind !== 'list') return source
    const item = b.items[itemIndex]
    return item ? toggleTaskItem(source, item) : source
  },
  setCode(source, block, patch) {
    const b = block.ref as MdBlock
    if (b.kind !== 'code') return source
    let next = source
    if (patch.lang !== undefined) next = spliceRange(next, b.langStart, b.langEnd, patch.lang)
    if (patch.code !== undefined) {
      // Re-parse after a possible lang splice so offsets are current.
      const cur = parseMarkdown(next).find((x) => x.kind === 'code' && x.start === b.start)
      if (cur && cur.kind === 'code') next = spliceRange(next, cur.codeStart, cur.codeEnd, patch.code.endsWith('\n') || patch.code === '' ? patch.code : `${patch.code}\n`)
    }
    return next
  },
  deleteBlock(source, block) { return mdDelete(source, block.ref as MdBlock) },
  appendBlock(source, kind) { return mdAppend(source, kind) },
}

/* ── RTF adapter ──────────────────────────────────────────────── */

interface RtfPara { text: string; style: BlockStyle }

const RTF_DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'footnote'])

/** Parse the RTF subset the base editor writes and common writers
 * emit for simple documents: paragraphs with size, weight and
 * alignment. Richer RTF (tables, images, nested lists) degrades to
 * plain paragraphs — stated in the editor, not hidden. */
export function parseRtf(source: string): RtfPara[] {
  const paras: RtfPara[] = []
  let text = ''
  let style: BlockStyle = {}
  let started = false // any text/control seen for the current paragraph
  let bold: boolean | undefined
  let fsPt: number | undefined
  let align: TextAlign | undefined
  let depth = 0
  let skipDepth = -1 // group depth of a destination being skipped
  let ucSkip = 1
  let i = 0

  const flush = () => {
    paras.push({ text, style: { ...(fsPt !== undefined ? { fontSizePt: fsPt } : {}), ...(bold !== undefined ? { bold } : {}), ...(align !== undefined ? { align } : {}), ...style } })
    text = ''
    started = false
  }
  // Paragraph style comes from \pard-scoped controls; in the subset
  // they appear before the paragraph's text, so we simply snapshot
  // the running state at \par time.

  while (i < source.length) {
    const c = source[i]
    if (skipDepth >= 0) {
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth < skipDepth) skipDepth = -1 }
      i++
      continue
    }
    if (c === '{') {
      // Destination group? peek at the first control word
      const m = /^[{]\\(\*\\|\\)?([a-z]+)/.exec(source.slice(i, i + 24))
      const word = m?.[2]
      if (word && RTF_DESTINATIONS.has(word)) { skipDepth = depth + 1; depth++; i++; continue }
      depth++
      i++
      continue
    }
    if (c === '}') { depth = Math.max(0, depth - 1); i++; continue }
    if (c === '\\') {
      const hex = source.slice(i + 1, i + 2)
      if (hex === "'") {
        const code = parseInt(source.slice(i + 2, i + 4), 16)
        if (!Number.isNaN(code)) { text += String.fromCharCode(code); started = true }
        i += 4
        continue
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(i))
      if (m) {
        const word = m[1]
        const arg = m[2] !== undefined ? parseInt(m[2], 10) : undefined
        i += m[0].length
        switch (word) {
          case 'par': flush(); bold = undefined; fsPt = undefined; align = undefined; break
          case 'line': text += '\n'; started = true; break
          case 'tab': text += '\t'; started = true; break
          case 'b': bold = arg !== 0; started = true; break
          case 'i': break // italics are not in the block model in this slice
          case 'fs': if (arg !== undefined) fsPt = arg / 2; started = true; break
          case 'ql': align = 'left'; started = true; break
          case 'qc': align = 'center'; started = true; break
          case 'qr': align = 'right'; started = true; break
          case 'qj': align = 'justify'; started = true; break
          case 'pard': bold = undefined; fsPt = undefined; align = undefined; break
          case 'uc': ucSkip = arg ?? 1; break
          case 'u': {
            if (arg !== undefined) {
              text += String.fromCharCode(arg < 0 ? arg + 65536 : arg)
              started = true
              // skip the fallback bytes (usually \'xx or ?)
              let skipped = 0
              while (skipped < ucSkip && i < source.length) {
                if (source[i] === '\\' && source[i + 1] === "'") i += 4; else i++
                skipped++
              }
            }
            break
          }
          default: break
        }
        continue
      }
      // escaped literal \{ \} \\
      const lit = source[i + 1]
      if (lit === '{' || lit === '}' || lit === '\\') { text += lit; started = true; i += 2; continue }
      i++
      continue
    }
    if (c === '\r' || c === '\n') { i++; continue }
    text += c
    started = true
    i++
  }
  if (started || text !== '' || paras.length === 0) flush()
  // A trailing empty paragraph from a final \par is writer noise.
  while (paras.length > 1 && paras[paras.length - 1].text === '' && Object.keys(paras[paras.length - 1].style).length === 0) paras.pop()
  return paras
}

function escapeRtfText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === '{') out += '\\{'
    else if (ch === '}') out += '\\}'
    else if (ch === '\n') out += '\\line '
    else if (ch === '\t') out += '\\tab '
    else if (code > 127) out += `\\u${code > 32767 ? code - 65536 : code}?`
    else out += ch
  }
  return out
}

const ALIGN_WORD: Record<TextAlign, string> = { left: '\\ql', center: '\\qc', right: '\\qr', justify: '\\qj' }

/** Serialize paragraphs to a complete, simple RTF document. */
export function serializeRtf(paras: RtfPara[]): string {
  const body = paras.map((p) => {
    const s = p.style
    const controls = `\\pard ${ALIGN_WORD[s.align ?? 'left']} \\fs${Math.round((s.fontSizePt ?? 12) * 2)}${s.bold ? ' \\b' : ''} `
    return `${controls}${escapeRtfText(p.text)}\\par`
  }).join('\n')
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0\n${body}\n}`
}

function rtfMutate(source: string, fn: (paras: RtfPara[]) => void): string {
  const paras = parseRtf(source)
  fn(paras)
  return serializeRtf(paras)
}

export const rtfAdapter: TextAdapter = {
  id: 'rtf',
  label: 'RTF document',
  editNote: 'RTF is a generated format: saving rewrites the whole file from the document model. Formatting beyond size, weight and alignment is not carried yet.',
  parse(source) {
    return parseRtf(source).map((p, idx): DocBlock => ({
      kind: 'paragraph', text: p.text, style: { align: 'left', fontSizePt: 12, bold: false, ...p.style }, ref: idx,
    }))
  },
  support() { return { fontSize: true, fontWeight: true, align: true } },
  setText(source, block, text) {
    return rtfMutate(source, (paras) => { const p = paras[block.ref as number]; if (p) p.text = text })
  },
  setStyle(source, block, patch) {
    return rtfMutate(source, (paras) => { const p = paras[block.ref as number]; if (p) p.style = { ...p.style, ...patch } })
  },
  deleteBlock(source, block) {
    return rtfMutate(source, (paras) => { paras.splice(block.ref as number, 1) })
  },
  appendBlock(source, kind) {
    return rtfMutate(source, (paras) => {
      paras.push({ text: kind === 'heading' ? 'New heading' : kind === 'list' ? 'New item' : 'New paragraph.', style: kind === 'heading' ? { fontSizePt: 19, bold: true } : {} })
    })
  },
}
