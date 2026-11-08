import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from '../../launcher.js'
import {
  docAddBlockTool, docFindTool, docGetTool, docInspectTool, docRemoveBlockTool,
  docSetItemTool, docSetStyleTool, docSetTextTool,
} from './docTools.js'

/**
 * execute()-level tests for the document core tools: the blocks
 * model's verbs over the base text editor's adapters. Markdown
 * writes splice in place; RTF writes regenerate from the model —
 * both are pinned the way each format honestly works.
 */

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> }).execute(input, {})

function tmpProject(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-tools-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  setFsRoot(root)
  return root
}

const MD = '# Guide\n\nIntro paragraph.\n\n- [ ] first task\n- second item\n\n## Details\n\nClosing words.\n'

describe('doc core over Markdown', () => {
  it('inspect lists blocks; find and get address them', async () => {
    tmpProject({ 'guide.md': MD })
    const inspect = await run(docInspectTool, { path: '/guide.md' })
    assert.equal(inspect.ok, true)
    assert.equal(inspect.blocks, 5)
    const outline = inspect.outline as { kind: string; level?: number }[]
    assert.deepEqual(outline.map((o) => o.kind), ['heading', 'paragraph', 'list', 'heading', 'paragraph'])
    assert.equal(outline[0].level, 1)
    const found = await run(docFindTool, { path: '/guide.md', query: 'closing' })
    assert.deepEqual((found.matches as { block: number }[]).map((m) => m.block), [5])
    const got = await run(docGetTool, { path: '/guide.md', block: 3 })
    assert.deepEqual((got.items as { text: string; checked: boolean | null }[]).map((i) => i.text), ['first task', 'second item'])
  })

  it('set-text, set-item (with task toggle), add and remove splice in place', async () => {
    const root = tmpProject({ 'guide.md': MD })
    const file = () => fs.readFileSync(path.join(root, 'guide.md'), 'utf8')
    assert.equal((await run(docSetTextTool, { path: '/guide.md', block: 2, text: 'New intro.' })).ok, true)
    assert.equal(file(), MD.replace('Intro paragraph.', 'New intro.'))
    assert.equal((await run(docSetItemTool, { path: '/guide.md', block: 3, item: 1, checked: true })).ok, true)
    assert.ok(file().includes('- [x] first task'))
    assert.equal((await run(docSetItemTool, { path: '/guide.md', block: 3, item: 2, text: 'second, edited' })).ok, true)
    assert.ok(file().includes('- second, edited'))
    const added = await run(docAddBlockTool, { path: '/guide.md', kind: 'paragraph', text: 'Appended.' })
    assert.equal(added.ok, true)
    assert.equal(added.block, 6)
    assert.ok(file().endsWith('Appended.\n'))
    const removed = await run(docRemoveBlockTool, { path: '/guide.md', block: 6 })
    assert.equal(removed.ok, true)
    assert.ok(!file().includes('Appended.'))
  })

  it('style refuses what Markdown cannot represent, with the adapter reason', async () => {
    tmpProject({ 'guide.md': MD })
    const align = await run(docSetStyleTool, { path: '/guide.md', block: 2, align: 'center' })
    assert.equal(align.ok, false)
    assert.match(align.error as string, /no text alignment/)
    const leveled = await run(docSetStyleTool, { path: '/guide.md', block: 4, level: 3 })
    assert.equal(leveled.ok, true)
  })
})

describe('doc core over RTF', () => {
  it('inspect, set-text and set-style work through the RTF adapter', async () => {
    const rtf = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0\n\\pard \\ql \\fs24 Hello there.\\par\n}'
    const root = tmpProject({ 'note.rtf': rtf })
    const inspect = await run(docInspectTool, { path: '/note.rtf' })
    assert.equal(inspect.ok, true)
    assert.equal(inspect.blocks, 1)
    assert.equal((await run(docSetTextTool, { path: '/note.rtf', block: 1, text: 'Edited text.' })).ok, true)
    assert.ok(fs.readFileSync(path.join(root, 'note.rtf'), 'utf8').includes('Edited text.'))
    assert.equal((await run(docSetStyleTool, { path: '/note.rtf', block: 1, align: 'center', bold: true })).ok, true)
    const out = fs.readFileSync(path.join(root, 'note.rtf'), 'utf8')
    assert.ok(out.includes('\\qc'))
    assert.ok(out.includes('\\b'))
  })

  it('refuses files outside the doc core', async () => {
    tmpProject({ 'data.csv': 'a,b\n' })
    const r = await run(docInspectTool, { path: '/data.csv' })
    assert.equal(r.ok, false)
    assert.match(r.error as string, /not a document/)
  })
})
