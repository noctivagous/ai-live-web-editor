import { useCallback, useEffect, useState } from 'react'
import {
  getCrossLinks, getDeliverySettings, getGitBranches, getGitDiff, getGitLog, getGitStatus, getGitWorktrees,
  gitCheckpoint, gitCommit, gitCreateBranch, gitDraftMessage, gitFetch, gitPull, gitPush,
  gitStage, gitStageHunks, gitSwitchBranch, gitUnstage, gitUnstageHunks, saveDeliverySettings,
  type CrossLinkItem, type DeliveryActionResult, type GitBranchItem, type GitLogEntryItem, type GitStatusItem, type GitWorktreeItem,
} from '../../lib/api'

/**
 * The Delivery facet's Git section (Facets design §13.3):
 * the open project's repository — status, per-file diffs,
 * staging (per file or per hunk), the commit flow with a
 * drafted message the user edits, branches and worktrees,
 * fetch / pull / push, and checkpoints: marked commits that
 * tie agent work to an undo history. Push is a button, never
 * a side effect. Nothing here rewrites history.
 */

const row = (label: string, value: React.ReactNode) => (
  <div className="fs-row" key={label}><span>{label}</span><b>{value}</b></div>
)

interface DiffView { file: string, staged: boolean, text: string }

/** Split a unified diff into header + hunks, counting hunks
 * the same way the server does over the same text. */
function splitHunks(diff: string): { header: string, hunks: string[] } {
  const header: string[] = []
  const hunks: string[] = []
  let cur: string[] | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) {
      if (cur) hunks.push(cur.join('\n'))
      cur = [line]
    } else if (cur) cur.push(line)
    else header.push(line)
  }
  if (cur) hunks.push(cur.join('\n'))
  return { header: header.join('\n'), hunks }
}

