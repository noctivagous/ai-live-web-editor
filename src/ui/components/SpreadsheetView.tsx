import React, { useEffect, useState } from 'react'
import { readFile } from '../lib/api'
import { parseDelimited } from '../lib/csvGrid'

const MAX_ROWS = 300

/**
 * Spreadsheet stub (renderer registry): a CSV/TSV file shown as a
 * read-only grid. This is the slot the cell editor grows into — the
 * parser keeps cell text verbatim so edits can later splice back
 * into the file's lines the way the CSS boxes splice values.
 */
export function SpreadsheetView({ path }: { path: string }) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setRows(null)
    setFailed(false)
    readFile(path)
      .then((data) => { if (live) setRows(parseDelimited(typeof data?.content === 'string' ? data.content : '', path)) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [path])

  const wrap: React.CSSProperties = { flex: 1, overflow: 'auto', background: '#141417', padding: '16px 20px', minHeight: 0 }
  if (failed) return <div style={wrap}><div style={{ color: '#a1a1aa', fontSize: 12.5 }}>Could not read {path}.</div></div>
  if (rows === null) return <div style={wrap}><div style={{ color: '#a1a1aa', fontSize: 12.5 }}>Loading {path}…</div></div>
  if (rows.length === 0) return <div style={wrap}><div style={{ color: '#a1a1aa', fontSize: 12.5 }}>This file is empty.</div></div>

  const cols = Math.max(...rows.map((r) => r.length))
  const shown = rows.slice(0, MAX_ROWS)
  const cell: React.CSSProperties = { border: '1px solid #26262c', padding: '4px 8px', fontSize: 12, color: '#d4d4d8', whiteSpace: 'pre-wrap', verticalAlign: 'top' }
  return (
    <div style={wrap}>
      <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 10 }}>
        {rows.length} row{rows.length === 1 ? '' : 's'} × {cols} column{cols === 1 ? '' : 's'} — read-only for now; cell editing isn&rsquo;t built yet.
        {rows.length > MAX_ROWS ? ` Showing the first ${MAX_ROWS} rows.` : ''}
      </div>
      <table style={{ borderCollapse: 'collapse', background: '#17171b' }}>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              <td style={{ ...cell, color: '#71717a', textAlign: 'right', userSelect: 'none' }}>{ri + 1}</td>
              {Array.from({ length: cols }, (_, ci) => (
                <td key={ci} style={cell}>{row[ci] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
