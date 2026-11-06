import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { Markdown } from './Markdown.js'

function html(source: string): string {
  return renderToStaticMarkup(createElement(Markdown, { text: source }))
}

describe('Markdown', () => {
  it('renders GFM tables and fenced code', () => {
    const out = html('# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n')
    assert.match(out, /<table/)
    assert.match(out, /<code/)
    assert.match(out, /const x = 1/)
  })

  it('renders emphasis and lists without new containers', () => {
    const out = html('**bold** and *italic*\n\n- one\n- two\n')
    assert.match(out, /<strong>bold<\/strong>/)
    assert.match(out, /<li>one<\/li>/)
  })

  it('strips scripts and javascript: links', () => {
    const out = html('<script>alert(1)</script>\n\n[click](javascript:alert(2))\n\n[ok](https://example.com)\n')
    assert.doesNotMatch(out, /<script/)
    assert.doesNotMatch(out, /javascript:/)
    assert.doesNotMatch(out, /onerror/)
    assert.match(out, /https:\/\/example\.com/)
  })

  it('renders plain sentences near-identically to text', () => {
    const out = html('I updated the heading color.')
    assert.match(out, /I updated the heading color\./)
  })
})
