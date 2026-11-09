import assert from 'node:assert/strict'
import test from 'node:test'
import { RENDERERS, describeRenderer, rendererFor } from './previewRender'

test('registry: every renderer id has exactly one descriptor', () => {
  const ids = RENDERERS.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ['page', 'markdown', 'reading', 'image', 'css', 'json', 'yaml', 'toml', 'env', 'spreadsheet', 'richtext', 'document', 'workbook', 'jsx', 'host', 'none'] as const) {
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
  assert.equal(rendererFor('/package.json'), 'json')
  assert.equal(rendererFor('/tsconfig.json'), 'json')
  assert.equal(rendererFor('/data.jsonc'), 'json')
  assert.equal(rendererFor('/data.csv'), 'spreadsheet')
  assert.equal(rendererFor('/data.tsv'), 'spreadsheet')
  assert.equal(rendererFor('/report.docx'), 'document')
  assert.equal(rendererFor('/letter.rtf'), 'richtext')
  assert.equal(rendererFor('/ci.yml'), 'yaml')
  assert.equal(rendererFor('/config.yaml'), 'yaml')
  assert.equal(rendererFor('/Cargo.toml'), 'toml')
  assert.equal(rendererFor('/.env'), 'env')
  assert.equal(rendererFor('/.env.local'), 'env')
  assert.equal(rendererFor('/prod.env'), 'env')
  assert.equal(rendererFor('/book.xlsx'), 'workbook')
  assert.equal(rendererFor('/App.tsx'), 'host')
  assert.equal(rendererFor('/src/components/FieldLabel.jsx'), 'jsx')
})

test('rendererFor: script fallback is unchanged — components host, logic files none', () => {
  assert.equal(rendererFor('/src/components/widget.ts'), 'host')
  assert.equal(rendererFor('/src/fancy-element.ts'), 'host')
  assert.equal(rendererFor('/src/format-date.ts'), 'none')
  assert.equal(rendererFor('/archive.zip'), 'none')
  assert.equal(rendererFor('/noextension'), 'none')
})

test('descriptors: markdown, css and json write in place; richtext and image write whole-file', () => {
  const writable = RENDERERS.filter((r) => r.write !== 'none').map((r) => r.id)
  assert.deepEqual(writable, ['markdown', 'image', 'css', 'json', 'yaml', 'toml', 'env', 'xml', 'spreadsheet', 'richtext', 'jsx'])
  assert.equal(describeRenderer('richtext').write, 'whole-file')
  assert.equal(describeRenderer('image').write, 'whole-file')
  assert.equal(describeRenderer('spreadsheet').write, 'in-place')
  // The spreadsheet renderer ships its agent tool set on the descriptor.
  assert.deepEqual(describeRenderer('spreadsheet').tools, ['spreadsheet-inspect', 'spreadsheet-find', 'spreadsheet-set-cell', 'spreadsheet-add-row'])
  // The tree formats share the structured-data core tool set.
  for (const id of ['json', 'yaml', 'toml', 'env', 'xml'] as const) {
    assert.deepEqual(describeRenderer(id).tools, ['data-inspect', 'data-get', 'data-set', 'data-find', 'data-add', 'data-remove'], id)
  }
  // The document formats share the blocks core tool set.
  for (const id of ['markdown', 'richtext'] as const) {
    assert.deepEqual(describeRenderer(id).tools, ['doc-inspect', 'doc-get', 'doc-find', 'doc-set-text', 'doc-set-item', 'doc-set-style', 'doc-add-block', 'doc-remove-block'], id)
  }
})
