import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abortSignalFromReq, beginChatSse, isAbortError, mapMastraChunk, previewPartialArgs, summarizeArgs, summarizeResult, toTurnUsage } from './chatStream.js'

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
      { type: 'tool-result', id: 'c3', name: 'str-replace', ok: false, detail: 'old_string not found — file unchanged' },
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
})
