/**
 * Structured-content tools as plain host functions (re-platform
 * slice 5, tool wave 4 — group B).
 *
 * The renderers arc's eighteen structured-editing tools —
 * spreadsheet (4), structured data (6) and document (8) — served
 * to the OpenCode plugin through one dispatch endpoint,
 * POST /api/data/tool (registered in both server.ts and apiApp.ts;
 * "data" because all three families edit a structured document
 * through the same cores).
 *
 * Each function below is its Mastra tool's execute body
 * (src/mastra/tools/spreadsheetTools.ts / dataTools.ts /
 * docTools.ts) transcribed with the wrapper removed — the same
 * loaders (renderer gating, binary refusal, size caps), the same
 * cores (csvGrid offset splices, the dataTree verb set through
 * each format's own serialiser rules, the textDoc adapters'
 * source-splice methods), and paths resolved against the active
 * fs root exactly as the Mastra bodies do, so results and
 * on-disk bytes match the Mastra path's exactly.
 */
import fs from 'node:fs'
import { withDispatchDebugLog } from '../chatDebug.js'
import { getFsRoot } from '../launcher.js'
import { resolveProjectPath } from '../projectPath.js'
import { delimiterForPath, parseCsvGrid, replaceCsvCell, serialiseCsvCell, type CsvGrid } from '../ui/lib/csvGrid.js'
import { profileForConfigPath } from '../ui/lib/configProfiles.js'
import {
  addDataValue, countDataNodes, dataFormatForPath, findDataNode, findInData,
  outlineData, parseDataTree, removeDataNode, setDataScalar,
  type DataFormat, type DataNode,
} from '../ui/lib/dataTree.js'
import { profileForJsonPath } from '../ui/lib/jsonProfiles.js'
import { rendererFor } from '../ui/lib/previewRender.js'
import { markdownAdapter, rtfAdapter, type DocBlock, type TextAdapter } from '../ui/lib/textDoc.js'

type Input = Record<string, any>

// ── spreadsheet (transcribed from spreadsheetTools.ts) ────────

const MAX_SPREADSHEET_CHARS = 2_500_000
const SAMPLE_ROWS = 20
const MAX_MATCHES = 50

type GridLoadResult = { ok: true; rel: string; full: string; source: string; grid: CsvGrid } | { ok: false; error: string }

function loadSpreadsheet(inputPath: string): GridLoadResult {
  const root = getFsRoot()
  const resolved = resolveProjectPath(root, inputPath)
  if (resolved.ok === false) return { ok: false, error: resolved.error }
  const { full, rel } = resolved
  if (rendererFor(rel) !== 'spreadsheet') {
    return { ok: false, error: `${rel} is not a spreadsheet file (.csv or .tsv) — the spreadsheet tools work only on those.` }
  }
  let buf: Buffer
  try {
    buf = fs.readFileSync(full)
  } catch {
    return { ok: false, error: `No such file: ${rel}` }
  }
  if (buf.includes(0)) return { ok: false, error: `${rel} looks binary — the spreadsheet tools handle text CSV/TSV only.` }
  const source = buf.toString('utf8')
  if (source.length > MAX_SPREADSHEET_CHARS) {
    return { ok: false, error: `${rel} is ${source.length} chars — over the ${MAX_SPREADSHEET_CHARS}-char spreadsheet limit.` }
  }
  return { ok: true, rel, full, source, grid: parseCsvGrid(source, delimiterForPath(rel)) }
}

async function spreadsheetInspect(input: Input) {
  const loaded = loadSpreadsheet(input?.path)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const { rel, grid } = loaded
  const columns = Math.max(0, ...grid.rows.map((r) => r.length))
  return {
    ok: true,
    path: rel,
    delimiter: grid.delimiter === '\t' ? 'tab' : 'comma',
    rows: grid.rows.length,
    columns,
    header: grid.rows[0]?.map((c) => c.value) ?? [],
    sample: grid.rows.slice(0, SAMPLE_ROWS).map((r) => r.map((c) => c.value)),
    sampleTruncated: grid.rows.length > SAMPLE_ROWS,
  }
}

