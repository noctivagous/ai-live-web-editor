/**
 * The managed Stop hook → gate re-check (Muse Code design
 * §11, slice 9). Exactly ONE managed hook in v1.
 *
 * Delivery: ALE generates a hooks file (plus the small node
 * script the hook runs) into its own state directory and the
 * supervisor passes it to `muse serve` at spawn as
 * `-c managed_hooks_path=…` — it applies to ALE-run sessions
 * only and never touches the user's own Muse Code setup.
 * When a turn ends, Muse Code runs the hook with the turn's
 * payload on stdin ({ cwd, session_id, turn_id, … }); the
 * script POSTs it to POST /api/musecode/stop-hook; the editor
 * runs the gate on the settled tree and RECORDS the verdict
 * against the session + turn. The chat pipe then attaches the
 * verdict to the turn's `done` event as its `verification`
 * summary — the same surface the other engines' verify arcs
 * use.
 *
 * No loop, by construction and by guard: the re-check is
 * host-side computation — it starts no turn, so it can fire no
 * Stop of its own. On top of that, handleStopHook dedupes by
 * (session, turn) and collapses concurrent re-checks per
 * session, so even a host that double-fires settles into one
 * verdict.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getAgentSettingsPath } from '../agentSettings.js'
import type { VerifySummary } from '../chatStream.js'
import { getFsRoot } from '../launcher.js'
import { maybeCheckpointAfterVerifiedTurn } from '../delivery/checkpoints.js'
import { runGateVerdict, type GateVerdict } from '../mcpserver/gateVerdict.js'
import { aleEditorPort } from '../mcpserver/server.js'

/* ------------------------------------------------------------------ */
/* Verdict records                                                     */
/* ------------------------------------------------------------------ */

export interface GateVerdictRecord {
  at: string
  projectRoot: string
  sessionId: string
  turnId: string | null
  /** How this record came to exist: the Stop hook. (The field
   * exists so a future fallback trigger records itself as
   * what it is.) */
  source: 'stop-hook'
  verdict: GateVerdict
  /** The VerifySummary the turn's done event carries. */
  summary: VerifySummary
}

export function verdictSummary(verdict: GateVerdict): VerifySummary {
  return {
    ran: verdict.ran,
    ...(verdict.skipped ? { skipped: verdict.skipped } : {}),
    clean: verdict.ok,
    newLayout: verdict.layoutFindingCount,
    newConsole: verdict.consoleErrorCount,
    ...(verdict.unverified.length ? { unverified: verdict.unverified } : {}),
  }
}

const MAX_RECORDS_PER_PROJECT = 50
const recordsByRoot = new Map<string, GateVerdictRecord[]>()
const inFlightBySession = new Set<string>()

function verdictsFile(root: string): string {
  return path.join(root, '.ai-live', 'gate-verdicts.json')
}

function loadRecords(root: string): GateVerdictRecord[] {
  const cached = recordsByRoot.get(root)
  if (cached) return cached
  let records: GateVerdictRecord[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(verdictsFile(root), 'utf-8'))
    if (Array.isArray(raw)) records = raw as GateVerdictRecord[]
  } catch { /* no records yet */ }
  recordsByRoot.set(root, records)
  return records
}

export function recordGateVerdict(record: GateVerdictRecord): GateVerdictRecord {
  const records = loadRecords(record.projectRoot)
  records.push(record)
  while (records.length > MAX_RECORDS_PER_PROJECT) records.shift()
  try {
    fs.mkdirSync(path.dirname(verdictsFile(record.projectRoot)), { recursive: true })
    fs.writeFileSync(verdictsFile(record.projectRoot), JSON.stringify(records, null, 2), 'utf-8')
  } catch { /* a read-only project keeps the in-memory record only */ }
  return record
}

export function gateVerdictForTurn(sessionId: string, turnId: string | null, root: string = getFsRoot()): GateVerdictRecord | null {
  const records = loadRecords(root)
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r.sessionId !== sessionId) continue
    if (turnId && r.turnId && r.turnId !== turnId) continue
    return r
  }
  return null
}

export function listGateVerdicts(root: string = getFsRoot()): GateVerdictRecord[] {
  return [...loadRecords(root)]
}

/** Poll for a turn's verdict (the hook's POST and the pipe's
 * turn-end race; the hook usually wins by seconds). */
export async function waitForGateVerdict(sessionId: string, turnId: string | null, timeoutMs: number, root: string = getFsRoot()): Promise<GateVerdictRecord | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  for (;;) {
    const found = gateVerdictForTurn(sessionId, turnId, root)
    if (found) return found
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 250))
  }
}

/* ------------------------------------------------------------------ */
/* The Stop payload → one recorded verdict                             */
/* ------------------------------------------------------------------ */

export interface StopHookPayload {
  hook_event_name?: string
  session_id?: string
  turn_id?: string
  cwd?: string
}

export type StopHookAction = 'recorded' | 'duplicate' | 'in-flight' | 'ignored' | 'skipped'

export interface StopHookResult {
  action: StopHookAction
  record?: GateVerdictRecord
  reason?: string
}

/** Injectable for tests: the verdict runner. */
let verdictRunner: () => Promise<GateVerdict> = runGateVerdict
export function setGateVerdictRunner(next: (() => Promise<GateVerdict>) | null): void {
  verdictRunner = next ?? runGateVerdict
}

