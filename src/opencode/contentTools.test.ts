/**
 * Parity for the OpenCode structured-content tool ports (slice 5,
 * wave 4 group B): spreadsheet (4), structured data (6) and
 * document (8) tools in ./contentTools.ts vs their Mastra
 * originals — same scripted sequence over twin seeded roots,
 * every result deepEqual, and the final trees byte-identical
 * (these families' whole value is their on-disk byte shape:
 * surgical CSV cell edits, formatting-preserving data writes,
 * the document save round-trip).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { setFsRoot } from '../launcher.js'
import {
  dataAddTool, dataFindTool, dataGetTool, dataInspectTool, dataRemoveTool, dataSetTool,
} from '../mastra/tools/dataTools.js'
import {
  docAddBlockTool, docFindTool, docGetTool, docInspectTool, docRemoveBlockTool,
  docSetItemTool, docSetStyleTool, docSetTextTool,
} from '../mastra/tools/docTools.js'
import {
  spreadsheetAddRowTool, spreadsheetFindTool, spreadsheetInspectTool, spreadsheetSetCellTool,
} from '../mastra/tools/spreadsheetTools.js'
import { runContentTool } from './contentTools.js'

const runMastra = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<any> }).execute(input, {})

const MASTRA_CONTENT: Record<string, unknown> = {
  'spreadsheet-inspect': spreadsheetInspectTool,
  'spreadsheet-find': spreadsheetFindTool,
  'spreadsheet-set-cell': spreadsheetSetCellTool,
  'spreadsheet-add-row': spreadsheetAddRowTool,
  'data-inspect': dataInspectTool,
  'data-get': dataGetTool,
  'data-set': dataSetTool,
  'data-find': dataFindTool,
  'data-add': dataAddTool,
  'data-remove': dataRemoveTool,
  'doc-inspect': docInspectTool,
  'doc-get': docGetTool,
  'doc-find': docFindTool,
  'doc-set-text': docSetTextTool,
  'doc-set-item': docSetItemTool,
  'doc-set-style': docSetStyleTool,
  'doc-add-block': docAddBlockTool,
  'doc-remove-block': docRemoveBlockTool,
}

const roots: string[] = []
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-oc-content-'))
  roots.push(root)
  const w = (rel: string, content: string) => {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  w('data/people.csv', 'name,age\nAda,36\nGrace,85\n')
  w('data/config.json', '{\n  "name": "demo",\n  "theme": {\n    "colors": {\n      "accent": "red"\n    }\n  },\n  "scripts": [\n    "dev",\n    "build"\n  ]\n}\n')
  w('notes.md', '# Title\n\nFirst para.\n\n- one\n- two\n')
  return root
}

after(() => {
  setFsRoot('')
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else out[path.relative(root, full)] = fs.readFileSync(full, 'utf-8')
    }
  }
  walk(root)
  return out
}

const STEPS: Array<{ tool: string; input: Record<string, unknown> }> = [
  { tool: 'spreadsheet-inspect', input: { path: '/data/people.csv' } },
  { tool: 'spreadsheet-find', input: { path: '/data/people.csv', query: 'ADA' } },
  { tool: 'spreadsheet-set-cell', input: { path: '/data/people.csv', row: 2, col: 2, value: '37' } },
  { tool: 'spreadsheet-add-row', input: { path: '/data/people.csv', values: ['Alan', '41'] } },
  { tool: 'spreadsheet-inspect', input: { path: '/data/people.csv' } },
  { tool: 'spreadsheet-inspect', input: { path: '/notes.md' } },
  // (A schema-invalid input like row 0 is deliberately NOT a step:
  // Mastra's .execute validates through zod and returns its
  // validation envelope, while OpenCode validates plugin inputs
  // against the JSONSchema before execute — framework-owned on
  // both sides, never reaching either body. Body-level errors are
  // the parity surface, like the next step.)
  { tool: 'spreadsheet-set-cell', input: { path: '/data/people.csv', row: 4, col: 99, value: 'x' } },
  { tool: 'spreadsheet-set-cell', input: { path: '/data/people.csv', row: 99, col: 99, value: 'x' } },
  { tool: 'data-inspect', input: { path: '/data/config.json' } },
  { tool: 'data-get', input: { path: '/data/config.json', address: 'theme.colors.accent' } },
  { tool: 'data-get', input: { path: '/data/config.json', address: 'nope.missing' } },
  { tool: 'data-set', input: { path: '/data/config.json', address: 'theme.colors.accent', value: 'blue' } },
  { tool: 'data-add', input: { path: '/data/config.json', parent: 'theme.colors', key: 'bg', value: 'white' } },
  { tool: 'data-add', input: { path: '/data/config.json', parent: 'scripts', value: 'test' } },
  { tool: 'data-add', input: { path: '/data/config.json', parent: 'theme.colors', value: 'x' } },
  { tool: 'data-find', input: { path: '/data/config.json', query: 'blue' } },
  { tool: 'data-remove', input: { path: '/data/config.json', address: 'theme.colors.bg' } },
  { tool: 'data-inspect', input: { path: '/data/config.json' } },
  { tool: 'data-inspect', input: { path: '/notes.md' } },
  { tool: 'doc-inspect', input: { path: '/notes.md' } },
  { tool: 'doc-get', input: { path: '/notes.md', block: 1 } },
  { tool: 'doc-get', input: { path: '/notes.md', block: 99 } },
  { tool: 'doc-find', input: { path: '/notes.md', query: 'para' } },
  { tool: 'doc-set-text', input: { path: '/notes.md', block: 2, text: 'Changed para.' } },
  { tool: 'doc-set-item', input: { path: '/notes.md', block: 3, item: 2, text: 'dos' } },
  { tool: 'doc-set-item', input: { path: '/notes.md', block: 2, item: 1, text: 'x' } },
  { tool: 'doc-add-block', input: { path: '/notes.md', kind: 'heading', text: 'Section', level: 2 } },
  { tool: 'doc-add-block', input: { path: '/notes.md', kind: 'paragraph', text: 'Tail.' } },
  { tool: 'doc-set-style', input: { path: '/notes.md', block: 1, level: 3 } },
  { tool: 'doc-remove-block', input: { path: '/notes.md', block: 1 } },
  { tool: 'doc-inspect', input: { path: '/notes.md' } },
  { tool: 'doc-inspect', input: { path: '/data/config.json' } },
]

describe('opencode structured-content tools — parity with the Mastra originals', () => {
  it('the scripted sequence deepEquals step for step, and the final trees are byte-identical', async () => {
    const rootA = makeRoot()
    const rootB = makeRoot()
    const obsA: unknown[] = []
    const obsB: unknown[] = []
    for (const step of STEPS) {
      setFsRoot(rootA)
      obsA.push(await runMastra(MASTRA_CONTENT[step.tool], step.input))
      setFsRoot(rootB)
      obsB.push(await runContentTool(step.tool, step.input))
    }
    STEPS.forEach((step, i) => {
      assert.deepEqual(obsB[i], obsA[i], `step ${i}: ${step.tool} ${JSON.stringify(step.input)}`)
    })
    assert.deepEqual(treeOf(rootB), treeOf(rootA), 'final trees differ')
  })

  it('unknown tool names are an error value naming the set', async () => {
    const r = (await runContentTool('nope', {})) as { ok: boolean; error: string }
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown data tool "nope"/)
    assert.match(r.error, /doc-get/)
  })
})
