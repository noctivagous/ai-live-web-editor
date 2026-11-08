import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDataTree, findDataNode, setDataScalar } from './dataTree'

const XML = `<?xml version="1.0"?>
<project name="demo" version="2">
  <deps>
    <dep>react</dep>
    <dep>vite</dep>
  </deps>
  <empty/>
  <note><![CDATA[a <b> c]]></note>
  <desc>Tom &amp; Jerry</desc>
</project>
`

function tree() {
  const parsed = parseDataTree('xml', XML)
  if (parsed.ok === false) return assert.fail(parsed.error)
  return parsed
}

test('XML joins the tree core: elements, attributes, repeated siblings', () => {
  const { root } = tree()
  assert.equal(findDataNode(root, 'project.@name')?.value, 'demo')
  assert.equal(findDataNode(root, 'project.@version')?.scalarKind, 'number')
  assert.equal(findDataNode(root, 'project.deps.dep')?.value, 'react')
  assert.equal(findDataNode(root, 'project.deps.dep[1]')?.value, 'vite')
  assert.equal(findDataNode(root, 'project.desc')?.value, 'Tom & Jerry')
  assert.equal(findDataNode(root, 'project.note')?.value, 'a <b> c')
})

test('XML sets splice escaped text, keep CDATA, expand self-closing tags', () => {
  const { root } = tree()
  const desc = findDataNode(root, 'project.desc')!
  assert.deepEqual(setDataScalar('xml', XML, desc, 'A & B <tag>'),
    { ok: true, source: XML.replace('Tom &amp; Jerry', 'A &amp; B &lt;tag&gt;') })

  const fresh = tree()
  const name = findDataNode(fresh.root, 'project.@name')!
  assert.deepEqual(setDataScalar('xml', XML, name, 'my "app"'),
    { ok: true, source: XML.replace('name="demo"', 'name="my &quot;app&quot;"') })

  const fresh2 = tree()
  const empty = findDataNode(fresh2.root, 'project.empty')!
  assert.equal(empty.scalarKind, 'null')
  assert.deepEqual(setDataScalar('xml', XML, empty, 'filled'),
    { ok: true, source: XML.replace('<empty/>', '<empty>filled</empty>') })

  const fresh3 = tree()
  const note = findDataNode(fresh3.root, 'project.note')!
  const set = setDataScalar('xml', XML, note, 'x < y')
  assert.equal(set.ok, true)
  if (set.ok) assert.ok(set.source.includes('<note><![CDATA[x < y]]></note>'))
})

test('malformed XML is an error, never a partial tree', () => {
  assert.equal(parseDataTree('xml', '<a><b></a>').ok, false)
  assert.equal(parseDataTree('xml', '<a>').ok, false)
  assert.equal(parseDataTree('xml', '<a x=1/>').ok, false)
})
