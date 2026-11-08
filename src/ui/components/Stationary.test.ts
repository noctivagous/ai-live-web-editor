import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { groupTurns } from '../lib/deck.js'
import { StationaryView } from './Stationary.js'
import type { LogItem } from '../lib/chatSession.js'

function html(log: LogItem[], sending = false): string {
  const turns = groupTurns(log, { sending })
  return renderToStaticMarkup(
    createElement(StationaryView, { turns, sending, workingLabel: '' }),
  )
}

describe('StationaryView markdown', () => {
  it('renders pinned, note, and earlier agent text as markdown like the Stream view', () => {
    const out = html([
      { role: 'user', text: 'first ask' },
      { role: 'ai', text: '**first** final' },
      { role: 'user', text: 'second ask' },
      { role: 'ai', text: 'First *look*.' },
      { role: 'ai', text: '**second** final' },
    ])
    assert.match(out, /<strong>second<\/strong>/, 'pinned final renders markdown')
    assert.match(out, /<em>look<\/em>/, 'working note renders markdown')
    assert.match(out, /<strong>first<\/strong>/, 'earlier final renders markdown')
    assert.doesNotMatch(out, /\*\*second\*\*/, 'raw markdown markers are gone')
  })

  it('failed activity steps and error pins expose a Details button', () => {
    const failed = html([
      { role: 'user', text: 'check the env' },
      {
        role: 'tools',
        steps: [
          { id: '1', name: 'data-inspect', detail: 'data-inspect .env', status: 'error', result: 'data-inspect failed: no profile' },
        ],
      },
      { role: 'error', text: 'Chat failed: boom' },
    ])
    // One for the activity step, one for the pinned error.
    assert.equal(failed.split('Details').length - 1, 2)
  })

  it('earlier turn errors expose a Details button', () => {
    const out = html([
      { role: 'user', text: 'first ask' },
      { role: 'error', text: 'Chat failed: earlier boom' },
      { role: 'user', text: 'second ask' },
      { role: 'ai', text: 'second final' },
    ])
    assert.match(out, /Details/)
  })
})
