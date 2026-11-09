import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abortSignalFromReq, beginChatSse, describeUpstreamError, isAbortError, mapMastraChunk, previewPartialArgs, sumTurnUsage, summarizeArgs, summarizeResult, toTurnUsage } from './chatStream.js'

describe('mapMastraChunk', () => {
  it('maps Mastra payload.text text-delta', () => {
    assert.deepEqual(
      mapMastraChunk({ type: 'text-delta', payload: { id: '1', text: 'Hello' } }),
      { type: 'text-delta', text: 'Hello' },
    )
  })

  it('maps AI SDK delta / textDelta fallbacks', () => {
    assert.deepEqual(
      mapMastraChunk({ type: 'text-delta', delta: 'Hi' }),
      { type: 'text-delta', text: 'Hi' },
    )
    assert.deepEqual(
      mapMastraChunk({ type: 'text-delta', textDelta: 'There' }),
      { type: 'text-delta', text: 'There' },
    )
  })

  it('drops empty text-delta', () => {
    assert.equal(mapMastraChunk({ type: 'text-delta', payload: { id: '1', text: '' } }), null)
  })

  it('maps reasoning and status', () => {
    assert.deepEqual(
      mapMastraChunk({ type: 'reasoning-start', payload: { id: 'r' } }),
      { type: 'status', text: 'thinking…' },
    )
    assert.deepEqual(
      mapMastraChunk({ type: 'reasoning-delta', payload: { id: 'r', text: 'plan' } }),
      { type: 'reasoning-delta', text: 'plan' },
    )
    assert.deepEqual(
      mapMastraChunk({ type: 'step-start', payload: { modelId: 'grok-4.7' } }),
      { type: 'status', text: 'calling grok-4.7…' },
    )
  })

  it('maps tool streaming start before args finish', () => {
    assert.deepEqual(
      mapMastraChunk({
        type: 'tool-call-input-streaming-start',
        payload: { toolCallId: 'c1', toolName: 'write-real-file' },
      }),
      { type: 'tool-call', id: 'c1', name: 'write-real-file', detail: 'write-real-file…' },
    )
  })

  it('maps tool-call-delta args fragments', () => {
    assert.deepEqual(
      mapMastraChunk({
        type: 'tool-call-delta',
        payload: { toolCallId: 'c1', argsTextDelta: '{"path":"' },
      }),
      { type: 'tool-delta', id: 'c1', name: 'tool', text: '{"path":"' },
    )
  })

  it('maps tool-call args and results', () => {
    assert.deepEqual(
      mapMastraChunk({
        type: 'tool-call',
        payload: { toolCallId: 'c1', toolName: 'read-real-file', args: { path: '/App.jsx' } },
      }),
      { type: 'tool-call', id: 'c1', name: 'read-real-file', detail: 'read-real-file /App.jsx' },
    )
    assert.deepEqual(
      mapMastraChunk({
        type: 'tool-result',
        payload: {
          toolCallId: 'c1',
          toolName: 'read-real-file',
          result: { path: '/App.jsx', content: 'abc' },
        },
      }),
      { type: 'tool-result', id: 'c1', name: 'read-real-file', ok: true, detail: '/App.jsx · 3 chars' },
    )
  })

  it('marks tool-result with error payload as failed', () => {
    assert.deepEqual(
      mapMastraChunk({
        type: 'tool-result',
        payload: {
          toolCallId: 'c3',
          toolName: 'str-replace',
          result: { error: 'old_string not found — file unchanged', path: '/App.jsx', matches: 0 },
        },
      }),
      { type: 'tool-result', id: 'c3', name: 'str-replace', ok: false, detail: 'old_string not found — file unchanged · /App.jsx · 0 matches' },
    )
  })

  it('maps tool-error', () => {
    assert.deepEqual(
      mapMastraChunk({
        type: 'tool-error',
        payload: { toolCallId: 'c2', toolName: 'inspect-dom', error: new Error('timeout') },
      }),
      { type: 'tool-result', id: 'c2', name: 'inspect-dom', ok: false, detail: 'timeout' },
    )
  })

  it('maps error objects', () => {
    assert.deepEqual(
      mapMastraChunk({ type: 'error', payload: { error: { message: 'no key' } } }),
      { type: 'error', error: 'no key' },
    )
  })
})

