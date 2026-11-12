/**
 * The run engine (Facets design §13.4): for each detected
 * runner, build the scope's command, execute it, parse the
 * structured report, and record the run. A failing test suite
 * exits nonzero — that is data, not an engine error; the
 * executor therefore resolves with the exit code and only a
 * spawn failure rejects.
 *
 * The executor is injectable (the dispatch module's precedent)
 * so the JSON/JUnit parsers are testable against canned
 * reports without every runner installed.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  detectRunners, discoverTests, scopeFiles,
  type ParsedTestResult, type RunScope, type TestRunnerDef,
} from './testRunners.js'
import { latestFailureKeys, makeRun, recordTestRun, type TestRun } from './testStore.js'

export interface ExecResult { stdout: string, stderr: string, exitCode: number }
export type TestExecutor = (cmd: string, args: string[], cwd: string) => Promise<ExecResult>

/** The environment a runner child runs in: the editor's own,
 * minus NODE_TEST_CONTEXT — a test suite that spawns its own
 * runner (exactly what this engine's tests do) would
 * otherwise inherit "report to my parent" and its structured
 * output would never reach stdout. */
function runnerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return env
}

const defaultExecutor: TestExecutor = (cmd, args, cwd) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd, env: runnerEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
    if (err && typeof (err as { code?: unknown }).code !== 'number' && !stdout) {
      // A spawn failure (runner missing) — the caller reports it.
      reject(err)
      return
    }
    resolve({
      stdout: stdout as string,
      stderr: stderr as string,
      exitCode: err ? Number((err as { code?: unknown }).code ?? 1) : 0,
    })
  })
})

let executor: TestExecutor = defaultExecutor
export function setTestExecutor(next: TestExecutor | null): void {
  executor = next ?? defaultExecutor
}

export interface RunOutcome {
  runs: TestRun[]
  /** Plain-words problems (no runner detected, runner missing…). */
  notes: string[]
}

export async function runTests(root: string, scope: RunScope): Promise<RunOutcome> {
  const runners = detectRunners(root)
  if (!runners.length) return { runs: [], notes: ['No test runner was detected in this project.'] }
  const effectiveScope: RunScope = scope.kind === 'failures'
    ? { kind: 'failures', keys: latestFailureKeys(root) }
    : scope
  if (effectiveScope.kind === 'failures' && !effectiveScope.keys.length) {
    return { runs: [], notes: ['No failures in the latest recorded run — nothing to re-run.'] }
  }
  const suites = discoverTests(root, runners)
  const runs: TestRun[] = []
  const notes: string[] = []
  for (const runner of runners) {
    const mine = suites.filter(s => s.runnerId === runner.id)
    if (!mine.length) continue
    const files = scopeFiles(effectiveScope, mine)
    if (!files.length) continue
    const command = runner.command(root, effectiveScope, files)
    if (!command) continue
    if (command.reportFile) {
      try { fs.mkdirSync(path.dirname(command.reportFile), { recursive: true }) } catch { /* the read below reports it */ }
    }
    let result: ExecResult
    try {
      result = await executor(command.cmd, command.args, root)
    } catch (e) {
      notes.push(`${runner.label}: could not run (${e instanceof Error ? e.message.split('\n')[0] : String(e)}). Is it installed?`)
      continue
    }
    let reportText: string | null = null
    if (command.reportFile) {
      try { reportText = fs.readFileSync(command.reportFile, 'utf-8') } catch { reportText = null }
      if (reportText === null) notes.push(`${runner.label}: the run produced no report file.`)
    }
    let parsed: ParsedTestResult[] = []
    try { parsed = runner.parse(root, result.stdout, reportText) } catch { parsed = [] }
    if (!parsed.length && result.exitCode !== 0 && !reportText) {
      notes.push(`${runner.label}: the run failed before reporting (${result.stderr.split('\n')[0] ?? 'no output'}).`)
      continue
    }
    runs.push(recordTestRun(root, makeRun(runner.id, effectiveScope, parsed)))
  }
  return { runs, notes }
}

/** Discovery + recorded state, the section's one read. */
export function testsOverview(root: string) {
  const runners = detectRunners(root)
  return {
    runners: runners.map((r: TestRunnerDef) => ({ id: r.id, label: r.label })),
    suites: discoverTests(root, runners),
  }
}
