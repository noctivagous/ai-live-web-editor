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
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWriteTool } from './agentTools.js'
import { resolveProjectPath } from './projectPath.js'
import { getFsRoot, listProjects } from './launcher.js'
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
  ts: string
  endedAt: string
  durationMs: number
  projectRoot: string | null
  projectId: string | null
  mode: string | null
  workflowSwitched: boolean
  /** The exact activeTools list passed to the agent for this turn. */
  toolsOffered: string[] | null
  toolSignals: { hasActivePlan?: boolean; hasFeatureGraph?: boolean; searchAvailable?: boolean } | null
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
      if (ev.type !== 'tool-result' || !ev.ok || !isWriteTool(ev.name)) continue
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
