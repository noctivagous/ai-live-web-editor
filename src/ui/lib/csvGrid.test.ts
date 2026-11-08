import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCsv, parseDelimited } from './csvGrid'

test('parseCsv: plain rows and columns', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']])
})

test('parseCsv: quoted fields keep commas, quotes and newlines verbatim', () => {
  const rows = parseCsv('name,note\n"Smith, J","said ""hi""\ntwice"\n')
  assert.deepEqual(rows, [['name', 'note'], ['Smith, J', 'said "hi"\ntwice']])
})

test('parseCsv: CRLF rows, ragged rows and a missing trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\r\n1\r\nx,y'), [['a', 'b'], ['1'], ['x', 'y']])
})

test('parseCsv: empty input and a single cell', () => {
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('solo'), [['solo']])
})

test('parseDelimited: tsv by extension', () => {
  assert.deepEqual(parseDelimited('a\tb\n1\t2', '/data.tsv'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseDelimited('a,b', '/data.csv'), [['a', 'b']])
})

import { parseCsvGrid, replaceCsvCell, serialiseCsvCell } from './csvGrid'

test('cell offsets point at the exact tokens, quotes included', () => {
  const src = 'name,note\n"Smith, J",plain\n'
  const grid = parseCsvGrid(src)
  const [smith, plain] = grid.rows[1]
  assert.equal(src.slice(smith.start, smith.end), '"Smith, J"')
  assert.equal(smith.quoted, true)
  assert.equal(src.slice(plain.start, plain.end), 'plain')
  assert.equal(plain.quoted, false)
})

test('replaceCsvCell splices one cell and leaves every other byte', () => {
  const src = 'a,b\r\n"1, one",2\r\n'
  const grid = parseCsvGrid(src)
  assert.equal(replaceCsvCell(src, ',', grid.rows[1][1], '5'), 'a,b\r\n"1, one",5\r\n')
  // editing a quoted cell keeps it quoted; a comma in a bare cell adds quotes
  assert.equal(replaceCsvCell(src, ',', grid.rows[1][0], 'one, 1'), 'a,b\r\n"one, 1",2\r\n')
  assert.equal(replaceCsvCell(src, ',', grid.rows[0][0], 'x,y'), '"x,y",b\r\n"1, one",2\r\n')
})

test('replaceCsvCell escapes embedded quotes; tsv quotes on tabs', () => {
  const src = 'a\tb\n1\t2\n'
  const grid = parseCsvGrid(src, '\t')
  assert.equal(replaceCsvCell(src, '\t', grid.rows[1][0], 'has\ttab'), 'a\tb\n"has\ttab"\t2\n')
  assert.equal(serialiseCsvCell(',', { value: '', start: 0, end: 0, quoted: false }, 'say "hi"'), '"say ""hi"""')
})
