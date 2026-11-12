/**
 * The Tests section's runner registry (Facets design §13.4):
 * one entry per test runner, mirroring the configuration
 * recognizer pattern — detect, discover, run, parse — so a
 * new runner is one registry object, never surgery on the
 * section. node:test (JUnit reporter), Vitest and Jest (JSON
 * reporters), and pytest (JUnit) are the v1 entries.
 *
 * Discovery reads the project's files and names; kinds come
 * from where a test lives (e2e / integration path segments),
 * which is where projects declare them in practice.
 */
import fs from 'node:fs'
import path from 'node:path'
import { listProjectFiles } from '../launcher.js'
import { parseJunit } from './junit.js'

export type TestKind = 'unit' | 'integration' | 'e2e'

export interface DiscoveredTest {
  /** Stable key: file::name — history and flakiness key off it. */
  key: string
  file: string
  name: string
  kind: TestKind
}

export interface DiscoveredSuite {
  file: string
  kind: TestKind
  runnerId: string
  tests: DiscoveredTest[]
}

export type RunScope =
  | { kind: 'all' }
  | { kind: 'file', file: string }
  | { kind: 'single', file: string, name: string }
  | { kind: 'failures', keys: string[] }

export interface ParsedTestResult {
  file: string
  name: string
  status: 'pass' | 'fail' | 'skipped'
  durationMs?: number
  failure?: string
}

export interface RunnerCommand { cmd: string, args: string[], /** File the report lands in (then stdout is noise). */ reportFile?: string }

export interface TestRunnerDef {
  id: string
  label: string
  detect: (root: string) => boolean
  discover: (root: string) => DiscoveredSuite[]
  command: (root: string, scope: RunScope, files: string[]) => RunnerCommand | null
  parse: (root: string, stdout: string, reportText: string | null) => ParsedTestResult[]
}

/* ── shared helpers ──────────────────────────────────────── */

const JS_TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|mjs|cjs)$/
const PY_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/

export function kindOf(file: string): TestKind {
  if (/(^|\/)(e2e|e2e-tests)(\/|$)/.test(file) || /\.e2e\./.test(file)) return 'e2e'
  if (/(^|\/)(integration|integration-tests)(\/|$)/.test(file) || /\.integration\./.test(file)) return 'integration'
  return 'unit'
}