async function spreadsheetFind(input: Input) {
  const { path: inputPath, query } = input ?? {}
  const loaded = loadSpreadsheet(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const { rel, grid } = loaded
  const needle = String(query).toLowerCase()
  const matches: { row: number; col: number; value: string }[] = []
  let total = 0
  grid.rows.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      if (cell.value.toLowerCase().includes(needle)) {
        total++
        if (matches.length < MAX_MATCHES) matches.push({ row: ri + 1, col: ci + 1, value: cell.value })
      }
    })
  })
  return { ok: true, path: rel, query, total, matches, truncated: total > matches.length }
}

async function spreadsheetSetCell(input: Input) {
  const { path: inputPath, row, col, value } = input ?? {}
  const loaded = loadSpreadsheet(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const { rel, full, source, grid } = loaded
  const targetRow = grid.rows[row - 1]
  if (!targetRow) return { ok: false, error: `${rel} has ${grid.rows.length} rows — row ${row} does not exist. Use spreadsheet-add-row to append.` }
  const cell = targetRow[col - 1]
  if (!cell) return { ok: false, error: `Row ${row} of ${rel} has ${targetRow.length} cells — column ${col} does not exist there.` }
  const next = replaceCsvCell(source, grid.delimiter, cell, value)
  fs.writeFileSync(full, next, 'utf8')
  return { ok: true, path: rel, row, col, previous: cell.value, value }
}

async function spreadsheetAddRow(input: Input) {
  const { path: inputPath, values } = input ?? {}
  const loaded = loadSpreadsheet(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const { rel, full, source, grid } = loaded
  const bare = { value: '', start: 0, end: 0, quoted: false }
  const line = (values as string[]).map((v) => serialiseCsvCell(grid.delimiter, bare, v)).join(grid.delimiter)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const sep = source === '' || source.endsWith('\n') ? '' : eol
  fs.writeFileSync(full, source + sep + line + eol, 'utf8')
  return { ok: true, path: rel, row: grid.rows.length + 1, values }
}

// ── structured data (transcribed from dataTools.ts) ───────────

const MAX_DATA_CHARS = 2_500_000

type DataLoadResult =
  | { ok: true; rel: string; full: string; source: string; format: DataFormat; root: DataNode }
  | { ok: false; error: string }

function loadData(inputPath: string): DataLoadResult {
  const root = getFsRoot()
  const resolved = resolveProjectPath(root, inputPath)
  if (resolved.ok === false) return { ok: false, error: resolved.error }
  const { full, rel } = resolved
  const format = dataFormatForPath(rel)
  if (!format) {
    return { ok: false, error: `${rel} is not a structured-data file the data tools cover (.json, .yaml, .yml, .toml, .env, .xml).` }
  }
  let buf: Buffer
  try {
    buf = fs.readFileSync(full)
  } catch {
    return { ok: false, error: `No such file: ${rel}` }
  }
  if (buf.includes(0)) return { ok: false, error: `${rel} looks binary — the data tools handle text files only.` }
  const source = buf.toString('utf8')
  if (source.length > MAX_DATA_CHARS) {
    return { ok: false, error: `${rel} is ${source.length} chars — over the ${MAX_DATA_CHARS}-char data limit.` }
  }
  const parsed = parseDataTree(format, source)
  if (parsed.ok === false) return { ok: false, error: `Could not parse ${rel}: ${parsed.error} Nothing was changed.` }
  return { ok: true, rel, full, source, format, root: parsed.root }
}

function profileTitle(rel: string, format: DataFormat): string {
  if (format === 'json') return profileForJsonPath(rel).title
  if (format === 'xml') return 'XML document'
  return profileForConfigPath(rel, format).title
}

async function dataInspect(input: Input) {
  const loaded = loadData(input?.path)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  return {
    ok: true,
    path: loaded.rel,
    format: loaded.format,
    profile: profileTitle(loaded.rel, loaded.format),
    nodes: countDataNodes(loaded.root),
    outline: outlineData(loaded.root, 3),
  }
}

async function dataGet(input: Input) {
  const { path: inputPath, address } = input ?? {}
  const loaded = loadData(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const node = findDataNode(loaded.root, address)
  if (!node) return { ok: false, error: `No value at "${address}" in ${loaded.rel}. Inspect the file to see its addresses.` }
  if (node.kind === 'scalar') return { ok: true, path: loaded.rel, address, kind: 'scalar', scalarKind: node.scalarKind, value: node.value }
  if (node.kind === 'raw') return { ok: true, path: loaded.rel, address, kind: 'raw', note: 'Not a plain value in this format — shown read-only in the form as well.', raw: node.raw }
  return { ok: true, path: loaded.rel, address, kind: node.kind, outline: outlineData(node, 3) }
}

async function dataSet(input: Input) {
  const { path: inputPath, address, value } = input ?? {}
  const loaded = loadData(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const node = findDataNode(loaded.root, address)
  if (!node) return { ok: false, error: `No value at "${address}" in ${loaded.rel}. Inspect the file to see its addresses.` }
  const set = setDataScalar(loaded.format, loaded.source, node, value)
  if (set.ok === false) return { ok: false, error: set.error }
  fs.writeFileSync(loaded.full, set.source, 'utf8')
  return { ok: true, path: loaded.rel, address, previous: node.value, value }
}

async function dataFind(input: Input) {
  const { path: inputPath, query } = input ?? {}
  const loaded = loadData(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const { matches, total } = findInData(loaded.root, query)
  return { ok: true, path: loaded.rel, query, total, matches, truncated: total > matches.length }
}

async function dataAdd(input: Input) {
  const { path: inputPath, parent, key, value, type } = input ?? {}
  const loaded = loadData(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const added = addDataValue(loaded.format, loaded.source, loaded.root, parent, key ?? null, value, type)
  if (added.ok === false) return { ok: false, error: added.error }
  fs.writeFileSync(loaded.full, added.source, 'utf8')
  return { ok: true, path: loaded.rel, parent, key: key ?? null, value }
}

async function dataRemove(input: Input) {
  const { path: inputPath, address } = input ?? {}
  const loaded = loadData(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const node = findDataNode(loaded.root, address)
  if (!node) return { ok: false, error: `No value at "${address}" in ${loaded.rel}. Inspect the file to see its addresses.` }
  const removed = removeDataNode(loaded.format, loaded.source, loaded.root, address)
  if (removed.ok === false) return { ok: false, error: removed.error }
  fs.writeFileSync(loaded.full, removed.source, 'utf8')
  return { ok: true, path: loaded.rel, address, removedKind: node.kind, removedValue: node.kind === 'scalar' ? node.value : undefined }
}

// ── documents (transcribed from docTools.ts) ──────────────────

const MAX_DOC_CHARS = 2_500_000
const OUTLINE_BLOCKS = 100
const MAX_DOC_MATCHES = 50

const ADAPTERS: Record<string, TextAdapter> = { markdown: markdownAdapter, richtext: rtfAdapter }

type DocLoadResult =
  | { ok: true; rel: string; full: string; source: string; adapter: TextAdapter; blocks: DocBlock[] }
  | { ok: false; error: string }

function loadDoc(inputPath: string): DocLoadResult {
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

function docPreview(block: DocBlock): string {
  const text = block.kind === 'list'
    ? (block.items ?? []).map((i) => i.text).join(' · ')
    : block.kind === 'table' || block.kind === 'raw' || block.kind === 'frontmatter'
      ? (block.raw ?? '')
      : block.text
  return text.replace(/\s+/g, ' ').slice(0, 90)
}

function blockAt(loaded: Extract<DocLoadResult, { ok: true }>, n: number): DocBlock | null {
  return loaded.blocks[n - 1] ?? null
}

function writeBack(loaded: Extract<DocLoadResult, { ok: true }>, next: string): void {
  fs.writeFileSync(loaded.full, next, 'utf8')
}

async function docInspect(input: Input) {
  const loaded = loadDoc(input?.path)
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
      preview: docPreview(b),
    })),
    outlineTruncated: loaded.blocks.length > OUTLINE_BLOCKS,
  }
}

async function docGet(input: Input) {
  const { path: inputPath, block } = input ?? {}
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
}

async function docFind(input: Input) {
  const { path: inputPath, query } = input ?? {}
  const loaded = loadDoc(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const needle = String(query).toLowerCase()
  const matches: { block: number; kind: string; preview: string }[] = []
  let total = 0
  loaded.blocks.forEach((b, i) => {
    if (docPreview(b).toLowerCase().includes(needle) || b.text.toLowerCase().includes(needle)) {
      total++
      if (matches.length < MAX_DOC_MATCHES) matches.push({ block: i + 1, kind: b.kind, preview: docPreview(b) })
    }
  })
  return { ok: true, path: loaded.rel, query, total, matches, truncated: total > matches.length }
}

async function docSetText(input: Input) {
  const { path: inputPath, block, text } = input ?? {}
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
}

async function docSetItem(input: Input) {
  const { path: inputPath, block, item, text, checked } = input ?? {}
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
}

async function docSetStyle(input: Input) {
  const { path: inputPath, block, fontSizePt, bold, align, level } = input ?? {}
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
}

async function docAddBlock(input: Input) {
  const { path: inputPath, kind, text, level } = input ?? {}
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
}

async function docRemoveBlock(input: Input) {
  const { path: inputPath, block } = input ?? {}
  const loaded = loadDoc(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const b = blockAt(loaded, block)
  if (!b) return { ok: false, error: `${loaded.rel} has ${loaded.blocks.length} blocks — block ${block} does not exist.` }
  writeBack(loaded, loaded.adapter.deleteBlock(loaded.source, b))
  return { ok: true, path: loaded.rel, block, removedKind: b.kind, removedPreview: docPreview(b) }
}

/** The wave-4 group-B structured-content tools by their
 * (Mastra-identical) names: spreadsheet (4), data (6), docs (8). */
export const CONTENT_TOOL_HANDLERS: Record<string, (input: Input) => Promise<unknown>> = {
  'spreadsheet-inspect': spreadsheetInspect,
  'spreadsheet-find': spreadsheetFind,
  'spreadsheet-set-cell': spreadsheetSetCell,
  'spreadsheet-add-row': spreadsheetAddRow,
  'data-inspect': dataInspect,
  'data-get': dataGet,
  'data-set': dataSet,
  'data-find': dataFind,
  'data-add': dataAdd,
  'data-remove': dataRemove,
  'doc-inspect': docInspect,
  'doc-get': docGet,
  'doc-find': docFind,
  'doc-set-text': docSetText,
  'doc-set-item': docSetItem,
  'doc-set-style': docSetStyle,
  'doc-add-block': docAddBlock,
  'doc-remove-block': docRemoveBlock,
}

export const CONTENT_TOOL_NAMES = Object.keys(CONTENT_TOOL_HANDLERS)

/** Run one structured-content tool by name; unknown names are an
 * error value, never a throw (the dispatch endpoint's contract). */
async function runContentToolImpl(name: string, input: Input): Promise<unknown> {
  const handler = CONTENT_TOOL_HANDLERS[name]
  if (!handler) {
    return { ok: false, error: `unknown data tool "${name}". Available: ${CONTENT_TOOL_NAMES.join(', ')}` }
  }
  return handler(input ?? {})
}

/** The exported dispatch: the impl above, plus its per-tool debug
 * record when chat debug is on (slice 9 — chatDebug.ts). */
export async function runContentTool(name: string, input: Input): Promise<unknown> {
  return withDispatchDebugLog(name, input, () => runContentToolImpl(name, input))
}
