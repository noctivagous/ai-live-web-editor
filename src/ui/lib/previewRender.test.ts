import assert from 'node:assert/strict'
import test from 'node:test'
import { RENDERERS, describeRenderer, rendererFor } from './previewRender'

test('registry: every renderer id has exactly one descriptor', () => {
  const ids = RENDERERS.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ['page', 'markdown', 'reading', 'image', 'css', 'spreadsheet', 'document', 'workbook', 'host', 'none'] as const) {
    assert.equal(describeRenderer(id).id, id)
    assert.ok(describeRenderer(id).summary.length > 0, `${id} needs a summary`)
  }
})

test('registry: no extension is claimed twice', () => {
  const seen = new Set<string>()
  for (const r of RENDERERS) for (const ext of r.extensions) {
    assert.ok(!seen.has(ext), `${ext} claimed by two renderers`)
    seen.add(ext)
  }
})

test('rendererFor: extension dispatch follows the table', () => {
  assert.equal(rendererFor('/index.html'), 'page')
  assert.equal(rendererFor('/guide.md'), 'markdown')
  assert.equal(rendererFor('/notes.txt'), 'reading')
  assert.equal(rendererFor('/photo.PNG'), 'image')
  assert.equal(rendererFor('/styles.css'), 'css')
  assert.equal(rendererFor('/data.csv'), 'spreadsheet')
  assert.equal(rendererFor('/data.tsv'), 'spreadsheet')
  assert.equal(rendererFor('/report.docx'), 'document')
  assert.equal(rendererFor('/letter.rtf'), 'document')
  assert.equal(rendererFor('/book.xlsx'), 'workbook')
  assert.equal(rendererFor('/App.tsx'), 'host')
})

test('rendererFor: script fallback is unchanged — components host, logic files none', () => {
  assert.equal(rendererFor('/src/components/widget.ts'), 'host')
  assert.equal(rendererFor('/src/fancy-element.ts'), 'host')
  assert.equal(rendererFor('/src/format-date.ts'), 'none')
  assert.equal(rendererFor('/archive.zip'), 'none')
  assert.equal(rendererFor('/noextension'), 'none')
})

test('descriptors: only the css box editor writes in place today', () => {
  const writable = RENDERERS.filter((r) => r.write !== 'none').map((r) => r.id)
  assert.deepEqual(writable, ['css'])
  assert.equal(describeRenderer('spreadsheet').write, 'none')
  assert.equal(describeRenderer('image').write, 'none')
})
