/**
 * The Delivery facet's brief contribution (Facets design §13.6):
 * three lines — branch + dirty state; last test verdict; live
 * URL + last deploy. Each line is omitted honestly when its fact
 * is unknown (not a git repository, no recorded test run, no
 * recorded deployment) rather than padded with a placeholder.
 * This module only assembles; the facts live with their
 * backends. The brief is composed synchronously, so the git
 * line reads git directly here (a two-command status read);
 * the section and tools use git.ts's fuller machinery.
 */
import { execFileSync } from 'node:child_process'
import { getFsRoot } from '../launcher.js'
import { ciRunGreen, latestCiRunOnCommit } from './ciStore.js'
import { lastDeployment } from './deploy.js'
import { lastTestVerdict } from './testStore.js'

function gitOutSync(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 10_000 })
  } catch { return null }
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** "Git: branch main · 3 changed file(s)" — '' when not a repo. */
export function gitBriefLine(root: string): string {
  const out = gitOutSync(root, ['status', '--porcelain=v2', '--branch'])
  if (out === null) return ''
  let branch = ''
  let changed = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) { branch = line.slice('# branch.head '.length).trim(); continue }
    if (!line || line.startsWith('#')) continue
    // The user's dirt only: ALE's own .ai-live/ bookkeeping
    // (this facet's stores) is not uncommitted user work —
    // the same rule the Overview roll-up uses.
    const p = line.startsWith('? ') ? line.slice(2) : line.split('\t')[0].split(' ').pop() ?? ''
    if (p === '.ai-live/' || p.startsWith('.ai-live/')) continue
    changed++
  }
  const head = gitOutSync(root, ['rev-parse', '--short', 'HEAD'])?.trim()
  const where = branch && branch !== '(detached from HEAD)' ? `branch ${branch}` : `detached${head ? ` at ${head}` : ''}`
  return `Git: ${where} · ${changed === 0 ? 'clean tree' : `${changed} changed file${changed === 1 ? '' : 's'}`}`
}

/** "Tests: last full run green — 24 passed" — '' when no full run.
 * CI status folds into this line (§13.8: the brief keeps three
 * lines — CI is the same checks at the provider, so it rides
 * the checks line): when a CI run is recorded for HEAD, its
 * state is appended; when none is, nothing is claimed. */
export function testsBriefLine(root: string): string {
  const v = lastTestVerdict(root)
  if (!v) return ''
  const base = v.fail === 0
    ? `Tests: last full run green — ${v.pass} passed (${v.runnerId})`
    : `Tests: last full run has ${v.fail} failure${v.fail === 1 ? '' : 's'} of ${v.total} (${v.runnerId})`
  const head = gitOutSync(root, ['rev-parse', 'HEAD'])?.trim()
  const ciRun = latestCiRunOnCommit(root, head)
  if (!ciRun) return base
  const ciState = ciRunGreen(ciRun)
    ? 'CI green on HEAD'
    : ciRun.status === 'completed'
      ? `CI red on HEAD (${ciRun.conclusion ?? 'no conclusion'})`
      : `CI ${ciRun.status.replace('_', ' ')} on HEAD`
  return `${base} · ${ciState}`
}

/** "Live: https://… (deployed 2h ago from abc1234)" — '' when none. */
export function deployBriefLine(root: string): string {
  const d = lastDeployment(root)
  if (!d) return ''
  const when = ago(d.at)
  const commit = d.commit ? ` from ${d.commit.slice(0, 7)}` : ''
  return d.url
    ? `Live: ${d.url} (deployed ${when}${commit})`
    : `Last deploy: ${d.targetName} · ${d.kind} · ${d.state} ${when}${commit}`
}

/** The facet's brief lines for the project brief, in pipeline
 * order. Empty when nothing is known yet. */
export function deliveryBriefLines(root: string = getFsRoot()): string[] {
  const lines: string[] = []
  for (const line of [gitBriefLine(root), testsBriefLine(root), deployBriefLine(root)]) {
    if (line) lines.push(line)
  }
  return lines
}
