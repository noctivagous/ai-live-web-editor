import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pollUntilUp } from './previewProbe.js'

describe('pollUntilUp', () => {
  it('returns true as soon as the server answers', async () => {
    let calls = 0
    const ok = await pollUntilUp(
      async () => (++calls >= 3),
      { budgetMs: 5000, intervalMs: 5 },
    )
    assert.equal(ok, true)
    assert.equal(calls, 3)
  })

  it('gives up after the budget and returns false', async () => {
    const t0 = Date.now()
    const ok = await pollUntilUp(async () => false, { budgetMs: 50, intervalMs: 10 })
    assert.equal(ok, false)
    assert.ok(Date.now() - t0 < 2000)
  })

  it('stops on abort', async () => {
    const ctrl = new AbortController()
    let calls = 0
    const p = pollUntilUp(
      async () => {
        calls++
        if (calls === 1) ctrl.abort()
        return false
      },
      { budgetMs: 5000, intervalMs: 5, signal: ctrl.signal },
    )
    assert.equal(await p, false)
  })
})
