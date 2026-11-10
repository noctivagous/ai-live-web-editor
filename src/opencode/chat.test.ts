import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { ChatSseResponse, ChatStreamEvent } from '../chatStream.js'
import { setEnvPath } from '../env.js'
import {
  beginConsoleExpectations, endConsoleExpectations, resetConsoleExpectationsForTests,
} from '../verify/consoleExpectations.js'
import {
  clearOpencodeSession, createOpencodeEventFolder, pipeOpencodeChatStream, sumUsage, turnUsageFromTokens,
} from './chat.js'

const SID = 'ses_test'

function ev(type: string, data: Record<string, unknown> = {}) {
  return { type, data: { sessionID: SID, ...data } }
}

describe('opencode event folder', () => {
  it('folds a recorded-shape turn: text, a tool call + result, usage, terminal', () => {
    const folder = createOpencodeEventFolder(SID)
    const out: ChatStreamEvent[] = []
    const push = (e: Parameters<typeof folder.push>[0]) => out.push(...folder.push(e))

    push({ type: 'server.connected', data: {} })
    push(ev('session.text.delta', { assistantMessageID: 'm1', ordinal: 0, delta: 'Stub answer: ' }))
    push(ev('session.text.delta', { assistantMessageID: 'm1', ordinal: 0, delta: 'hello.' }))
    push(ev('session.tool.input.started', { assistantMessageID: 'm1', id: 'call_1', name: 'get-console' }))
    push(ev('session.tool.input.ended', { assistantMessageID: 'm1', id: 'call_1', text: '{}' }))
    push(ev('session.tool.called', { assistantMessageID: 'm1', id: 'call_1', input: {}, executed: false }))
    push(ev('session.tool.success', {
      assistantMessageID: 'm1', id: 'call_1', executed: true,
      content: [{ type: 'text', text: '{"via":"vite-page","entries":[]}' }],
    }))
    push(ev('session.step.ended', {
      assistantMessageID: 'm1', finish: 'tool-calls',
      tokens: { input: 81, output: 42, reasoning: 0, cache: { read: 30, write: 0 } }, cost: 0,
    }))
    push(ev('session.text.delta', { assistantMessageID: 'm2', ordinal: 0, delta: 'Done.' }))
    push(ev('session.step.ended', {
      assistantMessageID: 'm2', finish: 'stop',
      tokens: { input: 100, output: 10, reasoning: 4, cache: { read: 0, write: 5 } }, cost: 0,
    }))
    push(ev('session.execution.succeeded', {}))

    assert.deepEqual(out.filter((e) => e.type === 'text-delta'), [
      { type: 'text-delta', text: 'Stub answer: ' },
      { type: 'text-delta', text: 'hello.' },
      { type: 'text-delta', text: 'Done.' },
    ])
    assert.deepEqual(out.filter((e) => e.type === 'tool-call'), [
      { type: 'tool-call', id: 'call_1', name: 'get-console', detail: 'get-console' },
    ])
    assert.deepEqual(out.filter((e) => e.type === 'tool-result'), [
      { type: 'tool-result', id: 'call_1', name: 'get-console', ok: true, detail: '{"via":"vite-page","entries":[]}' },
    ])
    // Step 1: input 81 + cache.read 30 = 111, cached subset 30.
    // Step 2: input 100 + write 5 = 105. Totals accumulate.
    assert.deepEqual(folder.usage, {
      input: 216, output: 52, total: 268, cachedInput: 30, cacheWriteInput: 5, reasoning: 4,
    })
    assert.equal(folder.terminal, 'succeeded')
    assert.equal(folder.failure, null)
  })

  it('ignores events for other sessions and bus noise', () => {
    const folder = createOpencodeEventFolder(SID)
    assert.deepEqual(folder.push({ type: 'session.text.delta', data: { sessionID: 'ses_other', delta: 'nope' } }), [])
    assert.deepEqual(folder.push({ type: 'provider.updated', data: {} }), [])
    assert.deepEqual(folder.push({ type: 'session.text.delta', data: { delta: 'no session id' } }), [])
    assert.equal(folder.terminal, null)
  })

  it('maps reasoning deltas and tool failures', () => {
    const folder = createOpencodeEventFolder(SID)
    const out: ChatStreamEvent[] = []
    out.push(...folder.push(ev('session.reasoning.delta', { assistantMessageID: 'm1', delta: 'thinking…' })))
    out.push(...folder.push(ev('session.tool.input.started', { assistantMessageID: 'm1', id: 'c9', name: 'edit' })))
    out.push(...folder.push(ev('session.tool.called', { assistantMessageID: 'm1', id: 'c9', input: { path: 'a.txt' } })))
    out.push(...folder.push(ev('session.tool.failed', {
      assistantMessageID: 'm1', id: 'c9', error: { type: 'tool.execution', message: 'Invalid arguments for tool "edit": path missing' },
    })))
    assert.deepEqual(out[0], { type: 'reasoning-delta', text: 'thinking…' })
    assert.equal(out[1].type, 'tool-call')
    assert.deepEqual(out[2], {
      type: 'tool-result', id: 'c9', name: 'edit', ok: false,
      detail: 'Invalid arguments for tool "edit": path missing',
    })
  })

  it('records execution failure as the terminal failure', () => {
    const folder = createOpencodeEventFolder(SID)
    folder.push(ev('session.execution.failed', { error: { message: 'provider exploded' } }))
    assert.equal(folder.terminal, 'failed')
    assert.equal(folder.failure, 'provider exploded')
  })
})

