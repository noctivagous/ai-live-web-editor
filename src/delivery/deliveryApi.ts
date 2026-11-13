/**
 * Delivery facet HTTP API (Facets design §13), mounted on both
 * servers next to the other facet APIs. Everything acts on the
 * open project (getFsRoot) and nothing else: the Git reads and
 * actions, the Tests engine, and the Deployment targets.
 */
import type { Express, Request, Response } from 'express'
import { getFsRoot } from '../launcher.js'
import {
  commitStaged, createBranch, draftCommitMessage, fetchRemote, gitBranches, gitDiff, gitLog,
  gitStatus, gitWorktrees, pullFfOnly, pushRemote, safeProjectPath, stageFiles, stageHunks,
  switchBranch, unstageFiles, unstageHunks,
} from './git.js'
import { createCheckpoint, readDeliverySettings, writeDeliverySettings } from './checkpoints.js'
import { detectTargets, readDeployments, runDeployAction, targetViews } from './deploy.js'
import { ALL_DEPLOY_PLUGINS } from './deployPlugins.js'
import { deliverySummary } from './summary.js'
import { ciJobLogs, ciOverview, ciRunDetail, runCiAction } from './ci.js'
import { addCiStarter } from './ciStarter.js'
import { ALL_CI_PLUGINS } from './ciPlugins.js'
import type { RunScope } from './testRunners.js'
import { runTests, testsOverview } from './testRun.js'
import { flakyTestKeys, latestRun, readTestRuns } from './testStore.js'

