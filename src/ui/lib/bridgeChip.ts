import type { PluginEnsureInfo } from './api'

/**
 * The Preview header's bridge chip (bridge guarantee, slice 3): is
 * the live page actually connected to the editor? The derivation is
 * pure and fed ONLY by launcher-origin data — the plugin-ensure
 * state (slice 1) and the launcher's own /api/page/status client
 * count. Nothing here is sourced from the page's server (:5173):
 * in exactly the failure cases the chip exists for, that server is
 * down or was never bridged, so its silence must read as "not
 * bridged", never as an error and never as "bridged".
 *
 * `clients` is null when the launcher's status route could not
 * produce a count (its server-side relay to the page's bridge
 * registry failed). A failed probe is evidence of no connection,
 * so it derives 'not-bridged' wherever the plugin itself is in
 * place — the same honesty rule as slice 2's annotate states.
 */

export type BridgeChipState = 'bridged' | 'not-bridged' | 'plugin-missing' | 'none'

export interface BridgeChip {
  state: BridgeChipState
  label: string
  /** Modifier for the header's .pill idiom. */
  tone: 'good' | 'warn' | 'bad' | ''
  tooltip: string
}

const NONE: BridgeChip = { state: 'none', label: '', tone: '', tooltip: '' }

const BRIDGED_TIP = 'The live page is connected to the editor: the agent can inspect and edit it live, and annotations work.'
const NOT_BRIDGED_TIP = 'The editor plugin is in this project, but no live page is connected — the dev server may be stopped, or the page is not open yet.'

export function deriveBridgeChip(ensure: PluginEnsureInfo | null, clients: number | null): BridgeChip {
  // No live page exists to bridge; the chip has nothing to say.
  if (ensure?.state === 'not-vite') return NONE
  // A connected client is observed fact and outranks the paperwork:
  // if a page is answering on the bridge, the page is bridged.
  if (clients !== null && clients > 0) {
    return {
      state: 'bridged',
      label: 'Bridged',
      tone: 'good',
      tooltip: clients === 1 ? BRIDGED_TIP : `${clients} live pages are connected to the editor: the agent can inspect and edit them live, and annotations work.`,
    }
  }
  switch (ensure?.state) {
    case 'cannot':
      return {
        state: 'plugin-missing',
        label: 'Plugin missing',
        tone: 'bad',
        tooltip: `The editor plugin is not in this project's vite config${ensure.configFile ? ` (${ensure.configFile})` : ''}, so the page cannot connect live. Click to see the line to add.`,
      }
    case 'missing-declined':
      return {
        state: 'plugin-missing',
        label: 'Plugin missing',
        tone: 'bad',
        tooltip: 'The editor plugin is off for this project, so the page cannot connect live. Click to re-enable it in the notice above the preview.',
      }
    case 'registered':
    case 'added':
    case 'standalone':
      return { state: 'not-bridged', label: 'Not bridged', tone: 'warn', tooltip: NOT_BRIDGED_TIP }
    default:
      // No ensure state at all (the launcher API did not answer —
      // e.g. the UI is plugin-hosted, where there is no ensure
      // endpoint) and no client observed: nothing truthful to claim.
      return NONE
  }
}
