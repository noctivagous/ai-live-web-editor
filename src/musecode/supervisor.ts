/**
 * Muse Code supervision (Muse Code design §6 + §14, slice 4).
 *
 * One supervisor owns every `muse serve` spawn for chat. A host
 * is spawned per project: on the stdio shape the sandbox posture
 * and workspace trust are constructed at spawn and are NOT
 * negotiable over the wire (spike item 6/7), so posture or trust
 * changes mean a respawn — the host's fingerprint covers the
 * project root, the resolved posture's run configuration, the
 * binary, and the host-layer slots, and a changed fingerprint
 * replaces the host (the OpenCode supervisor's precedent).
 *
 * Versioning (§14): the binary is located and version-checked
 * through availability.ts before any spawn; the version is
 * recorded on every session record. A binary newer than the
 * tested version runs with a note on the record — drift never
 * blocks a run — while a session-protocol fingerprint mismatch
 * (the SDK's own check against the handshake) fails the session
 * start with a plain message, because a host we cannot speak to
 * cannot be supervised.
 *
 * Sessions are durable on Muse Code's side: the supervisor
 * remembers each project's session id across host respawns and
 * resumes it, so a crash restart or a posture respawn keeps the
 * conversation. Crash restarts are bounded: a host that keeps
 * dying stops being respawned and the failure surfaces plainly.
 */
import crypto from 'node:crypto'
import {
  MuseClient, checkServedFingerprint,
  type Session, type StartSessionOptions,
} from '@muse-code/sdk'

/** The per-session MCP server map the session/start config
 * admits (the SDK composes it into SessionStartParams; it is
 * not a standalone export). */
export type MusecodeMcpServers = NonNullable<NonNullable<StartSessionOptions['config']>['mcpServers']>
import { appSettings } from '../appSettings.js'
import { readProjectConfig } from '../projectConfig.js'
import {
  museRunConfig, resolveSandboxPosture,
  type MuseApprovalMode, type MuseRunConfig, type SandboxPosture,
} from '../ui/lib/museSandbox.js'
import { getMuseCodeAvailability, type MuseCodeAvailability } from './availability.js'
import { musecodeUnavailableMessage } from './unavailable.js'

/** The Muse Code version this build was tested against (the
 * spike's binary + SDK). Newer binaries still run (§14) — the
 * record just says so. */
export const MUSECODE_TESTED_VERSION = '1.4.15'

/** clientInfo.name must match ^[a-z0-9_]+$ (spike item 1). */
export const MUSECODE_CLIENT_NAME = 'ale'

/** Host-layer slots carried into every session on a host. All
 * optional; each slice that fills one passes it through the
 * ensure call — the supervisor itself owns no MCP server, hook,
 * or skill content. */
export interface MusecodeSessionSlots {
  /** MCP servers registered per session through the session/start
   * config's mcpServers (spike item 2). Slice 5 supplies the ALE
   * server entry here; until then the slot is wired but empty. */
  mcpServers?: MusecodeMcpServers
  /** Absolute path of the managed hooks file, passed to the host
   * at spawn as -c managed_hooks_path=… (spike item 3). Slice 9
   * supplies the Stop hook file; until then the slot is wired
   * but unset. */
  managedHooksPath?: string
  /* Skills slot (design §12, slice 6): skills are installed into
   * Muse Code's fixed discovery roots or shipped per project —
   * there is no per-session registration surface to wire (spike
   * item 5), so slice 6 lands on the install side, not here. This
   * comment is the slot; there is deliberately no field. */
}

/** The posture in force for one project, resolved through slice
 * 3's rule (project override → device default → 'unblocked')
 * from the stores both sides share: project.ai.json on disk and
 * the launcher's app-settings record for the device prefs. */
export function resolveMusecodePosture(projectRoot: string): SandboxPosture {
  let deviceDefault: unknown
  try { deviceDefault = appSettings().get().uiPrefs?.museSandboxPosture } catch { /* unreadable store reads as unset */ }
  let projectOverride: unknown
  try { projectOverride = readProjectConfig(projectRoot).museSandboxPosture } catch { /* no project config → no override */ }
  return resolveSandboxPosture(deviceDefault, projectOverride)
}

/** Spawn arguments for one host: `serve` plus the posture's
 * host-fixed flags, plus the managed-hooks slot when the host
 * layer provides one. Pure — the supervisor's tests pin this
 * shape per posture. Posture mapping itself is slice 3's
 * (museRunConfig); nothing here invents a flag, and no posture
 * produces --yolo or --disable-sandbox. */
