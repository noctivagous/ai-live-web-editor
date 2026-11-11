/**
 * Muse Code sandbox postures (Muse Code design §5.2/§5.3, as
 * amended by the spike, spike item 6): the posture vocabulary,
 * the resolution rule, and the concrete run configuration each
 * posture maps to. Pure logic, shared by both sides — the
 * sandbox surface (wizard step + Settings) renders from it, the
 * host stores and (from slice 4) spawns from it.
 *
 * Storage (Q9): the device-wide default posture rides the device
 * prefs (uiPrefs.museSandboxPosture); a project may carry its
 * own override in project.ai.json (museSandboxPosture), which
 * travels with the project. Resolution: project override →
 * device default → 'unblocked'.
 *
 * The mapping follows the spike's evidence: posture is
 * constructed at host spawn (serve flags + `-c` config), and the
 * approval mode is the one per-session value, selected on the
 * wire at session start (approvalMode). Named permission
 * profiles are not used — this install ships no profile catalog.
 *
 * Workspace trust is part of the posture (the spike's headline
 * finding): without it, a per-session MCP server never starts,
 * project skills and hooks don't load, and nothing says so.
 * Unblocked and Sandboxed therefore spawn trusted; Strict does
 * not, and the surface says plainly what that turns off.
 *
 * `--yolo` is never generated, and the sandbox is never disabled
 * by any posture: Unblocked means "no blocks in practice",
 * achieved by the approval mode and grants, not by removing the
 * sandbox. Strict's optional extra hardening (--disable-write /
 * --disable-shell) is deliberately not in the default mapping —
 * it would stop the agent editing files at all; a future grants
 * control can add it per project.
 */

export type SandboxPosture = 'unblocked' | 'sandboxed' | 'strict'

export const SANDBOX_POSTURES: readonly SandboxPosture[] = ['unblocked', 'sandboxed', 'strict']

export const DEFAULT_SANDBOX_POSTURE: SandboxPosture = 'unblocked'

export function isSandboxPosture(value: unknown): value is SandboxPosture {
  return value === 'unblocked' || value === 'sandboxed' || value === 'strict'
}

/** A stored posture value, validated: undefined when absent or
 * not a posture (callers decide what absence means — for the
 * project override it means "no override"). */
export function sanitizeSandboxPosture(value: unknown): SandboxPosture | undefined {
  return isSandboxPosture(value) ? value : undefined
}

/** The posture in force: project override → device default →
 * the standing default. Both inputs are raw stored values. */
export function resolveSandboxPosture(globalDefault: unknown, projectOverride: unknown): SandboxPosture {
  return sanitizeSandboxPosture(projectOverride)
    ?? sanitizeSandboxPosture(globalDefault)
    ?? DEFAULT_SANDBOX_POSTURE
}

/** Per-session approval mode, selected on the wire at session
 * start (spike item 6): the CLI spellings are never / on-request
 * / untrusted. */
export type MuseApprovalMode = 'allowAll' | 'onRequest' | 'denyUnmatched'

export type SandboxNetworkTier = 'proxy-only' | 'restricted' | 'unrestricted'

/** One posture, concretely: what the supervisor spawns (slice 4)
 * and what it selects per session. A run-configuration record —
 * building it runs nothing. */
export interface MuseRunConfig {
  posture: SandboxPosture
  /** The sandbox is on in every posture; nothing maps to
   * --disable-sandbox or --yolo. */
  sandbox: true
  sandboxNetwork: SandboxNetworkTier
  /** Spawn with --trust-workspace for the project (see header). */
  trustWorkspace: boolean
  approvalMode: MuseApprovalMode
  /** Host-level flags for `muse serve` (posture is host-fixed on
   * the stdio shape). */
  serveArgs: string[]
  /** The one-shot equivalents for `muse exec` (dispatch). */
  execArgs: string[]
}

export function museRunConfig(
  posture: SandboxPosture,
  opts: { networkUnrestricted?: boolean } = {},
): MuseRunConfig {
  switch (posture) {
    case 'unblocked': {
      const network: SandboxNetworkTier = opts.networkUnrestricted ? 'unrestricted' : 'proxy-only'
      return {
        posture, sandbox: true, sandboxNetwork: network, trustWorkspace: true, approvalMode: 'allowAll',
        serveArgs: ['--sandbox-network', network, '--trust-workspace'],
        execArgs: ['--disable-approval', '--sandbox-network', network, '--trust-workspace'],
      }
    }
    case 'sandboxed': {
      return {
        posture, sandbox: true, sandboxNetwork: 'proxy-only', trustWorkspace: true, approvalMode: 'onRequest',
        serveArgs: ['--sandbox-network', 'proxy-only', '--trust-workspace'],
        execArgs: ['--approval-mode', 'on-request', '--sandbox-network', 'proxy-only', '--trust-workspace'],
      }
    }
    case 'strict': {
      return {
        posture, sandbox: true, sandboxNetwork: 'restricted', trustWorkspace: false, approvalMode: 'denyUnmatched',
        serveArgs: ['--sandbox-network', 'restricted'],
        execArgs: ['--approval-mode', 'untrusted', '--sandbox-network', 'restricted'],
      }
    }
  }
}