export function GitSection() {
  const [status, setStatus] = useState<GitStatusItem | null>(null)
  const [entries, setEntries] = useState<GitLogEntryItem[]>([])
  const [branches, setBranches] = useState<GitBranchItem[]>([])
  const [worktrees, setWorktrees] = useState<GitWorktreeItem[]>([])
  const [diff, setDiff] = useState<DiffView | null>(null)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [switchTo, setSwitchTo] = useState('')
  const [agentCheckpoints, setAgentCheckpoints] = useState(false)
  const [prLinks, setPrLinks] = useState<CrossLinkItem[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [s, l, b, w, ds, xl] = await Promise.all([
        getGitStatus(), getGitLog(), getGitBranches(), getGitWorktrees(), getDeliverySettings().catch(() => null),
        getCrossLinks().catch(() => null),
      ])
      setStatus(s.status)
      setEntries(l.entries ?? [])
      setBranches(b.branches ?? [])
      setWorktrees(w.worktrees ?? [])
      if (ds) setAgentCheckpoints(ds.settings.agentCheckpoints)
      setPrLinks((xl?.links ?? []).filter(x => x.kind === 'implements'))
    } catch { setFailed(true) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const applyResult = async (r: DeliveryActionResult, okText: string) => {
    if (!r.ok) { setNote(r.error ?? 'The action failed.'); return }
    if (r.status) setStatus(r.status)
    setNote(r.output ? `${okText} ${r.output}` : okText)
    const l = await getGitLog().catch(() => null)
    if (l) setEntries(l.entries ?? [])
    const b = await getGitBranches().catch(() => null)
    if (b) setBranches(b.branches ?? [])
  }

  const act = async (fn: () => Promise<DeliveryActionResult>, okText: string) => {
    setBusy(true)
    setNote('')
    try { await applyResult(await fn(), okText) }
    catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const showDiff = async (file: string, staged: boolean) => {
    try {
      const r = await getGitDiff(file, staged)
      setDiff({ file, staged, text: r.diff ?? '' })
    } catch { setDiff({ file, staged, text: '' }) }
  }

  if (failed) return <div className="ap-empty">The repository state could not be read.</div>
  if (!status) return <div className="ap-empty">Loading…</div>
  if (!status.isRepo) {
    return <div className="field-hint">This project is not a git repository — there is no history to show and nothing to commit.</div>
  }

  const changedCount = status.staged.length + status.unstaged.length + status.untracked.length
  const localBranches = branches.filter(b => !b.remote)
  const diffParts = diff ? splitHunks(diff.text) : null

  const fileRow = (file: string, stagedGroup: boolean, label?: string) => (
    <div className="fs-pack" key={`${stagedGroup ? 's' : 'u'}-${file}`}>
      <span>{label ?? file}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="wiz-btn" disabled={busy} onClick={() => void showDiff(file, stagedGroup)}>Diff</button>
        {stagedGroup
          ? <button type="button" className="wiz-btn" disabled={busy} onClick={() => void act(() => gitUnstage([file]), `Unstaged ${file}.`)}>Unstage</button>
          : <button type="button" className="wiz-btn" disabled={busy} onClick={() => void act(() => gitStage([file]), `Staged ${file}.`)}>Stage</button>}
      </span>
    </div>
  )

  return (
    <>
      {row('Branch', status.branch ?? '(detached HEAD)')}
      {status.upstream && row('Upstream', `${status.upstream}${status.ahead ? ` · ${status.ahead} ahead` : ''}${status.behind ? ` · ${status.behind} behind` : ''}`)}
      {row('State', status.clean ? 'Clean — nothing to commit' : `${changedCount} changed file${changedCount === 1 ? '' : 's'} (${status.staged.length} staged, ${status.unstaged.length} unstaged, ${status.untracked.length} untracked)`)}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wiz-btn" disabled={busy} onClick={() => void refresh()}>Refresh</button>
        <button type="button" className="wiz-btn" disabled={busy} onClick={() => void act(gitFetch, 'Fetched.')}>Fetch</button>
        <button type="button" className="wiz-btn" disabled={busy} onClick={() => void act(gitPull, 'Pulled.')}>Pull (fast-forward only)</button>
        <button type="button" className="wiz-btn" disabled={busy} onClick={() => void act(gitPush, 'Pushed.')}>Push</button>
        <button
          type="button" className="wiz-btn" disabled={busy || status.clean}
          onClick={() => void act(async () => {
            const r = await gitCheckpoint()
            return r.checkpoint && !r.checkpoint.created
              ? { ...r, ok: false, error: `No checkpoint: ${r.checkpoint.reason ?? 'nothing to commit'}` }
              : r
          }, 'Checkpoint dropped.')}
        >
          Drop a checkpoint
        </button>
      </div>
      <label className="field-hint" style={{ display: 'block', marginTop: 6 }}>
        <input
          type="checkbox" checked={agentCheckpoints}
          onChange={e => {
            const on = e.target.checked
            setAgentCheckpoints(on)
            void saveDeliverySettings({ agentCheckpoints: on }).catch(() => {})
          }}
        />{' '}
        Let a verified chat turn drop a checkpoint on its own (off by default — automatic commits are yours to allow)
      </label>
      {note && <div className="field-hint" style={{ marginTop: 6 }}>{note}</div>}

      {status.staged.length > 0 && (
        <>
          <div className="aa-group">Staged</div>
          {status.staged.map(c => fileRow(c.path, true, c.origPath ? `${c.origPath} → ${c.path}` : c.path))}
        </>
      )}
      {status.unstaged.length > 0 && (
        <>
          <div className="aa-group">Unstaged</div>
          {status.unstaged.map(c => fileRow(c.path, false))}
        </>
      )}
      {status.untracked.length > 0 && (
        <>
          <div className="aa-group">Untracked</div>
          {status.untracked.map(f => fileRow(f, false))}
        </>
      )}

      {diff && diffParts && (
        <>
          <div className="aa-group">{diff.staged ? 'Staged diff' : 'Diff'} — {diff.file}</div>
          {!diff.text && <div className="field-hint">No diff — untracked files have no diff until they are staged.</div>}
          {diff.text && diffParts.hunks.length === 0 && <pre className="dcard-pre plain" style={{ maxHeight: 320, overflow: 'auto' }}>{diff.text}</pre>}
          {diffParts.hunks.map((hunk, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <pre className="dcard-pre plain" style={{ maxHeight: 240, overflow: 'auto', margin: 0 }}>{hunk}</pre>
              <button
                type="button" className="wiz-btn" disabled={busy}
                onClick={() => void act(
                  () => (diff.staged ? gitUnstageHunks(diff.file, [i]) : gitStageHunks(diff.file, [i])),
                  diff.staged ? 'Hunk unstaged.' : 'Hunk staged.',
                )}
              >
                {diff.staged ? 'Unstage this hunk' : 'Stage this hunk'}
              </button>
            </div>
          ))}
        </>
      )}

      <div className="aa-group">Commit</div>
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="Commit message"
        rows={3}
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          type="button" className="wiz-btn" disabled={busy || status.staged.length === 0}
          onClick={() => { void gitDraftMessage().then(r => { if (r.ok) setMessage(r.message) }).catch(() => {}) }}
        >
          Draft message from the staged changes
        </button>
        <button
          type="button" className="wiz-btn" disabled={busy || status.staged.length === 0 || !message.trim()}
          onClick={() => void act(async () => { const r = await gitCommit(message); if (r.ok) setMessage(''); return r }, 'Committed.')}
        >
          Commit {status.staged.length} staged file{status.staged.length === 1 ? '' : 's'}
        </button>
      </div>

      <div className="aa-group">Branches</div>
      {localBranches.map(b => row(
        b.current ? `● ${b.name}` : b.name,
        `${b.hash}${b.upstream ? ` → ${b.upstream}` : ''}`,
      ))}
      {branches.some(b => b.remote) && row('Remote branches', branches.filter(b => b.remote).map(b => b.name).join(', '))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <select value={switchTo} onChange={e => setSwitchTo(e.target.value)}>
          <option value="">Switch to…</option>
          {localBranches.filter(b => !b.current).map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
        </select>
        <button
          type="button" className="wiz-btn" disabled={busy || !switchTo}
          onClick={() => void act(() => gitSwitchBranch(switchTo), `Switched to ${switchTo}.`)}
        >
          Switch
        </button>
        <input
          value={newBranch} onChange={e => setNewBranch(e.target.value)}
          placeholder="New branch name"
        />
        <button
          type="button" className="wiz-btn" disabled={busy || !newBranch.trim()}
          onClick={() => void act(async () => { const r = await gitCreateBranch(newBranch.trim()); if (r.ok) setNewBranch(''); return r }, `Branch ${newBranch.trim()} created.`)}
        >
          Create branch
        </button>
      </div>

      <div className="aa-group">History</div>
      {entries.length === 0 && <div className="field-hint">No commits yet.</div>}
      {entries.slice(0, 30).map(e => (
        <div className="fs-row" key={e.hash}>
          <span>{e.shortHash} · {new Date(e.date).toLocaleDateString()} · {e.author}</span>
          <b>{e.checkpoint ? '⬢ ' : ''}{e.subject}{e.refs ? `  (${e.refs})` : ''}</b>
        </div>
      ))}

      {worktrees.length > 1 && (
        <>
          <div className="aa-group">Worktrees</div>
          {worktrees.map(w => row(
            w.current ? `● ${w.path}` : w.path,
            w.bare ? 'bare' : w.detached ? `detached at ${w.head ?? ''}` : (w.branch ?? ''),
          ))}
        </>
      )}

      {prLinks.length > 0 && (
        <>
          <div className="aa-group">Pull requests (cross-facet links)</div>
          {prLinks.map(l => row(
            `${l.from} implements ${l.to}`,
            l.resolved ? 'found in git history' : 'BROKEN — no matching PR reference in history, or the feature/plan is gone',
          ))}
        </>
      )}
    </>
  )
}