export function musecodeServeArgs(runConfig: MuseRunConfig, slots: MusecodeSessionSlots = {}): string[] {
  const args = ['serve', ...runConfig.serveArgs]
  if (slots.managedHooksPath) {
    args.push('-c', `managed_hooks_path=${JSON.stringify(slots.managedHooksPath)}`)
  }
  return args
}

/** The session/start options for one session on a host: the
 * workspace, the posture's per-session approval mode (the one
 * value the wire carries, spike item 6), and the MCP slot when
 * the host layer supplied servers. Pure. */
export function musecodeSessionStartOptions(
  projectRoot: string,
  runConfig: MuseRunConfig,
  slots: MusecodeSessionSlots = {},
): { workspaceRoot: string; approvalMode: MuseApprovalMode; config?: { mcpServers: MusecodeMcpServers } } {
  return {
    workspaceRoot: projectRoot,
    approvalMode: runConfig.approvalMode,
    ...(slots.mcpServers && Object.keys(slots.mcpServers).length > 0
      ? { config: { mcpServers: slots.mcpServers } }
      : {}),
  }
}

/** §14's version record: how the found binary compares with the
 * tested version, in words a run record can carry. Null when it
 * IS the tested version. */
export function musecodeVersionNote(version: string | null): string | null {
  if (!version) return 'Muse Code version not recorded.'
  if (version === MUSECODE_TESTED_VERSION) return null
  return compareVersions(version, MUSECODE_TESTED_VERSION) > 0
    ? `Muse Code ${version} is newer than the version this editor was tested with (${MUSECODE_TESTED_VERSION}); running with it.`
    : `Muse Code ${version} is older than the version this editor was tested with (${MUSECODE_TESTED_VERSION}); running with it.`
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** What a started (or resumed) session is recorded as: the facts
 * §14 wants on every session record — binary version (+ drift
 * note), posture, engine-facing choices — stamped at start. */
export interface MusecodeSessionRecord {
  sessionId: string
  projectRoot: string
  posture: SandboxPosture
  approvalMode: MuseApprovalMode
  trustWorkspace: boolean
  binaryVersion: string
  versionNote: string | null
  /** True when this start resumed a durable session from an
   * earlier host instead of creating a new one. */
  resumed: boolean
  startedAt: string
}

export interface MusecodeHostHandle {
  projectRoot: string
  posture: SandboxPosture
  runConfig: MuseRunConfig
  binaryVersion: string
  versionNote: string | null
  fingerprint: string
}

/** The spawn seam, injectable so tests drive the supervisor's
 * lifecycle without a real binary. The default is the SDK's own
 * spawn against the located binary. */
export interface MusecodeSpawner {
  spawn(opts: { binPath: string; args: string[]; cwd: string; onStderr: (chunk: string) => void }): Promise<MuseClient>
}

const defaultSpawner: MusecodeSpawner = {
  spawn: ({ binPath, args, cwd, onStderr }) => MuseClient.spawn({
    museBin: binPath,
    args,
    cwd,
    clientInfo: { name: MUSECODE_CLIENT_NAME, version: '1.0.0' },
    onStderr,
  }),
}

let spawner: MusecodeSpawner = defaultSpawner

/** Test hook: replace the spawn seam (and drop all hosts). */
export function setMusecodeSpawner(next: MusecodeSpawner | null): void {
  spawner = next ?? defaultSpawner
  stopMusecodeHosts()
}

interface RunningHost {
  client: MuseClient
  handle: MusecodeHostHandle
  fingerprint: string
  log: string[]
  sessions: Map<string, { session: Session; record: MusecodeSessionRecord }>
  /** Set when WE closed the host (respawn/shutdown), so the exit
   * watcher does not count an intentional close as a crash. */
  closing: boolean
}

const hosts = new Map<string, RunningHost>()
/** Durable session ids per project root, kept across host
 * respawns so the conversation resumes (§6 history). */
const durableSessionIds = new Map<string, string>()
const ensureInFlight = new Map<string, Promise<MusecodeHostHandle>>()

const MAX_CRASH_RESPAWNS = 3
const CRASH_WINDOW_MS = 60_000
const crashLedger = new Map<string, { count: number; firstAt: number }>()

function noteCrash(projectRoot: string): void {
  const now = Date.now()
  const cur = crashLedger.get(projectRoot)
  if (!cur || now - cur.firstAt > CRASH_WINDOW_MS) crashLedger.set(projectRoot, { count: 1, firstAt: now })
  else cur.count += 1
}

function crashLimitReached(projectRoot: string): boolean {
  const cur = crashLedger.get(projectRoot)
  return Boolean(cur && cur.count >= MAX_CRASH_RESPAWNS && Date.now() - cur.firstAt <= CRASH_WINDOW_MS)
}

function hostFingerprint(projectRoot: string, runConfig: MuseRunConfig, slots: MusecodeSessionSlots, availability: MuseCodeAvailability): string {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({
      root: projectRoot,
      serveArgs: runConfig.serveArgs,
      approvalMode: runConfig.approvalMode,
      hooks: slots.managedHooksPath ?? null,
      mcp: slots.mcpServers ? Object.keys(slots.mcpServers).sort() : [],
      bin: availability.binPath,
      version: availability.version,
    }))
    .digest('hex')
    .slice(0, 16)
  return `${projectRoot}|${runConfig.posture}|${hash}`
}

