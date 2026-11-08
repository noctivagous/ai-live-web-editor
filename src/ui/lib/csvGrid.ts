/**
 * CSV/TSV parsing for the spreadsheet surface (renderer registry):
 * enough of RFC 4180 to show a file as a grid — quoted fields with
 * embedded commas, quotes and newlines, CRLF or LF rows — and to
 * EDIT it in place: parseCsvGrid records every cell's exact token
 * range in the source (including its quotes), so a cell edit
 * serialises the new value and splices it into just that range,
 * the way the CSS boxes splice values. The file's other cells,
 * quoting style and line endings survive byte-identical.
 */
export interface CsvCell {
  /** The cell's text, unquoted and unescaped. */
  value: string
  /** Token range in the source, including surrounding quotes. */
  start: number
  end: number
  /** The token was quoted in the file (kept quoted on write). */
  quoted: boolean
}

export interface CsvGrid {
  delimiter: string
  rows: CsvCell[][]
}

export function parseCsvGrid(text: string, delimiter = ','): CsvGrid {
  const rows: CsvCell[][] = []
  let row: CsvCell[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false
  let quoted = false
  let tokenStart: number | null = null
  let tokenEnd = 0

  const endField = (at: number) => {
    row.push({ value: field, start: tokenStart ?? at, end: tokenStart === null ? at : tokenEnd, quoted })
    field = ''
    fieldStarted = false
    quoted = false
    tokenStart = null
    tokenEnd = 0
  }
  const endRow = (at: number) => { endField(at); rows.push(row); row = [] }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; tokenEnd = i + 1 } else { inQuotes = false; tokenEnd = i + 1 }
      } else { field += c; tokenEnd = i + 1 }
      continue
    }
    if (c === '"' && !fieldStarted && field === '') {
      inQuotes = true
      fieldStarted = true
      quoted = true
      if (tokenStart === null) tokenStart = i
      tokenEnd = i + 1
      continue
    }
    if (c === delimiter) { endField(i); continue }
    if (c === '\r') continue
    if (c === '\n') { endRow(i); continue }
    if (tokenStart === null) tokenStart = i
    field += c
    fieldStarted = true
    tokenEnd = i + 1
  }
  if (fieldStarted || field !== '' || row.length > 0) endRow(text.length)
  return { delimiter, rows }
}

export function parseCsv(text: string, delimiter = ','): string[][] {
  return parseCsvGrid(text, delimiter).rows.map((r) => r.map((c) => c.value))
}

export function delimiterForPath(path: string): string {
  return /\.tsv$/i.test(path) ? '\t' : ','
}

/** Tab-separated files parse with the same rules. */
export function parseDelimited(text: string, path: string): string[][] {
  return parseCsv(text, delimiterForPath(path))
}

export function parseDelimitedGrid(text: string, path: string): CsvGrid {
  return parseCsvGrid(text, delimiterForPath(path))
}

/** Serialise one cell value: quoted when the value needs it (or
 * when the cell was quoted in the file — its style is kept), with
 * embedded quotes doubled, per RFC 4180. */
export function serialiseCsvCell(delimiter: string, cell: CsvCell, text: string): string {
  const needsQuotes = text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')
  if (!cell.quoted && !needsQuotes) return text
  return `"${text.replaceAll('"', '""')}"`
}

/** Splice a new value for one cell into the source. */
export function replaceCsvCell(source: string, delimiter: string, cell: CsvCell, text: string): string {
  return source.slice(0, cell.start) + serialiseCsvCell(delimiter, cell, text) + source.slice(cell.end)
}