export function mountDeliveryApi(app: Express) {
  app.get('/api/delivery/git/status', async (_req, res) => {
    res.json({ ok: true, status: await gitStatus(getFsRoot()) })
  })

  app.get('/api/delivery/git/log', async (req, res) => {
    const limit = Number(req.query.limit)
    res.json({ ok: true, entries: await gitLog(getFsRoot(), Number.isFinite(limit) && limit > 0 ? limit : 60) })
  })

  app.get('/api/delivery/git/branches', async (_req, res) => {
    res.json({ ok: true, branches: await gitBranches(getFsRoot()) })
  })

  app.get('/api/delivery/git/worktrees', async (_req, res) => {
    res.json({ ok: true, worktrees: await gitWorktrees(getFsRoot()) })
  })

  app.post('/api/delivery/git/diff', async (req, res) => {
    const file = typeof req.body?.file === 'string' ? safeProjectPath(getFsRoot(), req.body.file) : null
    if (!file) return res.status(400).json({ ok: false, error: 'Expected { file } — a path inside the project.' })
    const diff = await gitDiff(getFsRoot(), file, req.body?.staged === true)
    res.json({ ok: true, diff })
  })

  /* ── Git actions (slice 3). Every action is a deliberate
   * call from the section; each answers with the fresh status
   * so the UI re-renders from truth. Git's own stderr is the
   * error text — the facet does not soften it. */
  const act = (fn: (body: Record<string, unknown>) => Promise<Record<string, unknown>>) =>
    async (req: Request, res: Response) => {
      try {
        const extra = await fn((req.body ?? {}) as Record<string, unknown>)
        res.json({ ok: true, status: await gitStatus(getFsRoot()), ...extra })
      } catch (e) {
        res.status(422).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
  const fileList = (body: Record<string, unknown>): string[] =>
    Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === 'string') : []
  const hunkIndexes = (body: Record<string, unknown>): number[] =>
    Array.isArray(body.hunks) ? body.hunks.filter((h): h is number => typeof h === 'number') : []

  app.post('/api/delivery/git/stage', act(async (body) => { await stageFiles(getFsRoot(), fileList(body)); return {} }))
  app.post('/api/delivery/git/unstage', act(async (body) => { await unstageFiles(getFsRoot(), fileList(body)); return {} }))
  app.post('/api/delivery/git/stage-hunks', act(async (body) => {
    await stageHunks(getFsRoot(), typeof body.file === 'string' ? body.file : '', hunkIndexes(body))
    return {}
  }))
  app.post('/api/delivery/git/unstage-hunks', act(async (body) => {
    await unstageHunks(getFsRoot(), typeof body.file === 'string' ? body.file : '', hunkIndexes(body))
    return {}
  }))
  app.post('/api/delivery/git/commit', act(async (body) => {
    const { hash } = await commitStaged(getFsRoot(), typeof body.message === 'string' ? body.message : '')
    return { hash }
  }))
  app.post('/api/delivery/git/draft-message', async (_req, res) => {
    const status = await gitStatus(getFsRoot())
    res.json({ ok: true, message: draftCommitMessage(status) })
  })
  app.post('/api/delivery/git/branch', act(async (body) => {
    await createBranch(getFsRoot(), typeof body.name === 'string' ? body.name : '')
    return {}
  }))
  app.post('/api/delivery/git/switch', act(async (body) => {
    await switchBranch(getFsRoot(), typeof body.name === 'string' ? body.name : '')
    return {}
  }))
  app.post('/api/delivery/git/fetch', act(async () => ({ output: await fetchRemote(getFsRoot()) })))
  app.post('/api/delivery/git/pull', act(async () => ({ output: await pullFfOnly(getFsRoot()) })))
  app.post('/api/delivery/git/push', act(async () => ({ output: await pushRemote(getFsRoot()) })))
  app.post('/api/delivery/git/checkpoint', act(async (body) => {
    const result = await createCheckpoint(getFsRoot(), typeof body.note === 'string' ? body.note : undefined)
    return { checkpoint: result }
  }))

  /* ── Tests (slice 4): discovery, recorded runs, flakiness,
   * and the run action. The run is synchronous — a test run
   * is seconds-to-minutes, like a long turn. */
  app.get('/api/delivery/tests', (_req, res) => {
    const root = getFsRoot()
    const overview = testsOverview(root)
    res.json({
      ok: true,
      runners: overview.runners,
      suites: overview.suites,
      latestRun: latestRun(root),
      runCount: readTestRuns(root).runs.length,
      flaky: flakyTestKeys(root),
    })
  })

  app.get('/api/delivery/summary', async (_req, res) => {
    res.json({ ok: true, summary: await deliverySummary(getFsRoot()) })
  })

  /* ── CI (slice 1 of §13.8): pipelines from the definition
   * files, runs live from a connected provider or from the
   * last-seen summary cache (the overview says which), and
   * the action door — trigger / rerun / cancel — which the
   * core refuses plainly while no provider is connected. */
  app.get('/api/delivery/ci', async (_req, res) => {
    res.json({ ok: true, overview: await ciOverview(getFsRoot(), ALL_CI_PLUGINS) })
  })

  app.get('/api/delivery/ci/runs/:id', async (req, res) => {
    const r = await ciRunDetail(getFsRoot(), ALL_CI_PLUGINS, req.params.id)
    if ('error' in r) return res.status(422).json({ ok: false, error: r.error })
    return res.json({ ok: true, detail: r.detail })
  })

  app.get('/api/delivery/ci/logs', async (req, res) => {
    const job = typeof req.query.job === 'string' ? req.query.job : ''
    if (!job) return res.status(400).json({ ok: false, error: 'Expected ?job=<job id>.' })
    const r = await ciJobLogs(getFsRoot(), ALL_CI_PLUGINS, job)
    if ('error' in r) return res.status(422).json({ ok: false, error: r.error })
    return res.json({ ok: true, lines: r.lines })
  })

  app.post('/api/delivery/ci/action', async (req, res) => {
    const body = (req.body ?? {}) as { action?: string, pipelineId?: string, runId?: string, ref?: string }
    const root = getFsRoot()
    if (body.action === 'trigger' && typeof body.pipelineId === 'string') {
      const r = await runCiAction(root, ALL_CI_PLUGINS, {
        action: 'trigger', pipelineId: body.pipelineId,
        ...(typeof body.ref === 'string' && body.ref ? { ref: body.ref } : {}),
      })
      if ('error' in r) return res.status(422).json({ ok: false, error: r.error })
      return res.json({ ok: true })
    }
    if ((body.action === 'rerun' || body.action === 'rerun-failed' || body.action === 'cancel') && typeof body.runId === 'string') {
      const r = await runCiAction(root, ALL_CI_PLUGINS, { action: body.action, runId: body.runId })
      if ('error' in r) return res.status(422).json({ ok: false, error: r.error })
      return res.json({ ok: true })
    }
    return res.status(400).json({ ok: false, error: 'A CI action needs an action (trigger, rerun, rerun-failed or cancel) with its pipeline or run id.' })
  })

  /* The starter (§13.8): write a test-on-push workflow file
   * for the detected stack when the project has none. A
   * plain project file afterwards — never an overwrite. */
  app.post('/api/delivery/ci/starter', (_req, res) => {
    const r = addCiStarter(getFsRoot())
    if (r.ok === false) return res.status(422).json({ ok: false, error: r.error })
    return res.json({ ok: true, file: r.file })
  })

  /* ── deployment ── */
  app.get('/api/delivery/deploy/targets', async (_req, res) => {
    const root = getFsRoot()
    const targets = await targetViews(root, ALL_DEPLOY_PLUGINS)
    res.json({ ok: true, targets, history: readDeployments(root) })
  })

  app.post('/api/delivery/deploy/action', async (req, res) => {
    const body = (req.body ?? {}) as { action?: string, targetId?: string, kind?: string, recordId?: string }
    if ((body.action !== 'deploy' && body.action !== 'promote' && body.action !== 'rollback') || typeof body.targetId !== 'string') {
      return res.status(400).json({ ok: false, error: 'A deployment action needs an action (deploy, promote or rollback) and a target id.' })
    }
    const r = await runDeployAction(getFsRoot(), ALL_DEPLOY_PLUGINS, {
      action: body.action, targetId: body.targetId,
      kind: body.kind === 'production' ? 'production' : 'preview',
      ...(typeof body.recordId === 'string' ? { recordId: body.recordId } : {}),
    })
    if ('error' in r) return res.status(422).json({ ok: false, error: r.error, ...(r.record ? { record: r.record } : {}) })
    return res.json({ ok: true, record: r.record })
  })

  app.get('/api/delivery/deploy/status', async (req, res) => {
    const root = getFsRoot()
    const targetId = String(req.query.target ?? '')
    const target = detectTargets(root, ALL_DEPLOY_PLUGINS).find(t => t.id === targetId)
    const plugin = ALL_DEPLOY_PLUGINS.find(p => p.id === target?.pluginId)
    if (!target || !plugin) return res.status(400).json({ ok: false, error: `No deployment target "${targetId}" was detected in this project.` })
    return res.json({ ok: true, status: await plugin.status(root, target) })
  })

  app.get('/api/delivery/deploy/logs', async (req, res) => {
    const root = getFsRoot()
    const targetId = String(req.query.target ?? '')
    const target = detectTargets(root, ALL_DEPLOY_PLUGINS).find(t => t.id === targetId)
    const plugin = ALL_DEPLOY_PLUGINS.find(p => p.id === target?.pluginId)
    if (!target || !plugin) return res.status(400).json({ ok: false, error: `No deployment target "${targetId}" was detected in this project.` })
    const recordId = typeof req.query.record === 'string' ? req.query.record : undefined
    const record = recordId ? readDeployments(root).find(r => r.id === recordId) : undefined
    return res.json({ ok: true, logs: await plugin.logs(root, target, record) })
  })

  app.post('/api/delivery/tests/run', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    let scope: RunScope = { kind: 'all' }
    if (body.scope === 'file' && typeof body.file === 'string') scope = { kind: 'file', file: body.file }
    else if (body.scope === 'single' && typeof body.file === 'string' && typeof body.name === 'string') scope = { kind: 'single', file: body.file, name: body.name }
    else if (body.scope === 'failures') scope = { kind: 'failures', keys: [] }
    try {
      const outcome = await runTests(getFsRoot(), scope)
      res.json({ ok: true, runs: outcome.runs, notes: outcome.notes, flaky: flakyTestKeys(getFsRoot()) })
    } catch (e) {
      res.status(422).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  app.get('/api/delivery/settings', (_req, res) => {
    res.json({ ok: true, settings: readDeliverySettings(getFsRoot()) })
  })
  app.post('/api/delivery/settings', (req, res) => {
    const settings = writeDeliverySettings(getFsRoot(), {
      agentCheckpoints: (req.body as Record<string, unknown>)?.agentCheckpoints === true,
    })
    res.json({ ok: true, settings })
  })
}
