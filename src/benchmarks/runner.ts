/**
 * Token benchmark — runner.
 *
 * Drives real Files-mode chat turns against throwaway copies of the
 * fixture project and grades each one the moment it finishes. A turn
 * is driven in-process through pipeAgentChatStream (the exact function
 * behind POST /api/chat/stream) with a stub req/res that captures the
 * SSE event stream; the run copy becomes the active project through
 * the launcher's own fs-root state (setFsRoot — the same state
 * selectProject sets and every agent tool resolves against), and the
 * previous root is restored afterwards, even on error.
 *
 * The fixture template is never edited: every task×rep gets a fresh
 * copy under .ai-live/benchmark-work/<runId>/.
 *
 * Engine selection (re-platform slice 9): a run serves its turns
 * through ONE chat engine — the Mastra stream or the OpenCode
 * translator — chosen by the same chatEngine agent setting the
 * app routes with. BenchmarkRunOptions.engine, when given, wins
 * and is set into that setting for the run's duration (restored
 * afterwards, like the fs root); without it the run uses the
 * setting's current value. The summary/report name the engine,
 * and the Mastra baseline (60,071 tokens per solved task) stays
 * on the report as the comparison anchor either way.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentAgentSettings, saveAgentSettings, type ChatEngine } from '../agentSettings.js'
import { pipeAgentChatStream, type ChatStreamEvent, type TurnUsage } from '../chatStream.js'
import {
  activateConnection, connectionKey, getStore, recordProbe,
  resolveConnectionModel, setModalityDefaults, upsertConnection,
} from '../connections.js'
import { loadDotEnv } from '../env.js'
import { EDITOR_ROOT, getFsRoot, setFsRoot } from '../launcher.js'
import { pipeOpencodeChatStream } from '../opencode/chat.js'
import { pipeMusecodeChatStream } from '../musecode/chat.js'
import { getMuseCodeAvailability } from '../musecode/availability.js'
import { opencodeMappingFor } from '../opencode/config.js'
import { presetById } from '../providerPresets.js'
import { listProviderModels } from '../providers.js'
import { buildSummary, writeRunReport, type TaskRunRecord } from './report.js'
import { BASIC_SUITE, type TurnFacts } from './suite.js'

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture')

export const BENCH_MODEL_DEFAULT = 'muse-spark-1.3-contributor'
const ABORT_GRACE_MS = 15_000

/** Fresh copy of the fixture template at dest (dest is replaced). */
export function copyFixture(dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(FIXTURE_DIR, dest, { recursive: true })
}

/**
 * Make sure a Meta connection exists, is active, and resolves to the
 * requested model — using the connections store exactly as the
 * server's own routes do. The key is resolved from the environment /
 * .env the way the server resolves it (CONN_KEY_META, falling back to
 * the preset's MODEL_API_KEY); when no key is resolvable this throws
 * before anything runs.
 */
