/**
 * Self mode (phase-11-06 §L): the editor working on itself.
 * Active only with AI_LIVE_SELF=1, and only *in force* while the
 * active workspace is the editor's own repo — the flag alone
 * changes nothing for other projects.
 *
 * What lives here:
 * - the write-scope guard (writes confined to src/ui/** while
 *   the editor is the workspace; AI_LIVE_SELF_UNLOCK=1 lifts it,
 *   the slice-2 tier),
 * - pre-turn git snapshots of the tree (`git stash create`
 *   semantics: a commit object, no working-tree disturbance) and
 *   scope-limited revert from the recovery page,
 * - the post-turn self-checks (tsc + the test suite) whose
 *   latest result rides the workflow snapshot next to the SELF
 *   badge.
 *
 * Snapshot/check functions take an explicit root so they are
 * unit-testable against a throwaway repo; the public entry
 * points gate on the self workspace and delegate.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { EDITOR_ROOT, getFsRoot } from './launcher.js'

const run = promisify(execFile)

export function isSelfMode(): boolean {
  return process.env.AI_LIVE_SELF === '1'
}

export function isSelfUnlocked(): boolean {
  return process.env.AI_LIVE_SELF_UNLOCK === '1'
}

/** True when self mode is actually in force: flag on AND the editor repo is the workspace. */
export function isSelfWorkspace(root: string = getFsRoot()): boolean {
  return isSelfMode() && path.resolve(root) === EDITOR_ROOT
}

/** The only tree the agent may write in self mode v1 (repo-relative, forward slashes). */
export const SELF_SCOPE = 'src/ui'

export function scopeAllows(relPosix: string): boolean {
  return relPosix === SELF_SCOPE || relPosix.startsWith(SELF_SCOPE + '/')
}

/**
 * Guard for agent file writes, shaped like sketchWriteGuard:
 * null = allowed, { error } = blocked. Applies only while the
 * editor itself is the workspace.
 */
export function selfWriteGuard(absPath: string): { error: string } | null {
  if (!isSelfWorkspace() || isSelfUnlocked()) return null
  const rel = path.relative(EDITOR_ROOT, absPath).replace(/\\/g, '/')
  if (scopeAllows(rel)) return null
  return {
    error: `Self mode: the editor is the workspace and writes are confined to ${SELF_SCOPE}/ (got ${rel}). Server code is a locked tier in self mode v1 — the user can lift this with AI_LIVE_SELF_UNLOCK=1.`,
  }
}

// --- Snapshots -------------------------------------------------

export interface SelfSnapshot {
  hash: string
  at: number
  label: string
}

const MAX_SNAPSHOTS = 20

function snapshotFile(root: string): string {
  return path.join(root, '.ai-live', 'self-snapshots.json')
}

export function listSnapshotsAt(root: string): SelfSnapshot[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotFile(root), 'utf-8')) as { snapshots?: unknown }
    if (!Array.isArray(parsed.snapshots)) return []
    return parsed.snapshots.filter(
      (s): s is SelfSnapshot =>
        Boolean(s) && typeof s === 'object' &&
        typeof (s as SelfSnapshot).hash === 'string' && typeof (s as SelfSnapshot).at === 'number',
    )
  } catch {
    return []
  }
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: root, timeout: 30_000 })
  return stdout
}

/**
 * Snapshot the tree at `root`: `git stash create` captures
 * tracked changes (modifications + deletions) as a commit
 * object without touching the working tree or the index; a
 * clean tree snapshots as HEAD itself. Untracked files are not
 * in the commit — revert handles them by removal (below).
 */
export async function createSnapshotAt(root: string, label: string): Promise<SelfSnapshot> {
  const stash = (await git(root, ['stash', 'create'])).trim()
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim()
  const snap: SelfSnapshot = { hash: stash || head, at: Date.now(), label }
  const snapshots = [snap, ...listSnapshotsAt(root)].slice(0, MAX_SNAPSHOTS)
  fs.mkdirSync(path.dirname(snapshotFile(root)), { recursive: true })
  fs.writeFileSync(snapshotFile(root), JSON.stringify({ snapshots }, null, 2) + '\n', 'utf-8')
  return snap
}

