/**
 * The Delivery facet's Git backend (Facets design §13.3): the
 * open project's repository, read and acted on through the git
 * CLI. Every operation is scoped to the project root — git runs
 * with cwd = root, and reported paths are made project-relative
 * (when the project sits inside a larger repo, entries outside
 * the project are not the facet's business and are left out).
 *
 * Hard rules: checkpoints are ordinary commits visibly marked
 * with CHECKPOINT_PREFIX; nothing here rewrites history (no
 * amend, rebase, or reset surfaces exist in this module); push
 * happens only as the explicit action in gitActions — never as
 * a side effect of anything else.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const CHECKPOINT_PREFIX = 'ale-checkpoint:'

export function isCheckpointSubject(subject: string): boolean {
  return subject.startsWith(CHECKPOINT_PREFIX)
}

/** Run git in the project; null on any failure (not a repo,
 * git missing, nonzero exit). Probes use this; actions use
 * runGitOrThrow so the user sees git's own words. */
export async function gitOut(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 })
    return stdout
  } catch {
    return null
  }
}

export async function runGitOrThrow(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })
    return stdout
  } catch (e) {
    const err = e as { stderr?: string, message?: string }
    const detail = (err.stderr ?? '').trim()
    throw new Error(detail || err.message || `git ${args[0]} failed`)
  }
}

export async function isGitRepo(root: string): Promise<boolean> {
  const out = await gitOut(root, ['rev-parse', '--is-inside-work-tree'])
  return out?.trim() === 'true'
}

/** The repo's path prefix for this project ('' at the repo
 * root, 'sub/dir/' below it) — porcelain paths are repo-root
 * relative, the facet speaks project-relative. */
async function repoPrefix(root: string): Promise<string> {
  const out = await gitOut(root, ['rev-parse', '--show-prefix'])
  return out?.trim() ?? ''
}

function projectPath(prefix: string, repoPath: string): string | null {
  if (!prefix) return repoPath
  if (!repoPath.startsWith(prefix)) return null
  return repoPath.slice(prefix.length)
}

export interface GitFileChange {
  path: string
  /** Set on renames/copies: the path it came from. */
  origPath?: string
  /** Porcelain XY code for this entry (e.g. 'M.', '.M', 'A.'). */
  xy: string
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  head?: string
  upstream?: string
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: string[]
  clean: boolean
}

export const NOT_A_REPO: GitStatus = {
  isRepo: false, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], clean: true,
}

/** Parse `git status --porcelain=v2 --branch -z` output. */
export function parsePorcelainV2(out: string, prefix: string): GitStatus {
  const status: GitStatus = { isRepo: true, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], clean: false }
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const line = fields[i]
    if (!line) continue
    if (line.startsWith('# branch.oid ')) status.head = line.slice(13).trim()
    else if (line.startsWith('# branch.head ')) {
      const head = line.slice(14).trim()
      if (head !== '(detached from' && !head.startsWith('(detached')) status.branch = head
    } else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) { status.ahead = Number(m[1]); status.behind = Number(m[2]) }
    } else if (line.startsWith('? ')) {
      const p = projectPath(prefix, line.slice(2))
      if (p !== null) status.untracked.push(p)
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      let rawPath = parts[parts.length - 1]
      let origPath: string | undefined
      if (line.startsWith('2 ')) {
        // Rename in -z mode: the next NUL field is the source path.
        origPath = fields[i + 1]
        i++
      }
      const p = projectPath(prefix, rawPath)
      if (p === null) continue
      const change: GitFileChange = { path: p, xy, ...(origPath ? { origPath: projectPath(prefix, origPath) ?? origPath } : {}) }
      const [x, y] = [xy[0], xy[1]]
      if (x !== '.' && x !== '?') status.staged.push(change)
      if (y !== '.') status.unstaged.push(change)
      if (x === '?' ) status.untracked.push(p)
    }
  }
  status.clean = status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0
  return status
}

export async function gitStatus(root: string): Promise<GitStatus> {
  if (!(await isGitRepo(root))) return NOT_A_REPO
  const prefix = await repoPrefix(root)
  const out = await gitOut(root, ['status', '--porcelain=v2', '--branch', '-z'])
  if (out === null) return NOT_A_REPO
  return parsePorcelainV2(out, prefix)
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  author: string
  /** ISO date. */
  date: string
  subject: string
  /** Ref decorations (branch names, tags, HEAD). */
  refs: string
  checkpoint: boolean
}

const LOG_SEP = '\x1f'
const LOG_END = '\x1e'

