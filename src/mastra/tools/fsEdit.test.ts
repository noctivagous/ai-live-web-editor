import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyStrReplace, compileGrep, countOccurrences, grepText, isPlaceholderWrite, sliceLines, snippetAround } from './fsEdit.js'

describe('applyStrReplace', () => {
  const src = 'alpha\nbeta\nalpha\n'

  it('replaces a unique hunk', () => {
    const r = applyStrReplace(src, 'beta', 'BETA')
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.matches, 1)
      assert.equal(r.content, 'alpha\nBETA\nalpha\n')
    }
  })

  it('fails closed when missing', () => {
    const r = applyStrReplace(src, 'nope', 'x')
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.matches, 0)
      assert.match(r.error, /not found/)
    }
  })

  it('fails closed when not unique', () => {
    const r = applyStrReplace(src, 'alpha', 'A')
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.matches, 2)
      assert.match(r.error, /not unique/)
    }
  })

  it('replace_all replaces every match', () => {
    const r = applyStrReplace(src, 'alpha', 'A', true)
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.matches, 2)
      assert.equal(r.content, 'A\nbeta\nA\n')
    }
  })

  it('rejects empty old_string', () => {
    const r = applyStrReplace(src, '', 'x')
    assert.equal(r.ok, false)
  })
})

describe('sliceLines / grep', () => {
  it('slices 1-based lines', () => {
    const r = sliceLines('a\nb\nc\nd', 2, 2)
    assert.equal(r.content, 'b\nc')
    assert.equal(r.startLine, 2)
    assert.equal(r.endLine, 3)
    assert.equal(r.totalLines, 4)
    assert.equal(r.truncated, true)
  })

  it('greps line hits', () => {
    const hits: { path: string, line: number, text: string }[] = []
    const re = compileGrep('be', false)
    assert.ok(re instanceof RegExp)
    grepText('alpha\nbeta\nBETA', '/App.jsx', re, 10, hits)
    assert.deepEqual(hits, [{ path: '/App.jsx', line: 2, text: 'beta' }])
  })

  it('counts overlapping-safe occurrences', () => {
    assert.equal(countOccurrences('aaa', 'aa'), 1)
    assert.equal(countOccurrences('aaaa', 'aa'), 2)
  })

  it('builds a numbered snippet', () => {
    const s = snippetAround('one\ntwo\nthree', 'two', 1)
    assert.match(s, /1\| one/)
    assert.match(s, /2\| two/)
    assert.match(s, /3\| three/)
  })

  it('flags placeholder full writes', () => {
    assert.equal(isPlaceholderWrite('keep this\n[original content]\n'), true)
    assert.equal(isPlaceholderWrite('export function App() {}'), false)
  })
})
