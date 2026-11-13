/**
 * The GitHub Actions CI plugin (Facets design §13.8): the
 * first CI provider, against GitHub's documented Actions
 * REST API — workflows, runs, jobs, logs, workflow_dispatch,
 * re-runs, cancel — through the delivery transports
 * (deployTransport), so every flow is exercised in tests
 * against fakes and no test touches a real account.
 *
 * Detection is the project's own shape: workflow files under
 * .github/workflows/ AND an origin remote that names a
 * GitHub repository. (Pipelines themselves are read from the
 * files by ci.ts whether or not this plugin detects the
 * project — definitions are code.)
 *
 * Credentials (§7.3): GITHUB_TOKEN (or GH_TOKEN) from the
 * editor's environment, sent only as an Authorization
 * header — never in a URL, argv, or returned data — or the
 * gh CLI's own stored auth, checked via `gh api user` (gh
 * holds its credential; ALE never sees it). The API base can
 * be overridden with ALE_GITHUB_API_BASE (GitHub Enterprise,
 * and the facet's own fake-server drives).
 *
 * Logs: one job's log is the depth v1 reads — the API serves
 * job logs as text; whole-run logs are a zip archive, which
 * the section does not unpack.
 */
import { execFileSync } from 'node:child_process'
import { gitStatus } from './git.js'
import { readPipelines, workflowFiles, type CiActionResult, type CiPlugin, type CiRunDetail, type CiRunSummary } from './ci.js'
import type { ConnectState } from './deploy.js'
import { httpJson, runCli, type HttpResult } from './deployTransport.js'

const HOW_TO_CONNECT = 'Set GITHUB_TOKEN in the editor\'s environment, or run `gh auth login` in a terminal.'
const API_VERSION = '2022-11-28'

export function githubApiBase(): string {
  return (process.env.ALE_GITHUB_API_BASE ?? 'https://api.github.com').replace(/\/$/, '')
}

function token(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined
}

/** owner/repo from a remote URL, in the shapes git records:
 * https://github.com/o/r(.git), git@github.com:o/r.git,
 * ssh://git@github.com/o/r.git. When ALE_GITHUB_API_BASE
 * overrides the API host, the operator has named the API
 * explicitly, so any host's owner/repo shape is accepted
 * for it; otherwise the host must be github.com. */
export function parseGitHubRemote(url: string, apiBase = githubApiBase()): { owner: string, repo: string } | null {
  const trimmed = url.trim()
  const m = /^[^@\s]+@([^:/\s]+):([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed)
    ?? /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed)
    ?? /^ssh:\/\/(?:[^@\s]+@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed)
  if (!m) return null
  if (m[1] !== 'github.com' && apiBase === 'https://api.github.com') return null
  return { owner: m[2], repo: m[3] }
}

function gitOutSync(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 10_000 })
  } catch { return null }
}

export function githubRepo(root: string): { owner: string, repo: string } | null {
  const url = gitOutSync(root, ['remote', 'get-url', 'origin'])
  return url ? parseGitHubRemote(url) : null
}

interface GhRun {
  id: number, name?: string, path?: string, status?: string, conclusion?: string | null,
  head_branch?: string, head_sha?: string, event?: string,
  created_at?: string, updated_at?: string, html_url?: string,
}

function mapRun(r: GhRun): CiRunSummary {
  const created = r.created_at ?? ''
  const updated = r.updated_at
  const durationMs = created && updated ? new Date(updated).getTime() - new Date(created).getTime() : NaN
  return {
    id: String(r.id),
    pipelineName: r.name ?? 'Workflow',
    ...(r.path ? { workflowFile: r.path } : {}),
    status: r.status ?? 'unknown',
    conclusion: r.conclusion ?? null,
    ...(r.head_branch ? { branch: r.head_branch } : {}),
    ...(r.head_sha ? { commit: r.head_sha } : {}),
    ...(r.event ? { event: r.event } : {}),
    createdAt: created,
    ...(updated ? { updatedAt: updated } : {}),
    ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
    ...(r.html_url ? { url: r.html_url } : {}),
  }
}

function apiError(r: HttpResult, what: string): string {
  const message = (r.json as { message?: string } | null)?.message
  return message ? `${what}: ${message}` : `${what}: GitHub answered ${r.status}.`
}

