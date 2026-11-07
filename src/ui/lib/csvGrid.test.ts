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
