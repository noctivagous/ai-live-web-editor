import assert from 'node:assert/strict'
import test from 'node:test'
import { levelForPt, markdownAdapter, parseRtf, rtfAdapter, serializeRtf } from './textDoc'

const MD = `# Title

Some **body** text.

- [ ] A task
`

test('markdown adapter: blocks map onto the neutral model', () => {
  const blocks = markdownAdapter.parse(MD)
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'paragraph', 'list'])
  assert.equal(blocks[0].level, 1)
  assert.equal(blocks[0].style.fontSizePt, 24)
  assert.deepEqual(blocks[2].items, [{ text: 'A task', checked: false }])
})

test('markdown adapter: font size on a heading is a level change; on a paragraph it is refused honestly', () => {
  const blocks = markdownAdapter.parse(MD)
  const resized = markdownAdapter.setStyle(MD, blocks[0], { fontSizePt: 14 })
  assert.ok(resized.startsWith('#### Title')) // 14pt <-> H4
  assert.equal(markdownAdapter.setStyle(MD, blocks[1], { fontSizePt: 20 }), MD)
  const support = markdownAdapter.support(blocks[1])
  assert.equal(typeof support.align, 'string')
  assert.ok((support.align as string).includes('no text alignment'))
  assert.equal(levelForPt(24), 1)
  assert.equal(levelForPt(12), 6)
})

test('markdown adapter: text and task edits delegate to the offset splices', () => {
  const blocks = markdownAdapter.parse(MD)
  const renamed = markdownAdapter.setText(MD, blocks[0], 'New Title')
  assert.ok(renamed.includes('# New Title'))
  const toggled = markdownAdapter.toggleTask!(MD, blocks[2], 0)
  assert.ok(toggled.includes('- [x] A task'))
})

const RTF = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0
\\pard \\qc \\fs36 \\b Report Title\\par
\\pard \\ql \\fs24 Normal body text.\\par
}`

test('rtf: parse reads paragraphs with size, weight and alignment; font table is skipped', () => {
  const paras = parseRtf(RTF)
  assert.equal(paras.length, 2)
  assert.deepEqual(paras[0], { text: 'Report Title', style: { fontSizePt: 18, bold: true, align: 'center' } })
  assert.deepEqual(paras[1], { text: 'Normal body text.', style: { fontSizePt: 12, align: 'left' } })
})

test('rtf: serialize round-trips text and style', () => {
  const paras = parseRtf(RTF)
  const out = serializeRtf(paras)
  const again = parseRtf(out)
  assert.deepEqual(again, paras)
  assert.ok(out.startsWith('{\\rtf1'))
})

test('rtf adapter: style edits land in the serialized file (align, size, weight)', () => {
  const blocks = rtfAdapter.parse(RTF)
  assert.equal(rtfAdapter.support(blocks[1]).align, true)
  const centred = rtfAdapter.setStyle(RTF, blocks[1], { align: 'center' })
  assert.ok(parseRtf(centred)[1].style.align === 'center')
  const bigger = rtfAdapter.setStyle(RTF, blocks[1], { fontSizePt: 20 })
  assert.equal(parseRtf(bigger)[1].style.fontSizePt, 20)
  const bolded = rtfAdapter.setStyle(RTF, blocks[1], { bold: true })
  assert.equal(parseRtf(bolded)[1].style.bold, true)
  const renamed = rtfAdapter.setText(RTF, blocks[0], 'Quarterly Report')
  assert.equal(parseRtf(renamed)[0].text, 'Quarterly Report')
})

test('rtf: escapes and unicode survive a round trip', () => {
  const paras = [{ text: 'Braces {here} and café', style: { fontSizePt: 12 } }]
  const out = serializeRtf(paras)
  assert.deepEqual(parseRtf(out)[0].text, 'Braces {here} and café')
})
