import assert from 'node:assert/strict'
import test from 'node:test'
import { braveSearch, parseBraveResults, BRAVE_KEY_MISSING, type FetchImpl } from './brave.js'
import { fetchPageText, htmlToText, isPublicHttpUrl } from './fetchPage.js'
import { runResearch, type ResearchDeps } from './research.js'

const BRAVE_FIXTURE = {
  web: {
    results: [
      { title: 'Brave Search API', url: 'https://brave.com/search/api/', description: 'Independent index.', age: '3 days ago' },
      { title: 'Docs', url: 'https://api-dashboard.search.brave.com/app/documentation', description: 'Endpoints and keys.' },
      { title: 42, url: 'https://example.com/weird', description: 'non-string title tolerated' },
      { description: 'no url — skipped' },
    ],
  },
}

test('parseBraveResults reads the web.results shape tolerantly', () => {
  const results = parseBraveResults(BRAVE_FIXTURE)
  assert.equal(results.length, 3)
  assert.equal(results[0].title, 'Brave Search API')
  assert.equal(results[0].age, '3 days ago')
  assert.equal(results[2].title, 'https://example.com/weird')
  assert.deepEqual(parseBraveResults(null), [])
  assert.deepEqual(parseBraveResults({ web: {} }), [])
})

test('braveSearch without a key returns the remedy, not a throw', async () => {
  const r = await braveSearch('anything', {}, fetch, '')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error, BRAVE_KEY_MISSING)
})

test('braveSearch sends the token header and parses results', async () => {
  let seenUrl = ''
  let seenToken = ''
  const stub: FetchImpl = async (url, init) => {
    seenUrl = String(url)
    seenToken = (init?.headers as Record<string, string>)['X-Subscription-Token']
    return new Response(JSON.stringify(BRAVE_FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const r = await braveSearch('brave api', { count: 4 }, stub, 'test-key')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.results.length, 3)
  assert.match(seenUrl, /q=brave\+api/)
  assert.match(seenUrl, /count=4/)
  assert.equal(seenToken, 'test-key')
})

test('isPublicHttpUrl blocks loopback and private hosts', () => {
  assert.equal(isPublicHttpUrl('https://example.com/docs'), true)
  assert.equal(isPublicHttpUrl('http://localhost:4112/api/workflow'), false)
  assert.equal(isPublicHttpUrl('http://127.0.0.1/x'), false)
  assert.equal(isPublicHttpUrl('http://192.168.1.10/x'), false)
  assert.equal(isPublicHttpUrl('http://10.0.0.5/x'), false)
  assert.equal(isPublicHttpUrl('http://172.16.0.9/x'), false)
  assert.equal(isPublicHttpUrl('http://172.32.0.9/x'), true)
  assert.equal(isPublicHttpUrl('file:///etc/passwd'), false)
  assert.equal(isPublicHttpUrl('not a url'), false)
})

test('htmlToText strips chrome and scripts, keeps prose, decodes entities', () => {
  const { title, text } = htmlToText(`
    <html><head><title>Guide &amp; Reference</title><style>.x{}</style></head>
    <body><nav>menu</nav><script>track()</script>
    <h1>Getting started</h1><p>First &lt;step&gt; here.</p><p>Second&nbsp;para.</p>
    <footer>copyright</footer></body></html>`)
  assert.equal(title, 'Guide & Reference')
  assert.match(text, /Getting started/)
  assert.match(text, /First <step> here\./)
  assert.doesNotMatch(text, /track\(\)|menu|copyright/)
})

test('fetchPageText refuses private URLs before any fetch', async () => {
  let called = false
  const stub: FetchImpl = async () => { called = true; return new Response('') }
  const r = await fetchPageText('http://localhost:5173/', stub)
  assert.equal(r.ok, false)
  assert.equal(called, false)
})

function fakeDeps(overrides: Partial<ResearchDeps> = {}): ResearchDeps {
  return {
    search: async (q) => ({
      ok: true,
      results: q.includes('pricing')
        ? [{ title: 'Pricing', url: 'https://example.com/pricing', snippet: 'Free tier exists.' }]
        : [
            { title: 'Overview', url: 'https://example.com/overview', snippet: 'Overview snippet.' },
            { title: 'Pricing', url: 'https://example.com/pricing', snippet: 'Free tier exists.' },
          ],
    }),
    fetchText: async (url) => url.includes('pricing')
      ? { ok: false, error: 'HTTP 403' }
      : { ok: true, text: 'Full overview body with the facts.' },
    synthesize: async (_q, evidence) => `Answer from evidence. ${evidence.includes('[1]') ? 'Cited [1].' : 'UNCITED'}`,
    ...overrides,
  }
}

test('runResearch dedupes, numbers, fetches, synthesizes a cited brief', async () => {
  const r = await runResearch({ question: 'What does it cost?', queries: ['x overview', 'x pricing'] }, fakeDeps())
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.sources.length, 2)
  assert.equal(r.sources[0].n, 1)
  assert.equal(r.pagesFetched, 1) // pricing fetch failed; snippet is the fallback
  assert.equal(r.sources[1].fetchFailed, true)
  assert.equal(r.synthesized, true)
  assert.match(r.brief, /# Research: What does it cost\?/)
  assert.match(r.brief, /Cited \[1\]\./)
  assert.match(r.brief, /## Sources/)
})

test('runResearch degrades to a labelled evidence pack when synthesis is unavailable', async () => {
  const r = await runResearch({ question: 'Q?', queries: ['x overview'] }, fakeDeps({ synthesize: async () => null }))
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.synthesized, false)
  assert.match(r.brief, /synthesis unavailable/)
  assert.match(r.brief, /Full overview body/)
})

test('runResearch surfaces the search error when every search fails', async () => {
  const r = await runResearch(
    { question: 'Q?', queries: ['a'] },
    fakeDeps({ search: async () => ({ ok: false, error: BRAVE_KEY_MISSING }) }),
  )
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error, BRAVE_KEY_MISSING)
})