describe('summarize', () => {
  it('previews incomplete tool JSON', () => {
    assert.equal(previewPartialArgs('write-real-file', '{"path":"/App.jsx","con'), 'write-real-file /App.jsx')
    assert.equal(
      previewPartialArgs('write-real-file', '{"path":"/App.jsx","content":"hi"}'),
      'write-real-file /App.jsx 2 chars',
    )
  })

  it('summarizes write args', () => {
    assert.equal(
      summarizeArgs('write-real-file', { path: '/App.jsx', content: 'xxxx' }),
      'write-real-file /App.jsx 4 chars',
    )
    assert.equal(
      summarizeArgs('str-replace', { path: '/App.jsx', old_string: 'ab', new_string: 'abcd' }),
      'str-replace /App.jsx 2→4',
    )
    assert.equal(
      summarizeArgs('grep', { pattern: 'Inbox' }),
      'grep Inbox',
    )
    assert.equal(
      summarizeArgs('patch-dom', { selector: 'h1', op: 'text', text: 'Hello' }),
      'patch-dom h1 text Hello',
    )
  })

  it('summarizes file lists and errors', () => {
    assert.equal(summarizeResult({ files: ['a', 'b'], root: '/x' }), '2 files')
    assert.equal(summarizeResult({ error: 'Not found: /nope' }), 'Not found: /nope')
    assert.equal(
      summarizeResult({ error: 'old_string not found — file unchanged', path: '/src/App.jsx', matches: 0, fileLines: 3 }),
      'old_string not found — file unchanged · /src/App.jsx · 0 matches · 3 lines',
    )
    assert.equal(
      summarizeResult({ ok: true, path: '/src/App.jsx', matches: 1, range: [2, 3], fileLines: 4 }),
      '/src/App.jsx · 1 match · L2–3 · 4 lines',
    )
    assert.equal(summarizeResult({ ok: true, path: '/a', bytes: 12 }), '/a · 12b')
    assert.equal(summarizeResult({ hits: [{ path: '/a', line: 1, text: 'x' }], count: 1 }), '1 hits')
    assert.equal(summarizeResult({ path: '/a', matches: 1, snippet: '1| x' }), '/a · 1 match')
    assert.equal(summarizeResult({ path: '/a', startLine: 10, endLine: 20, content: 'x'.repeat(8) }), '/a · 8 chars · L10–20')
  })
})

describe('beginChatSse', () => {
  it('writes connected comment and flushes each event', () => {
    const writes: string[] = []
    let flushes = 0
    const res = {
      setHeader() {},
      flushHeaders() {},
      write(chunk: string) { writes.push(chunk); return true },
      flush() { flushes += 1 },
      end() {},
      socket: { setNoDelay() {} },
    }
    const { send } = beginChatSse(res)
    send({ type: 'text-delta', text: 'x' })
    assert.equal(writes[0], ': connected\n\n')
    assert.equal(writes[1], 'data: {"type":"text-delta","text":"x"}\n\n')
    assert.ok(flushes >= 2)
  })
})

describe('abortSignalFromReq', () => {
  it('aborts when the HTTP request reports aborted or close', () => {
    assert.equal(isAbortError({ name: 'AbortError' }), true)
    assert.equal(isAbortError(new Error('nope')), false)
    const listeners: Record<string, () => void> = {}
    const req = {
      aborted: false,
      on(event: string, listener: () => void) { listeners[event] = listener },
    }
    const signal = abortSignalFromReq(req)
    assert.equal(signal.aborted, false)
    listeners.aborted()
    assert.equal(signal.aborted, true)
    const already = abortSignalFromReq({ aborted: true })
    assert.equal(already.aborted, true)
  })
})

