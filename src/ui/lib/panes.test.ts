import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clampPanes } from './panes.js'

describe('clampPanes', () => {
  it('shrinks side panes so the middle column keeps room', () => {
    const next = clampPanes({ leftW: 400, rightW: 400, previewH: 42 }, 800)
    assert.equal(next.leftW + next.rightW <= 800 - 64 - 280, true)
    assert.equal(next.leftW >= 140, true)
    assert.equal(next.rightW >= 140, true)
  })

  it('leaves a wide window alone', () => {
    const next = clampPanes({ leftW: 220, rightW: 360, previewH: 42 }, 1400)
    assert.equal(next.leftW, 220)
    assert.equal(next.rightW, 360)
  })
})
