import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { recordDispatchToolCall, type ChatDebugToolCallRecord } from '../chatDebug.js'
import { setFsRoot } from '../launcher.js'
import { runFsTool } from './fsTools.js'
import { runPageTool } from './pageTools.js'

/**
 * Slice 9: the withToolLog gap closure — tool executions through
 * the host dispatch endpoints append per-tool records to the
 * chat-debug JSONL when AI_LIVE_CHAT_DEBUG is on, and nothing at
 * all when it is off. The dispatch result itself never changes.
 */
describe('dispatch debug records (slice 9)', () => {
  let dir: string
  let debugFile: string
  let savedDebug: string | undefined
  let savedFile: string | undefined

  const records = (): ChatDebugToolCallRecord[] => {
    if (!fs.existsSync(debugFile)) return []
    return fs.readFileSync(debugFile, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as ChatDebugToolCallRecord)
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-debug-'))
    const project = path.join(dir, 'project')
    fs.mkdirSync(path.join(project, 'src'), { recursive: true })
    fs.writeFileSync(path.join(project, 'src', 'App.jsx'), 'export default function App() { return null }\n')
    setFsRoot(project)
    debugFile = path.join(dir, 'chat-debug.jsonl')
    savedDebug = process.env.AI_LIVE_CHAT_DEBUG
    savedFile = process.env.AI_LIVE_CHAT_DEBUG_FILE
    process.env.AI_LIVE_CHAT_DEBUG_FILE = debugFile
    delete process.env.AI_LIVE_CHAT_DEBUG
  })

  afterEach(() => {
    if (savedDebug === undefined) delete process.env.AI_LIVE_CHAT_DEBUG
    else process.env.AI_LIVE_CHAT_DEBUG = savedDebug
    if (savedFile === undefined) delete process.env.AI_LIVE_CHAT_DEBUG_FILE
    else process.env.AI_LIVE_CHAT_DEBUG_FILE = savedFile
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('debug off: a dispatch executes and writes NO record', async () => {
    const result = await runFsTool('read-real-file', { path: 'src/App.jsx' }) as { path?: string }
    assert.equal(result.path, '/src/App.jsx')
    assert.equal(fs.existsSync(debugFile), false, 'no file is created with the flag off')
  })

  it('debug on: a dispatch appends one tool-call record with the result facts', async () => {
    process.env.AI_LIVE_CHAT_DEBUG = '1'
    const result = await runFsTool('str-replace', {
      path: 'src/App.jsx', old_string: 'return null', new_string: 'return 42',
    }) as { ok?: boolean; path?: string; fileLines?: number }
    assert.equal(result.ok, true)
    const recs = records()
    assert.equal(recs.length, 1)
    const rec = recs[0]
    assert.equal(rec.kind, 'tool-call')
    assert.equal(rec.engine, 'opencode')
    assert.equal(rec.tool, 'str-replace')
    assert.equal(rec.ok, true)
    assert.equal(rec.path, '/src/App.jsx')
    assert.equal(rec.matches, 1)
    assert.equal(rec.fileLines, result.fileLines)
    assert.ok(Array.isArray(rec.range), 'the applied range rides the record')
    assert.equal(typeof rec.elapsedMs, 'number')
    assert.equal(rec.error, undefined)
  })

  it('the dispatch result is identical with debug on and off', async () => {
    const off = await runFsTool('read-real-file', { path: 'src/App.jsx' })
    process.env.AI_LIVE_CHAT_DEBUG = '1'
    const on = await runFsTool('read-real-file', { path: 'src/App.jsx' })
    assert.deepEqual(on, off)
    assert.equal(records().length, 1, 'only the debug-on call recorded')
    assert.equal(records()[0].tool, 'read-real-file')
  })

  it('an error-value result records ok:false with the error message', async () => {
    process.env.AI_LIVE_CHAT_DEBUG = '1'
    const result = await runFsTool('no-such-tool', {}) as { ok?: boolean; error?: string }
    assert.equal(result.ok, false)
    const recs = records()
    assert.equal(recs.length, 1)
    assert.equal(recs[0].tool, 'no-such-tool')
    assert.equal(recs[0].ok, false)
    assert.match(recs[0].error ?? '', /unknown fs tool/)
  })

  it('a page-tool dispatch records too (the endpoint family is shared)', async () => {
    process.env.AI_LIVE_CHAT_DEBUG = '1'
    // No live page in the test process: the tool answers with its
    // no-page error value, which is still an execution to record.
    const result = await runPageTool('take-snapshot', {}) as { error?: string }
    assert.ok(result.error, 'no-page error value')
    const recs = records()
    assert.equal(recs.length, 1)
    assert.equal(recs[0].tool, 'take-snapshot')
    assert.equal(recs[0].ok, false)
  })

  it('recordDispatchToolCall: a thrown execution records the throw; off writes nothing', () => {
    assert.equal(
      recordDispatchToolCall({ tool: 'x', result: { ok: true }, elapsedMs: 3 }),
      false,
      'disabled: nothing written',
    )
    assert.equal(fs.existsSync(debugFile), false)
    process.env.AI_LIVE_CHAT_DEBUG = '1'
    assert.equal(
      recordDispatchToolCall({ tool: 'x', thrown: 'kaboom', elapsedMs: 3 }),
      true,
    )
    const recs = records()
    assert.equal(recs.length, 1)
    assert.equal(recs[0].ok, false)
    assert.equal(recs[0].error, 'kaboom')
  })
})
