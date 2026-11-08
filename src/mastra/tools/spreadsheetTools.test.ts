import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from '../../launcher.js'
import {
  spreadsheetAddRowTool, spreadsheetFindTool, spreadsheetInspectTool, spreadsheetSetCellTool,
} from './spreadsheetTools.js'

/**
 * execute()-level tests for the spreadsheet renderer's agent tool
 * set: the tools run on the same csvGrid library as the human
 * grid, so these pin BOTH callers' contract — inspect shape, find
 * coordinates, and splice-exact writes.
 */

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> }).execute(input, {})

function tmpProject(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spreadsheet-tools-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  setFsRoot(root)
  return root
}

const CSV = 'name,note,score\n"Smith, J","said ""hi""",10\nAda,plain,20\n'

describe('spreadsheet-inspect', () => {
  it('reports shape, header and a verbatim sample', async () => {
    tmpProject({ 'data.csv': CSV })
    const r = await run(spreadsheetInspectTool, { path: '/data.csv' })
    assert.equal(r.ok, true)
    assert.equal(r.rows, 3)
    assert.equal(r.columns, 3)
    assert.equal(r.delimiter, 'comma')
    assert.deepEqual(r.header, ['name', 'note', 'score'])
    assert.deepEqual((r.sample as string[][])[1], ['Smith, J', 'said "hi"', '10'])
  })

  it('refuses a non-spreadsheet file with a plain reason', async () => {
    tmpProject({ 'app.ts': 'export {}\n' })
    const r = await run(spreadsheetInspectTool, { path: '/app.ts' })
    assert.equal(r.ok, false)
    assert.match(r.error as string, /not a spreadsheet/)
  })
})

describe('spreadsheet-find and set-cell', () => {
  it('find locates coordinates; set-cell splices byte-exactly', async () => {
    const root = tmpProject({ 'data.csv': CSV })
    const found = await run(spreadsheetFindTool, { path: '/data.csv', query: 'smith' })
    assert.equal(found.ok, true)
    assert.deepEqual(found.matches, [{ row: 2, col: 1, value: 'Smith, J' }])

    const set = await run(spreadsheetSetCellTool, { path: '/data.csv', row: 2, col: 3, value: '1,000' })
    assert.equal(set.ok, true)
    assert.equal(set.previous, '10')
    assert.equal(
      fs.readFileSync(path.join(root, 'data.csv'), 'utf8'),
      CSV.replace(',10\n', ',"1,000"\n'),
    )
  })

  it('set-cell outside the grid refuses and writes nothing', async () => {
    const root = tmpProject({ 'data.csv': CSV })
    const set = await run(spreadsheetSetCellTool, { path: '/data.csv', row: 9, col: 1, value: 'x' })
    assert.equal(set.ok, false)
    assert.match(set.error as string, /does not exist/)
    assert.equal(fs.readFileSync(path.join(root, 'data.csv'), 'utf8'), CSV)
  })
})

describe('spreadsheet-add-row', () => {
  it('appends a serialised row, quoting where needed, keeping CRLF style', async () => {
    const root = tmpProject({ 'data.tsv': 'a\tb\r\n1\t2\r\n', 'data.csv': CSV.replaceAll('\n', '\r\n') })
    const added = await run(spreadsheetAddRowTool, { path: '/data.csv', values: ['Grace', 'has, comma', '30'] })
    assert.equal(added.ok, true)
    assert.equal(added.row, 4)
    assert.equal(
      fs.readFileSync(path.join(root, 'data.csv'), 'utf8'),
      CSV.replaceAll('\n', '\r\n') + 'Grace,"has, comma",30\r\n',
    )
    const tsv = await run(spreadsheetAddRowTool, { path: '/data.tsv', values: ['3', '4'] })
    assert.equal(tsv.ok, true)
    assert.equal(fs.readFileSync(path.join(root, 'data.tsv'), 'utf8'), 'a\tb\r\n1\t2\r\n3\t4\r\n')
  })

  it('adds the missing newline before appending to a file without one', async () => {
    const root = tmpProject({ 'data.csv': 'a,b\n1,2' })
    await run(spreadsheetAddRowTool, { path: '/data.csv', values: ['3', '4'] })
    assert.equal(fs.readFileSync(path.join(root, 'data.csv'), 'utf8'), 'a,b\n1,2\n3,4\n')
  })
})
