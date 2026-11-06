import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  abbreviateNote,
  abbreviateSelector,
  elementToken,
  noteToken,
} from './annotateChips.js'

describe('annotateChips', () => {
  it('keeps ids and short selectors intact', () => {
    assert.equal(abbreviateSelector('#hero'), '#hero')
    assert.equal(abbreviateSelector('h1'), 'h1')
    assert.equal(abbreviateSelector('[data-testid="cta"]'), '[data-testid="cta"]')
  })

  it('shortens long nth-of-type chains to the last two segments', () => {
    assert.equal(
      abbreviateSelector('main:nth-of-type(1) > div:nth-of-type(2) > h1:nth-of-type(1)'),
      'div > h1',
    )
  })

  it('falls back to body for junk', () => {
    assert.equal(abbreviateSelector(''), 'body')
  })

  it('truncates long notes with an ellipsis', () => {
    assert.equal(abbreviateNote('short'), 'short')
    assert.equal(abbreviateNote('  spaced  '), 'spaced')
    const long = 'make the heading blue and increase the font size a lot please'
    assert.equal(abbreviateNote(long), `${long.slice(0, 24)}…`)
  })

  it('builds input tokens from chips', () => {
    assert.equal(elementToken('main > h1'), '@main > h1 ')
    assert.equal(noteToken('make it blue'), 'note: "make it blue" ')
  })
})
