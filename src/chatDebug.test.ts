import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chatDebugEnabled, chatDebugFile, createChatDebugTurn } from './chatDebug.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chat-debug-test-'))
}

describe('chatDebugEnabled / chatDebugFile', () => {
  it('is opt-in: only 1/true (trimmed, any case) enable it', () => {
    assert.equal(chatDebugEnabled({ AI_LIVE_CHAT_DEBUG: '1' }), true)
    assert.equal(chatDebugEnabled({ AI_LIVE_CHAT_DEBUG: ' true ' }), true)
    assert.equal(chatDebugEnabled({ AI_LIVE_CHAT_DEBUG: 'TRUE' }), true)
    assert.equal(chatDebugEnabled({ AI_LIVE_CHAT_DEBUG: '0' }), false)
    assert.equal(chatDebugEnabled({ AI_LIVE_CHAT_DEBUG: 'yes' }), false)
    assert.equal(chatDebugEnabled({ AI_LIVE_CHAT_DEBUG: '' }), false)
    assert.equal(chatDebugEnabled({}), false)
  })

  it('defaults to <repo root>/.ai-live/chat-debug.jsonl and honours the override', () => {
    const def = chatDebugFile({})
    assert.ok(def.endsWith(path.join('.ai-live', 'chat-debug.jsonl')), def)
    assert.equal(chatDebugFile({ AI_LIVE_CHAT_DEBUG_FILE: ' /tmp/custom/report.jsonl ' }), '/tmp/custom/report.jsonl')
  })
})

describe('ChatDebugTurn disabled', () => {
  it('keeps no records and writes no file, whatever it is fed', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'nested', 'report.jsonl')
    const dbg = createChatDebugTurn({ env: {}, file, projectRoot: dir, projectId: 'p' })
    assert.equal(dbg.enabled, false)
    dbg.noteMode('files', false)
    dbg.noteTools(['write-real-file'], {})
    dbg.noteGateArmed(true, { captured: true, error: null })
    dbg.noteGateDecision(true, ['write-real-file'])
    dbg.noteGateFollowUpSkipped('unverified-only')
    dbg.recordEvent({ type: 'status', text: 'starting…' })
    dbg.recordEvent({ type: 'text-delta', text: 'hello' })
    dbg.recordEvent({ type: 'done', usage: { input: 1, output: 2, total: 3 } })
    assert.equal(dbg.events.length, 0)
    assert.equal(dbg.finish({}), null)
    assert.equal(fs.existsSync(file), false)
    assert.equal(fs.existsSync(path.join(dir, 'nested')), false)
  })
})

