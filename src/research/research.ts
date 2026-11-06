/**
 * The research compiler (phase-11-06 §N): fan a question out
 * over several Brave searches, fetch the best pages, and make
 * ONE synthesis call over the compiled evidence. The calling
 * agent plans the sub-queries (it is the model in the loop);
 * this tool executes, dedupes, reads, and concludes — returning
 * a brief with [n] citations against a numbered source list.
 *
 * Degradation is honest: if every search fails, the error
 * surfaces (usually the missing-key remedy); if synthesis is
 * unavailable, the brief is the evidence pack, labelled as such.
 */
import { openaiApiKey, openaiBaseUrl, openaiModelName } from '../env.js'
import { braveSearch, type BraveResult } from './brave.js'
import { fetchPageText } from './fetchPage.js'

export interface ResearchSource extends BraveResult {
  n: number
  text?: string
  fetchFailed?: boolean
}

export interface ResearchDeps {
  search: (query: string) => Promise<{ ok: true; results: BraveResult[] } | { ok: false; error: string }>
  fetchText: (url: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  synthesize: (question: string, evidence: string) => Promise<string | null>
}

const MAX_QUERIES = 6
const MAX_PAGES = 8
const PER_PAGE_CHARS = 5_000
const TOTAL_EVIDENCE_CHARS = 45_000

/** Synthesis through the active model connection; null when unavailable. */
export async function synthesizeWithActiveModel(question: string, evidence: string): Promise<string | null> {
  const key = openaiApiKey()
  if (!key) return null
  const base = openaiBaseUrl() || 'https://api.openai.com/v1'
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: openaiModelName(),
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are the research compiler inside a code editor. Answer ONLY from the evidence provided. Structure: a direct answer first (2-5 sentences), then key findings as bullets, then a short "Uncertainty & disagreements" note when sources conflict or evidence is thin. Cite sources inline as [n] matching the evidence numbering. Do not invent facts, versions, dates or prices that are not in the evidence.',
          },
          { role: 'user', content: `Question: ${question}\n\nEvidence:\n${evidence}` },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content?.trim()
    return text || null
  } catch {
    return null
  }
}

export function defaultResearchDeps(): ResearchDeps {
  return {
    search: (q) => braveSearch(q, { count: 6 }),
    fetchText: async (url) => {
      const r = await fetchPageText(url)
      if (r.ok === false) return { ok: false, error: r.error }
      return { ok: true, text: r.text }
    },
    synthesize: synthesizeWithActiveModel,
  }
}

export async function runResearch(
  input: { question: string; queries: string[]; maxPages?: number },
  deps: ResearchDeps = defaultResearchDeps(),
): Promise<
  | { ok: true; brief: string; sources: ResearchSource[]; searches: number; pagesFetched: number; synthesized: boolean }
  | { ok: false; error: string }
> {
  const queries = [...new Set([input.question, ...input.queries].map(q => q.trim()).filter(Boolean))].slice(0, MAX_QUERIES)
  const searched = await Promise.all(queries.map(q => deps.search(q)))
  if (searched.every(s => s.ok === false)) {
    let firstError = 'All searches failed'
    for (const s of searched) {
      if (s.ok === false) { firstError = s.error; break }
    }
    return { ok: false, error: firstError }
  }
  // Dedupe by URL, first occurrence wins; number the sources.
  const byUrl = new Map<string, ResearchSource>()
  for (const s of searched) {
    if (!s.ok) continue
    for (const r of s.results) {
      if (!byUrl.has(r.url)) byUrl.set(r.url, { ...r, n: byUrl.size + 1 })
    }
  }
  const sources = [...byUrl.values()]
  const maxPages = Math.min(input.maxPages ?? 6, MAX_PAGES)
  let pagesFetched = 0
  await Promise.all(sources.slice(0, maxPages).map(async (src) => {
    const r = await deps.fetchText(src.url)
    if (r.ok) {
      src.text = r.text.slice(0, PER_PAGE_CHARS)
      pagesFetched++
    } else {
      src.fetchFailed = true
    }
  }))

  // Compile the evidence pack within a total budget.
  let budget = TOTAL_EVIDENCE_CHARS
  const evidenceParts: string[] = []
  for (const src of sources) {
    if (budget <= 0) break
    const body = (src.text ?? src.snippet ?? '').slice(0, Math.min(PER_PAGE_CHARS, budget))
    if (!body) continue
    evidenceParts.push(`[${src.n}] ${src.title} — ${src.url}\n${body}`)
    budget -= body.length
  }
  const evidence = evidenceParts.join('\n\n')

  const sourceList = sources.map(s => `${s.n}. ${s.title} — ${s.url}`).join('\n')
  const synthesis = await deps.synthesize(input.question, evidence)
  const brief = synthesis
    ? `# Research: ${input.question}\n\n${synthesis}\n\n## Sources\n${sourceList}\n`
    : `# Research: ${input.question}\n\n## Evidence pack (synthesis unavailable — conclusions not drawn)\n\n${evidence}\n\n## Sources\n${sourceList}\n`
  return { ok: true, brief, sources, searches: queries.length, pagesFetched, synthesized: Boolean(synthesis) }
}