/** Pre-turn snapshot, when self mode is in force. Never throws into a turn. */
export async function createSelfSnapshot(label: string): Promise<SelfSnapshot | null> {
  if (!isSelfWorkspace()) return null
  try {
    return await createSnapshotAt(EDITOR_ROOT, label)
  } catch {
    return null
  }
}

/** Directories inside the scope that are tooling, never agent output. */
const WALK_SKIP = new Set(['node_modules', '.vite'])

function walkRel(dir: string, base: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && WALK_SKIP.has(e.name)) continue
    const full = path.join(dir, e.name)
    const rel = path.relative(base, full).replace(/\\/g, '/')
    if (e.isDirectory()) walkRel(full, base, acc)
    else acc.push(rel)
  }
  return acc
}

/**
 * Revert the self scope (src/ui) at `root` to a recorded
 * snapshot: tracked files restored from the snapshot commit,
 * files the agent created inside the scope (not in the
 * snapshot's tree) removed. Nothing outside the scope moves.
 * Only hashes from the snapshot list are accepted.
 */
export async function revertSnapshotAt(
  root: string,
  hash: string,
): Promise<{ ok: true; removed: string[] } | { ok: false; error: string }> {
  if (!listSnapshotsAt(root).some(s => s.hash === hash)) {
    return { ok: false, error: 'Unknown snapshot hash' }
  }
  const inSnap = new Set(
    (await git(root, ['ls-tree', '-r', '--name-only', hash, '--', SELF_SCOPE]))
      .split('\n').map(s => s.trim()).filter(Boolean),
  )
  await git(root, ['checkout', hash, '--', SELF_SCOPE])
  const removed: string[] = []
  for (const rel of walkRel(path.join(root, SELF_SCOPE), root)) {
    if (!inSnap.has(rel)) {
      fs.rmSync(path.join(root, rel), { force: true })
      removed.push(rel)
    }
  }
  return { ok: true, removed }
}

export function revertSelfSnapshot(hash: string) {
  if (!isSelfWorkspace()) return Promise.resolve({ ok: false as const, error: 'Self workspace is not active' })
  return revertSnapshotAt(EDITOR_ROOT, hash)
}

// --- Post-turn self-checks --------------------------------------

export interface SelfCheckResult {
  at: number
  running: boolean
  tscOk?: boolean
  testsOk?: boolean
  testsSummary?: string
  tail?: string
}

let lastCheck: SelfCheckResult | null = null
let checking = false

export function getSelfCheck(): SelfCheckResult | null {
  return lastCheck
}

const CHECK_TAIL_CHARS = 3_000

async function runCheck(root: string, command: string): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await run('bash', ['-c', command], {
      cwd: root,
      timeout: 240_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { ok: true, out: `${stdout}\n${stderr}` }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}` }
  }
}

/**
 * Run tsc + the test suite against the editor repo and record
 * the outcome for the badge / recovery page. Fire-and-forget by
 * design: a turn never waits on it. No-ops outside the self
 * workspace or while a check is already running.
 */
export async function runSelfChecks(): Promise<void> {
  if (checking || !isSelfWorkspace()) return
  checking = true
  lastCheck = { at: Date.now(), running: true }
  try {
    const tsc = await runCheck(EDITOR_ROOT, 'npx tsc --noEmit')
    const tests = await runCheck(EDITOR_ROOT, 'npx tsx --test "src/**/*.test.ts"')
    const summary = tests.out.match(/(?:ℹ|#)\s*(?:tests|pass|fail)\b[^\n]*/g)?.slice(0, 4).join(' · ')
    const tailText = (!tsc.ok ? tsc.out : tests.out).slice(-CHECK_TAIL_CHARS)
    lastCheck = {
      at: Date.now(),
      running: false,
      tscOk: tsc.ok,
      testsOk: tests.ok,
      testsSummary: summary || undefined,
      tail: tailText.trim() || undefined,
    }
  } finally {
    checking = false
  }
}
