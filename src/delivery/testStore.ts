/**
 * The Tests section's results store (Facets design §13.4):
 * every run is recorded in <project>/.ai-live/test-runs.json
 * (ALE state beside the gate's verdicts), newest first, kept
 * to the last 50. History is what makes flakiness visible: a
 * test whose recent results flip between pass and fail is
 * flagged flaky — a fact about the test, not just today.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ParsedTestResult, RunScope } from './testRunners.js'

export interface StoredTestResult extends ParsedTestResult {
  key: string
}

export interface TestRun {
  id: string
  /** ISO timestamp. */
  at: string
  runnerId: string
  scope: RunScope
  results: StoredTestResult[]
  totals: { pass: number, fail: number, skipped: number, total: number, durationMs: number }
}

export interface TestRunsFile { runs: TestRun[] }

const MAX_RUNS = 50

export function testRunsPath(root: string): string {
  return path.join(root, '.ai-live', 'test-runs.json')
}

export function readTestRuns(root: string): TestRunsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(testRunsPath(root), 'utf-8')) as TestRunsFile
    return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] }
  } catch { return { runs: [] } }
}

export function recordTestRun(root: string, run: TestRun): TestRun {
  const file = readTestRuns(root)
  file.runs.unshift(run)
  file.runs = file.runs.slice(0, MAX_RUNS)
  const target = testRunsPath(root)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(file, null, 2), 'utf-8')
  return run
}

export function makeRun(runnerId: string, scope: RunScope, results: ParsedTestResult[]): TestRun {
  const stored: StoredTestResult[] = results.map(r => ({ ...r, key: `${r.file}::${r.name}` }))
  const durationMs = stored.reduce((n, r) => n + (r.durationMs ?? 0), 0)
  return {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    runnerId,
    scope,
    results: stored,
    totals: {
      pass: stored.filter(r => r.status === 'pass').length,
      fail: stored.filter(r => r.status === 'fail').length,
      skipped: stored.filter(r => r.status === 'skipped').length,
      total: stored.length,
      durationMs,
    },
  }
}

export function latestRun(root: string): TestRun | null {
  return readTestRuns(root).runs[0] ?? null
}

/** The most recent run that can judge the whole project: a
 * full-scope run. A single-test run must not pose as the
 * project's verdict. */
export function latestFullRun(root: string): TestRun | null {
  return readTestRuns(root).runs.find(r => r.scope.kind === 'all') ?? null
}

export interface LastVerdict {
  at: string
  green: boolean
  pass: number
  fail: number
  total: number
  runnerId: string
}

/** The last full run's verdict, for the brief and the gate
 * criterion. Null when no full run has been recorded. */
export function lastTestVerdict(root: string): LastVerdict | null {
  const run = latestFullRun(root)
  if (!run) return null
  return {
    at: run.at,
    green: run.totals.fail === 0 && run.totals.total > 0,
    pass: run.totals.pass,
    fail: run.totals.fail,
    total: run.totals.total,
    runnerId: run.runnerId,
  }
}

/**
 * Flaky keys: within the last `window` runs that included the
 * test, its results contain both a pass and a fail. One flip
 * is enough to flag — the flag means "do not trust a single
 * red or green from this test", which is exactly the signal
 * the section exists to surface (§13.4).
 */
export function flakyTestKeys(root: string, window = 10): string[] {
  const { runs } = readTestRuns(root)
  const recent = runs.slice(0, window)
  const seen = new Map<string, Set<string>>()
  for (const run of recent) {
    for (const r of run.results) {
      if (r.status === 'skipped') continue
      const set = seen.get(r.key) ?? new Set<string>()
      set.add(r.status)
      seen.set(r.key, set)
    }
  }
  return [...seen.entries()].filter(([, s]) => s.has('pass') && s.has('fail')).map(([k]) => k)
}

/** Failing keys from the latest run — the failures-only scope. */
export function latestFailureKeys(root: string): string[] {
  const run = latestRun(root)
  if (!run) return []
  return run.results.filter(r => r.status === 'fail').map(r => r.key)
}
