/**
 * Brave Search API client (phase-11-06 §N): the editor's native
 * web search. One responsibility — turn a query into compact,
 * agent-shaped results. The key is the user's own (BRAVE_API_KEY
 * in `.env`); a missing key produces a remedy, not a stack trace.
 */
import { braveApiBase, braveApiKey } from '../env.js'

export interface BraveResult {
  title: string
  url: string
  snippet: string
  age?: string
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

export const BRAVE_KEY_MISSING =
  'No Brave Search API key configured. Add one in Settings → Search (a free key from brave.com/search/api), then retry.'

/**
 * One Brave web search. `freshness` maps to Brave's pd/pw/pm/py
 * codes. Results are capped and stripped to what an agent needs.
 */
export async function braveSearch(
  query: string,
  opts: { count?: number; freshness?: 'day' | 'week' | 'month' | 'year' } = {},
  fetchImpl: FetchImpl = fetch,
  apiKey: string = braveApiKey(),
): Promise<{ ok: true; results: BraveResult[] } | { ok: false; error: string }> {
  if (!apiKey) return { ok: false, error: BRAVE_KEY_MISSING }
  const count = Math.min(Math.max(opts.count ?? 6, 1), 10)
  const params = new URLSearchParams({ q: query, count: String(count) })
  const freshnessCode = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const
  if (opts.freshness) params.set('freshness', freshnessCode[opts.freshness])
  let res: Response
  try {
    res = await fetchImpl(`${braveApiBase()}/web/search?${params}`, {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    return { ok: false, error: `Brave search request failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) {
    // Brave answers a bad key with 422 + a machine code; name
    // it plainly so the Settings Test button reads clearly.
    let code = ''
    try {
      const body = await res.json() as { error?: { code?: string } }
      code = body?.error?.code ?? ''
    } catch { /* non-JSON error body — the status alone will do */ }
    if (code === 'SUBSCRIPTION_TOKEN_INVALID') {
      return { ok: false, error: 'Brave says that API key is invalid.' }
    }
    return { ok: false, error: `Brave search failed: HTTP ${res.status}` }
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: 'Brave search returned unparseable JSON' }
  }
  return { ok: true, results: parseBraveResults(data) }
}

/** Parse Brave's web.results shape tolerantly; unknown shapes yield []. */
export function parseBraveResults(data: unknown): BraveResult[] {
  const web = (data as { web?: { results?: unknown } } | null)?.web
  if (!Array.isArray(web?.results)) return []
  const out: BraveResult[] = []
  for (const r of web.results) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    if (typeof row.url !== 'string' || !row.url) continue
    out.push({
      title: typeof row.title === 'string' ? row.title : row.url,
      url: row.url,
      snippet: typeof row.description === 'string' ? row.description : '',
      age: typeof row.age === 'string' ? row.age : undefined,
    })
  }
  return out
}