export function parseGitLog(out: string): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  for (const rec of out.split(LOG_END)) {
    const t = rec.trim()
    if (!t) continue
    const [hash, shortHash, author, date, subject, refs] = t.split(LOG_SEP)
    entries.push({
      hash, shortHash, author, date, subject: subject ?? '',
      refs: (refs ?? '').trim(),
      checkpoint: isCheckpointSubject(subject ?? ''),
    })
  }
  return entries
}

export async function gitLog(root: string, limit = 60): Promise<GitLogEntry[]> {
  const out = await gitOut(root, [
    'log', `--format=%H${LOG_SEP}%h${LOG_SEP}%an${LOG_SEP}%aI${LOG_SEP}%s${LOG_SEP}%D${LOG_END}`,
    '-n', String(Math.max(1, Math.min(limit, 500))),
  ])
  return out === null ? [] : parseGitLog(out)
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
  upstream?: string
  hash: string
}

export async function gitBranches(root: string): Promise<GitBranch[]> {
  const out = await gitOut(root, ['branch', '--all', `--format=%(refname)${LOG_SEP}%(HEAD)${LOG_SEP}%(upstream:short)${LOG_SEP}%(objectname:short)`])
  if (out === null) return []
  const branches: GitBranch[] = []
  for (const line of out.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const [ref, head, upstream, hash] = t.split(LOG_SEP)
    if (ref.endsWith('/HEAD')) continue
    const remote = ref.startsWith('refs/remotes/')
    const name = ref.replace(/^refs\/(heads|remotes)\//, '')
    branches.push({
      name,
      current: head === '*',
      remote,
      ...(upstream ? { upstream } : {}),
      hash: hash ?? '',
    })
  }
  return branches
}

export interface GitWorktree {
  path: string
  head?: string
  branch?: string
  detached: boolean
  bare: boolean
  /** The worktree the open project itself lives in. */
  current: boolean
}

export async function gitWorktrees(root: string): Promise<GitWorktree[]> {
  const out = await gitOut(root, ['worktree', 'list', '--porcelain'])
  if (out === null) return []
  const top = await gitOut(root, ['rev-parse', '--show-toplevel'])
  const topPath = top?.trim()
  const worktrees: GitWorktree[] = []
  let cur: GitWorktree | null = null
  const flush = () => { if (cur) worktrees.push(cur); cur = null }
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      const p = line.slice(9).trim()
      cur = { path: p, detached: false, bare: false, current: topPath === p || path.resolve(root) === p }
    } else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5).trim().slice(0, 12)
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace('refs/heads/', '')
    else if (cur && line.startsWith('detached')) cur.detached = true
    else if (cur && line.startsWith('bare')) cur.bare = true
  }
  flush()
  return worktrees
}

/** Validate a project-relative path for diff/action endpoints:
 * no absolute paths, no escaping the project. */
export function safeProjectPath(root: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel)) return null
  const resolved = path.resolve(root, rel)
  const base = path.resolve(root)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null
  return rel.replace(/^\.\//, '')
}

/** Unified diff for one file — the staged (index) diff or the
 * worktree diff. Untracked files have no diff until staged. */
export async function gitDiff(root: string, rel: string, staged: boolean): Promise<string> {
  const args = ['diff', '--no-color', ...(staged ? ['--cached'] : []), '--', rel]
  return (await gitOut(root, args)) ?? ''
}

/* ── Actions (slice 3) ───────────────────────────────────────
 * Every action is explicit: nothing here runs as a side
 * effect of a read. No history rewriting — there is no amend,
 * rebase, or reset in this module, by design (§13.3). */

/** Run git with stdin fed and closed (hunk patches go to
 * `git apply` this way — execFile's options cannot carry an
 * input stream in this build, so the child is driven by hand). */
function gitInput(root: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git', args,
      { cwd: root, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((typeof stderr === 'string' ? stderr : '').trim() || err.message || `git ${args[0]} failed`))
        else resolve(stdout as string)
      },
    )
    child.stdin?.end(input)
  })
}

function validatedFiles(root: string, files: string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    const v = safeProjectPath(root, f)
    if (v === null) throw new Error(`"${f}" is not a path inside the project.`)
    out.push(v)
  }
  if (!out.length) throw new Error('No files were given.')
  return out
}

export async function stageFiles(root: string, files: string[]): Promise<void> {
  await runGitOrThrow(root, ['add', '--', ...validatedFiles(root, files)])
}

export async function unstageFiles(root: string, files: string[]): Promise<void> {
  await runGitOrThrow(root, ['restore', '--staged', '--', ...validatedFiles(root, files)])
}

/** Split a unified diff into its header and hunks. Hunk
 * indexes are positions in this list — the UI and the server
 * count the same way over the same diff text. */
