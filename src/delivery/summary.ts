/**
 * The Delivery roll-up the Overview shows (§13.6): is the
 * tree clean, are the tests green, and is what's live the
 * commit at HEAD? Each fact is null when it cannot be known
 * (not a repo, no full run, nothing deployed) — the Overview
 * prints the unknown as unknown, never as a pass.
 */
import { lastDeployment } from './deploy.js'
import { gitStatus } from './git.js'
import { lastTestVerdict } from './testStore.js'

export interface DeliverySummary {
  git: { branch: string | null, changed: number, head: string | null } | null
  tests: { green: boolean, pass: number, fail: number, total: number, at: string } | null
  deploy: { targetName: string, url?: string, at: string, state: string } | null
  /** The commit the latest deployment shipped, when recorded. */
  deployedCommit: string | null
  /** deployedCommit === HEAD — null when either side is unknown. */
  upToDate: boolean | null
}

export async function deliverySummary(root: string): Promise<DeliverySummary> {
  const status = await gitStatus(root).catch(() => null)
  const verdict = lastTestVerdict(root)
  const deployment = lastDeployment(root)
  const head = status?.head ?? null
  const deployedCommit = deployment?.commit ?? null
  // The changed count is the USER's dirt: ALE's own .ai-live/
  // bookkeeping (this facet's stores live there) is not the
  // user's uncommitted work. The Git section still lists
  // every file, .ai-live included — nothing is hidden, the
  // roll-up just answers the ship question honestly.
  const userChanged = status?.isRepo
    ? [...status.staged.map(f => f.path), ...status.unstaged.map(f => f.path), ...status.untracked]
        .filter(p => p !== '.ai-live' && !p.startsWith('.ai-live/')).length
    : 0
  return {
    git: status?.isRepo
      ? { branch: status.branch ?? null, changed: userChanged, head }
      : null,
    tests: verdict ? { green: verdict.fail === 0, pass: verdict.pass, fail: verdict.fail, total: verdict.total, at: verdict.at } : null,
    deploy: deployment
      ? { targetName: deployment.targetName, ...(deployment.url ? { url: deployment.url } : {}), at: deployment.at, state: deployment.state }
      : null,
    deployedCommit,
    upToDate: head && deployedCommit ? head === deployedCommit : null,
  }
}
