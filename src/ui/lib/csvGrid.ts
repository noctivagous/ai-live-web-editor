/**
 * CSV/TSV parsing for the spreadsheet stub (renderer registry):
 * enough of RFC 4180 to show a file as a grid — quoted fields with
 * embedded commas, quotes and newlines, CRLF or LF rows. The grid is
 * read-only in the stub; parsing keeps every cell's text verbatim so
 * a later editing slice can splice edits back line by line, the way
 * the CSS boxes splice values.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false

  const endField = () => { row.push(field); field = ''; fieldStarted = false }
  const endRow = () => { endField(); rows.push(row); row = [] }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"' && !fieldStarted && field === '') { inQuotes = true; fieldStarted = true; continue }
    if (c === delimiter) { endField(); continue }
    if (c === '\r') continue
    if (c === '\n') { endRow(); continue }
    field += c
    fieldStarted = true
  }
  if (fieldStarted || field !== '' || row.length > 0) endRow()
  return rows
}

/** Tab-separated files parse with the same rules. */
export function parseDelimited(text: string, path: string): string[][] {
  return parseCsv(text, /\.tsv$/i.test(path) ? '\t' : ',')
}
