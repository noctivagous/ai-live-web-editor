import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSearchBackend, resolveSearchBackend, type SearchOption } from '../searchSession.js'
import { parseResponsesSearch, providerWebSearch } from './providerSearch.js'

const META_SHAPE = {
  output: [
    {
      type: 'web_search_call', status: 'completed',
      results: [
        { type: 'text_result', title: 'British GP', url: 'https://example.com/gp', snippet: 'Leclerc won…' },
        { type: 'text_result', title: 'Dup', url: 'https://example.com/gp', snippet: 'duplicate url' },
      ],
    },
    {
      type: 'message', role: 'assistant',
      content: [{
        type: 'output_text', text: 'Leclerc won the most recent race.',
        annotations: [
          { type: 'url_citation', url: 'https://example.com/gp', title: 'British GP', start_index: 0, end_index: 7 },
          { type: 'url_citation', url: 'https://example.org/report', title: 'Race report', start_index: 8, end_index: 12 },
        ],
      }],
    },
  ],
}

test('parseResponsesSearch reads Meta results + citations, deduped', () => {
  const r = parseResponsesSearch(META_SHAPE)
  assert.equal(r.searched, true)
  assert.equal(r.results.length, 2)
  assert.equal(r.results[0].snippet, 'Leclerc won…')
  assert.equal(r.results[1].url, 'https://example.org/report')
  assert.match(r.answer || '', /Leclerc won/)
})

test('parseResponsesSearch reads OpenAI action.sources', () => {
  const r = parseResponsesSearch({
    output: [
      { type: 'web_search_call', action: { type: 'search', query: 'q', sources: [{ url: 'https://a.example/1' }, { url: 'https://a.example/2' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'Answer.', annotations: [] }] },
    ],
  })
  assert.equal(r.searched, true)
  assert.deepEqual(r.results.map(x => x.url), ['https://a.example/1', 'https://a.example/2'])
})

test('parseResponsesSearch: model answering without searching is explicit', () => {
  const r = parseResponsesSearch({
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Paris.', annotations: [] }] }],
  })
  assert.equal(r.searched, false)
  assert.equal(r.results.length, 0)
  assert.equal(r.answer, 'Paris.')
})

test('providerWebSearch posts the Responses shape and parses the reply', async () => {
  let seenUrl = ''
  let seenBody: Record<string, unknown> = {}
  const stub = async (url: string, init?: RequestInit) => {
    seenUrl = url
    seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify(META_SHAPE), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const r = await providerWebSearch('who won', { name: 'Meta', baseUrl: 'https://api.meta.ai/v1/', model: 'muse-spark-1.3', apiKey: 'k' }, stub)
  assert.equal(seenUrl, 'https://api.meta.ai/v1/responses')
  assert.deepEqual(seenBody.tools, [{ type: 'web_search' }])
  assert.deepEqual(seenBody.include, ['web_search_call.results'])
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.results.length, 2)
})

test('providerWebSearch surfaces HTTP errors with the provider name', async () => {
  const stub = async () => new Response('nope', { status: 401 })
  const r = await providerWebSearch('q', { name: 'Meta', baseUrl: 'https://x/v1', model: 'm', apiKey: 'bad' }, stub)
  assert.equal(r.ok, false)
  if (r.ok === false) assert.match(r.error, /Meta web search failed: HTTP 401/)
})

const OPTS = (provider: boolean, brave: boolean): SearchOption[] => [
  { id: 'provider', label: 'P web search', available: provider },
  { id: 'brave', label: 'Brave Search', available: brave },
]

test('resolveSearchBackend: defaults prefer the provider, then Brave, then off', () => {
  assert.equal(resolveSearchBackend(null, OPTS(true, true)), 'provider')
  assert.equal(resolveSearchBackend(null, OPTS(false, true)), 'brave')
  assert.equal(resolveSearchBackend(null, OPTS(false, false)), 'off')
})

test('resolveSearchBackend: an explicit choice wins while available, off always wins', () => {
  assert.equal(resolveSearchBackend('brave', OPTS(true, true)), 'brave')
  assert.equal(resolveSearchBackend('off', OPTS(true, true)), 'off')
  assert.equal(resolveSearchBackend('provider', OPTS(false, true)), 'brave')
  assert.equal(parseSearchBackend('brave'), 'brave')
  assert.equal(parseSearchBackend('bogus'), null)
})
