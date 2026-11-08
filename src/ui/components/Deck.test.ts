import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { groupTurns } from '../lib/deck.js'
import { DeckCardView } from './Deck.js'
import type { LogItem } from '../lib/chatSession.js'

function cardsOf(log: LogItem[]) {
  const turns = groupTurns(log)
  return { turns, cards: turns[0]?.cards ?? [] }
}

describe('DeckCardView failure details', () => {
  it('failed tool steps get a Details button, done steps do not', () => {
    const { turns, cards } = cardsOf([
      { role: 'user', text: 'check the env' },
      {
        role: 'tools',
        steps: [
          { id: '1', name: 'data-inspect', detail: 'data-inspect .env', status: 'error', result: 'data-inspect failed: no profile' },
          { id: '2', name: 'grep', detail: 'grep foo', status: 'done', result: 'ok' },
        ],
      },
    ])
    const tools = cards.find(c => c.kind === 'tools')
    assert.ok(tools)
    const out = renderToStaticMarkup(
      createElement(DeckCardView, { card: tools, onNeedSetup: () => {}, turn: turns[0] }),
    )
    assert.match(out, /Details/)
    assert.equal(out.split('Details').length - 1, 1)
  })

  it('error cards get a Details button', () => {
    const { turns, cards } = cardsOf([
      { role: 'user', text: 'break it' },
      { role: 'error', text: 'Chat failed: no key' },
    ])
    const err = cards.find(c => c.kind === 'error')
    assert.ok(err)
    const out = renderToStaticMarkup(
      createElement(DeckCardView, { card: err, onNeedSetup: () => {}, turn: turns[0] }),
    )
    assert.match(out, /Details/)
  })
})