export async function ensureBenchmarkConnection(model: string): Promise<void> {
  loadDotEnv()
  if (!connectionKey({ id: 'meta', presetId: 'meta' })) {
    throw new Error(
      'No Meta API key is resolvable (CONN_KEY_META or MODEL_API_KEY). ' +
      'Put the key in the repo .env or the environment before running the benchmark.',
    )
  }
  const conn = upsertConnection({ id: 'meta', presetId: 'meta', name: 'Meta', model })
  activateConnection('meta')
  // Probe like POST /api/connections/test: a verified connection is
  // what lets the model be set as the text modality default, and a
  // connection stuck at 'failed' is never used by the agent.
  try {
    const listed = await listProviderModels(connectionKey(conn), conn.baseUrl, { allModels: true, presetId: 'meta' })
    recordProbe('meta', listed.tagged, true)
    try {
      setModalityDefaults({ text: { connectionId: 'meta', model } })
    } catch { /* the active connection's own model takes precedence anyway */ }
  } catch (e) {
    const current = getStore().connections.find((c) => c.id === 'meta')
    if (current?.status === 'failed') {
      throw new Error(`Meta connection probe failed and the connection is marked failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    console.warn(`[benchmark] connection probe failed (${e instanceof Error ? e.message : String(e)}); continuing with the configured connection`)
  }
  const resolved = resolveConnectionModel()
  if (!resolved || resolved.id !== `openai/${model}`) {
    throw new Error(`Connection setup did not resolve to ${model} (resolved: ${resolved?.id ?? 'none'}). Check the Meta connection in Settings.`)
  }
}

/** The turn pipe for an engine: the exact function behind
 * POST /api/chat/stream for that engine. Muse Code has no pipe
 * yet (its supervisor lands in a later slice, and the parity run
 * is that slice's gate), so asking for it fails plainly instead
 * of silently driving a different engine. */
export function chatPipeForEngine(engine: ChatEngine) {
  if (engine === 'musecode') return pipeMusecodeChatStream
  return engine === 'opencode' ? pipeOpencodeChatStream : pipeAgentChatStream
}

/** Whether a stored connection maps onto the OpenCode engine —
 * the supervisor's own mapping check (opencode/config.ts). */
function opencodeMappingOk(conn: { id: string; name: string; model: string; baseUrl: string; presetId: string }): boolean {
  const preset = presetById(conn.presetId)
  return opencodeMappingFor(
    { id: conn.id, name: conn.name, model: conn.model, baseUrl: conn.baseUrl, presetProviderId: preset?.providerId ?? null },
    { pluginDir: '', hostUrl: '' },
  ).ok === true
}

/**
 * The OpenCode engine's counterpart of ensureBenchmarkConnection:
 * make sure the ACTIVE connection names the requested model and
 * maps onto the engine. The supervisor reads the active
 * connection directly (no probe, no modality defaults — those
 * feed the Mastra agent's model resolution), so the setup is:
 * an already-active connection that names the model, resolves a
 * key, and maps is honored as-is (the mechanical stub-provider
 * runs seed exactly that); otherwise the recorded-baseline Meta
 * connection is upserted/activated exactly as the Mastra path
 * sets it up, and its mapping is verified.
 */
export async function ensureOpencodeBenchmarkConnection(model: string): Promise<void> {
  loadDotEnv()
  const store = getStore()
  const active = store.connections.find((c) => c.id === store.activeId)
  if (active && active.model === model && connectionKey(active) && opencodeMappingOk(active)) return
  if (!connectionKey({ id: 'meta', presetId: 'meta' })) {
    throw new Error(
      'No Meta API key is resolvable (CONN_KEY_META or MODEL_API_KEY). ' +
      'Put the key in the repo .env or the environment before running the benchmark.',
    )
  }
  const conn = upsertConnection({ id: 'meta', presetId: 'meta', name: 'Meta', model })
  activateConnection('meta')
  if (!opencodeMappingOk(conn)) {
    throw new Error(
      'The Meta connection does not map onto the OpenCode engine ' +
      '(its preset kind is not OpenAI-compatible, or its model/base URL is missing).',
    )
  }
}

/** Minimal faithful stand-in for the express response the chat route
 * hands pipeAgentChatStream: captures the SSE stream and replays it
 * as parsed events. */
class SseCapture {
  headersSent = false
  socket = { setNoDelay: (_v: boolean) => {} }
  readonly events: ChatStreamEvent[] = []
  private buffer = ''

  setHeader(_name: string, _value: string) { /* headers are not under test */ }
  flushHeaders() { this.headersSent = true }
  write(chunk: string) {
    this.buffer += chunk
    this.drain()
    return true
  }
  flush() { /* no transport to flush */ }
  end() { /* the event list is the record */ }

  private drain() {
    let idx = this.buffer.indexOf('\n\n')
    while (idx >= 0) {
      const frame = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          this.events.push(JSON.parse(line.slice(5).trim()) as ChatStreamEvent)
        } catch { /* a partial frame is not an event */ }
      }
      idx = this.buffer.indexOf('\n\n')
    }
  }
}

/** The request half of the stub: pipeAgentChatStream only reads
 * `aborted` and subscribes to 'aborted'/'close' for its abort signal,
 * so the stub is a tiny listener registry the runner can fire. */
function makeStubReq() {
  const listeners = new Map<string, (() => void)[]>()
  const req = {
    aborted: false,
    socket: { setNoDelay: (_v: boolean) => {} },
    on(event: string, listener: () => void) {
      const list = listeners.get(event) || []
      list.push(listener)
      listeners.set(event, list)
    },
    fireAbort() {
      req.aborted = true
      for (const event of ['aborted', 'close']) {
        for (const listener of listeners.get(event) || []) {
          try { listener() } catch { /* a listener's failure is not the turn's */ }
        }
      }
    },
  }
  return req
}

interface DrivenTurn {
  facts: TurnFacts
  usage: TurnUsage | null
  durationMs: number
}

/** One real Files-mode turn, in-process, with a wall-clock cap. On
 * timeout the stub req fires its close listeners (the pipeline's own
 * abort path); a turn that still has not settled after a grace period
 * throws, so the suite stops instead of letting a zombie turn write
 * into a later task's copy. */
async function driveTurn(prompt: string, taskTimeoutMs: number, engine: ChatEngine): Promise<DrivenTurn> {
  const res = new SseCapture()
  const req = makeStubReq()
  const started = Date.now()
  let timedOut = false
  const pipe = chatPipeForEngine(engine)([{ role: 'user', content: prompt }], res, req, 'files')
  const settled = pipe.then(() => true, () => true)
  const timer = setTimeout(() => {
    timedOut = true
    req.fireAbort()
  }, taskTimeoutMs)
  const finished = await Promise.race([
    settled,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), taskTimeoutMs + ABORT_GRACE_MS)),
  ])
  clearTimeout(timer)
  const durationMs = Date.now() - started
  if (!finished) {
    throw new Error(`turn did not settle within ${ABORT_GRACE_MS}ms of the abort signal (task timeout ${taskTimeoutMs}ms)`)
  }

  let finalText = ''
  let usage: TurnUsage | null = null
  let sawDone = false
  let streamError: string | null = null
  const toolResults: TurnFacts['toolResults'] = []
  const callIds = new Set<string>()
  for (const e of res.events) {
    if (e.type === 'text-delta') finalText += e.text
    else if (e.type === 'tool-call') callIds.add(e.id)
    else if (e.type === 'tool-result') toolResults.push({ name: e.name, ok: e.ok })
    else if (e.type === 'error') streamError = e.error
    else if (e.type === 'done') {
      sawDone = true
      usage = e.usage ?? null
    }
  }
  let error: string | null = null
  if (timedOut) error = `timed out after ${taskTimeoutMs}ms`
  else if (streamError) error = streamError
  else if (!sawDone) error = 'turn ended without a done event'
  const facts: TurnFacts = {
    finalText,
    error,
    timedOut,
    toolResults,
    toolCalls: callIds.size || toolResults.length,
  }
  return { facts, usage, durationMs }
}

export interface BenchmarkRunOptions {
  model?: string
  reps?: number
  taskTimeoutMs?: number
  taskIds?: string[]
  /** Chat engine for the run (see the module header): set into
   * the chatEngine agent setting for the run and restored after;
   * defaults to the setting's current value. */
  engine?: ChatEngine
  onProgress?: (msg: string) => void
}

export async function runBenchmark(opts: BenchmarkRunOptions = {}) {
  const model = opts.model || BENCH_MODEL_DEFAULT
  const reps = Math.max(1, Math.floor(opts.reps ?? 1))
  const taskTimeoutMs = opts.taskTimeoutMs ?? 300_000
  const tasks = opts.taskIds?.length
    ? BASIC_SUITE.tasks.filter((t) => opts.taskIds!.includes(t.id))
    : BASIC_SUITE.tasks
  if (!tasks.length) throw new Error('No benchmark tasks selected')
  const startedAt = new Date()
  const runId = startedAt.toISOString().replace(/[:.]/g, '-')

  // Engine for the run: an explicit option is set into the
  // chatEngine agent setting for the run's duration (restored in
  // the finally below, like the fs root); without one, the
  // setting's current value decides.
  const prevEngine = currentAgentSettings().chatEngine
  const engine: ChatEngine = opts.engine ?? prevEngine
  const engineSetForRun = opts.engine !== undefined && opts.engine !== prevEngine
  if (engineSetForRun) saveAgentSettings({ chatEngine: engine })

  const prevRoot = getFsRoot()
  const records: TaskRunRecord[] = []
  let stop = false
  try {
    if (engine === 'opencode') await ensureOpencodeBenchmarkConnection(model)
    else if (engine === 'musecode') {
      // No Meta connection to ensure: Muse Code carries its
      // own sign-in. What the run needs is the binary itself.
      const availability = await getMuseCodeAvailability()
      if (!availability.available) {
        throw new Error('The benchmark can’t run the Muse Code engine: Muse Code is not installed on this machine. Install it (see the Requirement: Muse Code note in Settings) or pick a different --engine.')
      }
    }
    else await ensureBenchmarkConnection(model)
    for (const task of tasks) {
      if (stop) break
      for (let rep = 1; rep <= reps; rep++) {
        const runDir = path.join(EDITOR_ROOT, '.ai-live', 'benchmark-work', runId, `${task.id}-r${rep}`)
        copyFixture(runDir)
        setFsRoot(runDir)
        opts.onProgress?.(`[${task.id} r${rep}] running…`)
        let driven: DrivenTurn
        try {
          driven = await driveTurn(task.prompt, taskTimeoutMs, engine)
        } catch (e) {
          records.push({
            taskId: task.id, title: task.title, rep,
            usage: null, durationMs: taskTimeoutMs, toolCalls: 0,
            solved: false, checks: [],
            error: e instanceof Error ? e.message : String(e),
          })
          stop = true
          break
        }
        const grade = task.grade(runDir, driven.facts)
        records.push({
          taskId: task.id, title: task.title, rep,
          usage: driven.usage, durationMs: driven.durationMs,
          toolCalls: driven.facts.toolCalls,
          solved: grade.solved, checks: grade.checks, error: driven.facts.error,
        })
        opts.onProgress?.(
          `[${task.id} r${rep}] ${grade.solved ? 'solved' : 'NOT solved'} — ` +
          `${driven.usage?.total ?? '?'} tokens, ${(driven.durationMs / 1000).toFixed(1)}s`,
        )
      }
    }
  } finally {
    setFsRoot(prevRoot)
    if (engineSetForRun) saveAgentSettings({ chatEngine: prevEngine })
  }

  const summary = buildSummary({
    runId,
    startedAt: startedAt.toISOString(),
    model,
    engine,
    suiteId: BASIC_SUITE.id,
    tasks,
    records,
  })
  const outDir = path.join(EDITOR_ROOT, '.ai-live', 'benchmark-runs', runId)
  const { summaryPath, reportPath } = writeRunReport(outDir, summary)
  return { runId, outDir, summaryPath, reportPath, summary }
}
