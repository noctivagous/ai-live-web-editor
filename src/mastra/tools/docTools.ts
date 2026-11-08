import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'node:fs'
import { getFsRoot } from '../../launcher.js'
import { resolveProjectPath } from '../../projectPath.js'
import { markdownAdapter, rtfAdapter, type DocBlock, type TextAdapter } from '../../ui/lib/textDoc.js'
import { rendererFor } from '../../ui/lib/previewRender.js'

/**
 * The document core tools: the blocks model's verb set, running
 * on the SAME TextAdapters as the base text editor
 * (src/ui/lib/textDoc) — so an agent edit and a person's toolbar
 * edit go through identical code, including the honest limits:
 * doc-set-style asks the adapter's support() first and refuses
 * with the adapter's own reason, the same string the human
 * toolbar shows on its greyed control.
 *
 * Blocks are addressed by their 1-based number in the document,
 * as doc-inspect lists them. Markdown writes splice in place;
 * RTF rewrites the file from the model (its registry write mode
 * says so, and doc-inspect repeats it).
 */

const MAX_DOC_CHARS = 2_500_000
const OUTLINE_BLOCKS = 100
const MAX_MATCHES = 50

const ADAPTERS: Record<string, TextAdapter> = { markdown: markdownAdapter, richtext: rtfAdapter }

type LoadResult =
  | { ok: true; rel: string; full: string; source: string; adapter: TextAdapter; blocks: DocBlock[] }
  | { ok: false; error: string }

function loadDoc(inputPath: string): LoadResult {
  const root = getFsRoot()
  const resolved = resolveProjectPath(root, inputPath)
  if (resolved.ok === false) return { ok: false, error: resolved.error }
  const { full, rel } = resolved
  const adapter = ADAPTERS[rendererFor(rel)]
  if (!adapter) {
    return { ok: false, error: `${rel} is not a document the doc tools cover (.md or .rtf).` }
  }
  let buf: Buffer
  try {
    buf = fs.readFileSync(full)
  } catch {
    return { ok: false, error: `No such file: ${rel}` }
  }
  if (buf.includes(0)) return { ok: false, error: `${rel} looks binary — the doc tools handle text documents only.` }
  const source = buf.toString('utf8')
  if (source.length > MAX_DOC_CHARS) {
    return { ok: false, error: `${rel} is ${source.length} chars — over the ${MAX_DOC_CHARS}-char document limit.` }
  }
  return { ok: true, rel, full, source, adapter, blocks: adapter.parse(source) }
}

function preview(block: DocBlock): string {
  const text = block.kind === 'list'
    ? (block.items ?? []).map((i) => i.text).join(' · ')
    : block.kind === 'table' || block.kind === 'raw' || block.kind === 'frontmatter'
      ? (block.raw ?? '')
      : block.text
  return text.replace(/\s+/g, ' ').slice(0, 90)
}

function blockAt(loaded: Extract<LoadResult, { ok: true }>, n: number): DocBlock | null {
  return loaded.blocks[n - 1] ?? null
}

function writeBack(loaded: Extract<LoadResult, { ok: true }>, next: string): void {
  fs.writeFileSync(loaded.full, next, 'utf8')
}

const pathField = z.string().describe('Project-relative path to a .md or .rtf file')
const blockField = z.number().int().min(1).describe('1-based block number, as doc-inspect lists them')

export const docInspectTool = createTool({
  id: 'doc-inspect',
  description:
    'Inspect a document (Markdown or RTF) as blocks: the block list with kinds, heading levels and a short preview of each. Use this before editing a document — the block numbers are what the other doc tools take.',
  inputSchema: z.object({ path: pathField }),
  execute: async ({ path: inputPath }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    return {
      ok: true,
      path: loaded.rel,
      format: loaded.adapter.label,
      editNote: loaded.adapter.editNote,
      blocks: loaded.blocks.length,
      outline: loaded.blocks.slice(0, OUTLINE_BLOCKS).map((b, i) => ({
        block: i + 1,
        kind: b.kind,
        ...(b.level ? { level: b.level } : {}),
        preview: preview(b),
      })),
      outlineTruncated: loaded.blocks.length > OUTLINE_BLOCKS,
    }
  },
})

