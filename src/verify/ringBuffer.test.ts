import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRingBuffer, pushRing, readRing } from './ringBuffer.js'

describe('ringBuffer', () => {
  it('caps entries but keeps the sequence', () => {
    const buf = createRingBuffer(3)
    for (let i = 0; i < 5; i++) pushRing(buf, { level: 'log', text: `m${i}` })
    assert.equal(buf.entries.length, 3)
    assert.equal(buf.seq, 5)
    assert.deepEqual(buf.entries.map((e) => e.text), ['m2', 'm3', 'm4'])
  })

  it('filters by sequence and level', () => {
    const buf = createRingBuffer()
    pushRing(buf, { level: 'log', text: 'a' })
    pushRing(buf, { level: 'error', text: 'b' })
    const { entries, latestSeq } = readRing(buf, { sinceSeq: 1, levels: ['error'] })
    assert.equal(latestSeq, 2)
    assert.deepEqual(entries.map((e) => e.text), ['b'])
  })

  it('returns everything after seq 0 by default', () => {
    const buf = createRingBuffer()
    pushRing(buf, { level: 'warn', text: 'w' })
    assert.equal(readRing(buf).entries.length, 1)
  })
})
