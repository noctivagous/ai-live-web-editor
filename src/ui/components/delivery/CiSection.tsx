import { useCallback, useEffect, useState } from 'react'
import {
  addCiStarterApi, getCiJobLogs, getCiOverview, getCiRunDetail, runCiActionApi,
  type CiJobRunItem, type CiOverviewItem, type CiRunDetailItem, type CiRunSummaryItem,
} from '../../lib/api'
import { FixWithMusecodeButton } from '../FixWithMusecode'

/**
 * The Delivery facet's CI section (Facets design §13.8):
 * the pipelines the project's own files define — jobs and
 * steps, not raw YAML — and the runs the provider reports.
 * Definitions are always here (they are code); runs and
 * actions exist only when a provider is connected, and the
 * section says so plainly when none is (the honest-absence
 * pattern): with no connection it shows the last-seen
 * recorded summary and labels it as recorded, never as live.
 * A failed test step points at the Tests section; a failed
 * run offers the same headless-dispatch fix a failing local
 * test offers.
 */

const row = (label: string, value: React.ReactNode) => (
  <div className="fs-row" key={label}><span>{label}</span><b>{value}</b></div>
)

const shortCommit = (c?: string) => (c ? c.slice(0, 7) : '—')

function duration(ms?: number): string {
  if (ms === undefined) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function runGlyph(run: CiRunSummaryItem): string {
  if (run.status !== 'completed') return run.status === 'in_progress' ? '●' : '…'
  if (run.conclusion === 'success') return '✓'
  if (run.conclusion === 'failure') return '✗'
  return '–'
}

function runState(run: CiRunSummaryItem): string {
  return run.status === 'completed' ? (run.conclusion ?? 'completed') : run.status.replace('_', ' ')
}

/** A step that ran the project's tests, by its name — the
 * deep-link to the Tests section hangs off these. */
function looksLikeTests(name: string): boolean {
  return /test/i.test(name)
}

export function CiSection() {
  const [overview, setOverview] = useState<CiOverviewItem | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, CiRunDetailItem>>({})
  const [logs, setLogs] = useState<Record<string, string[]>>({})

  const refresh = useCallback(async () => {
    try {
      const r = await getCiOverview()
      setOverview(r.overview)
    } catch { setFailed(true) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (failed) return <div className="ap-empty">The CI state could not be read.</div>
  if (!overview) return <div className="ap-empty">Loading…</div>

  const { pipelines, providers, runs, runsSource, secretNames } = overview
  const detected = providers.filter(p => p.detected)
  const connected = detected.some(p => p.connect?.connected)
  const connectHint = detected.find(p => p.connect && !p.connect.connected)?.connect?.howToConnect

  const act = async (action: 'trigger' | 'rerun' | 'rerun-failed' | 'cancel', input: { pipelineId?: string, runId?: string }) => {
    setBusy(true)
    setNote('')
    try {
      const r = await runCiActionApi(action, input)
      setNote(r.ok ? 'Done — the runs above refresh from the provider.' : (r.error ?? 'The action failed.'))
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const toggleDetail = async (run: CiRunSummaryItem) => {
    if (openRun === run.id) { setOpenRun(null); return }
    setOpenRun(run.id)
    if (!details[run.id] && connected) {
      try {
        const r = await getCiRunDetail(run.id)
        if (r.detail) setDetails(d => ({ ...d, [run.id]: r.detail! }))
        else setNote(r.error ?? 'The run detail could not be read.')
      } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    }
  }

  const loadLogs = async (job: CiJobRunItem) => {
    try {
      const r = await getCiJobLogs(job.id)
      if (r.lines) setLogs(l => ({ ...l, [job.id]: r.lines! }))
      else setNote(r.error ?? 'The job log could not be read.')
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
  }

  const addStarter = async () => {
    setBusy(true)
    setNote('')
    try {
      const r = await addCiStarterApi()
      setNote(r.ok ? `Starter written to ${r.file} — it appears above as a pipeline, and the Configuration facet now recognises it.` : (r.error ?? 'The starter could not be written.'))
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const scrollToTests = () => {
    document.getElementById('delivery-tests')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const fixEvidence = (run: CiRunSummaryItem): string => {
    const detail = details[run.id]
    const failedBits = (detail?.jobs ?? [])
      .flatMap(j => j.steps.filter(s => s.conclusion === 'failure').map(s => `job "${j.name}", step "${s.name}"`))
    return [
      `CI run "${run.pipelineName}" failed${run.branch ? ` on branch ${run.branch}` : ''} at commit ${run.commit ?? 'unknown'}.`,
      failedBits.length ? `Failing steps: ${failedBits.join('; ')}.` : 'Open the run in the Delivery facet\'s CI section for the failing job and step.',
      run.url ? `Run: ${run.url}` : '',
    ].filter(Boolean).join(' ')
  }

  return (
    <>
      {providers.map(p => row(
        `Provider — ${p.label}`,
        !p.detected
          ? 'Not detected in this project'
          : p.connect?.connected
            ? `Connected${p.connect.accountLabel ? ` — ${p.connect.accountLabel}` : ''}`
            : 'Not connected',
      ))}
      {detected.length > 0 && !connected && connectHint && <div className="field-hint">{connectHint}</div>}
      {secretNames.length > 0 && row('Action secrets (names only)', secretNames.join(', '))}
      {note && <div className="field-hint" style={{ marginBottom: 6 }}>{note}</div>}

      <div className="aa-group">Pipelines — defined in this project's files</div>
      {pipelines.length === 0 && (
        <div className="ap-empty">
          No workflow definitions were found. A file under <b>.github/workflows/</b> (GitHub Actions)
          defines one — the Configuration facet recognises those files, and this section shows their runs.
          <div style={{ marginTop: 8 }}>
            <button type="button" className="wiz-btn" disabled={busy} onClick={() => void addStarter()}>
              Add a test-on-push starter workflow…
            </button>
          </div>
          <div className="field-hint" style={{ marginTop: 4 }}>
            Writes <b>.github/workflows/ci.yml</b> for the stack detected here. It is a plain
            project file afterwards — yours to edit or delete.
          </div>
        </div>
      )}
      {pipelines.map(p => (
        <div key={p.id}>
          <div className="fs-row">
            <span><b>{p.name}</b> · {p.file}</span>
            <b>
              {p.canDispatch && (
                <button
                  type="button" className="wiz-btn" disabled={busy || !connected}
                  title={connected ? `Trigger ${p.name} on the current branch` : 'Connect the provider to trigger runs'}
                  onClick={() => void act('trigger', { pipelineId: p.id })}
                >
                  Run now
                </button>
              )}
            </b>
          </div>
          {row('Runs on', p.triggers.length ? p.triggers.join(', ') : 'No triggers the reader could read')}
          {p.jobs.map(job => (
            <div key={job.id} style={{ marginLeft: 12 }}>
              <div className="fs-row">
                <span>{job.name ?? job.id}{job.needs.length ? ` · needs ${job.needs.join(', ')}` : ''}</span>
                <b>{job.steps.length} step{job.steps.length === 1 ? '' : 's'}</b>
              </div>
              {job.steps.map((s, i) => (
                <div className="fs-row" key={i} style={{ marginLeft: 14 }}>
                  <span>{s.name ?? s.uses ?? (s.run ? s.run.split('\n')[0] : 'step')}</span>
                  <b>{s.uses ? 'action' : s.run ? 'run' : ''}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {pipelines.some(p => p.canDispatch) && !connected && (
        <div className="field-hint">Triggering unlocks when the provider is connected.</div>
      )}

      <div className="aa-group">Recent runs</div>
      {runsSource === 'cache' && (
        <div className="field-hint">
          These runs are the last summary recorded while a provider was connected
          {overview.cachedAt ? ` (seen ${new Date(overview.cachedAt).toLocaleString()})` : ''} — not a live read.
        </div>
      )}
      {runsSource === 'none' && (
        <div className="ap-empty">
          No runs recorded yet. Connect the provider and runs appear here; until then there
          is nothing to show, and the section will not invent any.
        </div>
      )}
      {runs.map(run => {
        const detail = details[run.id]
        const isOpen = openRun === run.id
        const active = run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting'
        return (
          <div key={run.id}>
            <div className="fs-row">
              <span>
                {runGlyph(run)} <b>{run.pipelineName}</b> · {runState(run)}
                {run.branch ? ` · ${run.branch}` : ''} · commit {shortCommit(run.commit)}
                {run.event ? ` · ${run.event}` : ''} · {new Date(run.createdAt).toLocaleString()}
                {run.durationMs !== undefined ? ` · ${duration(run.durationMs)}` : ''}
                {run.url ? <> · <a href={run.url} target="_blank" rel="noreferrer">at the provider</a></> : null}
              </span>
              <b style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="wiz-btn" disabled={!connected} title={connected ? 'Jobs and steps' : 'Connect the provider to read run detail'} onClick={() => void toggleDetail(run)}>
                  {isOpen ? 'Hide detail' : 'Detail'}
                </button>
                {active && (
                  <button type="button" className="wiz-btn" disabled={busy || !connected} onClick={() => void act('cancel', { runId: run.id })}>Cancel</button>
                )}
                {!active && run.status === 'completed' && (
                  <button type="button" className="wiz-btn" disabled={busy || !connected} onClick={() => void act('rerun', { runId: run.id })}>Re-run</button>
                )}
                {run.conclusion === 'failure' && (
                  <button type="button" className="wiz-btn" disabled={busy || !connected} onClick={() => void act('rerun-failed', { runId: run.id })}>Re-run failed jobs</button>
                )}
              </b>
            </div>
            {run.conclusion === 'failure' && (
              <div style={{ marginLeft: 12, marginTop: 2 }}>
                <FixWithMusecodeButton
                  title={`Fix the failing CI run "${run.pipelineName}"`}
                  evidence={fixEvidence(run)}
                  source="manual"
                  label="Fix with Muse Code"
                />
              </div>
            )}
            {isOpen && !detail && (
              <div className="field-hint" style={{ marginLeft: 12 }}>Reading the run's jobs…</div>
            )}
            {isOpen && detail && detail.jobs.map(job => (
              <div key={job.id} style={{ marginLeft: 12 }}>
                <div className="fs-row">
                  <span>
                    {job.conclusion === 'failure' ? '✗' : job.conclusion === 'success' ? '✓' : '–'} <b>{job.name}</b>
                    {job.startedAt && job.completedAt ? ` · ${duration(new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime())}` : ''}
                  </span>
                  <b>
                    <button type="button" className="wiz-btn" onClick={() => void loadLogs(job)}>Job log</button>
                  </b>
                </div>
                {job.steps.map(step => (
                  <div key={step.number}>
                    <div className="fs-row" style={{ marginLeft: 14 }}>
                      <span>
                        {step.conclusion === 'failure' ? '✗' : step.conclusion === 'success' ? '✓' : step.status !== 'completed' ? '…' : '–'} {step.name}
                      </span>
                      <b style={{ display: 'flex', gap: 6 }}>
                        {step.conclusion === 'failure' && (looksLikeTests(step.name) || looksLikeTests(job.name)) && (
                          <button type="button" className="wiz-btn" onClick={scrollToTests}>Open the Tests section</button>
                        )}
                      </b>
                    </div>
                  </div>
                ))}
                {logs[job.id] && (
                  <pre className="dcard-pre plain" style={{ maxHeight: 220, overflow: 'auto', marginLeft: 14 }}>
                    {logs[job.id].join('\n')}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}
