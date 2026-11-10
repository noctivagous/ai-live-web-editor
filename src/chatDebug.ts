/**
 * Chat debug / reporting mode — opt-in via AI_LIVE_CHAT_DEBUG=1.
 *
 * When enabled, every chat turn handled by chatStream.ts is recorded
 * as ONE JSON object per line in a JSONL report (default
 * <repo root>/.ai-live/chat-debug.jsonl, override with
 * AI_LIVE_CHAT_DEBUG_FILE). The record is built to answer one
 * question — "why did no edit land?" — by keeping, per turn:
 *
 *   - the exact tool names offered to the model for the turn,
 *   - every event forwarded to the client, in order (tool events in
 *     full; text/reasoning deltas as lengths only, plus the first
 *     200 chars of the turn's final text),
 *   - whether the verify gate was armed, its trigger decision and
 *     the outcome the turn reported,
 *   - the files the turn's write-classified tool RESULTS claim to
 *     have written, each resolved through the one project-path
 *     resolver and checked on disk afterwards (exists + mtime).
 *
 * When the flag is off the recorder is a strict no-op: it keeps no
 * records and never touches the filesystem. Every recorder method
 * swallows its own errors — a debug aid must never break a turn.
 *
 * Slice 9 extends the same file and flag to the OpenCode path:
 * the translator's turns are recorded through the same recorder
 * (engine: 'opencode' marks them), and tool executions arriving
 * through the host dispatch endpoints append per-tool records
 * (kind: 'tool-call') — see recordDispatchToolCall below.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWriteTool } from './agentTools.js'
import { resolveProjectPath } from './projectPath.js'
import { getFsRoot, listProjects } from './launcher.js'
import { countLines } from './mastra/tools/fsEdit.js'
import type { ChatStreamEvent, TurnUsage, VerifySummary } from './chatStream.js'

export function chatDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.AI_LIVE_CHAT_DEBUG || '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function chatDebugFile(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.AI_LIVE_CHAT_DEBUG_FILE || '').trim()
  if (override) return path.resolve(override)
  return path.join(REPO_ROOT, '.ai-live', 'chat-debug.jsonl')
}

/** One forwarded client event, compacted: deltas carry lengths, not text. */
export type DebugEvent =
  | { type: 'status'; text: string }
  | { type: 'workflow'; mode: string; reason?: string }
  | { type: 'reasoning-delta'; len: number }
  | { type: 'text-delta'; len: number }
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-delta'; id: string; name: string; len: number }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'error'; error: string }
  | { type: 'done'; usage: TurnUsage | null; model?: string; verification?: VerifySummary }
  | { type: 'unmapped'; unmapped: true; originalType: string }

export interface DebugWriteClaim {
  tool: string
  id: string
  /** The path the tool result (or, failing that, the call args) named. */
  claimedPath: string | null
  claimSource: 'result' | 'result-files' | 'args' | 'none'
  /** Absolute path the one resolver maps the claim to under the project root. */
  resolvedPath: string | null
  exists: boolean | null
  mtime: string | null
}

export interface ChatDebugTurnRecord {
  kind: 'chat-turn'
  /** Serving engine, present only when the recorder was created
   * with one (the OpenCode translator passes 'opencode'). Mastra
   * records omit the field — their shape is unchanged. */
  engine?: string
  ts: string
  endedAt: string
  durationMs: number
  projectRoot: string | null
  projectId: string | null
  mode: string | null
  workflowSwitched: boolean
  /** The exact activeTools list passed to the agent for this turn. */
  toolsOffered: string[] | null
  toolSignals: { hasActivePlan?: boolean; hasFeatureGraph?: boolean; hasUserFlowGraph?: boolean; searchAvailable?: boolean } | null
  gateArmed: boolean
  gateBaselineCaptured: boolean | null
  gateBaselineError: string | null
  gate: { decision: boolean; toolTrace: string[]; verification: VerifySummary | null; followUpSkipped: string | null } | null
  events: DebugEvent[]
  textChars: number
  reasoningChars: number
  finalTextHead: string
  usage: TurnUsage | null
  model: string | null
  error: string | null
  aborted: boolean
  writes: DebugWriteClaim[]
}