async function api(root: string, method: string, pathName: string, body?: unknown): Promise<HttpResult> {
  const slug = githubRepo(root)
  if (!slug) throw new Error('No GitHub repository could be read from this project\'s origin remote.')
  const t = token()
  return httpJson(`${githubApiBase()}/repos/${slug.owner}/${slug.repo}${pathName}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function connectState(root: string): Promise<ConnectState> {
  const t = token()
  if (t) {
    try {
      const r = await httpJson(`${githubApiBase()}/user`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
          Authorization: `Bearer ${t}`,
        },
      })
      const user = r.json as { login?: string, name?: string } | null
      if (r.status === 200 && user?.login) {
        return { connected: true, accountLabel: user.name ? `${user.login} (${user.name})` : user.login, howToConnect: HOW_TO_CONNECT }
      }
      if (r.status === 401) {
        return { connected: false, howToConnect: 'The GITHUB_TOKEN in the editor\'s environment was refused by GitHub (401). Replace it, or run `gh auth login`.' }
      }
    } catch { /* fall through to the gh session check */ }
  }
  // The gh CLI's stored auth: gh holds the credential, ALE
  // only learns the account's login from its answer.
  const gh = await runCli('gh', ['api', 'user'], root).catch(() => null)
  if (gh && gh.code === 0) {
    try {
      const user = JSON.parse(gh.stdout) as { login?: string }
      if (user.login) return { connected: true, accountLabel: user.login, howToConnect: HOW_TO_CONNECT }
    } catch { /* not a session answer */ }
  }
  return { connected: false, howToConnect: HOW_TO_CONNECT }
}

export const githubActionsPlugin: CiPlugin = {
  id: 'github-actions',
  label: 'GitHub Actions',
  detect: (root) => workflowFiles(root).length > 0 && githubRepo(root) !== null,
  connectState,
  pipelines: (root) => readPipelines(root, 'github-actions'),

  runs: async (root, limit) => {
    const r = await api(root, 'GET', `/actions/runs?per_page=${Math.max(1, Math.min(limit, 100))}`)
    if (r.status !== 200) throw new Error(apiError(r, 'Reading workflow runs failed'))
    const list = (r.json as { workflow_runs?: GhRun[] } | null)?.workflow_runs ?? []
    return list.map(mapRun)
  },

  runDetail: async (root, runId): Promise<CiRunDetail> => {
    const runRes = await api(root, 'GET', `/actions/runs/${encodeURIComponent(runId)}`)
    if (runRes.status !== 200) throw new Error(apiError(runRes, 'Reading the run failed'))
    const jobsRes = await api(root, 'GET', `/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`)
    if (jobsRes.status !== 200) throw new Error(apiError(jobsRes, 'Reading the run\'s jobs failed'))
    const jobs = (jobsRes.json as {
      jobs?: {
        id: number, name?: string, status?: string, conclusion?: string | null,
        started_at?: string, completed_at?: string,
        steps?: { number: number, name?: string, status?: string, conclusion?: string | null, started_at?: string, completed_at?: string }[],
      }[],
    } | null)?.jobs ?? []
    return {
      run: mapRun(runRes.json as GhRun),
      jobs: jobs.map(j => ({
        id: String(j.id),
        name: j.name ?? 'job',
        status: j.status ?? 'unknown',
        conclusion: j.conclusion ?? null,
        ...(j.started_at ? { startedAt: j.started_at } : {}),
        ...(j.completed_at ? { completedAt: j.completed_at } : {}),
        steps: (j.steps ?? []).map(s => ({
          number: s.number,
          name: s.name ?? `step ${s.number}`,
          status: s.status ?? 'unknown',
          conclusion: s.conclusion ?? null,
          ...(s.started_at ? { startedAt: s.started_at } : {}),
          ...(s.completed_at ? { completedAt: s.completed_at } : {}),
        })),
      })),
    }
  },

  jobLogs: async (root, jobId) => {
    const slug = githubRepo(root)
    if (!slug) throw new Error('No GitHub repository could be read from this project\'s origin remote.')
    const t = token()
    // The API answers with a redirect to a signed download
    // URL; fetch follows it, and the Authorization header is
    // not forwarded across origins — the token never reaches
    // the download host, and never appears in any URL here.
    const r = await httpJson(`${githubApiBase()}/repos/${slug.owner}/${slug.repo}/actions/jobs/${encodeURIComponent(jobId)}/logs`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    })
    if (r.status !== 200) throw new Error(apiError(r, 'Reading the job log failed'))
    return r.text.split('\n').filter(l => l.trim()).slice(-400)
  },

  trigger: async (root, pipeline, ref): Promise<CiActionResult> => {
    const status = await gitStatus(root).catch(() => null)
    const useRef = ref || status?.branch || 'main'
    const file = pipeline.file.split('/').pop() ?? pipeline.file
    const r = await api(root, 'POST', `/actions/workflows/${encodeURIComponent(file)}/dispatches`, { ref: useRef })
    return r.status === 204
      ? { ok: true }
      : { ok: false, error: apiError(r, `Triggering "${pipeline.name}" on ${useRef} failed`) }
  },

  rerun: async (root, runId, failedOnly): Promise<CiActionResult> => {
    const r = await api(root, 'POST', `/actions/runs/${encodeURIComponent(runId)}/${failedOnly ? 'rerun-failed-jobs' : 'rerun'}`)
    return r.status === 201 || r.status === 204 || r.status === 200
      ? { ok: true }
      : { ok: false, error: apiError(r, failedOnly ? 'Re-running the failed jobs failed' : 'Re-running the run failed') }
  },

  cancel: async (root, runId): Promise<CiActionResult> => {
    const r = await api(root, 'POST', `/actions/runs/${encodeURIComponent(runId)}/cancel`)
    return r.status === 202 || r.status === 200 || r.status === 204
      ? { ok: true }
      : { ok: false, error: apiError(r, 'Cancelling the run failed') }
  },

  secrets: async (root) => {
    // Names only — the API itself returns no values (§7.3).
    try {
      const r = await api(root, 'GET', '/actions/secrets?per_page=100')
      if (r.status !== 200) return []
      const list = (r.json as { secrets?: { name?: string }[] } | null)?.secrets ?? []
      return list.map(s => s.name).filter((n): n is string => typeof n === 'string')
    } catch { return [] }
  },
}