export function projectFiles(root: string): string[] {
  try {
    return listProjectFiles(root).map(e => e.path.replace(/^\//, '')).filter(f => !f.includes('node_modules'))
  } catch { return [] }
}

function readPkg(root: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as unknown
    return p && typeof p === 'object' ? p as Record<string, unknown> : null
  } catch { return null }
}

function depsOf(pkg: Record<string, unknown> | null): Record<string, unknown> {
  if (!pkg) return {}
  return {
    ...(pkg.dependencies as Record<string, unknown> ?? {}),
    ...(pkg.devDependencies as Record<string, unknown> ?? {}),
  }
}

/** Test names declared in a JS/TS test file, statically. */
export function scanJsTestNames(text: string): string[] {
  const names: string[] = []
  for (const m of text.matchAll(/(?:^|[^\w.])(?:it|test)\(\s*['"`]([^'"`]+)['"`]/g)) names.push(m[1])
  return names
}

/** Test names declared in a Python test file. */
export function scanPyTestNames(text: string): string[] {
  const names: string[] = []
  for (const m of text.matchAll(/^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/gm)) names.push(m[1])
  return names
}

function suitesFor(root: string, runnerId: string, files: string[], py: boolean): DiscoveredSuite[] {
  const suites: DiscoveredSuite[] = []
  for (const file of files) {
    let text = ''
    try { text = fs.readFileSync(path.join(root, file), 'utf-8').slice(0, 512 * 1024) } catch { continue }
    const names = py ? scanPyTestNames(text) : scanJsTestNames(text)
    const kind = kindOf(file)
    suites.push({
      file, kind, runnerId,
      tests: names.map(name => ({ key: `${file}::${name}`, file, name, kind })),
    })
  }
  return suites
}

function relFile(root: string, file: string): string {
  return path.isAbsolute(file) ? path.relative(root, file) : file
}

function scopeFiles(scope: RunScope, discovered: DiscoveredSuite[]): string[] {
  if (scope.kind === 'all') return discovered.map(s => s.file)
  if (scope.kind === 'file' || scope.kind === 'single') return discovered.some(s => s.file === scope.file) ? [scope.file] : []
  const files = new Set<string>()
  for (const key of scope.keys) {
    const file = key.split('::')[0]
    if (discovered.some(s => s.file === file)) files.add(file)
  }
  return [...files]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function namePattern(scope: RunScope): string | null {
  if (scope.kind === 'single') return escapeRegExp(scope.name)
  if (scope.kind === 'failures') {
    const names = scope.keys.map(k => k.split('::').slice(1).join('::'))
    return names.length ? names.map(escapeRegExp).join('|') : null
  }
  return null
}

/** Does this file import node:test? Such files belong to the
 * node:test runner even when another runner is also present. */
function importsNodeTest(root: string, file: string): boolean {
  try { return fs.readFileSync(path.join(root, file), 'utf-8').slice(0, 4096).includes('node:test') } catch { return false }
}

/* ── node:test ───────────────────────────────────────────── */

const nodeTestRunner: TestRunnerDef = {
  id: 'node-test',
  label: 'node:test',
  detect(root) {
    const files = projectFiles(root).filter(f => JS_TEST_FILE.test(f))
    if (!files.length) return false
    return files.slice(0, 24).some(f => {
      try { return fs.readFileSync(path.join(root, f), 'utf-8').slice(0, 4096).includes('node:test') } catch { return false }
    })
  },
  discover(root) {
    const files = projectFiles(root).filter(f => JS_TEST_FILE.test(f) && importsNodeTest(root, f))
    return suitesFor(root, 'node-test', files, false)
  },
  command(root, scope, files) {
    if (!files.length) return null
    const usesTs = files.some(f => /\.tsx?$/.test(f)) || 'tsx' in depsOf(readPkg(root))
    const args = ['--test', '--test-reporter=junit']
    const pattern = namePattern(scope)
    if (pattern) args.push(`--test-name-pattern=${pattern}`)
    args.push(...files)
    return usesTs ? { cmd: 'npx', args: ['tsx', ...args] } : { cmd: 'node', args }
  },
  parse(root, stdout) {
    return parseJunit(stdout).map(c => ({
      file: relFile(root, c.file ?? c.classname),
      name: c.name,
      status: c.skipped ? 'skipped' as const : c.failure ? 'fail' as const : 'pass' as const,
      durationMs: Math.round(c.timeSec * 1000),
      ...(c.failure ? { failure: c.failure } : {}),
    }))
  },
}

/* ── Vitest / Jest (JSON reporters) ──────────────────────── */

interface JsonAssertion { title?: string, fullName?: string, status?: string, duration?: number, failureMessages?: string[] }
interface JsonFileResult { name?: string, assertionResults?: JsonAssertion[] }

function parseRunnerJson(root: string, text: string): ParsedTestResult[] {
  let parsed: { testResults?: JsonFileResult[] } | null = null
  try { parsed = JSON.parse(text) as { testResults?: JsonFileResult[] } } catch {
    const start = text.indexOf('{')
    if (start >= 0) { try { parsed = JSON.parse(text.slice(start)) as { testResults?: JsonFileResult[] } } catch { parsed = null } }
  }
  if (!parsed?.testResults) return []
  const out: ParsedTestResult[] = []
  for (const fr of parsed.testResults) {
    const file = relFile(root, fr.name ?? '')
    for (const a of fr.assertionResults ?? []) {
      out.push({
        file,
        name: a.title ?? a.fullName ?? '',
        status: a.status === 'failed' ? 'fail' : a.status === 'passed' ? 'pass' : 'skipped',
        ...(typeof a.duration === 'number' ? { durationMs: Math.round(a.duration) } : {}),
        ...(a.failureMessages?.length ? { failure: a.failureMessages.join('\n').slice(0, 4000) } : {}),
      })
    }
  }
  return out
}

const vitestRunner: TestRunnerDef = {
  id: 'vitest',
  label: 'Vitest',
  detect(root) {
    const files = projectFiles(root)
    if (files.some(f => /(^|\/)vitest\.config\.[^/]+$/.test(f))) return true
    const pkg = readPkg(root)
    if (pkg && 'vitest' in depsOf(pkg)) return true
    const testScript = (pkg?.scripts as Record<string, unknown> | undefined)?.test
    return typeof testScript === 'string' && testScript.includes('vitest')
  },
  discover(root) {
    return suitesFor(root, 'vitest', projectFiles(root).filter(f => JS_TEST_FILE.test(f) && !importsNodeTest(root, f)), false)
  },
  command(root, scope, files) {
    if (!files.length) return null
    const reportFile = path.join(root, '.ai-live', 'vitest-report.json')
    const args = ['vitest', 'run', '--reporter=json', `--outputFile.json=${reportFile}`, ...files]
    const pattern = namePattern(scope)
    if (pattern) args.push('-t', pattern)
    return { cmd: 'npx', args, reportFile }
  },
  parse(root, _stdout, reportText) {
    return reportText ? parseRunnerJson(root, reportText) : []
  },
}

const jestRunner: TestRunnerDef = {
  id: 'jest',
  label: 'Jest',
  detect(root) {
    const files = projectFiles(root)
    if (files.some(f => /(^|\/)jest\.config\.[^/]+$/.test(f))) return true
    const pkg = readPkg(root)
    if (!pkg) return false
    return 'jest' in depsOf(pkg) || 'jest' in pkg || '@jest/core' in depsOf(pkg)
  },
  discover(root) {
    return suitesFor(root, 'jest', projectFiles(root).filter(f => JS_TEST_FILE.test(f) && !importsNodeTest(root, f)), false)
  },
  command(_root, scope, files) {
    if (!files.length) return null
    const args = ['jest', '--json', '--runTestsByPath', ...files]
    const pattern = namePattern(scope)
    if (pattern) args.push('-t', pattern)
    return { cmd: 'npx', args }
  },
  parse(root, stdout) {
    return parseRunnerJson(root, stdout)
  },
}

/* ── pytest ──────────────────────────────────────────────── */

const pytestRunner: TestRunnerDef = {
  id: 'pytest',
  label: 'pytest',
  detect(root) {
    const files = projectFiles(root)
    if (!files.some(f => PY_TEST_FILE.test(f))) return false
    return files.some(f => /(^|\/)(pytest\.ini|conftest\.py|pyproject\.toml|setup\.cfg|tox\.ini)$/.test(f))
      || files.some(f => PY_TEST_FILE.test(f))
  },
  discover(root) {
    return suitesFor(root, 'pytest', projectFiles(root).filter(f => PY_TEST_FILE.test(f)), true)
  },
  command(root, scope) {
    const reportFile = path.join(root, '.ai-live', 'pytest-report.xml')
    const args = ['-m', 'pytest', '-q', `--junitxml=${reportFile}`]
    if (scope.kind === 'file') args.push(scope.file)
    else if (scope.kind === 'single') args.push(`${scope.file}::${scope.name}`)
    else if (scope.kind === 'failures') {
      // A result key IS a pytest nodeid (file::test_name).
      if (!scope.keys.length) return null
      args.push(...scope.keys)
    }
    return { cmd: 'python3', args, reportFile }
  },
  parse(root, _stdout, reportText) {
    if (!reportText) return []
    return parseJunit(reportText).map(c => ({
      file: relFile(root, c.file ?? c.classname.replace(/\./g, '/') + '.py'),
      name: c.name,
      status: c.skipped ? 'skipped' as const : c.failure ? 'fail' as const : 'pass' as const,
      durationMs: Math.round(c.timeSec * 1000),
      ...(c.failure ? { failure: c.failure } : {}),
    }))
  },
}

export const TEST_RUNNERS: TestRunnerDef[] = [vitestRunner, jestRunner, nodeTestRunner, pytestRunner]

export function detectRunners(root: string): TestRunnerDef[] {
  return TEST_RUNNERS.filter(r => {
    try { return r.detect(root) } catch { return false }
  })
}

export function discoverTests(root: string, runners: TestRunnerDef[] = detectRunners(root)): DiscoveredSuite[] {
  const claimed = new Set<string>()
  const suites: DiscoveredSuite[] = []
  for (const runner of runners) {
    let found: DiscoveredSuite[] = []
    try { found = runner.discover(root) } catch { found = [] }
    for (const suite of found) {
      if (claimed.has(suite.file)) continue
      claimed.add(suite.file)
      suites.push(suite)
    }
  }
  return suites
}

export { scopeFiles }