describe('ChatDebugTurn enabled', () => {
  it('records a synthetic turn in order and checks claimed writes on disk', () => {
    const dir = tmpDir()
    const root = path.join(dir, 'project')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    const appFile = path.join(root, 'src', 'app.ts')
    fs.writeFileSync(appFile, 'export const x = 1\n')
    const file = path.join(dir, 'report.jsonl')

    const dbg = createChatDebugTurn({
      env: { AI_LIVE_CHAT_DEBUG: '1' },
      file,
      projectRoot: root,
      projectId: 'scratch',
      now: (() => { let t = 1_700_000_000_000; return () => (t += 100) })(),
    })
    assert.equal(dbg.enabled, true)
    dbg.noteMode('files', false)
    dbg.noteTools(['read-real-file', 'write-real-file', 'str-replace'], { hasActivePlan: false, hasFeatureGraph: false, searchAvailable: false })
    dbg.noteGateArmed(true, { captured: true, error: null })
    dbg.noteGateDecision(false, ['read-real-file', 'write-real-file', 'str-replace'])

    dbg.recordEvent({ type: 'status', text: 'starting…' })
    // A read: not a write tool, so it must never become a claim.
    dbg.noteToolChunk({ type: 'tool-call', id: 'r1', name: 'read-real-file', detail: 'read-real-file /src/app.ts' },
      { type: 'tool-call', payload: { toolCallId: 'r1', toolName: 'read-real-file', args: { path: 'src/app.ts' } } })
    dbg.recordEvent({ type: 'tool-call', id: 'r1', name: 'read-real-file', detail: 'read-real-file /src/app.ts' })
    dbg.recordEvent({ type: 'tool-result', id: 'r1', name: 'read-real-file', ok: true, detail: '/src/app.ts · 20 chars' })
    // A write whose result names the canonical path.
    dbg.noteToolChunk({ type: 'tool-call', id: 'w1', name: 'write-real-file', detail: 'write-real-file src/app.ts' },
      { type: 'tool-call', payload: { toolCallId: 'w1', toolName: 'write-real-file', args: { path: 'src/app.ts', content: 'x' } } })
    dbg.recordEvent({ type: 'tool-call', id: 'w1', name: 'write-real-file', detail: 'write-real-file src/app.ts' })
    dbg.noteToolChunk({ type: 'tool-result', id: 'w1', name: 'write-real-file', ok: true, detail: '/src/app.ts · 42b' },
      { type: 'tool-result', payload: { toolCallId: 'w1', toolName: 'write-real-file', result: { ok: true, path: '/src/app.ts', bytes: 42 } } })
    dbg.recordEvent({ type: 'tool-result', id: 'w1', name: 'write-real-file', ok: true, detail: '/src/app.ts · 42b' })
    // A write whose result names nothing: the claim falls back to the
    // call args, and the file is not on disk afterwards.
    dbg.noteToolChunk({ type: 'tool-call', id: 'w2', name: 'str-replace', detail: 'str-replace src/gone.ts' },
      { type: 'tool-call', payload: { toolCallId: 'w2', toolName: 'str-replace', args: { path: 'src/gone.ts', old_string: 'a', new_string: 'b' } } })
    dbg.recordEvent({ type: 'tool-call', id: 'w2', name: 'str-replace', detail: 'str-replace src/gone.ts' })
    dbg.recordEvent({ type: 'tool-result', id: 'w2', name: 'str-replace', ok: true, detail: 'ok' })
    // A failed write: forwarded as an event, but it claims nothing.
    dbg.recordEvent({ type: 'tool-result', id: 'w3', name: 'write-real-file', ok: false, detail: 'Path escapes the project root' })

    dbg.recordEvent({ type: 'reasoning-delta', text: 'think' })
    dbg.recordEvent({ type: 'text-delta', text: 'Hello ' })
    dbg.recordEvent({ type: 'text-delta', text: 'world' })
    dbg.recordEvent({ type: 'done', usage: { input: 10, output: 5, total: 15 }, model: 'test-model', verification: { ran: false } })

    const record = dbg.finish({})
    assert.ok(record)
    assert.equal(record.kind, 'chat-turn')
    assert.equal(record.mode, 'files')
    assert.equal(record.projectRoot, root)
    assert.equal(record.projectId, 'scratch')
    assert.deepEqual(record.toolsOffered, ['read-real-file', 'write-real-file', 'str-replace'])
    assert.equal(record.gateArmed, true)
    assert.equal(record.gateBaselineCaptured, true)
    assert.equal(record.gate?.decision, false)
    assert.deepEqual(record.gate?.toolTrace, ['read-real-file', 'write-real-file', 'str-replace'])
    assert.deepEqual(record.gate?.verification, { ran: false })
    assert.equal(record.gate?.followUpSkipped, null)
    assert.deepEqual(record.events.map((e) => e.type), [
      'status', 'tool-call', 'tool-result', 'tool-call', 'tool-result',
      'tool-call', 'tool-result', 'tool-result', 'reasoning-delta',
      'text-delta', 'text-delta', 'done',
    ])
    // Deltas are lengths only — no text field leaks into the record.
    const delta = record.events.find((e) => e.type === 'text-delta')
    assert.deepEqual(delta, { type: 'text-delta', len: 6 })
    assert.equal(record.textChars, 11)
    assert.equal(record.reasoningChars, 5)
    assert.equal(record.finalTextHead, 'Hello world')
    assert.deepEqual(record.usage, { input: 10, output: 5, total: 15 })
    assert.equal(record.model, 'test-model')
    assert.equal(record.error, null)
    assert.equal(record.aborted, false)

    assert.equal(record.writes.length, 2)
    const [w1, w2] = record.writes
    assert.equal(w1.tool, 'write-real-file')
    assert.equal(w1.claimedPath, '/src/app.ts')
    assert.equal(w1.claimSource, 'result')
    assert.equal(w1.resolvedPath, appFile)
    assert.equal(w1.exists, true)
    assert.ok(typeof w1.mtime === 'string' && w1.mtime.length > 0)
    assert.equal(w2.tool, 'str-replace')
    assert.equal(w2.claimedPath, 'src/gone.ts')
    assert.equal(w2.claimSource, 'args')
    assert.equal(w2.resolvedPath, path.join(root, 'src', 'gone.ts'))
    assert.equal(w2.exists, false)
    assert.equal(w2.mtime, null)

    // Exactly one JSONL line, identical to the returned record, and a
    // second finish() is a no-op.
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n')
    assert.equal(lines.length, 1)
    assert.deepEqual(JSON.parse(lines[0]), JSON.parse(JSON.stringify(record)))
    assert.equal(dbg.finish({}), null)
    assert.equal(fs.readFileSync(file, 'utf-8').trim().split('\n').length, 1)
  })

  it('records a gate follow-up skipped as unverified-only', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'report.jsonl')
    const dbg = createChatDebugTurn({ env: { AI_LIVE_CHAT_DEBUG: '1' }, file, projectRoot: dir, projectId: 'p' })
    dbg.noteGateArmed(true, { captured: true, error: null })
    dbg.noteGateDecision(true, ['write-real-file'])
    dbg.noteGateFollowUpSkipped('unverified-only')
    dbg.recordEvent({
      type: 'done',
      usage: { input: 3, output: 1, total: 4 },
      verification: { ran: true, clean: false, newLayout: 0, newConsole: 0, unverified: ['no live page'], followUp: false },
    })
    const record = dbg.finish({})
    assert.ok(record)
    assert.equal(record.gate?.decision, true)
    assert.equal(record.gate?.followUpSkipped, 'unverified-only')
    assert.equal(record.gate?.verification?.followUp, false)
  })

  it('keeps only the first 200 chars of the final text — the tail never reaches the report', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'report.jsonl')
    const dbg = createChatDebugTurn({ env: { AI_LIVE_CHAT_DEBUG: '1' }, file, projectRoot: dir })
    const longText = 'a'.repeat(250) + 'TAIL-MARKER'
    dbg.recordEvent({ type: 'text-delta', text: longText })
    const record = dbg.finish({})
    assert.ok(record)
    assert.equal(record.finalTextHead.length, 200)
    assert.equal(record.textChars, longText.length)
    const raw = fs.readFileSync(file, 'utf-8')
    assert.equal(raw.includes('TAIL-MARKER'), false)
  })

  it('expands a result files list into one claim per file', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'report.jsonl')
    const dbg = createChatDebugTurn({ env: { AI_LIVE_CHAT_DEBUG: '1' }, file, projectRoot: dir })
    dbg.noteToolChunk({ type: 'tool-result', id: 't1', name: 'place-template', ok: true, detail: '2 files' },
      { type: 'tool-result', payload: { toolCallId: 't1', toolName: 'place-template', result: { files: ['/a.html', '/b.css'] } } })
    dbg.recordEvent({ type: 'tool-result', id: 't1', name: 'place-template', ok: true, detail: '2 files' })
    const record = dbg.finish({})
    assert.ok(record)
    assert.deepEqual(record.writes.map((w) => [w.claimedPath, w.claimSource, w.exists]), [
      ['/a.html', 'result-files', false],
      ['/b.css', 'result-files', false],
    ])
  })
})
