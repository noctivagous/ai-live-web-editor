/**
 * Token benchmark — report writing.
 *
 * Two artifacts per run, written under .ai-live/benchmark-runs/<runId>/:
 * summary.json is the canonical record (aggregates included, prompts
 * hashed so a wording change is visible), report.md is the human read.
 * The headline metric is cost per solved task, in tokens: everything
 * the suite spent divided by the tasks it actually solved.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { TurnUsage } from '../chatStream.js'
import type { GradeCheck } from './suite.js'

export interface TaskRunRecord {
  taskId: string
  title: string
  rep: number
  usage: TurnUsage | null
  durationMs: number
  toolCalls: number
  solved: boolean
  checks: GradeCheck[]
  error: string | null
}

export interface TaskAggregate {
  reps: number
  solved: number
  medianTokens: number | null
  medianDurationMs: number | null
}

export interface BenchmarkSummary {
  runId: string
  startedAt: string
  model: string
  suite: string
  /** sha256 of each task's verbatim prompt, keyed by task id. */
  promptHashes: Record<string, string>
  records: TaskRunRecord[]
  aggregates: {
    perTask: Record<string, TaskAggregate>
    totalTokens: number
    totalRuns: number
    solvedCount: number
    /** totalTokens / solvedCount; null when nothing was solved. */
    costPerSolvedTaskTokens: number | null
    /** The control task's median total — the fixed per-turn floor every task pays. */
    controlFloorTokens: number | null
  }
}

export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf-8').digest('hex')
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function buildSummary(input: {
  runId: string
  startedAt: string
  model: string
  suiteId: string
  tasks: { id: string; title: string; prompt: string }[]
  records: TaskRunRecord[]
}): BenchmarkSummary {
  const promptHashes: Record<string, string> = {}
  for (const t of input.tasks) promptHashes[t.id] = promptHash(t.prompt)

  const perTask: Record<string, TaskAggregate> = {}
  for (const t of input.tasks) {
    const recs = input.records.filter((r) => r.taskId === t.id)
    perTask[t.id] = {
      reps: recs.length,
      solved: recs.filter((r) => r.solved).length,
      medianTokens: median(recs.map((r) => r.usage?.total).filter((v): v is number => typeof v === 'number')),
      medianDurationMs: median(recs.map((r) => r.durationMs)),
    }
  }

  const totalTokens = input.records.reduce((sum, r) => sum + (r.usage?.total ?? 0), 0)
  const solvedCount = input.records.filter((r) => r.solved).length
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    model: input.model,
    suite: input.suiteId,
    promptHashes,
    records: input.records,
    aggregates: {
      perTask,
      totalTokens,
      totalRuns: input.records.length,
      solvedCount,
      costPerSolvedTaskTokens: solvedCount > 0 ? Math.round(totalTokens / solvedCount) : null,
      controlFloorTokens: perTask['control-ok']?.medianTokens ?? null,
    },
  }
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US')
}

export function renderReport(summary: BenchmarkSummary): string {
  const a = summary.aggregates
  const lines: string[] = []
  lines.push(`# Token benchmark — ${summary.suite} suite`)
  lines.push('')
  lines.push(`Run: ${summary.runId} · started ${summary.startedAt} · model \`${summary.model}\``)
  lines.push('')
  lines.push('| Task | Rep | Solved | Tokens (total) | Input | Output | Cached input | Tool calls | Elapsed |')
  lines.push('| --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const r of summary.records) {
    const u = r.usage
    lines.push(
      `| ${r.taskId} | ${r.rep} | ${r.solved ? 'yes' : 'no'} | ${fmt(u?.total)} | ${fmt(u?.input)} | ${fmt(u?.output)} | ${fmt(u?.cachedInput)} | ${r.toolCalls} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    )
  }
  lines.push('')
  lines.push('## Baseline')
  lines.push('')
  if (a.controlFloorTokens !== null) {
    lines.push(
      `The control task (\`control-ok\` — "reply OK, touch nothing") cost a median of **${fmt(a.controlFloorTokens)} tokens** per turn. ` +
      'That is the fixed floor every turn pays before any task work happens: project brief, tool schemas, memory, and the model\'s one-word reply.',
    )
  } else {
    lines.push('The control task reported no usage, so no fixed floor could be measured this run.')
  }
  lines.push('')
  lines.push('## Totals')
  lines.push('')
  lines.push(`- Tasks solved: ${a.solvedCount} of ${a.totalRuns} runs`)
  lines.push(`- Total tokens: ${fmt(a.totalTokens)}`)
  lines.push(`- Cost per solved task: ${a.costPerSolvedTaskTokens === null ? '— (nothing solved)' : `${fmt(a.costPerSolvedTaskTokens)} tokens`}`)
  lines.push('')
  const failed = summary.records.filter((r) => !r.solved)
  if (failed.length) {
    lines.push('## Failures')
    lines.push('')
    for (const r of failed) {
      lines.push(`### ${r.taskId} (rep ${r.rep})`)
      if (r.error) lines.push(`- turn error: ${r.error}`)
      for (const c of r.checks.filter((c) => !c.ok)) {
        lines.push(`- ✗ ${c.name} — ${c.detail}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

export function writeRunReport(
  outDir: string,
  summary: BenchmarkSummary,
): { summaryPath: string; reportPath: string } {
  fs.mkdirSync(outDir, { recursive: true })
  const summaryPath = path.join(outDir, 'summary.json')
  const reportPath = path.join(outDir, 'report.md')
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8')
  fs.writeFileSync(reportPath, renderReport(summary), 'utf-8')
  return { summaryPath, reportPath }
}
