import assert from 'node:assert/strict'
import test from 'node:test'
import { parseJsxDocument, renameComponentInText, setPropDefaultInText } from './jsxDoc.js'

const TSX_SRC = `import { useState } from 'react'

export function Badge({ label, tone = 'plain', onPick }: { label: string, tone?: string, onPick?: () => void }) {
  const [on, setOn] = useState(false)
  return <span onClick={() => setOn(!on)}>{label}</span>
}
`

const JS_SRC = `import { format } from './fmt.js'

export const VERSION = 3

export function formatName(first, last) {
  return format(first) + ' ' + format(last)
}
`

const SRC = `import { useEffect, useState } from 'react'
import * as lib from '../lib/units.js'
import Logo from './Logo.jsx'

const LIMIT = 12

function helper(x) {
  return x * 2
}

export function Card({ title, count = 3, onPick }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(count > 0)
  }, [count])
  return (
    <div className="card">
      <Logo />
      <h1>{title}</h1>
      <button onClick={onPick}>go</button>
    </div>
  )
}

const Pill = ({ label = 'new' }) => {
  return <span>{label}</span>
}

export { Pill }
export default Card
`

test('parseJsxDocument reads imports, components, helpers', async () => {
  const doc = await parseJsxDocument(SRC)
  assert.deepEqual(doc.imports.map(i => i.source), ['react', '../lib/units.js', './Logo.jsx'])
  assert.deepEqual(doc.imports[0].names, ['useEffect', 'useState'])
  assert.deepEqual(doc.imports[1].names, ['* as lib'])
  assert.deepEqual(doc.imports[2].names, ['Logo'])

  const names = doc.components.map(c => c.name).sort()
  assert.deepEqual(names, ['Card', 'Pill'])
  const card = doc.components.find(c => c.name === 'Card')!
  assert.equal(card.exported, true)
  assert.deepEqual(card.props.map(p => p.name), ['title', 'count', 'onPick'])
  assert.equal(card.props.find(p => p.name === 'count')?.defaultSrc, '3')
  assert.equal(card.props.find(p => p.name === 'title')?.defaultSrc, undefined)
  assert.deepEqual(card.hooks.map(h => h.name), ['useState', 'useEffect'])
  assert.deepEqual(card.hooks[0].bound, ['open', 'setOpen'])
  assert.ok(card.outline[0].startsWith('<div'), `outline starts at the returned div (got ${card.outline[0]})`)
  assert.ok(card.outline.some(t => t.startsWith('<Logo')), 'outline includes nested Logo')
  assert.ok(card.outline.some(t => t.startsWith('<h1')), 'outline includes nested h1')
  const pill = doc.components.find(c => c.name === 'Pill')!
  assert.equal(pill.props[0].defaultSrc, "'new'")

  assert.ok(doc.helpers.some(h => h.name === 'LIMIT' && !h.exported), 'LIMIT is an unexported helper')
  assert.ok(doc.helpers.some(h => h.name === 'helper' && !h.exported), 'helper() is an unexported helper')
})

test('parseJsxDocument with tsx reads typed props', async () => {
  const doc = await parseJsxDocument(TSX_SRC, 'tsx')
  assert.deepEqual(doc.imports[0].names, ['useState'])
  const badge = doc.components.find(c => c.name === 'Badge')!
  assert.equal(badge.exported, true)
  assert.deepEqual(badge.props.map(p => p.name), ['label', 'tone', 'onPick'])
  assert.equal(badge.props.find(p => p.name === 'tone')?.defaultSrc, "'plain'")
  assert.deepEqual(badge.hooks[0].bound, ['on', 'setOn'])
  const renamed = await renameComponentInText(TSX_SRC, 'Badge', 'Tag')
  assert.ok(renamed.includes('export function Tag('))
  const edited = await setPropDefaultInText(TSX_SRC, 'Badge', 'tone', "'loud'", 'tsx')
  assert.ok(edited.includes("tone = 'loud'"))
})

test('parseJsxDocument with js reads helpers and no components', async () => {
  const doc = await parseJsxDocument(JS_SRC, 'js')
  assert.deepEqual(doc.imports[0].names, ['format'])
  assert.equal(doc.components.length, 0)
  const names = doc.helpers.map(h => h.name).sort()
  assert.deepEqual(names, ['VERSION', 'formatName'])
  assert.ok(doc.helpers.every(h => h.exported), 'both are exported')
})

test('renameComponentInText touches the definition, tags, and exports only', async () => {
  const out = await renameComponentInText(SRC, 'Card', 'Panel')
  assert.ok(out.includes('export function Panel('), 'definition renamed')
  assert.ok(out.includes('export { Pill }'), 'other exports untouched')
  assert.ok(out.includes('export default Card') === false, 'default export renamed')
  assert.ok(out.includes('export default Panel'), 'default export renamed to Panel')
  assert.ok(!/\bCard\b/.test(out), 'no Card identifier remains')
  assert.ok(out.includes("from 'react'"), 'import sources untouched')
})

test('setPropDefaultInText rewrites an existing default and inserts a missing one', async () => {
  const rewritten = await setPropDefaultInText(SRC, 'Card', 'count', '9')
  assert.ok(rewritten.includes('count = 9'), 'existing default rewritten')
  const inserted = await setPropDefaultInText(SRC, 'Card', 'title', "'hi'")
  assert.ok(inserted.includes("title = 'hi'"), 'missing default inserted after the prop name')
  const pill = await setPropDefaultInText(SRC, 'Pill', 'label', "'sale'")
  assert.ok(pill.includes("label = 'sale'"), 'single quotes preserved as written')
  await assert.rejects(setPropDefaultInText(SRC, 'Missing', 'x', '1'), /No component Missing/)
  await assert.rejects(setPropDefaultInText(SRC, 'Card', 'nope', '1'), /No prop nope/)
})
