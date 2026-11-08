import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'node:fs'
import { getFsRoot } from '../../launcher.js'
import { resolveProjectPath } from '../../projectPath.js'
import { delimiterForPath, parseCsvGrid, replaceCsvCell, serialiseCsvCell, type CsvGrid } from '../../ui/lib/csvGrid.js'
import { rendererFor } from '../../ui/lib/previewRender.js'

/**
 * Spreadsheet tools: the agent's tool set for the spreadsheet
 * renderer. A renderer and its bases ship WITH the tools that let
 * the agent work in that format — and they run on the very same
 * library the human grid uses (src/ui/lib/csvGrid), so an agent
 * cell edit lands by the same offset splice, with the same
 * quoting rules, as a person typing in the grid. One
 * implementation, two callers; the behaviours cannot drift.
 *
 * Rows and columns in tool inputs are 1-based, the way the grid
 * shows them (the first row is usually the header).
 */

const MAX_SPREADSHEET_CHARS = 2_500_000
const SAMPLE_ROWS = 20
const MAX_MATCHES = 50

type LoadResult = { ok: true; rel: string; full: string; source: string; grid: CsvGrid } | { ok: false; error: string }

function loadSpreadsheet(inputPath: string): LoadResult {
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

export const spreadsheetInspectTool = createTool({
  id: 'spreadsheet-inspect',
  description:
    'Inspect a CSV/TSV file as a spreadsheet: row and column counts, the header row, and a sample of the first rows. Use this before reading or editing a spreadsheet — it is far cheaper than reading the raw file, and it tells you the shape your edits must fit.',
  inputSchema: z.object({
    path: z.string().describe('Project-relative path to the .csv or .tsv file, e.g. "/data/sales.csv"'),
  }),
  execute: async ({ path: inputPath }) => {
    const loaded = loadSpreadsheet(inputPath)
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
  },
})

export const spreadsheetFindTool = createTool({
  id: 'spreadsheet-find',
  description:
    'Find cells in a CSV/TSV file whose text contains a query (case-insensitive). Returns 1-based row/column coordinates and the matching values, so a follow-up spreadsheet-set-cell can target the exact cell.',
  inputSchema: z.object({
    path: z.string().describe('Project-relative path to the .csv or .tsv file'),
    query: z.string().describe('Text to look for inside cell values'),
  }),
  execute: async ({ path: inputPath, query }) => {
    const loaded = loadSpreadsheet(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const { rel, grid } = loaded
    const needle = query.toLowerCase()
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
  },
})

export const spreadsheetSetCellTool = createTool({
  id: 'spreadsheet-set-cell',
  description:
    'Set one cell of a CSV/TSV file (1-based row and column; row 1 is usually the header). The new value is spliced into exactly that cell — quoting is handled for you and every other cell, and the file’s line endings, stay byte-identical. To append data, use spreadsheet-add-row instead.',
  inputSchema: z.object({
    path: z.string().describe('Project-relative path to the .csv or .tsv file'),
    row: z.number().int().min(1).describe('1-based row number'),
    col: z.number().int().min(1).describe('1-based column number'),
    value: z.string().describe('The new cell text'),
  }),
  execute: async ({ path: inputPath, row, col, value }) => {
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
  },
})

export const spreadsheetAddRowTool = createTool({
  id: 'spreadsheet-add-row',
  description:
    'Append one row to the end of a CSV/TSV file. Values are serialised with the file’s delimiter and quoting rules, and the row lands on a fresh line (the file’s own line-ending style is kept). Returns the new row’s 1-based number.',
  inputSchema: z.object({
    path: z.string().describe('Project-relative path to the .csv or .tsv file'),
    values: z.array(z.string()).min(1).describe('The new row’s cell values, in column order'),
  }),
  execute: async ({ path: inputPath, values }) => {
    const loaded = loadSpreadsheet(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const { rel, full, source, grid } = loaded
    const bare = { value: '', start: 0, end: 0, quoted: false }
    const line = values.map((v) => serialiseCsvCell(grid.delimiter, bare, v)).join(grid.delimiter)
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    const sep = source === '' || source.endsWith('\n') ? '' : eol
    fs.writeFileSync(full, source + sep + line + eol, 'utf8')
    return { ok: true, path: rel, row: grid.rows.length + 1, values }
  },
})
