/**
 * The CI section's last-seen summary cache (Facets design
 * §13.8): CI runs are provider truth — ALE keeps NO competing
 * history store. What it keeps, in <project>/.ai-live/
 * ci-summary.json beside the other delivery stores, is the
 * last summary it actually saw while connected: enough for
 * the brief, the ci-green criterion, and the Overview to say
 * something honest when the provider cannot be reached, and
 * to say "nothing recorded" when nothing ever was.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface CiRunSummary {
  /** The provider's run id, as a string. */
  id: string
  pipelineName: string
  /** The workflow definition file, when the provider names it. */
  workflowFile?: string
  /** queued | in_progress | completed | waiting | … (provider words). */
  status: string
  /** success | failure | cancelled | … — null until completed. */
  conclusion: string | null
  branch?: string
  /** The commit the run executed (full hash when known). */
  commit?: string
  event?: string
  createdAt: string
  updatedAt?: string
  durationMs?: number
  url?: string
}

export interface CiSummaryCache {
  /** ISO time this summary was written — its honesty stamp. */
  updatedAt: string
  /** The plugin id that produced it ('github-actions'). */
  provider: string
  connected: boolean
  accountLabel?: string
  /** Newest first, capped. */
  recentRuns: CiRunSummary[]
}

const MAX_RUNS = 20

export function ciSummaryPath(root: string): string {
  return path.join(root, '.ai-live', 'ci-summary.json')
}

export function readCiSummary(root: string): CiSummaryCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(ciSummaryPath(root), 'utf-8')) as CiSummaryCache
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.recentRuns)) return null
    return parsed
  } catch { return null }
}

export function writeCiSummary(root: string, cache: CiSummaryCache): CiSummaryCache {
  const trimmed: CiSummaryCache = { ...cache, recentRuns: cache.recentRuns.slice(0, MAX_RUNS) }
  const file = ciSummaryPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(trimmed, null, 2), 'utf-8')
  return trimmed
}

/** The newest recorded run that executed exactly this
 * commit — the ci-green criterion's whole question. Null
 * when no recorded run is for HEAD. */
export function latestCiRunOnCommit(root: string, commit: string | null | undefined): CiRunSummary | null {
  if (!commit) return null
  const cache = readCiSummary(root)
  if (!cache) return null
  return cache.recentRuns.find(r => r.commit === commit) ?? null
}

/** A run is green when it completed successfully. Anything
 * else — still running, failed, cancelled — is not green. */
export function ciRunGreen(run: CiRunSummary): boolean {
  return run.status === 'completed' && run.conclusion === 'success'
}