export interface ChatDebugOptions {
  enabled?: boolean
  file?: string
  projectRoot?: string
  projectId?: string
  env?: NodeJS.ProcessEnv
  now?: () => number
  /** Engine marker stamped onto the turn record (see
   * ChatDebugTurnRecord.engine). Absent = no marker. */
  engine?: string
  /** Extra tool names counted as writes for the record's write
   * claims, beyond agentTools' WRITE_TOOLS. The OpenCode
   * translator passes its native write tools (edit/write/
   * apply_patch) — names the Mastra path never sees, so its
   * records are unaffected. */
  extraWriteTools?: ReadonlySet<string>
}

type LooseRecord = Record<string, unknown>

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === 'object' ? value as LooseRecord : {}
}

interface ToolChunkPaths {
  argsPath?: string
  resultPath?: string
  resultFiles?: string[]
}

const FINAL_TEXT_HEAD = 200

export class ChatDebugTurn {
  readonly enabled: boolean
  /** Compacted events in forward order. Stays empty while disabled. */
  readonly events: DebugEvent[] = []
  private readonly file: string
  private readonly opts: ChatDebugOptions
  private readonly now: () => number
  private readonly startedAt: number
  private mode: string | null = null
  private workflowSwitched = false
  private toolsOffered: string[] | null = null
  private toolSignals: ChatDebugTurnRecord['toolSignals'] = null
  private gateArmed = false
  private gateBaselineCaptured: boolean | null = null
  private gateBaselineError: string | null = null
  private gateDecision: { decision: boolean; toolTrace: string[] } | null = null
  private gateFollowUpSkipped: string | null = null
  private readonly chunkPaths = new Map<string, ToolChunkPaths>()
  private textChars = 0
  private reasoningChars = 0
  private textHead = ''
  private doneUsage: TurnUsage | null = null
  private doneModel: string | null = null
  private doneVerification: VerifySummary | null = null
  private finished = false

  constructor(opts: ChatDebugOptions = {}) {
    this.opts = opts
    const env = opts.env ?? process.env
    this.enabled = opts.enabled ?? chatDebugEnabled(env)
    this.file = opts.file ?? chatDebugFile(env)
    this.now = opts.now ?? Date.now
    this.startedAt = this.now()
  }

  noteMode(mode: string, switched: boolean): void {
    if (!this.enabled) return
    this.mode = mode
    this.workflowSwitched = switched
  }

  noteTools(tools: string[], signals: ChatDebugTurnRecord['toolSignals']): void {
    if (!this.enabled) return
    this.toolsOffered = [...tools]
    this.toolSignals = signals
  }

  noteGateArmed(armed: boolean, baseline: { captured: boolean; error: string | null }): void {
    if (!this.enabled) return
    this.gateArmed = armed
    this.gateBaselineCaptured = baseline.captured
    this.gateBaselineError = baseline.error
  }

  noteGateDecision(decision: boolean, toolTrace: string[]): void {
    if (!this.enabled) return
    this.gateDecision = { decision, toolTrace: [...toolTrace] }
  }

  /** The gate ran but its model follow-up was deliberately not started
   * (reason 'unverified-only': findings were notes, not failures). */
  noteGateFollowUpSkipped(reason: string): void {
    if (!this.enabled) return
    this.gateFollowUpSkipped = reason
  }

