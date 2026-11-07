/**
 * Web-search backend session state (phase-11-06 §N): which
 * search the agent's web tools use. Two backends exist —
 * 'provider' (the active connection's own web search, when
 * its preset declares one: nothing extra to configure) and
 * 'brave' (the editor's Brave key). The header bar's Search
 * setting stores an explicit choice here; with no choice, the
 * provider wins when available (the user's point: most people
 * need nothing extra), then Brave, then off. Mirrored to both
 * chat surfaces through the workflow snapshot, like the
 * device target.
 */
import { activeSearchTarget } from './connections.js'
import { braveApiKey } from './env.js'

export type SearchBackendId = 'provider' | 'brave' | 'off'

export interface SearchOption {
  id: 'provider' | 'brave'
  label: string
  available: boolean
}

let choice: SearchBackendId | null = null

export function parseSearchBackend(value: unknown): SearchBackendId | null {
  return value === 'provider' || value === 'brave' || value === 'off' ? value : null
}

export function getSearchChoice(): SearchBackendId | null {
  return choice
}

export function setSearchChoice(next: SearchBackendId | null): void {
  choice = next
}

/** What could serve search right now, best labels first. */
export function searchOptions(): SearchOption[] {
  const target = activeSearchTarget()
  return [
    {
      id: 'provider',
      label: target ? `${target.name} web search` : 'Provider web search',
      available: Boolean(target),
    },
    {
      id: 'brave',
      label: 'Brave Search',
      available: Boolean(braveApiKey()),
    },
  ]
}

/** The backend a search would actually use, given a choice + availability. */
export function resolveSearchBackend(
  picked: SearchBackendId | null,
  options: SearchOption[],
): SearchBackendId {
  const avail = (id: 'provider' | 'brave') => options.find(o => o.id === id)?.available === true
  if (picked === 'off') return 'off'
  if (picked && avail(picked)) return picked
  if (avail('provider')) return 'provider'
  if (avail('brave')) return 'brave'
  return 'off'
}

export function getSearchBackend(): SearchBackendId {
  return resolveSearchBackend(choice, searchOptions())
}

/** The workflow-snapshot fields both chat surfaces render from. */
export function searchSnapshot() {
  const options = searchOptions()
  return {
    searchBackend: resolveSearchBackend(choice, options),
    searchOptions: options,
  }
}
