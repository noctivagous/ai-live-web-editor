import { useEffect, useState } from 'react'
import { fmtBytes, loadFolderHandle, repickFolder, type ImportBatchResult, type ImportProgress, type PickedFolder, type SkippedEntry } from '../lib/folderImport'

function Overlay({ onClose, children, wide }: {
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, maxWidth: wide ? 640 : 480, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

/* Over-max dialog: the picked folder exceeds the caps (default 50 MB /
 * 2000 files). Three honest choices — cancel, import the capped subset
 * (first N by path), or import everything anyway (slow, user's call). */
export function OverLimitDialog({ pick, maxBytes, maxFiles, withinCount, withinBytes, onChoice }: {
  pick: PickedFolder
  maxBytes: number
  maxFiles: number
  withinCount: number
  withinBytes: number
  onChoice: (c: 'cancel' | 'capped' | 'all') => void
}) {
  return (
    <Overlay onClose={() => onChoice('cancel')}>
      <b>Folder is over the import limit</b>
      <p style={{ color: '#ccc', fontSize: 'calc(13px * var(--ui-scale, 1))', margin: '10px 0' }}>
        <span className="mono">{pick.dirName}</span> holds{' '}
        <b>{pick.files.length} files · {fmtBytes(pick.totalBytes)}</b>,
        over the {fmtBytes(maxBytes)} / {maxFiles.toLocaleString()}-file default.
        Large imports are slow (files upload one batch at a time) and big
        folders make the agent slower too.
      </p>
      <p style={{ color: '#999', fontSize: 'calc(12px * var(--ui-scale, 1))', margin: '0 0 14px' }}>
        Within the limit: {withinCount} files · {fmtBytes(withinBytes)} (first by path).
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="deck-btn" onClick={() => onChoice('cancel')}>Cancel</button>
        <button className="deck-btn" onClick={() => onChoice('capped')} title="Import only the files that fit the limit">
          Import first {withinCount} files
        </button>
        <button className="deck-btn" onClick={() => onChoice('all')} title="Upload everything; may take a while" style={{ borderColor: 'var(--amber)', color: 'var(--amber-text)' }}>
          Import everything anyway
        </button>
      </div>
    </Overlay>
  )
}

export function ImportProgressDialog({ name, progress }: {
  name: string
  progress: ImportProgress
}) {
  const pct = progress.totalFiles === 0 ? 0 : Math.round((progress.sentFiles / progress.totalFiles) * 100)
  return (
    <Overlay onClose={() => { /* must not dismiss mid-upload */ }}>
      <b>Importing <span className="mono">{name}</span></b>
      <p style={{ color: '#ccc', fontSize: 'calc(13px * var(--ui-scale, 1))', margin: '10px 0 6px' }}>
        {progress.phase === 'installing' && progress.sentFiles >= progress.totalFiles
          ? 'Upload complete — installing dependencies and starting the project…'
          : <>Uploading file {progress.sentFiles} of {progress.totalFiles} · {fmtBytes(progress.sentBytes)} of {fmtBytes(progress.totalBytes)}</>}
      </p>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--blue)', transition: 'width 200ms' }} />
      </div>
    </Overlay>
  )
}

export function ImportReportDialog({ name, result, skipped, onClose, mode, syncDirName }: {
  name: string
  result: ImportBatchResult
  skipped: SkippedEntry[]
  onClose: () => void
  mode?: 'import' | 'sync'
  syncDirName?: string
}) {
  const failed = result.writeErrors || []
  const byReason = (r: SkippedEntry['reason']) => skipped.filter(s => s.reason === r)
  return (
    <Overlay wide onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <b>{mode === 'sync' ? <>Opened <span className="mono">{name}</span> — live sync on</> : <>Imported <span className="mono">{name}</span> — a copy, not a sync</>}</b>
        <button onClick={onClose} className="deck-btn" style={{ marginLeft: 'auto' }}>Close</button>
      </div>
      <div style={{ fontSize: 'calc(13px * var(--ui-scale, 1))', color: '#ccc', marginBottom: 10 }}>
        Copied <b>{result.received ?? 0} files</b>
        {skipped.length > 0 && <> · skipped {skipped.length}</>}
        {failed.length > 0 && <> · <span style={{ color: 'var(--red-text)' }}>{failed.length} failed</span></>}
        {result.installed
          ? <> · dependencies installed</>
          : result.installError
            ? <> · <span style={{ color: 'var(--red-text)' }}>install failed: {result.installError}</span></>
            : null}
      </div>
      <p style={{ color: '#999', fontSize: 'calc(12px * var(--ui-scale, 1))', margin: '0 0 10px' }}>
        {mode === 'sync'
          ? <>Two-way sync with <span className="mono">{syncDirName || 'your folder'}</span>: agent edits land in your folder, disk edits appear here. Binaries and deps/build output are not synced.</>
          : <>This is a one-time copy into <span className="mono">projects/{name}</span>. Later edits to the original folder do not sync back — use Re-import for a fresh copy, or Open for live sync.</>}
      </p>
      {skipped.length > 0 && (
        <details style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: '#999', marginBottom: 8 }}>
          <summary>Skipped ({skipped.length}): {byReason('skip-dir').length} in deps/VCS/build dirs
            {byReason('skip-binary').length > 0 && <>, {byReason('skip-binary').length} binaries</>}
            {byReason('skip-name').length > 0 && <>, {byReason('skip-name').length} OS junk</>}</summary>
          <pre style={{ maxHeight: 160, overflow: 'auto', color: '#777' }}>
            {skipped.slice(0, 100).map(s => `${s.path} (${s.reason})`).join('\n')}
            {skipped.length > 100 ? `\n… and ${skipped.length - 100} more` : ''}
          </pre>
        </details>
      )}
      {failed.length > 0 && (
        <details open style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--red-text)' }}>
          <summary>Failed writes ({failed.length})</summary>
          <pre style={{ maxHeight: 160, overflow: 'auto' }}>
            {failed.map(f => `${f.path}: ${f.error}`).join('\n')}
          </pre>
        </details>
      )}
    </Overlay>
  )
}

/** One-click re-import for projects that remember their folder handle. */
export function ReimportButton({ projectId, suppress, onPick }: {
  projectId: string
  suppress?: boolean
  onPick: (repick: () => Promise<Omit<PickedFolder, 'dirHandle'>>) => void
}) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let live = true
    setAvailable(false)
    if (!projectId) return
    void loadFolderHandle(projectId).then(h => { if (live) setAvailable(h !== null) })
    return () => { live = false }
  }, [projectId])
  if (suppress || !available) return null
  return (
    <button
      className="deck-btn"
      title="Refresh this project from its original folder (replaces contents)"
      onClick={() => onPick(async () => {
        const h = await loadFolderHandle(projectId)
        if (!h) throw new Error('Folder permission was revoked — use Open folder… to pick it again.')
        return repickFolder(h)
      })}
    >
      Re-import
    </button>
  )
}
