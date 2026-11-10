import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Point the store at a temp file BEFORE the modules under test load,
// so test runs never touch the real `.ai-live/mastra.db`.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastra-chat-memory-test-'))
process.env.AI_LIVE_STORAGE = path.join(tmp, 'test.db')

const { chatThreadIds, dropClientHistory, prepareMemoryTurn, clearChatThreads, clearChatThread } = await import('./chatMemory.js')
const { editorMemory } = await import('./memory.js')
const { getFsRoot } = await import('../launcher.js')

describe('chatThreadIds', () => {
  it('is deterministic for the same root and differs across roots', () => {
    assert.deepEqual(chatThreadIds('/work/lumen'), chatThreadIds('/work/lumen'))
    assert.notEqual(chatThreadIds('/work/lumen').thread, chatThreadIds('/other/lumen').thread)
    assert.notEqual(chatThreadIds('/work/lumen').resource, chatThreadIds('/other/lumen').resource)
  })

  it('does not leak the raw root path into the ids', () => {
    const ids = chatThreadIds('/home/someone/secret-project')
    assert.ok(!ids.thread.includes('secret-project'))
    assert.ok(!ids.resource.includes('secret-project'))
  })
})

describe('dropClientHistory', () => {
  it('keeps system messages and only the newest user message', () => {
    const payload = [
      { role: 'system', content: 'preamble' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'system', content: 'brief' },
      { role: 'user', content: 'second' },
    ]
    assert.deepEqual(dropClientHistory(payload), [
      { role: 'system', content: 'preamble' },
      { role: 'system', content: 'brief' },
      { role: 'user', content: 'second' },
    ])
  })

  it('passes non-arrays and user-less payloads through untouched', () => {
    assert.equal(dropClientHistory('nope'), 'nope')
    const payload = [{ role: 'system', content: 'only' }]
    assert.equal(dropClientHistory(payload), payload)
  })
})

describe('prepareMemoryTurn + clearChatThreads (real LibSQL store)', () => {
  it('seeds on the first turn, drops client history once the thread exists, and clears', async () => {
    const ids = chatThreadIds(getFsRoot())
    const payload = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'again' },
    ]

    // No thread yet: payload rides through untouched (seeding turn).
    const first = await prepareMemoryTurn(payload)
    assert.deepEqual(first.memory, ids)
    assert.equal(first.payload, payload)

    // Simulate the persisted thread a first memory turn creates.
    await editorMemory.saveThread({
      thread: {
        id: ids.thread,
        resourceId: ids.resource,
        title: '',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    // Thread exists: prior turns are dropped, recall supplies them.
    const second = await prepareMemoryTurn(payload)
    assert.deepEqual(second.memory, ids)
    assert.deepEqual(second.payload, [{ role: 'user', content: 'again' }])

    // Working memory round-trips on the same thread.
    await editorMemory.updateWorkingMemory({
      threadId: ids.thread,
      resourceId: ids.resource,
      workingMemory: '# Project working set\n\n## Current goal\nShip it\n',
    })
    const wm = await editorMemory.getWorkingMemory({ threadId: ids.thread, resourceId: ids.resource })
    assert.ok(String(wm).includes('Ship it'))

    // Clear removes the thread (Settings → Clear saved chat sessions).
    const cleared = await clearChatThreads()
    assert.ok(cleared.deleted >= 1)
    assert.equal(await editorMemory.getThreadById({ threadId: ids.thread }), null)
  })

  it("clearChatThread deletes only that root's thread (chat Clear button)", async () => {
    const a = chatThreadIds('/work/clear-a')
    const b = chatThreadIds('/work/clear-b')
    const save = (ids: { thread: string, resource: string }) => editorMemory.saveThread({
      thread: {
        id: ids.thread,
        resourceId: ids.resource,
        title: '',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    await save(a)
    await save(b)
    assert.equal(await clearChatThread('/work/clear-a'), true)
    assert.equal(await editorMemory.getThreadById({ threadId: a.thread }), null)
    assert.notEqual(await editorMemory.getThreadById({ threadId: b.thread }), null)
    assert.equal(await clearChatThread('/work/clear-a'), false)
    assert.equal(await clearChatThread('/work/clear-b'), true)
    assert.equal(await editorMemory.getThreadById({ threadId: b.thread }), null)
  })
})
