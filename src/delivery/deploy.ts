/**
 * The Deployment section's core (Facets design §13.5): the
 * provider plugin contract, the registry, the deployment
 * history store, and the action service every door (UI, MCP)
 * goes through.
 *
 * A plugin declares: detect (its config files / project
 * shape), connect state (account connected or the honest
 * absence), deploy (preview | production), promote, rollback,
 * logs, status. A new provider is a new plugin, never surgery
 * on the facet.
 *
 * Secrets rule (§7.3): credentials come from the process
 * environment or ALE's settings — never from the project
 * directory — and are never shown, logged, briefed, or
 * stored. Targets carry env var NAMES per environment only.
 * History records what shipped, when, from which commit, by
 * which action — ids and URLs, never tokens.
 */
import fs from 'node:fs'
import path from 'node:path'
import { gitStatus } from './git.js'

export type DeployKind = 'preview' | 'production'
export type DeployActionName = 'deploy' | 'promote' | 'rollback'

export interface DeployTarget {
  /** `${pluginId}:${name}` — stable across reads. */
  id: string
  pluginId: string
  /** The project's name at the provider. */
  name: string
  /** The provider's service label ('Workers', 'Pages', 'Vercel'…). */
  service: string
  /** The config file that declares this target. */
  configFile: string
  /** Env var NAMES per environment — never values (§7.3). */
  envNames: Record<string, string[]>
}

export interface ConnectState {
  connected: boolean
  /** A human label for the account (name/email) — never a token. */
  accountLabel?: string
  /** How to connect, shown in the not-connected state. */
  howToConnect: string
}

export interface DeployResult {
  ok: boolean
  url?: string
  deploymentId?: string
  /** The command/API output tail, for the record. */
  output?: string
  error?: string
}

export interface DeployStatus {
  url?: string
  /** ISO time of the last known deploy, when the provider says. */
  lastDeployAt?: string
  state?: string
  domains: string[]
  /** Plain words when a part of status cannot be known. */
  note?: string
}

export interface DeployLogEntry {
  at?: string
  text: string
}

export interface DeployPlugin {
  id: string
  label: string
  detect: (root: string) => DeployTarget[]
  connectState: (root: string) => Promise<ConnectState>
  deploy: (root: string, target: DeployTarget, kind: DeployKind) => Promise<DeployResult>
  promote: (root: string, target: DeployTarget, record: DeploymentRecord) => Promise<DeployResult>
  rollback: (root: string, target: DeployTarget, record: DeploymentRecord) => Promise<DeployResult>
  logs: (root: string, target: DeployTarget, record?: DeploymentRecord) => Promise<DeployLogEntry[]>
  status: (root: string, target: DeployTarget) => Promise<DeployStatus>
}

/* ── history ─────────────────────────────────────────────── */

export interface DeploymentRecord {
  id: string
  /** ISO timestamp. */
  at: string
  pluginId: string
  targetId: string
  targetName: string
  kind: DeployKind
  action: DeployActionName
  /** The commit that shipped (full hash when known). */
  commit?: string
  url?: string
  deploymentId?: string
  state: 'succeeded' | 'failed'
  /**
   * Who made this deployment (§13.8): 'manual' for a deploy
   * launched from ALE; 'ci' for one a pipeline made, when a
   * record arrives from a provider's own history carrying
   * that fact — so "deployed with no one pressing deploy in
   * ALE" is never misread as a manual release. In v1 every
   * record ALE writes itself is 'manual': no CI-originated
   * deploy path exists yet; the field lands now so history
   * can carry the distinction, and records written before
   * it have no source (unknown, shown as manual-era).
   */
  source?: 'manual' | 'ci'
  note?: string
}

export function deploymentsPath(root: string): string {
  return path.join(root, '.ai-live', 'deployments.json')
}

export function readDeployments(root: string): DeploymentRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(deploymentsPath(root), 'utf-8')) as { records?: DeploymentRecord[] }
    return Array.isArray(parsed.records) ? parsed.records : []
  } catch { return [] }
}

