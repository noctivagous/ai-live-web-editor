import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeFilesTouched } from './locateTurn.js'
import { WORKING_MEMORY_TEMPLATE } from './mastra/memory.js'

describe('mergeFilesTouched', () => {
  it('appends unique paths under Files touched', () => {
    const next = mergeFilesTouched(WORKING_MEMORY_TEMPLATE, [
      { path: '/App.jsx', start: 4, end: 9 },
      { path: '/index.html', start: 96, end: 137 },
    ])
    assert.match(next, /## Files touched\n- \/App\.jsx L4–9\n- \/index\.html L96–137/)
    assert.match(next, /## Decisions/)
  })

  it('replaces an earlier range for the same path', () => {
    const once = mergeFilesTouched(WORKING_MEMORY_TEMPLATE, [{ path: '/App.jsx', start: 1, end: 40 }])
    const twice = mergeFilesTouched(once, [{ path: '/App.jsx', start: 500, end: 560 }])
    assert.equal(twice.includes('L1–40'), false)
    assert.match(twice, /- \/App\.jsx L500–560/)
  })
})
