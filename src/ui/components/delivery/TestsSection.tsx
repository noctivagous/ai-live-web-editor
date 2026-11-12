import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getTestsOverview, runTestsApi,
  type StoredTestResultItem, type TestsOverviewItem,
} from '../../lib/api'
import { FacetCriteriaSection } from '../FacetCriteriaSection'
import { FixWithMusecodeButton } from '../FixWithMusecode'

/**
 * The Delivery facet's Tests section (Facets design §13.4):
 * the project's own suites — discovery, runs (all / file /
 * single test / failures only), results with failure output
 * in place, and the run history that makes flakiness
 * visible. The gate consumes these results as criteria
 * (§8.3, below); this section is the human surface, never a
 * second judge. A failing test offers the same headless
 * "Fix with Muse Code" dispatch failed criteria use.
 */

const row = (label: string, value: React.ReactNode) => (
  <div className="fs-row" key={label}><span>{label}</span><b>{value}</b></div>
)

export function TestsSection() {
  const [overview, setOverview] = useState<TestsOverviewItem | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [openFailure, setOpenFailure] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setOverview(await getTestsOverview()) } catch { setFailed(true) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const run = async (scope: 'all' | 'file' | 'single' | 'failures', file?: string, name?: string) => {
    setBusy(true)
    setNotes([])
    try {
      const r = await runTestsApi(scope, file, name)
      if (!r.ok) setNotes([r.error ?? 'The run failed.'])
      else setNotes(r.notes ?? [])
    } catch (e) {
      setNotes([e instanceof Error ? e.message : String(e)])
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const latestByKey = useMemo(() => {
    const map = new Map<string, StoredTestResultItem>()
    for (const r of overview?.latestRun?.results ?? []) map.set(r.key, r)
    return map
  }, [overview])

  if (failed) return <div className="ap-empty">The test state could not be read.</div>
  if (!overview) return <div className="ap-empty">Loading…</div>

  const { runners, suites, latestRun, flaky } = overview
  const flakySet = new Set(flaky)
  const totalTests = suites.reduce((n, s) => n + s.tests.length, 0)
  const latestFailures = (latestRun?.results ?? []).filter(r => r.status === 'fail')

  return (
    <>
      {row('Runners', runners.length ? runners.map(r => r.label).join(', ') : 'None detected in this project')}
      {row('Suites', suites.length ? `${suites.length} file${suites.length === 1 ? '' : 's'} · ${totalTests} test${totalTests === 1 ? '' : 's'}` : 'No test files found')}
      {row('Recorded runs', `${overview.runCount}`)}
      {latestRun
        ? row('Latest run', `${latestRun.scope.kind} · ${latestRun.runnerId} · ${new Date(latestRun.at).toLocaleString()} — ${latestRun.totals.pass} passed, ${latestRun.totals.fail} failed${latestRun.totals.skipped ? `, ${latestRun.totals.skipped} skipped` : ''}`)
        : row('Latest run', 'No run recorded yet')}
      {flaky.length > 0 && row('Flaky', `${flaky.length} test${flaky.length === 1 ? '' : 's'} have flipped between pass and fail recently`)}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wiz-btn" disabled={busy || !suites.length} onClick={() => void run('all')}>
          {busy ? 'Running…' : 'Run all tests'}
        </button>
        <button type="button" className="wiz-btn" disabled={busy || latestFailures.length === 0} onClick={() => void run('failures')}>
          Re-run failures ({latestFailures.length})
        </button>
        <button type="button" className="wiz-btn" disabled={busy} onClick={() => void refresh()}>Refresh</button>
      </div>
      {notes.map((n, i) => <div className="field-hint" key={i} style={{ marginTop: 6 }}>{n}</div>)}

      {suites.map(suite => (
        <div key={suite.file}>
          <div className="aa-group">{suite.file} · {suite.kind}</div>
          <div style={{ marginBottom: 4 }}>
            <button type="button" className="wiz-btn" disabled={busy} onClick={() => void run('file', suite.file)}>Run this file</button>
          </div>
          {suite.tests.length === 0 && <div className="field-hint">No test names could be read from this file.</div>}
          {suite.tests.map(t => {
            const last = latestByKey.get(t.key)
            const isFlaky = flakySet.has(t.key)
            return (
              <div key={t.key}>
                <div className="fs-row">
                  <span>
                    {last ? (last.status === 'pass' ? '✓ ' : last.status === 'fail' ? '✗ ' : '– ') : ''}{t.name}
                    {isFlaky ? ' · flaky' : ''}
                    {last?.durationMs !== undefined ? ` · ${last.durationMs}ms` : ''}
                  </span>
                  <b style={{ display: 'flex', gap: 6 }}>
                    {last?.status === 'fail' && last.failure && (
                      <button type="button" className="wiz-btn" onClick={() => setOpenFailure(openFailure === t.key ? null : t.key)}>
                        {openFailure === t.key ? 'Hide failure' : 'Show failure'}
                      </button>
                    )}
                    <button type="button" className="wiz-btn" disabled={busy} onClick={() => void run('single', t.file, t.name)}>Run</button>
                  </b>
                </div>
                {last?.status === 'fail' && openFailure === t.key && last.failure && (
                  <>
                    <pre className="dcard-pre plain" style={{ maxHeight: 240, overflow: 'auto' }}>{last.failure}</pre>
                    <FixWithMusecodeButton
                      title={`Fix the failing test "${t.name}" in ${t.file}`}
                      evidence={last.failure}
                      source="criteria"
                      label="Fix with Muse Code"
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      ))}

      <FacetCriteriaSection facet="delivery" />
    </>
  )
}