describe('token usage mapping', () => {
  it('adds cache read/write back into input, as subsets', () => {
    assert.deepEqual(
      turnUsageFromTokens({ input: 81, output: 42, reasoning: 0, cache: { read: 30, write: 0 } }),
      { input: 111, output: 42, total: 153, cachedInput: 30, cacheWriteInput: 0 },
    )
  })

  it('keeps reasoning only when reported above zero; null when nothing reported', () => {
    assert.deepEqual(
      turnUsageFromTokens({ input: 5, output: 7, reasoning: 3, cache: { read: 0, write: 0 } }),
      { input: 5, output: 7, total: 12, cachedInput: 0, cacheWriteInput: 0, reasoning: 3 },
    )
    assert.equal(turnUsageFromTokens({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }), null)
    assert.equal(turnUsageFromTokens(undefined), null)
  })

  it('sumUsage merges partial reports', () => {
    assert.deepEqual(
      sumUsage({ input: 10, output: 2, total: 12 }, { input: 5, output: 1, total: 6, cachedInput: 5 }),
      { input: 15, output: 3, total: 18, cachedInput: 5 },
    )
    assert.equal(sumUsage(null, null), null)
  })
})

describe('pipeOpencodeChatStream without a connection', () => {
  let dir: string
  let savedKey: string | undefined
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-chat-'))
    setEnvPath(path.join(dir, '.env'))
    savedKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
  })
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('surfaces the no-connection refusal as an SSE error event, not a throw', async () => {
    const chunks: string[] = []
    let ended = false
    const res: ChatSseResponse = {
      setHeader: () => {},
      write: (c: string) => { chunks.push(c); return true },
      end: () => { ended = true },
    }
    await pipeOpencodeChatStream([{ role: 'user', content: 'hello' }], res, {})
    const events = chunks
      .filter((c) => c.startsWith('data: '))
      .map((c) => JSON.parse(c.slice(6)) as ChatStreamEvent)
    const error = events.find((e) => e.type === 'error')
    assert.ok(error && error.type === 'error')
    assert.match(error.error, /active provider connection/)
    assert.equal(ended, true)
  })

  it('a refused turn leaves no expectation scope behind in the shared registry', async () => {
    resetConsoleExpectationsForTests()
    const res: ChatSseResponse = {
      setHeader: () => {},
      write: () => true,
      end: () => {},
    }
    await pipeOpencodeChatStream([{ role: 'user', content: 'hello' }], res, {})
    // The refusal happens before any scope opens — and even the
    // paths that do open one abandon it — so a fresh scope (any
    // engine's next turn) can begin immediately.
    assert.equal(beginConsoleExpectations('probe-turn'), true)
    endConsoleExpectations('probe-turn')
  })
})

describe('clearOpencodeSession', () => {
  it('is a no-op when no session is cached for the root (chat Clear button)', () => {
    assert.equal(clearOpencodeSession('/work/no-such-root'), false)
  })
})
