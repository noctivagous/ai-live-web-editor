/**
 * Token benchmark CLI — `npm run benchmark [-- --model <id>] [-- --reps <n>]
 * [-- --taskTimeoutMs <ms>] [-- --tasks <id,id>]`.
 *
 * Runs the basic suite against fresh fixture copies with real chat
 * turns and writes .ai-live/benchmark-runs/<runId>/report.md +
 * summary.json. Needs a resolvable Meta key (CONN_KEY_META in .env or
 * the environment) — it fails before running anything without one.
 */
import { runBenchmark } from './runner.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const tasksArg = arg('tasks')
try {
  const { reportPath, summary } = await runBenchmark({
    model: arg('model') || undefined,
    reps: Number(arg('reps') || '1'),
    taskTimeoutMs: Number(arg('taskTimeoutMs') || '300000'),
    taskIds: tasksArg ? tasksArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    onProgress: (msg) => console.log(msg),
  })
  const a = summary.aggregates
  console.log(
    `Benchmark ${summary.runId}: solved ${a.solvedCount}/${a.totalRuns}, ` +
    `${a.totalTokens.toLocaleString('en-US')} tokens total, cost per solved task ` +
    `${a.costPerSolvedTaskTokens === null ? '—' : a.costPerSolvedTaskTokens.toLocaleString('en-US')} tokens`,
  )
  console.log(`Report: ${reportPath}`)
  process.exit(0)
} catch (e) {
  console.error(`Benchmark failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
