/**
 * Token benchmark CLI — `npm run benchmark [-- --model <id>] [-- --reps <n>]
 * [-- --taskTimeoutMs <ms>] [-- --tasks <id,id>] [-- --engine <mastra|opencode|musecode>]`.
 *
 * Runs the basic suite against fresh fixture copies with real chat
 * turns and writes .ai-live/benchmark-runs/<runId>/report.md +
 * summary.json. Needs a resolvable Meta key (CONN_KEY_META in .env or
 * the environment) — it fails before running anything without one.
 * --engine picks the chat engine for the run (default: the chatEngine
 * agent setting's current value); the report names the engine and
 * keeps the Mastra baseline as the comparison anchor.
 */
import type { ChatEngine } from '../agentSettings.js'
import { runBenchmark } from './runner.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const tasksArg = arg('tasks')
const engineArg = arg('engine')
if (engineArg !== undefined && engineArg !== 'mastra' && engineArg !== 'opencode' && engineArg !== 'musecode') {
  console.error(`Benchmark failed: --engine must be "mastra", "opencode" or "musecode" (got "${engineArg}")`)
  process.exit(1)
}
try {
  const { reportPath, summary } = await runBenchmark({
    model: arg('model') || undefined,
    reps: Number(arg('reps') || '1'),
    taskTimeoutMs: Number(arg('taskTimeoutMs') || '300000'),
    taskIds: tasksArg ? tasksArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    engine: engineArg as ChatEngine | undefined,
    onProgress: (msg) => console.log(msg),
  })
  const a = summary.aggregates
  console.log(
    `Benchmark ${summary.runId} (engine: ${summary.engine}): solved ${a.solvedCount}/${a.totalRuns}, ` +
    `${a.totalTokens.toLocaleString('en-US')} tokens total, cost per solved task ` +
    `${a.costPerSolvedTaskTokens === null ? '—' : a.costPerSolvedTaskTokens.toLocaleString('en-US')} tokens`,
  )
  console.log(`Report: ${reportPath}`)
  process.exit(0)
} catch (e) {
  console.error(`Benchmark failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