  /**
   * Stash the paths a raw Mastra chunk carries for a tool call/result
   * (the mapped client event only keeps a prose detail). Called from
   * the stream loop just before the mapped event is recorded.
   */
  noteToolChunk(mapped: ChatStreamEvent, rawChunk: unknown): void {
    if (!this.enabled) return
    try {
      if (mapped.type !== 'tool-call' && mapped.type !== 'tool-result') return
      const chunk = asRecord(rawChunk)
      const p = asRecord(chunk.payload ?? rawChunk)
      const stash = this.chunkPaths.get(mapped.id) ?? {}
      if (mapped.type === 'tool-call') {
        const args = asRecord(p.args ?? p.input ?? p.arguments)
        if (typeof args.path === 'string' && args.path) stash.argsPath = args.path
      } else {
        const result = asRecord(p.result ?? p.output)
        if (typeof result.path === 'string' && result.path) stash.resultPath = result.path
        if (Array.isArray(result.files)) {
          const files = result.files.filter((f): f is string => typeof f === 'string' && Boolean(f))
          if (files.length) stash.resultFiles = files
        }
      }
      this.chunkPaths.set(mapped.id, stash)
    } catch { /* debug only */ }
  }

  recordEvent(ev: ChatStreamEvent): void {
    if (!this.enabled) return
    try {
      switch (ev.type) {
        case 'status':
          this.events.push({ type: 'status', text: ev.text })
          break
        case 'workflow':
          this.events.push({ type: 'workflow', mode: ev.mode, ...(ev.reason ? { reason: ev.reason } : {}) })
          break
        case 'reasoning-delta':
          this.reasoningChars += ev.text.length
          this.events.push({ type: 'reasoning-delta', len: ev.text.length })
          break
        case 'text-delta':
          this.textChars += ev.text.length
          if (this.textHead.length < FINAL_TEXT_HEAD) {
            this.textHead = (this.textHead + ev.text).slice(0, FINAL_TEXT_HEAD)
          }
          this.events.push({ type: 'text-delta', len: ev.text.length })
          break
        case 'tool-call':
          this.events.push({ type: 'tool-call', id: ev.id, name: ev.name, detail: ev.detail })
          break
        case 'tool-delta':
          this.events.push({ type: 'tool-delta', id: ev.id, name: ev.name, len: ev.text.length })
          break
        case 'tool-result':
          this.events.push({ type: 'tool-result', id: ev.id, name: ev.name, ok: ev.ok, detail: ev.detail })
          break
        case 'error':
          this.events.push({ type: 'error', error: ev.error })
          break
        case 'done':
          this.doneUsage = ev.usage ?? null
          this.doneModel = ev.model ?? null
          this.doneVerification = ev.verification ?? null
          this.events.push({ type: 'done', usage: this.doneUsage, ...(ev.model ? { model: ev.model } : {}), ...(ev.verification ? { verification: ev.verification } : {}) })
          break
        default:
          this.events.push({ type: 'unmapped', unmapped: true, originalType: (ev as { type: string }).type })
      }
    } catch { /* debug only */ }
  }

  private buildWrites(projectRoot: string | null): DebugWriteClaim[] {
    const claims: DebugWriteClaim[] = []
    for (const ev of this.events) {
      if (ev.type !== 'tool-result' || !ev.ok) continue
      if (!isWriteTool(ev.name) && !this.opts.extraWriteTools?.has(ev.name)) continue
      const stash = this.chunkPaths.get(ev.id) ?? {}
      const paths: { claimedPath: string | null; claimSource: DebugWriteClaim['claimSource'] }[] = []
      if (stash.resultPath) paths.push({ claimedPath: stash.resultPath, claimSource: 'result' })
      else if (stash.resultFiles?.length) for (const f of stash.resultFiles) paths.push({ claimedPath: f, claimSource: 'result-files' })
      else if (stash.argsPath) paths.push({ claimedPath: stash.argsPath, claimSource: 'args' })
      else paths.push({ claimedPath: null, claimSource: 'none' })
      for (const { claimedPath, claimSource } of paths) {
        let resolvedPath: string | null = null
        let exists: boolean | null = null
        let mtime: string | null = null
        if (claimedPath && projectRoot) {
          const r = resolveProjectPath(projectRoot, claimedPath)
          if (r.ok === true) {
            resolvedPath = r.full
            try {
              const st = fs.statSync(r.full)
              exists = true
              mtime = st.mtime.toISOString()
            } catch {
              exists = false
            }
          }
        }
        claims.push({ tool: ev.name, id: ev.id, claimedPath, claimSource, resolvedPath, exists, mtime })
      }
    }
    return claims
  }

