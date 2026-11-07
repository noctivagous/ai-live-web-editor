/**
 * The web-search dispatcher (phase-11-06 §N): the one entry
 * point the agent's web-search tool and the research compiler
 * call. Routes to the backend the header bar's Search setting
 * resolved to — the active provider's native search, or Brave
 * — and returns one BraveResult-shaped union either way, so
 * callers never know which served them beyond the label.
 */
import { activeSearchTarget } from '../connections.js'
import { getSearchBackend } from '../searchSession.js'
import { braveSearch, type BraveResult } from './brave.js'
import { providerWebSearch } from './providerSearch.js'

export interface WebSearchOk {
  ok: true
  results: BraveResult[]
  backend: 'provider' | 'brave'
  backendLabel: string
  /** Provider backend only: the grounded answer + whether it searched. */
  answer?: string
  searched?: boolean
}

export const SEARCH_OFF =
  'Web search is off. Turn it on in the chat header\'s Search setting — the active provider\'s built-in web search if it has one, or Brave Search with a key from Settings → Search.'

export async function webSearch(
  query: string,
  opts: { count?: number; freshness?: 'day' | 'week' | 'month' | 'year' } = {},
): Promise<WebSearchOk | { ok: false; error: string }> {
  const backend = getSearchBackend()
  if (backend === 'off') return { ok: false, error: SEARCH_OFF }
  if (backend === 'provider') {
    const target = activeSearchTarget()
    if (!target) return { ok: false, error: 'The active provider connection has no web search. Pick Brave in the header Search setting, or switch connections.' }
    const r = await providerWebSearch(query, target)
    if (r.ok === false) return r
    return {
      ok: true,
      results: r.results,
      backend: 'provider',
      backendLabel: `${target.name} web search`,
      answer: r.answer,
      searched: r.searched,
    }
  }
  const r = await braveSearch(query, opts)
  if (r.ok === false) return r
  return { ok: true, results: r.results, backend: 'brave', backendLabel: 'Brave Search' }
}

/** Any backend usable right now (the brief's research line keys on this). */
export function searchAvailable(): boolean {
  return getSearchBackend() !== 'off'
}

export function searchBackendLabel(): string {
  const backend = getSearchBackend()
  if (backend === 'provider') {
    const target = activeSearchTarget()
    return target ? `${target.name} web search` : 'Provider web search'
  }
  if (backend === 'brave') return 'Brave Search'
  return 'off'
}
