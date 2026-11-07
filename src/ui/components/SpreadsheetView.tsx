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

  const wrap: React.CSSProperties = { flex: 1, overflow: 'auto', background: 'var(--panel)', padding: '16px 20px', minHeight: 0 }
  if (failed) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Could not read {path}.</div></div>
  if (rows === null) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Loading {path}…</div></div>
  if (rows.length === 0) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>This file is empty.</div></div>

  const cols = Math.max(...rows.map((r) => r.length))
  const shown = rows.slice(0, MAX_ROWS)
  const cell: React.CSSProperties = { border: '1px solid var(--border)', padding: '4px 8px', fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--text)', whiteSpace: 'pre-wrap', verticalAlign: 'top' }
  return (
    <div style={wrap}>
      <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--muted)', marginBottom: 10 }}>
        {rows.length} row{rows.length === 1 ? '' : 's'} × {cols} column{cols === 1 ? '' : 's'} — read-only for now; cell editing isn&rsquo;t built yet.
        {rows.length > MAX_ROWS ? ` Showing the first ${MAX_ROWS} rows.` : ''}
      </div>
      <table style={{ borderCollapse: 'collapse', background: 'var(--card)' }}>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              <td style={{ ...cell, color: 'var(--faint)', textAlign: 'right', userSelect: 'none' }}>{ri + 1}</td>
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
