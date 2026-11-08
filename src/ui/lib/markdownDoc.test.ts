import assert from 'node:assert/strict'
import test from 'node:test'
import { appendBlock, deleteBlock, parseMarkdown, replaceQuoteText, replaceText, setHeadingLevel, toggleTaskItem } from './markdownDoc'

const DOC = `---
title: Guide
---

# Getting Started

Welcome to the **guide**. It has
two lines.

## Steps

- [x] Install it
- [ ] Run it
1. First ordered

> A note worth
> keeping.

\`\`\`ts
const x = 1
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |

---
`

test('parse: block kinds in order, frontmatter first', () => {
  const blocks = parseMarkdown(DOC)
  assert.deepEqual(blocks.map((b) => b.kind), ['frontmatter', 'heading', 'paragraph', 'heading', 'list', 'quote', 'code', 'table', 'hr'])
})

test('parse: offsets point at the exact text for headings, paragraphs and list items', () => {
  const blocks = parseMarkdown(DOC)
  const h = blocks[1]
  assert.equal(h.kind, 'heading')
  if (h.kind === 'heading') {
    assert.equal(h.level, 1)
    assert.equal(DOC.slice(h.textStart, h.textEnd), 'Getting Started')
  }
  const p = blocks[2]
  assert.equal(p.kind, 'paragraph')
  if (p.kind === 'paragraph') assert.equal(DOC.slice(p.textStart, p.textEnd), p.text)
  const list = blocks[4]
  assert.equal(list.kind, 'list')
  if (list.kind === 'list') {
    // A change of marker (bullet -> numbered) starts a new list block in this parser only if lines are consecutive — here they are one block of 3 items.
    assert.equal(list.items.length, 3)
    assert.equal(list.items[0].checked, true)
    assert.equal(list.items[1].checked, false)
    assert.equal(list.items[2].checked, null)
    for (const it of list.items) assert.equal(DOC.slice(it.textStart, it.textEnd), it.text)
  }
})

test('replace: heading text and level splice in place, rest untouched', () => {
  const blocks = parseMarkdown(DOC)
  const h = blocks[1]
  if (h.kind !== 'heading') throw new Error('heading expected')
  const renamed = replaceText(DOC, h, 'Start Here')
  assert.ok(renamed.includes('# Start Here'))
  assert.equal(renamed.replace('# Start Here', '# Getting Started'), DOC)
  const demoted = setHeadingLevel(DOC, h, 3)
  assert.ok(demoted.includes('### Getting Started'))
  assert.equal(demoted.replace('### Getting Started', '# Getting Started'), DOC)
})

test('toggle: a task item flips its checkbox byte only', () => {
  const blocks = parseMarkdown(DOC)
  const list = blocks[4]
  if (list.kind !== 'list') throw new Error('list expected')
  const next = toggleTaskItem(DOC, list.items[1])
  assert.ok(next.includes('- [x] Run it'))
  assert.equal(next.length, DOC.length)
  const nextList = parseMarkdown(next).find((b) => b.kind === 'list')
  if (!nextList || nextList.kind !== 'list') throw new Error('list expected after toggle')
  assert.equal(toggleTaskItem(next, nextList.items[1]), DOC)
})

test('quote: stripped text round-trips through replaceQuoteText', () => {
  const blocks = parseMarkdown(DOC)
  const q = blocks[5]
  if (q.kind !== 'quote') throw new Error('quote expected')
  assert.equal(q.text, 'A note worth\nkeeping.')
  const next = replaceQuoteText(DOC, q, 'A shorter note.')
  assert.ok(next.includes('> A shorter note.'))
  assert.ok(!next.includes('keeping.'))
})

test('code: language and content ranges are exact', () => {
  const blocks = parseMarkdown(DOC)
  const code = blocks[6]
  if (code.kind !== 'code') throw new Error('code expected')
  assert.equal(code.lang, 'ts')
  assert.equal(code.code, 'const x = 1')
  assert.equal(DOC.slice(code.langStart, code.langEnd), 'ts')
})

test('append and delete keep one blank line between blocks', () => {
  const added = appendBlock(DOC, 'paragraph')
  assert.ok(added.endsWith('\n\nNew paragraph.\n'))
  assert.equal(parseMarkdown(added).at(-1)?.kind, 'paragraph')

  const blocks = parseMarkdown(DOC)
  const para = blocks[2]
  const removed = deleteBlock(DOC, para)
  assert.ok(!removed.includes('Welcome to the'))
  assert.ok(removed.includes('# Getting Started\n\n## Steps'))
  assert.ok(!removed.includes('\n\n\n'))

  const last = parseMarkdown(DOC).at(-1)!
  const removedLast = deleteBlock(DOC, last)
  assert.ok(removedLast.endsWith('| 1 | 2 |\n'))
})

test('parse: a plain document with no special blocks is paragraphs and headings', () => {
  const blocks = parseMarkdown('# Title\n\nJust text.\n')
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'paragraph'])
  assert.deepEqual(parseMarkdown(''), [])
  assert.deepEqual(parseMarkdown('\n\n'), [])
})
