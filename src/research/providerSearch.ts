/**
 * Provider-native web search (phase-11-06 §N): some providers
 * ground answers in live web results themselves — no separate
 * search key. Implemented for the Responses API shape
 * (tools: [{type: 'web_search'}]): Meta Model API search
 * grounding and OpenAI web search. The model decides whether
 * to search; `include: ['web_search_call.results']` asks for
 * the raw hits so this returns BraveResult-shaped sources
 * alongside the provider's own grounded answer.
 */
import type { BraveResult, FetchImpl } from './brave.js'

export interface ProviderSearchTarget {
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

export interface ProviderSearchResult {
  results: BraveResult[]
  /** The provider's grounded answer text, when it produced one. */
  answer?: string
  /** False when the model answered without searching. */
  searched: boolean
}

export async function providerWebSearch(
  query: string,
  target: ProviderSearchTarget,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: true } & ProviderSearchResult | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetchImpl(`${target.baseUrl.replace(/\/+$/, '')}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify({
        model: target.model,
        input: query,
        tools: [{ type: 'web_search' }],
        include: ['web_search_call.results'],
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (e) {
    return { ok: false, error: `${target.name} web search request failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) return { ok: false, error: `${target.name} web search failed: HTTP ${res.status}` }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: `${target.name} web search returned unparseable JSON` }
  }
  return { ok: true, ...parseResponsesSearch(data) }
}

/**
 * Parse a Responses API payload tolerantly across providers:
 * Meta returns raw hits on web_search_call.results; OpenAI
 * puts sources on web_search_call.action.sources; both attach
 * url_citation annotations to the answer text.
 */
export function parseResponsesSearch(data: unknown): ProviderSearchResult {
  const output = (data as { output?: unknown })?.output
  const results: BraveResult[] = []
  const seen = new Set<string>()
  let answer = ''
  let searched = false
  const add = (title: string, url: string, snippet: string) => {
    if (!url || seen.has(url) || results.length >= 10) return
    seen.add(url)
    results.push({ title: title || url, url, snippet })
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      if (it.type === 'web_search_call') {
        searched = true
        if (Array.isArray(it.results)) {
          for (const r of it.results) {
            const row = r as Record<string, unknown>
            if (typeof row?.url === 'string') {
              add(typeof row.title === 'string' ? row.title : '', row.url, typeof row.snippet === 'string' ? row.snippet : '')
            }
          }
        }
        const sources = (it.action as { sources?: unknown } | undefined)?.sources
        if (Array.isArray(sources)) {
          for (const s of sources) {
            const row = s as Record<string, unknown>
            if (typeof row?.url === 'string') {
              add(typeof row.title === 'string' ? row.title : '', row.url, '')
            }
          }
        }
      }
      if (it.type === 'message' && Array.isArray(it.content)) {
        for (const block of it.content) {
          const b = block as Record<string, unknown>
          if (b?.type !== 'output_text') continue
          if (typeof b.text === 'string') answer += (answer ? '\n' : '') + b.text
          if (Array.isArray(b.annotations)) {
            for (const a of b.annotations) {
              const ann = a as Record<string, unknown>
              if (ann?.type === 'url_citation' && typeof ann.url === 'string') {
                add(typeof ann.title === 'string' ? ann.title : '', ann.url, '')
              }
            }
          }
        }
      }
    }
  }
  return { results, answer: answer || undefined, searched }
}
