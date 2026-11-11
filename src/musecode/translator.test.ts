import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatStreamEvent } from '../chatStream.js'
import {
  classifyMusecodeTurnError, createMusecodeEventFolder, musecodeUsageFromTokens,
  type MusecodeItemLike,
} from './translator.js'

function item(partial: Partial<MusecodeItemLike> & { itemId: string }): MusecodeItemLike {
  return { kind: 'agentMessage', status: 'inProgress', ...partial }
}

describe('musecode translator — agent message streaming', () => {
  it('diffs cumulative revisions into text deltas', () => {
    const folder = createMusecodeEventFolder()
    const first = folder.pushItem(item({ itemId: 'm1', text: 'Hel' }))
    const second = folder.pushItem(item({ itemId: 'm1', text: 'Hello' }))
    const third = folder.pushItem(item({ itemId: 'm1', status: 'completed', text: 'Hello' }))
    assert.deepEqual(first, [{ type: 'text-delta', text: 'Hel' }])
    assert.deepEqual(second, [{ type: 'text-delta', text: 'lo' }])
    assert.deepEqual(third, [], 'a revision with no new text emits nothing')
  })

  it('maps reasoning items to reasoning deltas', () => {
    const folder = createMusecodeEventFolder()
    const events = folder.pushItem(item({ itemId: 'r1', kind: 'reasoning', text: 'thinking…' }))
    assert.deepEqual(events, [{ type: 'reasoning-delta', text: 'thinking…' }])
  })

  it('ignores user messages and unknown kinds', () => {
    const folder = createMusecodeEventFolder()
    assert.deepEqual(folder.pushItem(item({ itemId: 'u1', kind: 'userMessage', text: 'hi' })), [])
    assert.deepEqual(folder.pushItem(item({ itemId: 'x1', kind: 'someFutureKind', text: '?' })), [])
  })
})

describe('musecode translator — tool calls', () => {
  it('emits tool-call then tool-result, with args summarized from the verbatim JSON', () => {
    const folder = createMusecodeEventFolder()
    const started = folder.pushItem(item({
      itemId: 't1', kind: 'toolCall', tool: 'read_file',
      args: JSON.stringify({ path: 'src/index.html' }),
    }))
    assert.equal(started.length, 1)
    assert.equal(started[0].type, 'tool-call')
    assert.match((started[0] as { detail: string }).detail, /src\/index\.html/)
    const finished = folder.pushItem(item({
      itemId: 't1', kind: 'toolCall', status: 'completed', tool: 'read_file', visibleOutput: 'file contents here',
    }))
    assert.deepEqual(finished, [{ type: 'tool-result', id: 't1', name: 'read_file', ok: true, detail: 'file contents here' }])
    assert.deepEqual(folder.toolTrace, ['read_file'])
  })

  it('streams tool output growth as tool-delta while the call runs', () => {
    const folder = createMusecodeEventFolder()
    folder.pushItem(item({ itemId: 't2', kind: 'toolCall', tool: 'run_shell', args: '{}' }))
    const delta = folder.pushItem(item({ itemId: 't2', kind: 'toolCall', tool: 'run_shell', visibleOutput: 'line one\n' }))
    assert.deepEqual(delta, [{ type: 'tool-delta', id: 't2', name: 'run_shell', text: 'line one\n' }])
  })

  it('marks a failed call not-ok with its failure reason, and never special-cases MCP tools', () => {
    const folder = createMusecodeEventFolder()
    const events = folder.pushItem(item({
      itemId: 't3', kind: 'toolCall', status: 'failed', tool: 'mcp__ale__page_patch',
      failureKind: 'tool_error', failureReason: 'no preview page is open',
    }))
    assert.deepEqual(events.map((e) => e.type), ['tool-call', 'tool-result'])
    const result = events[1] as Extract<ChatStreamEvent, { type: 'tool-result' }>
    assert.equal(result.ok, false)
    assert.equal(result.name, 'mcp__ale__page_patch')
    assert.match(result.detail, /no preview page is open/)
  })

  it('survives almost-JSON args', () => {
    const folder = createMusecodeEventFolder()
    const events = folder.pushItem(item({ itemId: 't4', kind: 'toolCall', tool: 'edit_file', args: '{path: ' }))
    assert.equal(events[0].type, 'tool-call')
  })
})

describe('musecode translator — usage + outcomes', () => {
  it('maps token usage, keeping cache figures only when reported', () => {
    const usage = musecodeUsageFromTokens({ inputTokens: 100, outputTokens: 25, cacheReadTokens: 40, reasoningTokens: 5 })
    assert.deepEqual(usage, { input: 100, output: 25, total: 125, cachedInput: 40, reasoning: 5 })
    assert.equal(musecodeUsageFromTokens({ inputTokens: 0, outputTokens: 0 }), null)
    assert.equal(musecodeUsageFromTokens(undefined), null)
  })

  it('a completed outcome settles succeeded and carries usage', () => {
    const folder = createMusecodeEventFolder()
    folder.pushOutcome({
      kind: 'completed',
      params: { terminal: 'completed', usage: { inputTokens: 10, outputTokens: 3 } },
    })
    assert.equal(folder.terminal, 'succeeded')
    assert.equal(folder.failure, null)
    assert.deepEqual(folder.usage, { input: 10, output: 3, total: 13 })
  })

  it('a cancelled outcome settles interrupted', () => {
    const folder = createMusecodeEventFolder()
    folder.pushOutcome({ kind: 'completed', params: { terminal: 'cancelled' } })
    assert.equal(folder.terminal, 'interrupted')
    const folder2 = createMusecodeEventFolder()
    folder2.pushOutcome({ kind: 'unqueued' })
    assert.equal(folder2.terminal, 'interrupted')
  })

  it('a failed outcome carries its failure, classified', () => {
    const folder = createMusecodeEventFolder()
    folder.pushOutcome({
      kind: 'completed',
      params: { terminal: 'failed', error: { kind: 'modelError', message: 'the model errored' } },
    })
    assert.equal(folder.terminal, 'failed')
    assert.equal(folder.failure?.message, 'the model errored')
    assert.equal(folder.failure?.billing, false)
  })

  it('terminalUnknown is a failure with an honest unknown-outcome message', () => {
    const folder = createMusecodeEventFolder()
    folder.pushOutcome({ kind: 'terminalUnknown' })
    assert.equal(folder.terminal, 'failed')
    assert.match(folder.failure?.message ?? '', /isn’t known/)
  })
})

describe('classifyMusecodeTurnError — §14 billing states', () => {
  it('the typed quota detail marks a billing state, with its reset time', () => {
    const failure = classifyMusecodeTurnError({
      kind: 'modelError', message: 'usage limit reached',
      quota: { limitKind: 'tokens', resetsAtMs: 1_800_000_000_000 },
    })
    assert.equal(failure.billing, true)
    assert.equal(failure.quotaResetsAtMs, 1_800_000_000_000)
  })

  it('a quota-class kind is a billing state even without the detail', () => {
    assert.equal(classifyMusecodeTurnError({ kind: 'quotaExceeded', message: 'x' }).billing, true)
  })

  it('ordinary failures are not billing states', () => {
    const failure = classifyMusecodeTurnError({ kind: 'environmentError', message: 'sandbox died' })
    assert.equal(failure.billing, false)
    assert.equal(failure.message, 'sandbox died')
  })

  it('falls back to the terminal reason, then to a plain default', () => {
    assert.equal(classifyMusecodeTurnError(undefined, 'host said no').message, 'host said no')
    assert.match(classifyMusecodeTurnError(undefined).message, /Muse Code session failed/)
  })
})