export function splitDiffHunks(diff: string): { header: string, hunks: string[] } {
  const lines = diff.split('\n')
  const headerLines: string[] = []
  const hunks: string[] = []
  let cur: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      if (cur) hunks.push(cur.join('\n'))
      cur = [line]
    } else if (cur) cur.push(line)
    else headerLines.push(line)
  }
  if (cur) hunks.push(cur.join('\n'))
  return { header: headerLines.join('\n'), hunks }
}

export function buildHunkPatch(diff: string, indexes: number[]): string {
  const { header, hunks } = splitDiffHunks(diff)
  const chosen = indexes.filter(i => i >= 0 && i < hunks.length).sort((a, b) => a - b)
  if (!chosen.length) throw new Error('None of the chosen hunks exist in the current diff.')
  return `${header}\n${chosen.map(i => hunks[i]).join('\n')}\n`
}

/** Stage only the chosen hunks of a file's worktree diff. */
export async function stageHunks(root: string, file: string, indexes: number[]): Promise<void> {
  const rel = safeProjectPath(root, file)
  if (rel === null) throw new Error(`"${file}" is not a path inside the project.`)
  const patch = buildHunkPatch(await gitDiff(root, rel, false), indexes)
  await gitInput(root, ['apply', '--cached'], patch)
}

/** Unstage only the chosen hunks of a file's staged diff. */
export async function unstageHunks(root: string, file: string, indexes: number[]): Promise<void> {
  const rel = safeProjectPath(root, file)
  if (rel === null) throw new Error(`"${file}" is not a path inside the project.`)
  const patch = buildHunkPatch(await gitDiff(root, rel, true), indexes)
  await gitInput(root, ['apply', '--cached', '--reverse'], patch)
}

export async function commitStaged(root: string, message: string): Promise<{ hash: string }> {
  const msg = message.trim()
  if (!msg) throw new Error('A commit message is required.')
  await runGitOrThrow(root, ['commit', '-m', msg])
  const hash = (await gitOut(root, ['rev-parse', 'HEAD']))?.trim() ?? ''
  return { hash }
}

export async function createBranch(root: string, name: string): Promise<void> {
  const n = name.trim()
  if (!n) throw new Error('A branch name is required.')
  const check = await gitOut(root, ['check-ref-format', '--branch', n])
  if (check === null) throw new Error(`"${n}" is not a valid branch name.`)
  await runGitOrThrow(root, ['branch', n])
}

export async function switchBranch(root: string, name: string): Promise<void> {
  await runGitOrThrow(root, ['switch', name])
}

export async function fetchRemote(root: string): Promise<string> {
  return (await runGitOrThrow(root, ['fetch', '--prune'])).trim()
}

/** Fast-forward only: a diverged pull fails in plain words
 * rather than manufacturing a merge commit. */
export async function pullFfOnly(root: string): Promise<string> {
  return (await runGitOrThrow(root, ['pull', '--ff-only'])).trim()
}

export async function pushRemote(root: string): Promise<string> {
  const status = await gitStatus(root)
  if (status.upstream) return (await runGitOrThrow(root, ['push'])).trim()
  const remotes = (await gitOut(root, ['remote']))?.split('\n').map(s => s.trim()) ?? []
  if (status.branch && remotes.includes('origin')) {
    return (await runGitOrThrow(root, ['push', '-u', 'origin', status.branch])).trim()
  }
  throw new Error('No upstream branch is set and there is no "origin" remote to push to.')
}

/**
 * A draft commit message composed from the staged changes —
 * files and change kinds, in conventional summary shape. (The
 * design says agent-drafted; ALE has no one-shot model call —
 * only full agent turns — so the draft is composed from the
 * diff itself and lands in the field for the user to edit,
 * which is the part of the flow that matters.)
 */
export function draftCommitMessage(status: GitStatus): string {
  const parts: string[] = []
  const verbs: Record<string, string> = { A: 'add', M: 'update', D: 'delete', R: 'rename', C: 'copy', U: 'update' }
  const byVerb = new Map<string, string[]>()
  for (const c of status.staged) {
    const verb = verbs[c.xy[0]] ?? 'update'
    byVerb.set(verb, [...(byVerb.get(verb) ?? []), c.origPath ? `${c.origPath} → ${c.path}` : c.path])
  }
  for (const [verb, files] of byVerb) {
    parts.push(files.length <= 3 ? `${verb} ${files.join(', ')}` : `${verb} ${files.slice(0, 3).join(', ')} and ${files.length - 3} more`)
  }
  return parts.join('; ')
}
