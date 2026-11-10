import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dayFile, logDir, logServerError, logToolCall, pruneLogs } from './serverLog.js'

let dir = ''
let savedEnv = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serverlog-test-'))
  savedEnv = process.env.AI_LIVE_LOG_DIR || ''
  process.env.AI_LIVE_LOG_DIR = dir
})

afterEach(() => {
  if (savedEnv) process.env.AI_LIVE_LOG_DIR = savedEnv
  else delete process.env.AI_LIVE_LOG_DIR
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('logServerError', () => {
  it('writes one JSONL line with only the fixed field set', () => {
    logServerError({ kind: 'chat-error', route: 'POST /api/chat/stream', status: 500, message: 'boom' })
    const files = fs.readdirSync(dir)
    assert.equal(files.length, 1)
    const row = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8').trim())
    assert.deepEqual(
      Object.keys(row).sort(),
      ['kind', 'message', 'route', 'status', 'ts'],
    )
    assert.equal(row.kind, 'chat-error')
    assert.equal(row.message, 'boom')
  })

  it('truncates long messages and details', () => {
    logServerError({ kind: 'pool', message: 'x'.repeat(5000), detail: 'y'.repeat(5000) })
    const row = JSON.parse(fs.readFileSync(dayFile(dir), 'utf-8').trim())
    assert.equal(row.message.length, 2000)
    assert.equal(row.detail.length, 2000)
  })

  it('never throws when the log home is unwritable', () => {
    process.env.AI_LIVE_LOG_DIR = '/sys/ai-live-logs-test-unwritable'
    assert.doesNotThrow(() => {
      logServerError({ kind: 'server-error', message: 'disk gone' })
    })
  })
})

describe('dayFile', () => {
  it('names files by UTC date', () => {
    assert.ok(dayFile(dir, new Date('2026-11-07T12:00:00Z')).endsWith('2026-11-07.jsonl'))
  })
})

describe('pruneLogs', () => {
  it('removes day files older than 7 days and ignores other files', () => {
    const old = path.join(dir, '2020-01-01.jsonl')
    const keep = path.join(dir, 'notes.txt')
    fs.writeFileSync(old, '{}\n')
    fs.utimesSync(old, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
    fs.writeFileSync(keep, 'keep me')
    const removed = pruneLogs(dir, 7, Date.now())
    assert.deepEqual(removed, ['2020-01-01.jsonl'])
    assert.ok(!fs.existsSync(old))
    assert.ok(fs.existsSync(keep))
  })

  it('defaults to the log dir and never throws when missing', () => {
    assert.doesNotThrow(() => pruneLogs(path.join(dir, 'nope')))
  })
})

describe('logDir', () => {
  it('follows the override env', () => {
    assert.equal(logDir(), path.resolve(dir))
  })
})

describe('logToolCall', () => {
  it('writes one JSONL tool-call line with tool, path, range, file lines and outcome', () => {
    logToolCall({ tool: 'str-replace', path: '/src/hooks/usePersistedSettings.js', range: [387, 387], fileLines: 124, matches: 0, ok: false, error: 'old_string not found — file unchanged', elapsedMs: 2 })
    const row = JSON.parse(fs.readFileSync(dayFile(dir), 'utf-8').trim())
    assert.deepEqual(
      Object.keys(row).sort(),
      ['elapsedMs', 'error', 'fileLines', 'kind', 'matches', 'ok', 'path', 'range', 'tool', 'ts'],
    )
    assert.equal(row.kind, 'tool-call')
    assert.equal(row.tool, 'str-replace')
    assert.equal(row.fileLines, 124)
    assert.equal(row.ok, false)
  })

  it('never throws when the log home is unwritable', () => {
    process.env.AI_LIVE_LOG_DIR = '/sys/ai-live-logs-test-unwritable'
    assert.doesNotThrow(() => {
      logToolCall({ tool: 'read-real-file', path: '/x', ok: true })
    })
  })
})
