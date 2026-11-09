import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { historyBudgetForWindow } from './memory.js'

/**
 * History budget: 1/16 of the window, floored at 4k, capped at 12k
 * (working set plus about two turns). Unknown window → 8k.
 */
describe('historyBudgetForWindow', () => {
  it('falls back to the fixed 8k when the window is unknown', () => {
    assert.equal(historyBudgetForWindow(undefined), 8000)
    assert.equal(historyBudgetForWindow(0), 8000)
  })

  it('takes a sixteenth of the window for known models', () => {
    assert.equal(historyBudgetForWindow(128_000), 8_000)
    assert.equal(historyBudgetForWindow(64_000), 4_000)
  })

  it('floors at 4k and caps at 12k', () => {
    assert.equal(historyBudgetForWindow(8_000), 4_000)
    assert.equal(historyBudgetForWindow(1_048_576), 12_000)
    assert.equal(historyBudgetForWindow(200_000), 12_000)
  })
})
