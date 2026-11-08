import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  FailureDetailsDialog,
  errorFailureReport,
  formatFailureReport,
  stepFailureReport,
} from './Modal.js'

describe('formatFailureReport', () => {
  it('packs title, args, meta, and fenced result into chat-ready markdown', () => {
    const out = formatFailureReport({
      title: 'data-inspect',
      detail: 'data-inspect package.json',
      result: 'data-inspect failed: no profile for .env',
      meta: ['Status: error', 'Turn 2 — fix the config'],
    })
    assert.match(out, /Agent failure: data-inspect/)
    assert.match(out, /Args: data-inspect package\.json/)
    assert.match(out, /Turn 2 — fix the config/)
    assert.match(out, /```\ndata-inspect failed: no profile for \.env\n```/)
  })
})

describe('stepFailureReport', () => {
  it('falls back to the detail line when the step has no result', () => {
    const r = stepFailureReport(
      { id: '1', name: 'data-inspect', detail: 'data-inspect .env', status: 'error' },
      { index: 0, intent: 'check the env' },
    )
    assert.equal(r.title, 'data-inspect')
    assert.equal(r.result, 'data-inspect .env')
    assert.deepEqual(r.meta, ['Status: error', 'Turn 0 — check the env'])
  })

  it('prefers the result text and adds elapsed time when timed', () => {
    const r = stepFailureReport(
      { id: '1', name: 'grep', detail: 'grep foo', result: 'boom', status: 'error', startedAt: 1000, endedAt: 2500 },
    )
    assert.equal(r.result, 'boom')
    assert.match((r.meta ?? []).join('\n'), /Elapsed:/)
  })
})

describe('errorFailureReport', () => {
  it('titles chat-level errors without an args line', () => {
    const r = errorFailureReport('Chat failed: no key', { index: 1, intent: null })
    assert.equal(r.title, 'Chat error')
    assert.equal(r.detail, undefined)
    assert.deepEqual(r.meta, ['Turn 1'])
  })
})

describe('FailureDetailsDialog', () => {
  it('renders nothing for a null report', () => {
    const out = renderToStaticMarkup(createElement(FailureDetailsDialog, { report: null, onClose: () => {} }))
    assert.equal(out, '')
  })

  it('renders the result plus copy and insert actions', () => {
    const out = renderToStaticMarkup(
      createElement(FailureDetailsDialog, {
        report: errorFailureReport('Chat failed: no key'),
        onClose: () => {},
      }),
    )
    assert.match(out, /Failure details/)
    assert.match(out, /Chat failed: no key/)
    assert.match(out, /Copy report/)
    assert.match(out, /Insert into chat/)
  })
})