export const docGetTool = createTool({
  id: 'doc-get',
  description: 'Read one block of a document (Markdown or RTF) in full: its kind, text, list items and style.',
  inputSchema: z.object({ path: pathField, block: blockField }),
  execute: async ({ path: inputPath, block }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const b = blockAt(loaded, block)
    if (!b) return { ok: false, error: `${loaded.rel} has ${loaded.blocks.length} blocks — block ${block} does not exist.` }
    return {
      ok: true, path: loaded.rel, block, kind: b.kind,
      ...(b.level ? { level: b.level } : {}),
      text: b.text,
      ...(b.items ? { items: b.items } : {}),
      ...(b.lang ? { lang: b.lang } : {}),
      ...(b.raw ? { raw: b.raw } : {}),
      style: b.style,
    }
  },
})

export const docFindTool = createTool({
  id: 'doc-find',
  description: 'Find blocks in a document (Markdown or RTF) whose text contains a query (case-insensitive). Returns block numbers the other doc tools can target.',
  inputSchema: z.object({ path: pathField, query: z.string().describe('Text to look for in block text and list items') }),
  execute: async ({ path: inputPath, query }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const needle = query.toLowerCase()
    const matches: { block: number; kind: string; preview: string }[] = []
    let total = 0
    loaded.blocks.forEach((b, i) => {
      if (preview(b).toLowerCase().includes(needle) || b.text.toLowerCase().includes(needle)) {
        total++
        if (matches.length < MAX_MATCHES) matches.push({ block: i + 1, kind: b.kind, preview: preview(b) })
      }
    })
    return { ok: true, path: loaded.rel, query, total, matches, truncated: total > matches.length }
  },
})

export const docSetTextTool = createTool({
  id: 'doc-set-text',
  description:
    'Replace the text of one block in a document (Markdown or RTF): a heading, paragraph, quote, or a code block’s code. For list blocks use doc-set-item; tables, frontmatter and raw HTML are not text-editable here.',
  inputSchema: z.object({ path: pathField, block: blockField, text: z.string().describe('The new text for the block') }),
  execute: async ({ path: inputPath, block, text }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const b = blockAt(loaded, block)
    if (!b) return { ok: false, error: `${loaded.rel} has ${loaded.blocks.length} blocks — block ${block} does not exist.` }
    if (b.kind === 'list') return { ok: false, error: 'That block is a list — change one item with doc-set-item.' }
    if (b.kind === 'table' || b.kind === 'raw' || b.kind === 'frontmatter' || b.kind === 'hr') {
      return { ok: false, error: `A ${b.kind} block has no editable text here — it is shown as-is in the editor too.` }
    }
    const next = b.kind === 'code' && loaded.adapter.setCode
      ? loaded.adapter.setCode(loaded.source, b, { code: text })
      : loaded.adapter.setText(loaded.source, b, text)
    if (next === loaded.source && text !== b.text) {
      return { ok: false, error: `The ${loaded.adapter.label} adapter cannot set the text of a ${b.kind} block.` }
    }
    writeBack(loaded, next)
    return { ok: true, path: loaded.rel, block, kind: b.kind, previous: b.text, text }
  },
})

export const docSetItemTool = createTool({
  id: 'doc-set-item',
  description:
    'Change one item of a list block in a document (Markdown): its text, and optionally its task checkbox state (checked true/false) for task lists.',
  inputSchema: z.object({
    path: pathField,
    block: blockField,
    item: z.number().int().min(1).describe('1-based item number within the list block'),
    text: z.string().optional().describe('The new item text (omit to only toggle the checkbox)'),
    checked: z.boolean().optional().describe('For task lists: the checkbox state to set'),
  }),
  execute: async ({ path: inputPath, block, item, text, checked }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const b = blockAt(loaded, block)
    if (!b) return { ok: false, error: `${loaded.rel} has ${loaded.blocks.length} blocks — block ${block} does not exist.` }
    if (b.kind !== 'list' || !loaded.adapter.setItemText) {
      return { ok: false, error: `Block ${block} is a ${b.kind}, not a list the adapter can edit item by item.` }
    }
    const target = (b.items ?? [])[item - 1]
    if (!target) return { ok: false, error: `That list has ${(b.items ?? []).length} items — item ${item} does not exist.` }
    let next = loaded.source
    if (text !== undefined && text !== target.text) next = loaded.adapter.setItemText(next, b, item - 1, text)
    if (checked !== undefined && target.checked !== null && target.checked !== checked && loaded.adapter.toggleTask) {
      // Re-parse after a possible text splice so offsets are current.
      const reparsed = loaded.adapter.parse(next)
      const rb = reparsed[block - 1]
      if (rb) next = loaded.adapter.toggleTask(next, rb, item - 1)
    }
    if (next === loaded.source) return { ok: false, error: 'Nothing to change — the item already reads that way.' }
    writeBack(loaded, next)
    return { ok: true, path: loaded.rel, block, item, previous: target.text, text: text ?? target.text, checked: checked ?? target.checked }
  },
})

