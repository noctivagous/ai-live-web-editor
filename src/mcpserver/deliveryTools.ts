/**
 * The Delivery facet's MCP tool family (Facets design §13.6):
 * git, test-run, and deploy tools, every one tagged
 * `facet: 'delivery'` so the registry withdraws them while the
 * facet is off (§10.2) — the facet's standard gating, applied
 * at the one registration point.
 *
 * What the agent is offered (§13.3): the repository's state
 * (status, log) and the checkpoint — the one write, and it is
 * gated on the project's own opt-in (agentCheckpoints in the
 * delivery settings), because automatic commits are the
 * user's word to give, not the agent's to take. Staging and
 * committing stay user actions in the section. The test
 * tools drive the Tests section's own engine (the gate stays
 * the judge of a turn). Deploy state is read-only here too —
 * shipping is the user's action in the section.
 */
import { getFsRoot } from '../launcher.js'
import { createCheckpoint, readDeliverySettings } from '../delivery/checkpoints.js'
import { targetViews } from '../delivery/deploy.js'
import { ALL_DEPLOY_PLUGINS } from '../delivery/deployPlugins.js'
import { gitLog, gitStatus } from '../delivery/git.js'
import { runTests, testsOverview } from '../delivery/testRun.js'
import { flakyTestKeys, lastTestVerdict } from '../delivery/testStore.js'
import type { RunScope } from '../delivery/testRunners.js'
import { obj, str, type AleToolDef } from './tools.js'

export const ALE_DELIVERY_TOOLS: AleToolDef[] = [
  {
    name: 'ale_git_status',
    description: 'Read the open project\'s git status: branch, upstream, ahead/behind, and the staged / unstaged / untracked file lists. Read-only.',
    inputSchema: obj({}),
    facet: 'delivery',
    run: async () => ({ ok: true, status: await gitStatus(getFsRoot()) }),
  },
  {
    name: 'ale_git_log',
    description: 'Read the open project\'s recent git history (hash, author, date, subject, refs). Checkpoint commits are marked. Read-only.',
    inputSchema: obj({ limit: { type: 'number', description: 'How many entries (default 30, max 200).' } }),
    facet: 'delivery',
    run: async (input) => {
      const limit = typeof input.limit === 'number' ? Math.min(Math.max(1, input.limit), 200) : 30
      return { ok: true, entries: await gitLog(getFsRoot(), limit) }
    },
  },
  {
    name: 'ale_git_checkpoint',
    description: 'Drop a checkpoint commit of the whole working tree, marked ale-checkpoint:. Only works when the project has enabled agent checkpoints in the Delivery facet — otherwise it explains that and does nothing.',
    inputSchema: obj({ note: str('An optional note for the checkpoint message.') }),
    facet: 'delivery',
    run: async (input) => {
      const root = getFsRoot()
      if (!readDeliverySettings(root).agentCheckpoints) {
        return { ok: false, error: 'Agent checkpoints are not enabled for this project. The user can enable them in the Delivery facet\'s Git section, or drop a checkpoint there themselves.' }
      }
      const result = await createCheckpoint(root, typeof input.note === 'string' ? input.note : undefined)
      return result.created
        ? { ok: true, checkpoint: result }
        : { ok: false, error: `No checkpoint was created: ${result.reason ?? 'nothing to commit'}.` }
    },
  },
  {
    name: 'ale_tests_overview',
    description: 'Read the project\'s test state: detected runners, discovered suites/tests (with kinds), the latest full-run verdict, and any tests flagged flaky from the run history. Read-only.',
    inputSchema: obj({}),
    facet: 'delivery',
    run: async () => {
      const root = getFsRoot()
      const overview = testsOverview(root)
      return {
        ok: true,
        runners: overview.runners,
        suites: overview.suites,
        verdict: lastTestVerdict(root),
        flaky: flakyTestKeys(root),
      }
    },
  },
  {
    name: 'ale_tests_run',
    description: 'Run the project\'s tests and record the run: scope "all", one "file", a "single" test (file + name), or the "failures" of the latest run. Returns per-test results with failure output. This is the Tests section\'s own engine — the verify gate remains the judge of a turn.',
    inputSchema: obj({
      scope: str('One of: all, file, single, failures.'),
      file: str('The test file, for scope file/single.'),
      name: str('The test name, for scope single.'),
    }),
    facet: 'delivery',
    run: async (input) => {
      const root = getFsRoot()
      let scope: RunScope = { kind: 'all' }
      if (input.scope === 'file' && typeof input.file === 'string') scope = { kind: 'file', file: input.file }
      else if (input.scope === 'single' && typeof input.file === 'string' && typeof input.name === 'string') scope = { kind: 'single', file: input.file, name: input.name }
      else if (input.scope === 'failures') scope = { kind: 'failures', keys: [] }
      const outcome = await runTests(root, scope)
      const failed = outcome.runs.flatMap(r => r.results.filter(x => x.status === 'fail'))
      return {
        ok: outcome.runs.length > 0 && failed.length === 0,
        runs: outcome.runs.map(r => ({ runnerId: r.runnerId, totals: r.totals, failures: r.results.filter(x => x.status === 'fail') })),
        notes: outcome.notes,
        ...(failed.length ? { error: `${failed.length} test(s) failing: ${failed.slice(0, 6).map(f => f.key).join(', ')}` } : {}),
      }
    },
  },
  {
    name: 'ale_deploy_status',
    description: 'Read the project\'s deployment state: detected targets (Cloudflare/Vercel), each provider\'s connect state, and the last deployment recorded for each target. Read-only — deploying is the user\'s action in the Delivery facet.',
    inputSchema: obj({}),
    facet: 'delivery',
    run: async () => {
      const root = getFsRoot()
      const views = await targetViews(root, ALL_DEPLOY_PLUGINS)
      return {
        ok: true,
        targets: views.map(v => ({
          target: v.target, plugin: v.pluginLabel,
          connected: v.connect.connected,
          ...(v.connect.connected ? {} : { howToConnect: v.connect.howToConnect }),
          lastDeployment: v.lastDeployment,
        })),
      }
    },
  },
]
