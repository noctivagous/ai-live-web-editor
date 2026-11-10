import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  advanceConsoleWatermarks,
  getProjectConsoleMarks,
  loadConsoleWatermarks,
  markConsoleWatermarksStale,
  sanitizeConsoleWatermarkStore,
  setConsoleWatermarksPath,
  sinceWindow,
} from './consoleWatermarks.js'

const ROOT = '/projects/demo'

describe('consoleWatermarks store', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-watermarks-'))
    setConsoleWatermarksPath(path.join(dir, 'console-watermarks.json'))
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('starts empty; advancing creates per-channel marks with the instance attached', () => {
    assert.equal(getProjectConsoleMarks(ROOT), undefined)
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 12, instance: 'page-a' } }, 1000)
    assert.deepEqual(getProjectConsoleMarks(ROOT), { bridge: { seq: 12, instance: 'page-a', at: 1000 } })
    // On disk too — the store survives a restart (fresh load reads it).
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'console-watermarks.json'), 'utf8'))
    assert.equal(onDisk.projects[ROOT].bridge.seq, 12)
  })

  it('advance moves only the channels observed; the other channel keeps its mark', () => {
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 5, instance: 'a' }, pool: { seq: 3, instance: 1 } }, 100)
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 9, instance: 'a' } }, 200)
    const marks = getProjectConsoleMarks(ROOT)!
    assert.equal(marks.bridge?.seq, 9)
    assert.equal(marks.bridge?.at, 200)
    assert.equal(marks.pool?.seq, 3)
    assert.equal(marks.pool?.at, 100)
  })

  it('advance with nothing observed is a no-op (no store entry is born)', () => {
    advanceConsoleWatermarks(ROOT, {})
    assert.equal(getProjectConsoleMarks(ROOT), undefined)
  })

  it('projects are keyed independently', () => {
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 1 } }, 1)
    advanceConsoleWatermarks('/projects/other', { bridge: { seq: 2 } }, 1)
    assert.equal(getProjectConsoleMarks(ROOT)?.bridge?.seq, 1)
    assert.equal(getProjectConsoleMarks('/projects/other')?.bridge?.seq, 2)
    assert.deepEqual(Object.keys(loadConsoleWatermarks().projects).sort(), ['/projects/demo', '/projects/other'])
  })

  it('stale marking: sets the flag without touching the marks; advance clears it', () => {
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 7, instance: 'a' } }, 100)
    markConsoleWatermarksStale(ROOT)
    const stale = getProjectConsoleMarks(ROOT)!
    assert.equal(stale.stale, true)
    assert.equal(stale.bridge?.seq, 7, 'a skipped (off) turn must not advance the watermark')
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 8, instance: 'a' } }, 300)
    const fresh = getProjectConsoleMarks(ROOT)!
    assert.equal(fresh.stale, undefined)
    assert.equal(fresh.bridge?.seq, 8)
  })

  it('stale marking is a no-op when the project has no marks yet', () => {
    markConsoleWatermarksStale(ROOT)
    assert.equal(getProjectConsoleMarks(ROOT), undefined)
  })

  it('sanitize drops malformed marks but keeps good ones', () => {
    const store = sanitizeConsoleWatermarkStore({
      projects: {
        '/a': { bridge: { seq: 4, instance: 'x', at: 9 }, pool: { seq: 'no' }, stale: true },
        '/b': { bridge: { seq: Number.NaN } },
        '/c': 'junk',
      },
    })
    assert.deepEqual(store.projects['/a'], { bridge: { seq: 4, instance: 'x', at: 9 }, stale: true })
    assert.deepEqual(store.projects['/b'], {})
    assert.equal(store.projects['/c'], undefined)
    assert.deepEqual(sanitizeConsoleWatermarkStore(null), { projects: {} })
    assert.deepEqual(sanitizeConsoleWatermarkStore('junk'), { projects: {} })
  })
})