/**
 * Ensure a `muse serve` host is running for `projectRoot` under
 * the CURRENT resolved posture and the given host-layer slots.
 * Respawns when the fingerprint changed (posture, trust, slots,
 * binary). Throws an Error whose message is fit to show the user:
 * the honest-absence message when there is no binary, a plain
 * protocol message when the host's schema has drifted past the
 * SDK, and a crash message when the host keeps dying.
 */
export async function ensureMusecodeHost(
  projectRoot: string,
  slots: MusecodeSessionSlots = {},
): Promise<MusecodeHostHandle> {
  const inFlight = ensureInFlight.get(projectRoot)
  if (inFlight) return inFlight
  const run = ensureMusecodeHostInner(projectRoot, slots).finally(() => { ensureInFlight.delete(projectRoot) })
  ensureInFlight.set(projectRoot, run)
  return run
}

async function ensureMusecodeHostInner(projectRoot: string, slots: MusecodeSessionSlots): Promise<MusecodeHostHandle> {
  const availability = await getMuseCodeAvailability()
  if (!availability.available || !availability.binPath) {
    throw new Error(musecodeUnavailableMessage(false))
  }
  const posture = resolveMusecodePosture(projectRoot)
  const runConfig = museRunConfig(posture)
  const fingerprint = hostFingerprint(projectRoot, runConfig, slots, availability)
  const existing = hosts.get(projectRoot)
  if (existing && existing.fingerprint === fingerprint) return existing.handle
  if (crashLimitReached(projectRoot)) {
    throw new Error(
      'Muse Code keeps stopping on this machine, so the editor has stopped restarting it. ' +
      'Check that Muse Code runs from a terminal, then restart the editor — or pick a different chat engine in Settings → Agent & Chat.',
    )
  }
  if (existing) await closeHost(projectRoot, existing)

  const log: string[] = []
  const client = await spawner.spawn({
    binPath: availability.binPath,
    args: musecodeServeArgs(runConfig, slots),
    cwd: projectRoot,
    onStderr: (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) log.push(line)
      if (log.length > 200) log.splice(0, log.length - 200)
    },
  })

  // §14: the protocol check rides the handshake the SDK already
  // ran — a served fingerprint the SDK does not recognize means
  // the binary has drifted past what this build can supervise.
  let servedFingerprint: string | null = null
  try { servedFingerprint = client.initializeResult.schema.fingerprint } catch { /* a spawn-built client always has one */ }
  if (servedFingerprint) {
    const warning = checkServedFingerprint(servedFingerprint)
    if (warning) {
      await client.close().catch(() => { /* best-effort */ })
      throw new Error(
        `Muse Code's session protocol has changed in the installed version (${availability.version ?? 'unknown'}), ` +
        'and this version of the editor can’t talk to it yet. Pick a different chat engine in Settings → Agent & Chat for now. ' +
        `(${warning.message})`,
      )
    }
  }

  const handle: MusecodeHostHandle = {
    projectRoot,
    posture,
    runConfig,
    binaryVersion: availability.version ?? 'unknown',
    versionNote: musecodeVersionNote(availability.version),
    fingerprint,
  }
  const entry: RunningHost = { client, handle, fingerprint, log, sessions: new Map(), closing: false }
  hosts.set(projectRoot, entry)
  // Crash watch: an exit we did not cause retires the host (the
  // next ensure respawns it, bounded by the crash ledger) and is
  // counted. Our own closes are flagged first, so they never
  // count.
  void client.exit.then((exit) => {
    if (hosts.get(projectRoot) === entry) hosts.delete(projectRoot)
    if (!entry.closing) {
      noteCrash(projectRoot)
      console.log('[musecode] host exit (unexpected)', JSON.stringify(exit).slice(0, 200))
    }
  }).catch(() => { /* the exit promise never rejects in the SDK; belt and braces */ })
  console.log(`[musecode] v${handle.binaryVersion} serving ${projectRoot} (posture ${posture})`)
  return handle
}

