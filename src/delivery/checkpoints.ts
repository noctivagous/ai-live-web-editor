/**
 * Checkpoints (Facets design §13.3): ordinary commits, visibly
 * marked with the ale-checkpoint: prefix, that tie agent work
 * to an undo history keyed by turns instead of anonymous
 * saves. Two doors, both deliberate:
 *
 * - the user's own action in the Git section (always allowed —
 *   it is their repository and their click);
 * - a verified chat turn, ONLY when the project has opted in
 *   (`agentCheckpoints` in the delivery settings) — automatic
 *   commits change history, so the default is off and the
 *   opt-in is the user's word, stored per project.
 *
 * Settings live in <project>/.ai-live/delivery.json beside the
 * gate's own verdict records — ALE state, never briefed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { CHECKPOINT_PREFIX, commitStaged, gitStatus, runGitOrThrow } from './git.js'

export interface DeliverySettings {
  /** May a verified turn drop a checkpoint commit on its own? */
  agentCheckpoints: boolean
}

export function deliverySettingsPath(root: string): string {
  return path.join(root, '.ai-live', 'delivery.json')
}

export function readDeliverySettings(root: string): DeliverySettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(deliverySettingsPath(root), 'utf-8')) as Partial<DeliverySettings>
    return { agentCheckpoints: parsed.agentCheckpoints === true }
  } catch {
    return { agentCheckpoints: false }
  }
}

export function writeDeliverySettings(root: string, settings: DeliverySettings): DeliverySettings {
  const file = deliverySettingsPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}

export interface CheckpointResult {
  created: boolean
  hash?: string
  reason?: string
}

/** Commit the whole working tree as a marked checkpoint.
 * A clean tree is a no-op with the reason said plainly. */
export async function createCheckpoint(root: string, note?: string): Promise<CheckpointResult> {
  const status = await gitStatus(root)
  if (!status.isRepo) return { created: false, reason: 'not a git repository' }
  if (status.clean) return { created: false, reason: 'the tree is clean — nothing to checkpoint' }
  await runGitOrThrow(root, ['add', '-A'])
  const label = (note ?? '').trim()
  const { hash } = await commitStaged(root, `${CHECKPOINT_PREFIX} ${label || 'checkpoint'}`)
  return { created: true, hash }
}

/**
 * The turn/verdict door: called from the Stop-hook gate path
 * after a verdict is recorded. Drops a checkpoint only when
 * the verdict is clean, the project opted in, and there is
 * something to commit. Never throws — a checkpoint must not
 * break the gate path that called it.
 */
export async function maybeCheckpointAfterVerifiedTurn(root: string): Promise<CheckpointResult> {
  try {
    if (!readDeliverySettings(root).agentCheckpoints) {
      return { created: false, reason: 'agent checkpoints are not enabled for this project' }
    }
    return await createCheckpoint(root, 'verified turn')
  } catch (e) {
    return { created: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