describe('sinceWindow (the since-last-chat window decision)', () => {
  const start = (seq: number, instance?: string | number, connected = true) => ({ seq, instance, connected })

  it('first-ever turn: no stored marks → no window (the watermark is born at the turn start)', () => {
    assert.equal(sinceWindow(undefined, 'bridge', start(10, 'a')), null)
    assert.equal(sinceWindow({}, 'bridge', start(10, 'a')), null)
  })

  it('same instance with entries in between → window from the stored seq', () => {
    const marks = { bridge: { seq: 10, instance: 'a', at: 1 } }
    assert.deepEqual(sinceWindow(marks, 'bridge', start(14, 'a')), { sinceSeq: 10 })
  })

  it('nothing logged in between → no window', () => {
    const marks = { bridge: { seq: 10, instance: 'a', at: 1 } }
    assert.equal(sinceWindow(marks, 'bridge', start(10, 'a')), null)
    assert.equal(sinceWindow(marks, 'bridge', start(9, 'a')), null)
  })

  it('a different page instance → silence (the old page history is unattributable)', () => {
    const marks = { bridge: { seq: 10, instance: 'a', at: 1 } }
    assert.equal(sinceWindow(marks, 'bridge', start(3, 'b')), null)
  })

  it('pool generations (numbers) follow the same rule', () => {
    const marks = { pool: { seq: 10, instance: 2, at: 1 } }
    assert.deepEqual(sinceWindow(marks, 'pool', start(11, 2)), { sinceSeq: 10 })
    assert.equal(sinceWindow(marks, 'pool', start(11, 3)), null)
  })

  it('a disconnected start claims no window', () => {
    const marks = { bridge: { seq: 10, instance: 'a', at: 1 } }
    assert.equal(sinceWindow(marks, 'bridge', start(14, 'a', false)), null)
  })

  it('stale marks (an off period intervened) claim no window — re-enable starts fresh', () => {
    const marks = { bridge: { seq: 10, instance: 'a', at: 1 }, stale: true }
    assert.equal(sinceWindow(marks, 'bridge', start(14, 'a')), null)
  })

  it('pre-epoch marks (no instance on either side) fall back to seq semantics', () => {
    const marks = { bridge: { seq: 10, at: 1 } }
    assert.deepEqual(sinceWindow(marks, 'bridge', start(12)), { sinceSeq: 10 })
  })

  it('channels are independent: a bridge mark says nothing about the pool window', () => {
    const marks = { bridge: { seq: 10, instance: 'a', at: 1 } }
    assert.equal(sinceWindow(marks, 'pool', start(12, 'a')), null)
  })
})

describe('the off-period rule, end to end (store level)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-watermarks-off-'))
    setConsoleWatermarksPath(path.join(dir, 'console-watermarks.json'))
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('errors across an off period are neither reported nor swallowed into the next window', () => {
    const start = (seq: number) => ({ seq, instance: 'page-a', connected: true })
    // Turn 1 (checking on): quiet turn, watermark advances to seq 10.
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 10, instance: 'page-a' } }, 100)
    // Between chats the page logs up to seq 14.
    // Turn 2 runs with checking OFF: the chat stream marks the
    // project stale and advances nothing (seq stays 10 on disk).
    markConsoleWatermarksStale(ROOT)
    assert.equal(getProjectConsoleMarks(ROOT)?.bridge?.seq, 10)
    // Turn 3 (back on): its start capture sees seq 18, but the stale
    // flag means NO since-last-chat window is claimed — the entries
    // logged across the off period (11–18) are not reported as
    // "since your last chat", because checking was off for part of
    // that span and the group would misattribute them.
    assert.equal(sinceWindow(getProjectConsoleMarks(ROOT), 'bridge', start(18)), null)
    // Turn 3's own read advances the watermark to 18 and clears the
    // stale flag: the window is anchored at the re-enable point.
    advanceConsoleWatermarks(ROOT, { bridge: { seq: 18, instance: 'page-a' } }, 400)
    assert.equal(getProjectConsoleMarks(ROOT)?.stale, undefined)
    // Turn 4: entries after 18 form a normal window again.
    assert.deepEqual(sinceWindow(getProjectConsoleMarks(ROOT), 'bridge', start(21)), { sinceSeq: 18 })
  })
})