/**
 * Handle one Stop payload. The loop guards live here:
 * (session, turn) dedupe — a re-fired Stop for a settled turn
 * returns the existing verdict without re-running; and a
 * per-session in-flight collapse — a second Stop while a
 * re-check runs is answered, not queued. The re-check itself
 * starts no model turn, so it cannot cause another Stop.
 */
export async function handleStopHook(payload: StopHookPayload): Promise<StopHookResult> {
  if (payload.hook_event_name !== 'Stop') return { action: 'ignored', reason: `hook event ${payload.hook_event_name ?? '(none)'} is not Stop` }
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : ''
  const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : null
  if (!sessionId) return { action: 'ignored', reason: 'the payload carries no session_id' }
  const root = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : getFsRoot()

  const existing = gateVerdictForTurn(sessionId, turnId, root)
  if (existing && turnId && existing.turnId === turnId) return { action: 'duplicate', record: existing }
  if (inFlightBySession.has(sessionId)) return { action: 'in-flight', reason: 'a gate re-check is already running for this session' }

  if (path.resolve(root) !== path.resolve(getFsRoot())) {
    const verdict: GateVerdict = {
      ran: false, ok: false,
      skipped: `The hook fired for ${root}, which is not the editor’s active project — no gate was run.`,
      layoutFindings: [], layoutFindingCount: 0, expectedFindings: [],
      consoleErrors: [], consoleErrorCount: 0, consoleEntries: [], unverified: [],
    }
    const record = recordGateVerdict({ at: new Date().toISOString(), projectRoot: root, sessionId, turnId, source: 'stop-hook', verdict, summary: verdictSummary(verdict) })
    return { action: 'skipped', record, reason: verdict.skipped }
  }

  inFlightBySession.add(sessionId)
  try {
    const verdict = await verdictRunner()
    const record = recordGateVerdict({ at: new Date().toISOString(), projectRoot: root, sessionId, turnId, source: 'stop-hook', verdict, summary: verdictSummary(verdict) })
    // Delivery checkpoints (§13.3): a verified turn may drop a
    // checkpoint commit — only on a clean verdict, and only
    // where the project opted in. The helper checks both and
    // never throws into this path.
    if (verdict.ran && verdict.ok) await maybeCheckpointAfterVerifiedTurn(root)
    return { action: 'recorded', record }
  } finally {
    inFlightBySession.delete(sessionId)
  }
}

/** Test hook: forget records + in-flight state. */
export function resetGateHookState(): void {
  recordsByRoot.clear()
  inFlightBySession.clear()
}

/* ------------------------------------------------------------------ */
/* The generated hook files                                            */
/* ------------------------------------------------------------------ */

/** ALE's generated-config location for the hook machinery:
 * beside the agent settings (ALE-owned state), never in the
 * user's Muse Code config and never in a project. */
export function gateHookDir(): string {
  return path.join(path.dirname(getAgentSettingsPath()), 'ale-musecode-hooks')
}

const HOOK_SCRIPT = `#!/usr/bin/env node
// ALE managed Stop hook (generated by the editor; do not edit —
// it is rewritten when the editor's port changes). Forwards the
// hook payload on stdin to the editor's stop-hook endpoint.
// Always exits 0: a hook must never break the agent's turn.
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', async () => {
  try {
    const body = Buffer.concat(chunks).toString('utf-8')
    await fetch('http://127.0.0.1:__PORT__/api/musecode/stop-hook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60000),
    })
  } catch { /* the editor is not running — the verdict simply isn't recorded */ }
  process.exit(0)
})
setTimeout(() => process.exit(0), 65000).unref()
`

/**
 * Write (or refresh) the managed hooks file + its script and
 * return the hooks file path for the supervisor's spawn slot.
 * Content-addressed by port: unchanged content is not
 * rewritten, so the supervisor's host fingerprint stays stable
 * across turns. Returns null when the state dir is unwritable
 * (sessions then run without the hook — the pipe notices the
 * missing slot and skips its verdict wait).
 */
export function ensureGateHookFiles(): string | null {
  try {
    const dir = gateHookDir()
    fs.mkdirSync(dir, { recursive: true })
    const scriptPath = path.join(dir, 'stop-hook.mjs')
    const hooksPath = path.join(dir, 'hooks.json')
    const script = HOOK_SCRIPT.replace('__PORT__', String(aleEditorPort()))
    const hooks = JSON.stringify({
      hooks: {
        Stop: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${JSON.stringify(scriptPath)}` }] }],
      },
    }, null, 2)
    if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, 'utf-8') !== script) {
      fs.writeFileSync(scriptPath, script, 'utf-8')
    }
    if (!fs.existsSync(hooksPath) || fs.readFileSync(hooksPath, 'utf-8') !== hooks) {
      fs.writeFileSync(hooksPath, hooks, 'utf-8')
    }
    return hooksPath
  } catch {
    return null
  }
}

/** The spawn argument pair for headless dispatch (§13 uses the
 * same managed hook as chat sessions): -c managed_hooks_path. */
export function gateHookConfigArgs(hooksPath: string): string[] {
  return ['-c', `managed_hooks_path=${JSON.stringify(hooksPath)}`]
}
