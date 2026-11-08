import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { OpenTabs } from './OpenTabs.js'

describe('OpenTabs', () => {
  it('lists pinned tabs with the active one marked, plus a transient active file', () => {
    const out = renderToStaticMarkup(
      createElement(OpenTabs, { tabs: ['/a.md', '/b.ts'], active: '/c.md', onActivate: () => {}, onUnpin: () => {} }),
    )
    assert.match(out, /a\.md/)
    assert.match(out, /aria-selected="true"/)
    assert.match(out, /transient/)
    // Only pinned tabs get an unpin button (the transient file has none).
    assert.equal(out.split('tab-x').length - 1, 2)
  })

  it('renders nothing with no tabs and no active file', () => {
    const out = renderToStaticMarkup(
      createElement(OpenTabs, { tabs: [], active: null, onActivate: () => {}, onUnpin: () => {} }),
    )
    assert.equal(out, '')
  })
})
