/**
 * Web tools as plain host functions (re-platform slice 5,
 * tool wave 4 — group B).
 *
 * web-search, fetch-page and research, served to the OpenCode
 * plugin through POST /api/web/tool (registered in both
 * server.ts and apiApp.ts). Each function is the Mastra tool's
 * execute body (src/mastra/tools/webTools.ts) transcribed with
 * the wrapper removed — the same search-backend plumbing, page
 * fetching and research runner, including fetch-page's
 * loopback/private refusal and research's .md-only saveTo rule.
 *
 * KEY HANDLING (the brief's rule, same as the Mastra path):
 * the search backend's key is resolved inside the host process
 * by the research plumbing (src/research/searchBackend reads
 * the connection store) and never appears in plugin code, in
 * these functions' arguments, or in any payload that crosses
 * the dispatch boundary — the plugin sends only the tool name
 * and the model's input, exactly like every other wave.
 */
import fs from 'node:fs'
import { withDispatchDebugLog } from '../chatDebug.js'
import path from 'node:path'
import { getFsRoot } from '../launcher.js'
import { resolveProjectPath } from '../projectPath.js'
import { fetchPageText } from '../research/fetchPage.js'
import { runResearch } from '../research/research.js'
import { webSearch } from '../research/searchBackend.js'

type Input = Record<string, any>

async function webSearchTool(input: Input) {
  const { query, count, freshness } = input ?? {}
  const r = await webSearch(query, { count, freshness })
  if (r.ok === false) return { ok: false, error: r.error }
  return {
    ok: true,
    via: r.backendLabel,
    results: r.results,
    ...(r.answer ? { answer: r.answer } : {}),
    ...(r.searched === false ? { note: 'The provider answered from its own knowledge without searching; treat the answer as ungrounded.' } : {}),
  }
}

async function fetchPage(input: Input) {
  const { url } = input ?? {}
  const r = await fetchPageText(url)
  if (r.ok === false) return { ok: false, error: r.error }
  return { ok: true, title: r.title, url: r.url, text: r.text, truncated: r.truncated }
}

async function research(input: Input) {
  const { question, queries, saveTo } = input ?? {}
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
    sources: r.sources.map((s) => ({ n: s.n, title: s.title, url: s.url })),
    searches: r.searches,
    pagesFetched: r.pagesFetched,
    synthesized: r.synthesized,
    savedPath,
  }
}

/** The wave-4 group-B web tools by their (Mastra-identical) names. */
export const WEB_TOOL_HANDLERS: Record<string, (input: Input) => Promise<unknown>> = {
  'web-search': webSearchTool,
  'fetch-page': fetchPage,
  'research': research,
}

export const WEB_TOOL_NAMES = Object.keys(WEB_TOOL_HANDLERS)

/** Run one web tool by name; unknown names are an error value,
 * never a throw (the dispatch endpoint's contract). */
async function runWebToolImpl(name: string, input: Input): Promise<unknown> {
  const handler = WEB_TOOL_HANDLERS[name]
  if (!handler) {
    return { ok: false, error: `unknown web tool "${name}". Available: ${WEB_TOOL_NAMES.join(', ')}` }
  }
  return handler(input ?? {})
}

/** The exported dispatch: the impl above, plus its per-tool debug
 * record when chat debug is on (slice 9 — chatDebug.ts). */
export async function runWebTool(name: string, input: Input): Promise<unknown> {
  return withDispatchDebugLog(name, input, () => runWebToolImpl(name, input))
}
