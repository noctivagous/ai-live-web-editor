import React, { useEffect, useMemo, useState } from 'react'
import { readFile, writeFile } from '../lib/api'
import { parseDelimitedGrid, replaceCsvCell, type CsvCell } from '../lib/csvGrid'

const MAX_ROWS = 300

/**
 * Spreadsheet editor (renderer registry, `spreadsheet` surface):
 * a CSV/TSV file as an editable grid. Each cell is a field; a
 * commit serialises the new value and splices it into the cell's
 * exact token range in the file (lib/csvGrid) — the other cells,
 * the file's quoting and its line endings are untouched. Adding
 * or removing rows and columns is not in this slice.
 */
export function SpreadsheetView({ path, onSaved }: { path: string; onSaved: () => void }) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setSource(null)
    setFailed(false)
    setError(null)
    readFile(path)
      .then((data) => { if (live) setSource(typeof data?.content === 'string' ? data.content : '') })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [path])

  const grid = useMemo(() => (source === null ? null : parseDelimitedGrid(source, path)), [source, path])

  function commit(cell: CsvCell, text: string) {
    if (source === null || grid === null || text === cell.value) return
    const next = replaceCsvCell(source, grid.delimiter, cell, text)
    if (next === source) return
    setSource(next)
    setError(null)
    void (async () => {
      try {
        await writeFile(path, next)
        onSaved()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  const wrap: React.CSSProperties = { flex: 1, overflow: 'auto', background: 'var(--panel)', padding: '16px 20px', minHeight: 0 }
  if (failed) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Could not read {path}.</div></div>
  if (source === null || grid === null) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Loading {path}…</div></div>
  if (grid.rows.length === 0) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>This file is empty.</div></div>

  const cols = Math.max(...grid.rows.map((r) => r.length))
  const shown = grid.rows.slice(0, MAX_ROWS)
  const cellStyle: React.CSSProperties = { border: '1px solid var(--border)', padding: 0, fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--text)', verticalAlign: 'top' }
  const gutter: React.CSSProperties = { border: '1px solid var(--border)', padding: '4px 8px', fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--faint)', textAlign: 'right', userSelect: 'none' }

  return (
    <div style={wrap}>
      <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--muted)', marginBottom: 10 }}>
        {grid.rows.length} row{grid.rows.length === 1 ? '' : 's'} × {cols} column{cols === 1 ? '' : 's'} — editing a cell rewrites that cell in <span className="mono">{path}</span>.
        {grid.rows.length > MAX_ROWS ? ` Showing the first ${MAX_ROWS} rows; the rest of the file is not shown here.` : ''}
      </div>
      {error && <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--red-text)', marginBottom: 8 }}>{error}</div>}
      <table style={{ borderCollapse: 'collapse', background: 'var(--card)' }}>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              <td style={gutter}>{ri + 1}</td>
              {Array.from({ length: cols }, (_, ci) => {
                const cell = row[ci]
                return (
                  <td key={ci} style={cellStyle}>
                    {cell
                      ? <CellInput cell={cell} header={ri === 0} label={`Cell R${ri + 1}C${ci + 1}`} onCommit={commit} />
                      : <span style={{ display: 'block', padding: '4px 8px', color: 'var(--faint)' }}>·</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CellInput({ cell, header, label, onCommit }: {
  cell: CsvCell
  header: boolean
  label: string
  onCommit: (cell: CsvCell, text: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="text"
      value={draft ?? cell.value}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { onCommit(cell, draft); setDraft(null) } }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      style={{
        display: 'block', width: '100%', minWidth: 90, boxSizing: 'border-box',
        background: 'transparent', border: 'none', outline: 'none',
        padding: '4px 8px', fontSize: 'calc(12px * var(--ui-scale, 1))',
        color: 'var(--text)', fontFamily: 'inherit', whiteSpace: 'pre-wrap',
        fontWeight: header ? 600 : 400,
      }}
    />
  )
}