describe('toTurnUsage', () => {
  it('maps camelCase AI SDK usage', () => {
    assert.deepEqual(
      toTurnUsage({ inputTokens: 120, outputTokens: 30, totalTokens: 150 }),
      { input: 120, output: 30, total: 150 },
    )
  })
  it('maps snake_case gateway usage and derives the total', () => {
    assert.deepEqual(
      toTurnUsage({ input_tokens: 10, output_tokens: 5 }),
      { input: 10, output: 5, total: 15 },
    )
  })
  it('returns null — never zeros — when the provider reports nothing', () => {
    assert.equal(toTurnUsage(undefined), null)
    assert.equal(toTurnUsage(null), null)
    assert.equal(toTurnUsage({}), null)
    assert.equal(toTurnUsage({ model: 'x' }), null)
  })
  it('keeps the cache and reasoning splits (AI SDK shape)', () => {
    assert.deepEqual(
      toTurnUsage({ inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedInputTokens: 800, reasoningTokens: 50 }),
      { input: 1000, output: 200, total: 1200, cachedInput: 800, reasoning: 50 },
    )
    assert.deepEqual(
      toTurnUsage({ inputTokens: 1000, outputTokens: 10, cacheCreationInputTokens: 250 }),
      { input: 1000, output: 10, total: 1010, cacheWriteInput: 250 },
    )
  })
  it('keeps the splits from snake_case gateway detail objects', () => {
    assert.deepEqual(
      toTurnUsage({
        prompt_tokens: 500,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 400 },
        completion_tokens_details: { reasoning_tokens: 30 },
      }),
      { input: 500, output: 100, total: 600, cachedInput: 400, reasoning: 30 },
    )
  })
  it('keeps a reported 0, omits unreported splits, clamps splits to their totals', () => {
    assert.deepEqual(
      toTurnUsage({ inputTokens: 100, outputTokens: 5, cachedInputTokens: 0 }),
      { input: 100, output: 5, total: 105, cachedInput: 0 },
    )
    assert.equal(toTurnUsage({ inputTokens: 100, outputTokens: 5, cachedInputTokens: 5000 })?.cachedInput, 100)
    assert.equal('reasoning' in (toTurnUsage({ inputTokens: 100, outputTokens: 5 }) as object), false)
  })
})

describe('sumTurnUsage', () => {
  it('adds two streams, merging the splits only when reported', () => {
    assert.deepEqual(
      sumTurnUsage(
        { input: 100, output: 20, total: 120, cachedInput: 80 },
        { input: 50, output: 10, total: 60, cachedInput: 40, reasoning: 5 },
      ),
      { input: 150, output: 30, total: 180, cachedInput: 120, reasoning: 5 },
    )
    assert.deepEqual(
      sumTurnUsage({ input: 1, output: 2, total: 3 }, { input: 4, output: 5, total: 9 }),
      { input: 5, output: 7, total: 12 },
    )
  })
  it('passes nulls through', () => {
    const u = { input: 1, output: 2, total: 3 }
    assert.equal(sumTurnUsage(null, null), null)
    assert.equal(sumTurnUsage(u, null), u)
    assert.equal(sumTurnUsage(null, u), u)
  })
})

describe('describeUpstreamError', () => {
  const creditsBody = '{"code":"permission-denied","error":"Your team 24841cc9 has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit."}'
  const creditsErr = Object.assign(new Error('Forbidden'), {
    statusCode: 403,
    url: 'https://api.x.ai/v1/chat/completions',
    responseBody: creditsBody,
  })

  it('surfaces the provider billing detail instead of bare Forbidden', () => {
    const msg = describeUpstreamError(creditsErr)
    assert.match(msg, /403/)
    assert.match(msg, /credits/i)
    assert.match(msg, /spending limit/i)
    assert.match(msg, /api\.x\.ai/)
    assert.doesNotMatch(msg, /^Forbidden$/)
  })

  it('maps streamed error chunks through the same detail', () => {
    const ev = mapMastraChunk({ type: 'error', payload: { error: creditsErr } })
    assert.equal(ev?.type, 'error')
    assert.match((ev as { error: string }).error, /credits/i)
  })

  it('points 401 at the API key setup', () => {
    const msg = describeUpstreamError(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
    assert.match(msg, /API key/i)
  })

  it('labels 429 as rate-limited and 5xx as a provider outage', () => {
    assert.match(describeUpstreamError(Object.assign(new Error('Too Many Requests'), { statusCode: 429 })), /rate-limit/i)
    assert.match(describeUpstreamError(Object.assign(new Error('Bad Gateway'), { statusCode: 502 })), /provider/i)
  })

  it('passes plain errors and strings through', () => {
    assert.equal(describeUpstreamError(new Error('boom')), 'boom')
    assert.equal(describeUpstreamError('plain failure'), 'plain failure')
  })
})
