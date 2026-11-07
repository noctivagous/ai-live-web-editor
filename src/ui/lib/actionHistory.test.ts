import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseIdList, pushRecent, serializeIdList, togglePin } from './actionHistory.js'

describe('actionHistory', () => {
  it('parseIdList survives malformed storage', () => {
    assert.deepEqual(parseIdList(null), [])
    assert.deepEqual(parseIdList('not json'), [])
    assert.deepEqual(parseIdList('{"a":1}'), [])
    assert.deepEqual(parseIdList('["a", 2, "a", "b"]'), ['a', 'b'])
    assert.deepEqual(parseIdList(serializeIdList(['x', 'y'])), ['x', 'y'])
  })

  it('togglePin pins and unpins', () => {
    assert.deepEqual(togglePin([], 'a'), ['a'])
    assert.deepEqual(togglePin(['a', 'b'], 'a'), ['b'])
    assert.deepEqual(togglePin(['a'], 'b'), ['a', 'b'])
  })

  it('pushRecent is most-recent-first, deduped, and capped', () => {
    assert.deepEqual(pushRecent([], 'a'), ['a'])
    assert.deepEqual(pushRecent(['a', 'b'], 'b'), ['b', 'a'])
    assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b'])
  })
})
