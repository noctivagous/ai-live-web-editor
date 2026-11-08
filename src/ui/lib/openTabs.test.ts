import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadPinnedTabs, savePinnedTabs } from './openTabs.js'

function memoryStore(initial = ''): Pick<Storage, 'getItem' | 'setItem'> {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => { value = v },
  }
}

describe('openTabs', () => {
  it('round-trips pins per project', () => {
    const store = memoryStore()
    assert.deepEqual(loadPinnedTabs('lumen', store), [])
    savePinnedTabs('lumen', ['/a.md', '/b.ts'], store)
    savePinnedTabs('other', ['/c.md'], store)
    assert.deepEqual(loadPinnedTabs('lumen', store), ['/a.md', '/b.ts'])
    assert.deepEqual(loadPinnedTabs('other', store), ['/c.md'])
  })

  it('ignores corrupt or foreign data', () => {
    assert.deepEqual(loadPinnedTabs('lumen', memoryStore('not json{{')), [])
    assert.deepEqual(loadPinnedTabs('', memoryStore()), [])
  })
})
