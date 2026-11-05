import React from 'react'

export function FileTree({ files, active, onSelect, onNew }: {
  files: string[], active: string, onSelect: (p: string) => void, onNew: () => void
}) {
  return (
    <div style={{ padding: 10, overflow: 'auto', flex: 1, minHeight: 0 }}>
      {files.map(f => (
        <div key={f} onClick={() => onSelect(f)}
          style={{
            padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
            background: f === active ? '#17171b' : 'transparent',
            border: f === active ? '1px solid #2a2a32' : '1px solid transparent',
            color: f === active ? '#fff' : '#b4b4b9',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginBottom: 2,
          }}>
          {f}
        </div>
      ))}
      {files.length === 0 && (
        <div style={{ fontSize: 12.5, color: '#71717a', padding: '8px 4px', lineHeight: 1.6 }}>
          No files yet. Check the launcher connection, then create your first file.
        </div>
      )}
      <button onClick={onNew} className="deck-btn" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>+ New File</button>
      <div style={{ marginTop: 14, fontSize: 11.5, color: '#71717a', lineHeight: '17px' }}>
        <b style={{ color: '#a1a1aa' }}>Fast loop:</b><br />
        write = fs.writeFileSync 1ms<br />
        patch = page.$eval 5ms<br />
        no screenshot tax
      </div>
    </div>
  )
}
