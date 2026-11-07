import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../../launcher.js'
import { resolveProjectPath } from '../../projectPath.js'
import { fetchPageText } from '../../research/fetchPage.js'
import { runResearch } from '../../research/research.js'
import { webSearch } from '../../research/searchBackend.js'

export const webSearchTool = createTool({
  id: 'web-search',
  description:
    'Search the web using the search source chosen in the chat header (the active provider\'s built-in web search, or Brave Search). Use for current facts: API shapes, library docs, versions, prior art. Returns compact results (title, url, snippet) — follow up with fetch-page or research when a snippet is not enough.',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    count: z.number().int().positive().max(10).optional().describe('Max results (default 6)'),
    freshness: z.enum(['day', 'week', 'month', 'year']).optional().describe('Only results from this window (Brave backend)'),
  }),
  execute: async ({ query, count, freshness }) => {
    const r = await webSearch(query, { count, freshness })
    if (r.ok === false) return { ok: false, error: r.error }
    return {
      ok: true,
      via: r.backendLabel,
      results: r.results,
      ...(r.answer ? { answer: r.answer } : {}),
      ...(r.searched === false ? { note: 'The provider answered from its own knowledge without searching; treat the answer as ungrounded.' } : {}),
    }
  },
})

export const fetchPageTool = createTool({
  id: 'fetch-page',
  description:
    'Fetch one public web page and return its readable text (title + body, truncated). Use to read a doc, article or reference page found via web-search. Loopback/private hosts are refused.',
  inputSchema: z.object({
    url: z.string().describe('The page URL (http/https, public)'),
  }),
  execute: async ({ url }) => {
    const r = await fetchPageText(url)
    if (r.ok === false) return { ok: false, error: r.error }
    return { ok: true, title: r.title, url: r.url, text: r.text, truncated: r.truncated }
  },
})

export const researchTool = createTool({
  id: 'research',
  description:
    'Deep research: run several web searches, read the best pages, and compile a cited brief (conclusions with [n] source citations, disagreements flagged). YOU plan the fan-out: pass 3-6 specific sub-queries that together cover the question. Use before building something that depends on external facts — a library choice, an API integration, a format spec. With saveTo (a .md path in the project), the brief is also written to disk so later turns can build from it.',
  inputSchema: z.object({
    question: z.string().describe('The research question, stated fully'),
    queries: z.array(z.string()).min(1).max(6).describe('Sub-queries that together cover the question'),
    saveTo: z.string().optional().describe('Optional project-relative .md path to save the brief, e.g. "ai-research/brave-api.md"'),
  }),
  execute: async ({ question, queries, saveTo }) => {
    const r = await runResearch({ question, queries })
    if (r.ok === false) return { ok: false, error: r.error }
    let savedPath: string | undefined
    if (saveTo) {
      if (!saveTo.endsWith('.md')) return { ok: false, error: 'saveTo must be a .md path (research briefs are documents, not code)' }
      const resolved = resolveProjectPath(getFsRoot(), saveTo)
      if (resolved.ok === false) return { ok: false, error: resolved.error }
      fs.mkdirSync(path.dirname(resolved.full), { recursive: true })
      fs.writeFileSync(resolved.full, r.brief, 'utf-8')
      savedPath = resolved.rel
    }
    return {
      ok: true,
      brief: r.brief,
      sources: r.sources.map(s => ({ n: s.n, title: s.title, url: s.url })),
      searches: r.searches,
      pagesFetched: r.pagesFetched,
      synthesized: r.synthesized,
      savedPath,
    }
  },
})
