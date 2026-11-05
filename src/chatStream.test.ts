import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { beginChatSse, mapMastraChunk, previewPartialArgs, summarizeArgs, summarizeResult } from './chatStream.js'

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
  })

  it('summarizes file lists and errors', () => {
    assert.equal(summarizeResult({ files: ['a', 'b'], root: '/x' }), '2 files')
    assert.equal(summarizeResult({ error: 'Not found: /nope' }), 'Not found: /nope')
    assert.equal(summarizeResult({ ok: true, path: '/a', bytes: 12 }), '/a · 12b')
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
