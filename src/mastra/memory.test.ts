import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { historyBudgetForWindow } from './memory.js'

/**
 * History budget sizing (provider cluster): the Mastra message-history
 * budget used to be a fixed 8k tokens regardless of the model's
 * context window. It now scales with the window — half, floored at
 * the old 8k, capped at 128k, fixed 8k when the window is unknown.
 */
describe('historyBudgetForWindow', () => {
  it('falls back to the fixed 8k when the window is unknown', () => {
    assert.equal(historyBudgetForWindow(undefined), 8000)
    assert.equal(historyBudgetForWindow(0), 8000)
  })

  it('takes half the window for known models', () => {
    assert.equal(historyBudgetForWindow(128_000), 64_000)
    assert.equal(historyBudgetForWindow(200_000), 100_000)
    assert.equal(historyBudgetForWindow(32_000), 16_000)
  })

  it('floors at 8k and caps at 128k', () => {
    assert.equal(historyBudgetForWindow(8_000), 8000)
    assert.equal(historyBudgetForWindow(1_048_576), 128_000)
  })
})