  /**
   * Close the turn: build the record, check claimed writes on disk,
   * and append one JSONL line. Returns the record, or null when
   * disabled / already finished / the write failed. Never throws.
   */
  finish(info: { error?: string | null; aborted?: boolean } = {}): ChatDebugTurnRecord | null {
    if (!this.enabled || this.finished) return null
    this.finished = true
    try {
      const endedAtMs = this.now()
      let projectRoot = this.opts.projectRoot ?? null
      if (!projectRoot) {
        try { projectRoot = getFsRoot() } catch { projectRoot = null }
      }
      let projectId = this.opts.projectId ?? null
      if (!projectId && projectRoot) {
        try { projectId = listProjects().find((p) => p.root === projectRoot)?.id ?? null } catch { projectId = null }
      }
      const record: ChatDebugTurnRecord = {
        kind: 'chat-turn',
        ...(this.opts.engine ? { engine: this.opts.engine } : {}),
        ts: new Date(this.startedAt).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: Math.max(0, Math.round(endedAtMs - this.startedAt)),
        projectRoot,
        projectId,
        mode: this.mode,
        workflowSwitched: this.workflowSwitched,
        toolsOffered: this.toolsOffered,
        toolSignals: this.toolSignals,
        gateArmed: this.gateArmed,
        gateBaselineCaptured: this.gateBaselineCaptured,
        gateBaselineError: this.gateBaselineError,
        gate: this.gateDecision
          ? { decision: this.gateDecision.decision, toolTrace: this.gateDecision.toolTrace, verification: this.doneVerification, followUpSkipped: this.gateFollowUpSkipped }
          : null,
        events: this.events,
        textChars: this.textChars,
        reasoningChars: this.reasoningChars,
        finalTextHead: this.textHead,
        usage: this.doneUsage,
        model: this.doneModel,
        error: info.error ?? null,
        aborted: Boolean(info.aborted),
        writes: this.buildWrites(projectRoot),
      }
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.appendFileSync(this.file, JSON.stringify(record) + '\n')
      return record
    } catch {
      return null
    }
  }
}

export function createChatDebugTurn(opts: ChatDebugOptions = {}): ChatDebugTurn {
  return new ChatDebugTurn(opts)
}

/* ------------------------------------------------------------------ */
/* Per-tool dispatch records (re-platform slice 9)                     */
/* ------------------------------------------------------------------ */

/**
 * One host-dispatch tool execution, recorded in the same JSONL
 * file as the turn records (kind: 'tool-call'). This closes the
 * withToolLog gap on the OpenCode path: the Mastra module wraps
 * its fs tools so every execution lands in the server log
 * (serverLog's ToolCallEntry — tool, canonical path, line range,
 * the file's actual line count, outcome; counts and ranges only,
 * never contents), but the ported host functions behind the
 * plugin's dispatch endpoints deliberately skipped that side
 * effect in slice 5. Here every execution through the dispatch
 * endpoints (page/graph/project/fs/data/web) gets the equivalent
 * record — gated on AI_LIVE_CHAT_DEBUG like the rest of this
 * module: with the flag off nothing is written and the wrapper
 * below adds no bookkeeping at all. The fact extraction mirrors
 * withToolLog's field-for-field.
 */
export interface ChatDebugToolCallRecord {
  kind: 'tool-call'
  engine: 'opencode'
  ts: string
  tool: string
  ok: boolean
  elapsedMs: number
  /** Canonical /… project path when the call targets one. */
  path?: string
  /** Requested or applied 1-based line range. */
  range?: [number, number]
  /** Actual file line count observed at call time. */
  fileLines?: number
  /** str-replace / grep match count. */
  matches?: number
  /** write-real-file created flag. */
  created?: boolean
  /** Failure message only — never file contents or edit bodies. */
  error?: string
}

