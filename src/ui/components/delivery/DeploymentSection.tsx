import { useCallback, useEffect, useState } from 'react'
import {
  getDeployLogs, getDeployStatus, getDeployTargets, runDeployActionApi,
  type DeploymentRecordItem, type DeployStatusItem, type DeployTargetViewItem,
} from '../../lib/api'

/**
 * The Delivery facet's Deployment section (Facets design
 * §13.5): the project's deployment targets with their connect
 * states in plain sight, deploy / promote / rollback actions
 * that exist only when a provider is actually connected (the
 * honest-absence pattern — a disconnected provider explains
 * how to connect instead of offering dead buttons), live
 * status on request, and the deployment history tied to the
 * commits that shipped. Env vars appear as names per
 * environment — values are never in this UI's reach (§7.3).
 */

const row = (label: string, value: React.ReactNode) => (
  <div className="fs-row" key={label}><span>{label}</span><b>{value}</b></div>
)

const shortCommit = (c?: string) => (c ? c.slice(0, 7) : '—')

export function DeploymentSection() {
  const [targets, setTargets] = useState<DeployTargetViewItem[] | null>(null)
  const [history, setHistory] = useState<DeploymentRecordItem[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [statuses, setStatuses] = useState<Record<string, DeployStatusItem>>({})
  const [logs, setLogs] = useState<{ targetId: string, lines: { at?: string, text: string }[] } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await getDeployTargets()
      setTargets(r.targets)
      setHistory(r.history)
    } catch { setFailed(true) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const act = async (action: 'deploy' | 'promote' | 'rollback', targetId: string, kind?: 'preview' | 'production', recordId?: string) => {
    setBusy(true)
    setNote('')
    try {
      const r = await runDeployActionApi(action, targetId, kind, recordId)
      setNote(r.ok ? 'Done — the outcome is in the history below.' : (r.error ?? 'The action failed.'))
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const loadStatus = async (targetId: string) => {
    try {
      const r = await getDeployStatus(targetId)
      if (r.status) setStatuses(s => ({ ...s, [targetId]: r.status! }))
      else setNote(r.error ?? 'Status could not be read.')
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
  }

  const loadLogs = async (targetId: string, recordId?: string) => {
    try {
      const r = await getDeployLogs(targetId, recordId)
      if (r.logs) setLogs({ targetId, lines: r.logs })
      else setNote(r.error ?? 'Logs could not be read.')
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
  }

  if (failed) return <div className="ap-empty">The deployment state could not be read.</div>
  if (!targets) return <div className="ap-empty">Loading…</div>

  return (
    <>
      {targets.length === 0 && (
        <div className="ap-empty">
          No deployment target was detected in this project. A <b>wrangler.toml</b> (Cloudflare Workers or Pages)
          or a <b>vercel.json</b> (Vercel) declares one — the Configuration facet recognises both files.
        </div>
      )}
      {note && <div className="field-hint" style={{ marginBottom: 6 }}>{note}</div>}

      {targets.map(({ target, pluginLabel, connect, lastDeployment }) => {
        const status = statuses[target.id]
        const envEntries = Object.entries(target.envNames).filter(([, v]) => v.length)
        const targetHistory = history.filter(h => h.targetId === target.id)
        return (
          <div key={target.id}>
            <div className="aa-group">{target.name} · {target.service} ({pluginLabel})</div>
            {row('Config', target.configFile)}
            {row('Connection', connect.connected
              ? `Connected${connect.accountLabel ? ` — ${connect.accountLabel}` : ''}`
              : 'Not connected')}
            {!connect.connected && <div className="field-hint">{connect.howToConnect}</div>}
            {envEntries.map(([env, names]) => row(`Env names (${env})`, names.join(', ')))}
            {lastDeployment
              ? row('Last deployment', `${lastDeployment.action} · ${lastDeployment.kind} · ${lastDeployment.state} · ${new Date(lastDeployment.at).toLocaleString()} · commit ${shortCommit(lastDeployment.commit)}`)
              : row('Last deployment', 'Nothing deployed from here yet')}
            {lastDeployment?.url && row('Live URL', <a href={lastDeployment.url} target="_blank" rel="noreferrer">{lastDeployment.url}</a>)}
            {status && row('Live status', status.note ?? `${status.url ?? '—'}${status.state ? ` · ${status.state}` : ''}${status.lastDeployAt ? ` · last deploy ${new Date(status.lastDeployAt).toLocaleString()}` : ''}`)}

            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" className="wiz-btn" disabled={busy || !connect.connected} onClick={() => void act('deploy', target.id, 'preview')}>Deploy preview</button>
              <button type="button" className="wiz-btn" disabled={busy || !connect.connected} onClick={() => void act('deploy', target.id, 'production')}>Deploy production</button>
              <button type="button" className="wiz-btn" disabled={busy} onClick={() => void loadStatus(target.id)}>Live status</button>
              <button type="button" className="wiz-btn" disabled={busy} onClick={() => void loadLogs(target.id, lastDeployment?.id)}>Logs</button>
            </div>
            {!connect.connected && <div className="field-hint">Deploy actions unlock when the provider is connected.</div>}

            {logs?.targetId === target.id && (
              <pre className="dcard-pre plain" style={{ maxHeight: 220, overflow: 'auto' }}>
                {logs.lines.map(l => `${l.at ? `${l.at} ` : ''}${l.text}`).join('\n')}
              </pre>
            )}

            {targetHistory.length > 0 && (
              <>
                <div className="aa-group">History — {target.name}</div>
                {targetHistory.map(h => (
                  <div className="fs-row" key={h.id}>
                    <span>
                      {new Date(h.at).toLocaleString()} · {h.action} · {h.kind} · {h.state} · commit {shortCommit(h.commit)}
                      {h.url ? <> · <a href={h.url} target="_blank" rel="noreferrer">{h.url}</a></> : null}
                    </span>
                    <b style={{ display: 'flex', gap: 6 }}>
                      {h.action === 'deploy' && h.kind === 'preview' && h.state === 'succeeded' && (
                        <button type="button" className="wiz-btn" disabled={busy || !connect.connected} onClick={() => void act('promote', target.id, undefined, h.id)}>Promote</button>
                      )}
                      <button type="button" className="wiz-btn" disabled={busy || !connect.connected} onClick={() => void act('rollback', target.id, undefined, h.id)}>Roll back</button>
                    </b>
                  </div>
                ))}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
