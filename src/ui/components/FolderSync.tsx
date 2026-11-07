import { useState } from 'react'
import type { SyncStatus } from '../lib/folderSync'

/* Folder sync (Open-folder) UI: status bar + conflict resolution dialog.
 * Import-a-copy UI stays in FolderImport.tsx; this file is the Open button's
 * half. Every ambiguous change needs an explicit user choice — the dialog
 * never applies anything on its own. */

export interface ConflictItem {
  path: string
  kind: 'conflict' | 'diskDeleted' | 'serverDeleted'
}

export interface ConflictChoice {
  path: string
  side: 'disk' | 'server'
}

function kindLabel(kind: ConflictItem['kind']): string {
  if (kind === 'diskDeleted') return 'deleted on disk'
  if (kind === 'serverDeleted') return 'deleted in editor'
  return 'edited on both sides'
}

function diskLabel(kind: ConflictItem['kind']): string {
  if (kind === 'diskDeleted') return 'Delete in editor too'
  if (kind === 'serverDeleted') return 'Re-upload from disk'
  return 'Keep disk version'
}

function serverLabel(kind: ConflictItem['kind']): string {
  if (kind === 'diskDeleted') return 'Restore to disk'
  if (kind === 'serverDeleted') return 'Delete on disk too'
  return 'Keep editor version'
}

export function SyncStatusBar({ dirName, status, message, lastAt, onSyncNow, onDisconnect, onResume }: {
  dirName: string
  status: SyncStatus
  message: string
  lastAt: number | null
  onSyncNow: () => void
  onDisconnect: () => void
  onResume: () => void
}) {
  const dot = status === 'live' ? 'var(--green)' : 'var(--amber)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 'calc(12px * var(--ui-scale, 1))', color: '#ccc', background: 'var(--well)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span><b>Live sync</b> ↔ <span className="mono">{dirName}</span></span>
      <span style={{ color: '#888' }}>{message}{lastAt ? ` · ${new Date(lastAt).toLocaleTimeString()}` : ''}</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {status === 'paused' && (
          <button className="deck-btn" onClick={onResume} title="Re-grant folder permission and resume syncing">Resume</button>
        )}
        <button className="deck-btn" onClick={onSyncNow} title="Run a sync pass now">Sync now</button>
        <button className="deck-btn" onClick={onDisconnect} title="Stop syncing; the project stays as an ordinary copy">Disconnect</button>
      </span>
    </div>
  )
}

export function SyncConflictsDialog({ items, onResolve, onPostpone }: {
  items: ConflictItem[]
  onResolve: (choices: ConflictChoice[]) => void
  onPostpone: () => void
}) {
  const [choices, setChoices] = useState<Record<string, 'disk' | 'server'>>({})
  const allChosen = items.every(i => choices[i.path])
  function setAll(side: 'disk' | 'server') {
    setChoices(Object.fromEntries(items.map(i => [i.path, side])))
  }
  return (
    <div onClick={onPostpone} style={{ position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, maxWidth: 640, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        <b>Sync needs a decision ({items.length})</b>
        <p style={{ color: '#999', fontSize: 'calc(12px * var(--ui-scale, 1))', margin: '8px 0 12px' }}>
          These files changed on both sides, or were deleted on one side. Nothing syncs
          until every row has a choice — syncing stays paused meanwhile.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="deck-btn" onClick={() => setAll('disk')}>All disk</button>
          <button className="deck-btn" onClick={() => setAll('server')}>All editor</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {items.map(item => (
            <div key={item.path} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 'calc(12px * var(--ui-scale, 1))' }}>
              <div className="mono" style={{ marginBottom: 2 }}>{item.path}</div>
              <div style={{ color: 'var(--amber)', fontSize: 'calc(11px * var(--ui-scale, 1))', marginBottom: 6 }}>{kindLabel(item.kind)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="deck-btn"
                  style={choices[item.path] === 'disk' ? { borderColor: 'var(--green)' } : undefined}
                  onClick={() => setChoices(prev => ({ ...prev, [item.path]: 'disk' }))}
                >
                  {diskLabel(item.kind)}
                </button>
                <button
                  className="deck-btn"
                  style={choices[item.path] === 'server' ? { borderColor: 'var(--green)' } : undefined}
                  onClick={() => setChoices(prev => ({ ...prev, [item.path]: 'server' }))}
                >
                  {serverLabel(item.kind)}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="deck-btn" onClick={onPostpone}>Decide later</button>
          <button
            className="deck-btn"
            disabled={!allChosen}
            title={allChosen ? 'Apply the choices above' : 'Choose a side for every row first'}
            onClick={() => onResolve(items.map(i => ({ path: i.path, side: choices[i.path] })))}
          >
            Apply choices
          </button>
        </div>
      </div>
    </div>
  )
}
