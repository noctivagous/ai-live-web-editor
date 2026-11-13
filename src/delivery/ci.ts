/**
 * The CI section's core (Facets design §13.8): the provider
 * plugin contract, the pipeline reader, the overview the
 * section renders, and the action service every door (UI,
 * MCP) goes through — the Deployment core's shape (§13.5),
 * applied to continuous integration.
 *
 * A CI plugin declares: detect (its definition files exist),
 * connect state (account connected or the honest absence),
 * pipelines (the defined workflows), runs, runDetail (jobs,
 * steps, logs), trigger / rerun / cancel. A new provider is
 * a new plugin, never surgery on the facet.
 *
 * Two boundary rules from §13.8, enforced here so every door
 * gets them:
 * - Definitions are code; runs are provider truth. Pipelines
 *   are read from the project's files and are available with
 *   no connection at all. Runs are read live from the
 *   provider while connected; otherwise the section serves
 *   the last-seen summary cache and says so. CI has no
 *   competing history store.
 * - Secrets (§7.3): a provider token lives in the process
 *   environment only — never in argv, a URL, a project file,
 *   or anything returned from here. Provider secrets are
 *   surfaced by NAME only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { listProjectFiles } from '../launcher.js'
import type { ConnectState } from './deploy.js'
import { parseWorkflow, type WorkflowJobDef } from './workflowYaml.js'
import {
  readCiSummary, writeCiSummary, type CiRunSummary, type CiSummaryCache,
} from './ciStore.js'

export type { CiRunSummary, CiSummaryCache }
export type { ConnectState }

export interface CiPipeline {
  /** `${pluginId}:${file}` — stable across reads. */
  id: string
  pluginId: string
  /** The workflow's declared name, or its file name. */
  name: string
  /** The definition file, relative to the project root. */
  file: string
  triggers: string[]
  /** Declares workflow_dispatch — triggerable by hand. */
  canDispatch: boolean
  jobs: WorkflowJobDef[]
}

export interface CiStepRun {
  number: number
  name: string
  status: string
  conclusion: string | null
  startedAt?: string
  completedAt?: string
}

export interface CiJobRun {
  id: string
  name: string
  status: string
  conclusion: string | null
  startedAt?: string
  completedAt?: string
  steps: CiStepRun[]
}

export interface CiRunDetail {
  run: CiRunSummary
  jobs: CiJobRun[]
}

export interface CiActionResult { ok: boolean, error?: string }

export interface CiPlugin {
  id: string
  label: string
  /** Its definition files exist in this project. */
  detect: (root: string) => boolean
  connectState: (root: string) => Promise<ConnectState>
  /** The defined pipelines, read from the project's files. */
  pipelines: (root: string) => CiPipeline[]
  /** Recent runs, newest first — live provider truth. */
  runs: (root: string, limit: number) => Promise<CiRunSummary[]>
  runDetail: (root: string, runId: string) => Promise<CiRunDetail>
  /** One job's log lines (capped by the implementation). */
  jobLogs: (root: string, jobId: string) => Promise<string[]>
  trigger: (root: string, pipeline: CiPipeline, ref?: string) => Promise<CiActionResult>
  rerun: (root: string, runId: string, failedOnly: boolean) => Promise<CiActionResult>
  cancel: (root: string, runId: string) => Promise<CiActionResult>
  /** Provider secret NAMES only (§7.3). Optional: a provider
   * that cannot list them omits the method, not the rule. */
  secrets?: (root: string) => Promise<string[]>
}

/* ── pipelines from definition files ─────────────────────── */

const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/

