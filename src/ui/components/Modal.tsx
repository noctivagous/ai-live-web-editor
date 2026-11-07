import React from 'react'

function Overlay({ onClose, children }: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141417', border: '1px solid #26262c', borderRadius: 12, padding: 18, maxWidth: 900, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

function Header({ title, onClose }: { title: string, onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
      <b>{title}</b>
      <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
    </div>
  )
}

export function NoticeDialog({ notice, onClose }: {
  notice: string | null
  onClose: () => void
}) {
  if (notice === null) return null
  return (
    <Overlay onClose={onClose}>
      <Header title="Inspect result" onClose={onClose} />
      <pre style={{ overflow: 'auto', fontSize: 12, color: '#ccc', margin: 0, fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}>{notice}</pre>
    </Overlay>
  )
}
