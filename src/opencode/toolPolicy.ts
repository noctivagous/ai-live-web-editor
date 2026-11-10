/**
 * Per-turn tool policy registry (re-platform slice 7) — the host
 * side of the plugin's tool.execute.before backstop.
 *
 * The primary gating is OpenCode's own permission machinery
 * (agent rules in the generated config + the translator's
 * per-turn session PATCH — see opencode/agents.ts): denied tools
 * are hidden from the model and blocked server-side before any
 * plugin code runs. This registry is the third layer, for the
 * case those two miss — a prompt path that reached execution with
 * stale session permissions. The translator records each turn's
 * computed allowed set here, keyed by OpenCode session id, at the
 * same moment it PATCHes the session; the plugin's execute.before
 * hook POSTs { sessionID, tool } to /api/opencode/tool-check
 * before running any ALE tool, and throws on a deny.
 *
 * Posture for the unknown: a session with NO recorded policy is
 * allowed through — the permission layers already governed what
 * the model could see and call, and sessions are only ever
 * created by the translator, which always records a policy before
 * prompting. The registry is a backstop, not a gatekeeper.
 *
 * In-memory and per-process, like the translator's session map:
 * the chat stream and this endpoint are served by the same
 * process in both server topologies (server.ts and apiApp.ts
 * mount both), so the registry the translator writes is the one
 * the hook consults. Entries are replaced per turn and dropped
 * when the translator drops the session.
 */
import type { SketchMode } from '../sketchSession.js'

interface TurnToolPolicy {
  allowed: ReadonlySet<string>
  mode: SketchMode
}

const policies = new Map<string, TurnToolPolicy>()

/** Record (or replace) the allowed ALE tool set for the turn
 * about to run in this session. */
export function setTurnToolPolicy(sessionID: string, allowed: Iterable<string>, mode: SketchMode): void {
  if (!sessionID) return
  policies.set(sessionID, { allowed: new Set(allowed), mode })
}

/** Drop a session's policy (the session was dropped/recreated). */
export function clearTurnToolPolicy(sessionID: string): void {
  if (!sessionID) return
  policies.delete(sessionID)
}

export interface ToolCheckResult {
  allow: boolean
  reason?: string
}

/** The backstop's verdict for one proposed tool call. */
export function checkTurnTool(sessionID: string, tool: string): ToolCheckResult {
  const policy = typeof sessionID === 'string' ? policies.get(sessionID) : undefined
  if (!policy) return { allow: true }
  if (policy.allowed.has(tool)) return { allow: true }
  return {
    allow: false,
    reason: `${tool} is not available in this turn (${policy.mode} workflow). `
      + 'The tools offered this turn are the full set for it — continue with those, '
      + 'or say in one line that this step needs a tool the turn does not have.',
  }
}

/** POST /api/opencode/tool-check handler (mounted in both
 * servers, next to the other plugin dispatches). A malformed body
 * is an allow: the hook treats anything but an explicit deny as
 * pass-through, and the execute that follows will surface any
 * real problem as tool content. */
export function handleToolCheck(body: unknown): ToolCheckResult {
  const b = (body ?? {}) as { sessionID?: unknown; tool?: unknown }
  const sessionID = typeof b.sessionID === 'string' ? b.sessionID : ''
  const tool = typeof b.tool === 'string' ? b.tool : ''
  if (!tool) return { allow: true }
  return checkTurnTool(sessionID, tool)
}
