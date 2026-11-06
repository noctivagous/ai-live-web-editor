import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCollapse } from './collapse.js'

describe('parseCollapse', () => {
  it('defaults both panes to expanded', () => {
    assert.deepEqual(parseCollapse(null), { editor: false, preview: false })
    assert.deepEqual(parseCollapse({}), { editor: false, preview: false })
  })

  it('keeps stored collapse flags and drops junk', () => {
    assert.deepEqual(
      parseCollapse({ editor: true, preview: false }),
      { editor: true, preview: false },
    )
    assert.deepEqual(
      parseCollapse({ editor: 'yes', preview: 1 }),
      { editor: false, preview: false },
    )
  })
})