export const docSetStyleTool = createTool({
  id: 'doc-set-style',
  description:
    'Style one block of a document: font size (points), bold, alignment, or a Markdown heading level. The format decides what it can honestly represent — Markdown, for instance, has no alignment and its sizes ARE heading levels — and the tool refuses with the same reason the editor’s toolbar greys out, rather than faking it.',
  inputSchema: z.object({
    path: pathField,
    block: blockField,
    fontSizePt: z.number().optional().describe('Font size in points'),
    bold: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right', 'justify']).optional(),
    level: z.number().int().min(1).max(6).optional().describe('Heading level (Markdown headings)'),
  }),
  execute: async ({ path: inputPath, block, fontSizePt, bold, align, level }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const b = blockAt(loaded, block)
    if (!b) return { ok: false, error: `${loaded.rel} has ${loaded.blocks.length} blocks — block ${block} does not exist.` }
    const support = loaded.adapter.support(b)
    if (fontSizePt !== undefined && typeof support.fontSize === 'string') return { ok: false, error: support.fontSize }
    if (bold !== undefined && typeof support.fontWeight === 'string') return { ok: false, error: support.fontWeight }
    if (align !== undefined && typeof support.align === 'string') return { ok: false, error: support.align }
    if (level !== undefined && !loaded.adapter.setLevel) {
      return { ok: false, error: `${loaded.adapter.label} has no heading levels to set.` }
    }
    let next = loaded.source
    if (level !== undefined && loaded.adapter.setLevel) next = loaded.adapter.setLevel(next, b, level)
    const patch = {
      ...(fontSizePt !== undefined ? { fontSizePt } : {}),
      ...(bold !== undefined ? { bold } : {}),
      ...(align !== undefined ? { align } : {}),
    }
    if (Object.keys(patch).length > 0) {
      const reparsed = loaded.adapter.parse(next)
      const rb = reparsed[block - 1]
      if (rb) next = loaded.adapter.setStyle(next, rb, patch)
    }
    if (next === loaded.source) return { ok: false, error: 'That styling made no change to the file.' }
    writeBack(loaded, next)
    return { ok: true, path: loaded.rel, block, applied: { ...patch, ...(level !== undefined ? { level } : {}) } }
  },
})

export const docAddBlockTool = createTool({
  id: 'doc-add-block',
  description:
    'Append a new block (heading, paragraph or list) at the end of a document (Markdown or RTF), with the given text — for a list, the text becomes its first item. Headings can take a level (Markdown).',
  inputSchema: z.object({
    path: pathField,
    kind: z.enum(['heading', 'paragraph', 'list']),
    text: z.string().describe('The new block’s text (a list’s first item)'),
    level: z.number().int().min(1).max(6).optional().describe('Heading level, for kind "heading"'),
  }),
  execute: async ({ path: inputPath, kind, text, level }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    let next = loaded.adapter.appendBlock(loaded.source, kind)
    const blocks = loaded.adapter.parse(next)
    const last = blocks[blocks.length - 1]
    if (last) {
      if (kind === 'list' && loaded.adapter.setItemText && (last.items ?? []).length > 0) {
        next = loaded.adapter.setItemText(next, last, 0, text)
      } else {
        next = loaded.adapter.setText(next, last, text)
      }
      if (kind === 'heading' && level !== undefined && loaded.adapter.setLevel) {
        const reparsed = loaded.adapter.parse(next)
        const rb = reparsed[reparsed.length - 1]
        if (rb) next = loaded.adapter.setLevel(next, rb, level)
      }
    }
    writeBack(loaded, next)
    return { ok: true, path: loaded.rel, block: blocks.length, kind, text }
  },
})

export const docRemoveBlockTool = createTool({
  id: 'doc-remove-block',
  description: 'Remove one block from a document (Markdown or RTF) by its 1-based block number. Only that block goes; the rest of the file keeps its shape.',
  inputSchema: z.object({ path: pathField, block: blockField }),
  execute: async ({ path: inputPath, block }) => {
    const loaded = loadDoc(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const b = blockAt(loaded, block)
    if (!b) return { ok: false, error: `${loaded.rel} has ${loaded.blocks.length} blocks — block ${block} does not exist.` }
    writeBack(loaded, loaded.adapter.deleteBlock(loaded.source, b))
    return { ok: true, path: loaded.rel, block, removedKind: b.kind, removedPreview: preview(b) }
  },
})