/** Cap for the line-count re-read (mirrors withToolLog's). */
const DISPATCH_LOG_READ_CAP = 1_000_000

/** Best-effort current line count for a canonical project path
 * (the same guarded re-read withToolLog performs when a result
 * carries a path but no line count of its own). */
function dispatchLiveLineCount(canonicalPath: string): number | undefined {
  try {
    const r = resolveProjectPath(getFsRoot(), canonicalPath)
    if (r.ok === false) return undefined
    const st = fs.statSync(r.full)
    if (!st.isFile() || st.size > DISPATCH_LOG_READ_CAP) return undefined
    const buf = fs.readFileSync(r.full)
    if (buf.subarray(0, 8192).includes(0)) return undefined
    return countLines(buf.toString('utf-8'))
  } catch { return undefined }
}

/**
 * Append one dispatch record for a finished tool execution.
 * Returns true when a line was written. A strict no-op (false)
 * when debug is off; swallows its own errors like the recorder.
 */
export function recordDispatchToolCall(
  entry: { tool: string; input?: unknown; result?: unknown; thrown?: string | null; elapsedMs: number },
  opts: { env?: NodeJS.ProcessEnv; file?: string } = {},
): boolean {
  const env = opts.env ?? process.env
  if (!chatDebugEnabled(env)) return false
  try {
    const rec = asRecord(entry.result)
    const input = asRecord(entry.input)
    const error = entry.thrown ?? (typeof rec.error === 'string' ? rec.error : null)
    const record: ChatDebugToolCallRecord = {
      kind: 'tool-call',
      engine: 'opencode',
      ts: new Date().toISOString(),
      tool: entry.tool,
      ok: !error,
      elapsedMs: Math.max(0, Math.round(entry.elapsedMs)),
    }
    if (error) record.error = error
    const p = typeof rec.path === 'string' ? rec.path
      : typeof rec.to === 'string' ? rec.to
      : typeof rec.from === 'string' ? rec.from
      : typeof input.path === 'string' ? input.path : undefined
    if (p) record.path = p
    if (typeof rec.matches === 'number') record.matches = rec.matches
    if (typeof rec.created === 'boolean') record.created = rec.created
    if (Array.isArray(rec.range) && rec.range.length === 2 && typeof rec.range[0] === 'number' && typeof rec.range[1] === 'number') {
      record.range = [rec.range[0], rec.range[1]]
    } else if (typeof rec.startLine === 'number' && typeof rec.endLine === 'number') {
      record.range = [rec.startLine, rec.endLine]
    }
    if (typeof rec.totalLines === 'number') record.fileLines = rec.totalLines
    else if (typeof rec.fileLines === 'number') record.fileLines = rec.fileLines
    else if (record.path) {
      const live = dispatchLiveLineCount(record.path)
      if (typeof live === 'number') record.fileLines = live
    }
    const file = opts.file ?? chatDebugFile(env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(record) + '\n')
    return true
  } catch {
    return false
  }
}

/**
 * Wrap one host-dispatch tool execution (opencode/*Tools run*
 * functions) with its debug record. When AI_LIVE_CHAT_DEBUG is
 * off the wrapped call runs exactly as before — no timing, no
 * extraction, no file access. When on, the result (or throw)
 * passes through unchanged and the record is appended after the
 * execution settles.
 */
export async function withDispatchDebugLog<T>(
  tool: string,
  input: unknown,
  run: () => Promise<T>,
): Promise<T> {
  if (!chatDebugEnabled()) return run()
  const t0 = Date.now()
  try {
    const result = await run()
    recordDispatchToolCall({ tool, input, result, elapsedMs: Date.now() - t0 })
    return result
  } catch (e) {
    recordDispatchToolCall({ tool, input, thrown: e instanceof Error ? e.message : String(e), elapsedMs: Date.now() - t0 })
    throw e
  }
}