export function workflowFiles(root: string): string[] {
  return listProjectFiles(root)
    .map(e => e.path.replace(/^\//, ''))
    .filter(f => WORKFLOW_FILE.test(f))
    .sort()
}

/** The project's pipelines as its files define them — the
 * GitHub Actions layout in v1. Available with no provider
 * connection: definitions are code (§13.8). A file too
 * strange for the extractor still appears, with the
 * structure the extractor could read (possibly none). */
export function readPipelines(root: string, pluginId = 'github-actions'): CiPipeline[] {
  return workflowFiles(root).map(file => {
    let text = ''
    try { text = fs.readFileSync(path.join(root, file), 'utf-8') } catch { /* unreadable: the empty def stands */ }
    const def = parseWorkflow(text)
    return {
      id: `${pluginId}:${file}`,
      pluginId,
      name: def.name ?? path.basename(file).replace(/\.ya?ml$/, ''),
      file,
      triggers: def.triggers,
      canDispatch: def.canDispatch,
      jobs: def.jobs,
    }
  })
}

/* ── the overview ────────────────────────────────────────── */

export interface CiProviderView {
  pluginId: string
  label: string
  detected: boolean
  connect: ConnectState | null
}

export interface CiOverview {
  pipelines: CiPipeline[]
  providers: CiProviderView[]
  /** Live runs when a provider answered just now; otherwise
   * the summary cache's runs. */
  runs: CiRunSummary[]
  runsSource: 'live' | 'cache' | 'none'
  /** When runsSource is 'cache': when that summary was seen. */
  cachedAt?: string
  /** Secret names across connected providers (§7.3). */
  secretNames: string[]
}

export async function ciOverview(root: string, plugins: CiPlugin[], runLimit = 20): Promise<CiOverview> {
  const pipelines: CiPipeline[] = []
  const providers: CiProviderView[] = []
  const secretNames: string[] = []
  let liveRuns: CiRunSummary[] | null = null

  for (const plugin of plugins) {
    let detected = false
    try { detected = plugin.detect(root) } catch { detected = false }
    if (!detected) {
      providers.push({ pluginId: plugin.id, label: plugin.label, detected: false, connect: null })
      continue
    }
    for (const p of plugin.pipelines(root)) {
      if (!pipelines.some(x => x.file === p.file)) pipelines.push(p)
    }
    let connect: ConnectState
    try { connect = await plugin.connectState(root) } catch {
      connect = { connected: false, howToConnect: 'The provider could not be checked.' }
    }
    providers.push({ pluginId: plugin.id, label: plugin.label, detected, connect })
    if (!connect.connected) continue
    try {
      const runs = await plugin.runs(root, runLimit)
      liveRuns = runs
      writeCiSummary(root, {
        updatedAt: new Date().toISOString(),
        provider: plugin.id,
        connected: true,
        ...(connect.accountLabel ? { accountLabel: connect.accountLabel } : {}),
        recentRuns: runs,
      })
    } catch { /* live read failed: the cache below speaks */ }
    if (plugin.secrets) {
      try { secretNames.push(...await plugin.secrets(root)) } catch { /* names are a courtesy, not a promise */ }
    }
  }

  // Pipelines exist even when no plugin claims the project
  // (definition files with a non-GitHub remote, say): the
  // files are the project's, so the section shows them.
  if (!pipelines.length && workflowFiles(root).length) {
    pipelines.push(...readPipelines(root))
  }

  if (liveRuns) return { pipelines, providers, runs: liveRuns, runsSource: 'live', secretNames }
  const cache = readCiSummary(root)
  if (cache) return { pipelines, providers, runs: cache.recentRuns, runsSource: 'cache', cachedAt: cache.updatedAt, secretNames }
  return { pipelines, providers, runs: [], runsSource: 'none', secretNames }
}

/** One run's jobs and steps, from the one detected, connected
 * plugin. The plain refusals mirror runDeployAction: no
 * detected provider, or no connection, and the provider is
 * never called. */
export async function ciRunDetail(
  root: string, plugins: CiPlugin[], runId: string,
): Promise<{ detail: CiRunDetail } | { error: string }> {
  const found = await connectedPlugin(root, plugins)
  if ('error' in found) return found
  try {
    return { detail: await found.plugin.runDetail(root, runId) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function ciJobLogs(
  root: string, plugins: CiPlugin[], jobId: string,
): Promise<{ lines: string[] } | { error: string }> {
  const found = await connectedPlugin(root, plugins)
  if ('error' in found) return found
  try {
    return { lines: await found.plugin.jobLogs(root, jobId) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function connectedPlugin(
  root: string, plugins: CiPlugin[],
): Promise<{ plugin: CiPlugin } | { error: string }> {
  const detected = plugins.filter(p => { try { return p.detect(root) } catch { return false } })
  if (!detected.length) {
    return { error: 'No CI provider was detected in this project — no workflow definitions were found.' }
  }
  for (const plugin of detected) {
    const connect = await plugin.connectState(root).catch(() => null)
    if (connect?.connected) return { plugin }
  }
  const first = detected[0]
  const connect = await first.connectState(root).catch(() => null)
  return { error: `${first.label} is not connected. ${connect?.howToConnect ?? ''}`.trim() }
}

/* ── actions ─────────────────────────────────────────────── */

export type CiActionInput =
  | { action: 'trigger', pipelineId: string, ref?: string }
  | { action: 'rerun' | 'rerun-failed' | 'cancel', runId: string }

/**
 * One CI action with the facet's rules enforced here: the
 * provider is never called while unconnected (the honest
 * absence answers instead), and a trigger fires only on a
 * pipeline that declares workflow_dispatch.
 */
export async function runCiAction(
  root: string, plugins: CiPlugin[], input: CiActionInput,
): Promise<{ ok: true } | { error: string }> {
  const found = await connectedPlugin(root, plugins)
  if ('error' in found) return found
  const { plugin } = found
  try {
    if (input.action === 'trigger') {
      const pipeline = plugin.pipelines(root).find(p => p.id === input.pipelineId)
        ?? readPipelines(root, plugin.id).find(p => p.id === input.pipelineId)
      if (!pipeline) return { error: `No pipeline "${input.pipelineId}" was found in this project.` }
      if (!pipeline.canDispatch) {
        return { error: `"${pipeline.name}" does not declare workflow_dispatch — it cannot be triggered by hand. It runs on: ${pipeline.triggers.join(', ') || 'nothing the extractor could read'}.` }
      }
      const r = await plugin.trigger(root, pipeline, input.ref)
      return r.ok ? { ok: true } : { error: r.error ?? `${plugin.label} refused the trigger.` }
    }
    const r = input.action === 'cancel'
      ? await plugin.cancel(root, input.runId)
      : await plugin.rerun(root, input.runId, input.action === 'rerun-failed')
    return r.ok ? { ok: true } : { error: r.error ?? `${plugin.label} refused the ${input.action}.` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