export function recordDeployment(root: string, record: DeploymentRecord): DeploymentRecord {
  const records = [record, ...readDeployments(root)].slice(0, 100)
  const file = deploymentsPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ records }, null, 2), 'utf-8')
  return record
}

export function lastDeployment(root: string, targetId?: string): DeploymentRecord | null {
  const records = readDeployments(root)
  return (targetId ? records.find(r => r.targetId === targetId) : records[0]) ?? null
}

/* ── the action service ──────────────────────────────────── */

export interface TargetView {
  target: DeployTarget
  pluginLabel: string
  connect: ConnectState
  lastDeployment: DeploymentRecord | null
}

export function detectTargets(root: string, plugins: DeployPlugin[]): DeployTarget[] {
  const targets: DeployTarget[] = []
  for (const plugin of plugins) {
    try { targets.push(...plugin.detect(root)) } catch { /* a broken plugin hides no others */ }
  }
  return targets
}

export async function targetViews(root: string, plugins: DeployPlugin[]): Promise<TargetView[]> {
  const views: TargetView[] = []
  for (const target of detectTargets(root, plugins)) {
    const plugin = plugins.find(p => p.id === target.pluginId)
    if (!plugin) continue
    let connect: ConnectState
    try { connect = await plugin.connectState(root) } catch {
      connect = { connected: false, howToConnect: 'The provider could not be checked.' }
    }
    views.push({ target, pluginLabel: plugin.label, connect, lastDeployment: lastDeployment(root, target.id) })
  }
  return views
}

export interface DeployActionInput {
  action: DeployActionName
  targetId: string
  kind?: DeployKind
  /** For promote/rollback: the recorded deployment acted on. */
  recordId?: string
}

/**
 * One deployment action, with the facet's rules enforced
 * here so every door gets them: unknown target → plain
 * error; not connected → the honest absence (the plugin is
 * never called); the outcome — success or failure — is
 * recorded against the current commit.
 */
export async function runDeployAction(
  root: string,
  plugins: DeployPlugin[],
  input: DeployActionInput,
): Promise<{ record: DeploymentRecord } | { error: string, record?: DeploymentRecord }> {
  const plugin = plugins.find(p => input.targetId.startsWith(`${p.id}:`))
  const target = plugin ? detectTargets(root, [plugin]).find(t => t.id === input.targetId) : undefined
  if (!plugin || !target) return { error: `No deployment target "${input.targetId}" was detected in this project.` }
  const connect = await plugin.connectState(root)
  if (!connect.connected) {
    return { error: `${plugin.label} is not connected. ${connect.howToConnect}` }
  }
  const records = readDeployments(root)
  const source = input.recordId ? records.find(r => r.id === input.recordId) : undefined
  if ((input.action === 'promote' || input.action === 'rollback') && !source) {
    return { error: `A ${input.action} needs a recorded deployment to act on.` }
  }
  let result: DeployResult
  try {
    if (input.action === 'deploy') result = await plugin.deploy(root, target, input.kind ?? 'preview')
    else if (input.action === 'promote') result = await plugin.promote(root, target, source!)
    else result = await plugin.rollback(root, target, source!)
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const status = await gitStatus(root).catch(() => null)
  const record: DeploymentRecord = {
    id: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    pluginId: plugin.id,
    targetId: target.id,
    targetName: target.name,
    kind: input.action === 'deploy' ? (input.kind ?? 'preview') : input.action === 'promote' ? 'production' : (source?.kind ?? 'production'),
    action: input.action,
    ...(status?.head ? { commit: status.head } : {}),
    ...(result.url ? { url: result.url } : {}),
    ...(result.deploymentId ? { deploymentId: result.deploymentId } : {}),
    state: result.ok ? 'succeeded' : 'failed',
    // Launched from ALE by a person (or the agent for them):
    // the actor is manual (§13.8) — see the field's note.
    source: 'manual',
    ...(result.ok ? (result.output ? { note: result.output.slice(0, 300) } : {}) : { note: (result.error ?? 'failed').slice(0, 300) }),
  }
  recordDeployment(root, record)
  return result.ok ? { record } : { error: result.error ?? `${plugin.label} ${input.action} failed.`, record }
}