async function closeHost(projectRoot: string, entry: RunningHost): Promise<void> {
  if (hosts.get(projectRoot) === entry) hosts.delete(projectRoot)
  entry.closing = true
  await entry.client.close().catch(() => { /* best-effort */ })
}

/** Stop every host. Called on project switch and on launcher
 * exit (wired in launcher.ts next to stopOpencodeServer). The
 * durable session ids are kept: a later host for the same
 * project resumes the conversation. */
export function stopMusecodeHosts(): void {
  for (const [root, entry] of [...hosts]) {
    if (hosts.get(root) === entry) hosts.delete(root)
    entry.closing = true
    void entry.client.close().catch(() => { /* best-effort */ })
  }
}

export function musecodeHostStatus(): { running: boolean; projectRoot?: string; posture?: SandboxPosture; binaryVersion?: string } {
  const first = hosts.values().next().value as RunningHost | undefined
  return first
    ? { running: true, projectRoot: first.handle.projectRoot, posture: first.handle.posture, binaryVersion: first.handle.binaryVersion }
    : { running: false }
}

/** Recent host stderr, for error surfaces (never credentials:
 * the binary's own output only, like the OpenCode log). */
export function musecodeHostLog(projectRoot: string): string[] {
  const entry = hosts.get(projectRoot)
  return entry ? [...entry.log] : []
}

/**
 * The project's live session on its current host, started or
 * resumed as needed, with its §14 record. The session/start
 * carries the posture's approval mode and the MCP slot; approval
 * failures the host reports are logged (the posture's sandbox is
 * the confinement; an approval this client never answers is
 * decided by the host's own default, and its failure lands here
 * rather than vanishing).
 */
export async function getOrStartMusecodeSession(
  projectRoot: string,
  slots: MusecodeSessionSlots = {},
): Promise<{ session: Session; record: MusecodeSessionRecord }> {
  const handle = await ensureMusecodeHost(projectRoot, slots)
  const entry = hosts.get(projectRoot)
  if (!entry) throw new Error('Muse Code stopped before the session could start. Try the turn again.')
  const cached = entry.sessions.get(projectRoot)
  if (cached) return cached
  let session: Session | null = null
  let resumed = false
  const durableId = durableSessionIds.get(projectRoot)
  if (durableId) {
    try {
      session = await entry.client.resumeSession({ sessionId: durableId })
      resumed = true
    } catch { /* the durable session is gone or belongs to a dead host shape — start fresh below */ }
  }
  if (!session) {
    session = await entry.client.startSession(musecodeSessionStartOptions(projectRoot, handle.runConfig, slots))
    resumed = false
  }
  durableSessionIds.set(projectRoot, session.sessionId)
  const pair = { session, record: recordFor(handle, session.sessionId, resumed) }
  entry.sessions.set(projectRoot, pair)
  // A healthy session start is the crash ledger's reset: whatever
  // died before, this host + session pair is alive.
  crashLedger.delete(projectRoot)
  session.onApprovalError((failure) => {
    console.log('[musecode] approval round trip failed', failure.kind, failure.approvalId)
  })
  return pair
}

function recordFor(handle: MusecodeHostHandle, sessionId: string, resumed: boolean): MusecodeSessionRecord {
  return {
    sessionId,
    projectRoot: handle.projectRoot,
    posture: handle.posture,
    approvalMode: handle.runConfig.approvalMode,
    trustWorkspace: handle.runConfig.trustWorkspace,
    binaryVersion: handle.binaryVersion,
    versionNote: handle.versionNote,
    resumed,
    startedAt: new Date().toISOString(),
  }
}

/**
 * Forget the shared Muse Code session for one project root (the
 * chat Clear button's server half on this engine): the live
 * session is dropped and the durable id forgotten, so the next
 * turn starts a fresh conversation. The orphaned durable session
 * is simply never resumed. True when something was dropped.
 */
export function clearMusecodeSession(projectRoot: string): boolean {
  const entry = hosts.get(projectRoot)
  const hadLive = entry ? entry.sessions.delete(projectRoot) : false
  const hadDurable = durableSessionIds.delete(projectRoot)
  return hadLive || hadDurable
}

/** Test hook: drop all supervisor state (hosts are closed). */
export function resetMusecodeSupervisor(): void {
  stopMusecodeHosts()
  durableSessionIds.clear()
  crashLedger.clear()
  ensureInFlight.clear()
}
