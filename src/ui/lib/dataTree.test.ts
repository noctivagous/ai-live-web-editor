import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findDataNode, findInData, outlineData, parseAddress, parseDataTree, setDataScalar } from './dataTree'

const PKG = '{\n  // a comment\n  "name": "demo",\n  "private": true,\n  "dependencies": { "react": "^18.3.0" },\n  "keywords": ["a", "b"]\n}\n'

test('one core over JSON: outline, address forms, find', () => {
  const parsed = parseDataTree('json', PKG)
  if (parsed.ok === false) return assert.fail(parsed.error)
  const outline = outlineData(parsed.root, 1)
  assert.deepEqual(outline.children?.map((c) => c.segment), ['name', 'private', 'dependencies', 'keywords'])
  assert.equal(findDataNode(parsed.root, 'dependencies.react')?.value, '^18.3.0')
  assert.equal(findDataNode(parsed.root, 'keywords[1]')?.value, 'b')
  assert.equal(findDataNode(parsed.root, 'keywords.0')?.value, 'a')
  assert.equal(findDataNode(parsed.root, 'missing.path'), null)
  assert.deepEqual(parseAddress('a.b[2].c'), ['a', 'b[2]', 'c'])
  const found = findInData(parsed.root, 'react')
  assert.deepEqual(found.matches.map((m) => m.address), ['dependencies.react'])
})

test('JSON set splices by type and keeps comments; bad types refuse', () => {
  const parsed = parseDataTree('json', PKG)
  if (parsed.ok === false) return assert.fail(parsed.error)
  const react = findDataNode(parsed.root, 'dependencies.react')!
  const set = setDataScalar('json', PKG, react, '^19.0.0')
  assert.deepEqual(set, { ok: true, source: PKG.replace('"^18.3.0"', '"^19.0.0"') })
  const priv = findDataNode(parsed.root, 'private')!
  assert.equal(setDataScalar('json', PKG, priv, 'yes').ok, false)
  const deps = findDataNode(parsed.root, 'dependencies')!
  assert.equal(setDataScalar('json', PKG, deps, 'x').ok, false)
})

const CI = 'name: CI\non: push\njobs:\n  build:\n    timeout-minutes: 30\n    steps:\n      - uses: actions/checkout@v4\n'

test('the same core over YAML: nested maps and lists of maps', () => {
  const parsed = parseDataTree('yaml', CI)
  if (parsed.ok === false) return assert.fail(parsed.error)
  assert.equal(findDataNode(parsed.root, 'jobs.build.steps[0].uses')?.value, 'actions/checkout@v4')
  const timeout = findDataNode(parsed.root, 'jobs.build.timeout-minutes')!
  assert.equal(timeout.scalarKind, 'number')
  assert.deepEqual(setDataScalar('yaml', CI, timeout, '45'), { ok: true, source: CI.replace('timeout-minutes: 30', 'timeout-minutes: 45') })
})

test('TOML and ENV ride the core; raw nodes refuse with a reason', () => {
  const toml = parseDataTree('toml', '[package]\nedition = "2021"\npoint = { x = 1 }\n')
  if (toml.ok === false) return assert.fail(toml.error)
  const edition = findDataNode(toml.root, 'package.edition')!
  assert.deepEqual(setDataScalar('toml', '[package]\nedition = "2021"\npoint = { x = 1 }\n', edition, '2024'),
    { ok: true, source: '[package]\nedition = "2024"\npoint = { x = 1 }\n' })
  const point = findDataNode(toml.root, 'package.point')!
  assert.equal(point.kind, 'raw')
  assert.equal(setDataScalar('toml', '', point, 'x').ok, false)

  const env = parseDataTree('env', 'PORT=3000\n')
  if (env.ok === false) return assert.fail(env.error)
  const port = findDataNode(env.root, 'PORT')!
  assert.deepEqual(setDataScalar('env', 'PORT=3000\n', port, '8080'), { ok: true, source: 'PORT=8080\n' })
})

import { addDataValue, removeDataNode } from './dataTree'

function parsed(format: 'json' | 'yaml' | 'toml' | 'env' | 'xml', source: string) {
  const p = parseDataTree(format, source)
  if (p.ok === false) return assert.fail(p.error)
  return p
}

test('JSON add/remove: indented insert, duplicate refusal, span deletes', () => {
  const src = '{\n  "name": "demo",\n  "keywords": ["a", "b"]\n}\n'
  const added = addDataValue('json', src, parsed('json', src).root, '', 'version', '1.0')
  assert.deepEqual(added, { ok: true, source: '{\n  "name": "demo",\n  "keywords": ["a", "b"],\n  "version": 1.0\n}\n' })
  assert.equal(addDataValue('json', src, parsed('json', src).root, '', 'name', 'x').ok, false)
  const arrAdd = addDataValue('json', src, parsed('json', src).root, 'keywords', null, 'c')
  assert.deepEqual(arrAdd, { ok: true, source: src.replace('"a", "b"', '"a", "b", "c"') })
  const removed = removeDataNode('json', src, parsed('json', src).root, 'name')
  assert.deepEqual(removed, { ok: true, source: '{\n  "keywords": ["a", "b"]\n}\n' })
  const removedLast = removeDataNode('json', src, parsed('json', src).root, 'keywords')
  assert.deepEqual(removedLast, { ok: true, source: '{\n  "name": "demo"\n}\n' })
  const removedItem = removeDataNode('json', src, parsed('json', src).root, 'keywords[0]')
  assert.deepEqual(removedItem, { ok: true, source: src.replace('"a", "b"', '"b"') })
})

test('YAML add/remove: section keys, list items, whole sections by lines', () => {
  const src = 'name: CI\njobs:\n  build:\n    runs-on: ubuntu\n    steps:\n      - one\n      - two\n'
  const added = addDataValue('yaml', src, parsed('yaml', src).root, 'jobs.build', 'timeout-minutes', '45')
  assert.deepEqual(added, { ok: true, source: `${src}    timeout-minutes: 45\n` })
  const itemAdded = addDataValue('yaml', src, parsed('yaml', src).root, 'jobs.build.steps', null, 'three')
  assert.deepEqual(itemAdded, { ok: true, source: `${src}      - three\n` })
  const removed = removeDataNode('yaml', src, parsed('yaml', src).root, 'jobs.build.runs-on')
  assert.deepEqual(removed, { ok: true, source: src.replace('    runs-on: ubuntu\n', '') })
  const sectionRemoved = removeDataNode('yaml', src, parsed('yaml', src).root, 'jobs')
  assert.deepEqual(sectionRemoved, { ok: true, source: 'name: CI\n' })
  const itemRemoved = removeDataNode('yaml', src, parsed('yaml', src).root, 'jobs.build.steps[0]')
  assert.deepEqual(itemRemoved, { ok: true, source: src.replace('      - one\n', '') })
})

test('TOML and ENV add/remove by lines', () => {
  const toml = '[package]\nname = "demo"\n'
  const added = addDataValue('toml', toml, parsed('toml', toml).root, 'package', 'edition', '2021', 'string')
  assert.deepEqual(added, { ok: true, source: '[package]\nname = "demo"\nedition = "2021"\n' })
  assert.deepEqual(addDataValue('toml', toml, parsed('toml', toml).root, 'package', 'year', '2021'),
    { ok: true, source: '[package]\nname = "demo"\nyear = 2021\n' })
  const removed = removeDataNode('toml', toml, parsed('toml', toml).root, 'package.name')
  assert.deepEqual(removed, { ok: true, source: '[package]\n' })
  const sectionRemoved = removeDataNode('toml', toml, parsed('toml', toml).root, 'package')
  assert.deepEqual(sectionRemoved, { ok: true, source: '' })

  const env = 'PORT=3000\n'
  assert.deepEqual(addDataValue('env', env, parsed('env', env).root, '', 'HOST', 'localhost'),
    { ok: true, source: 'PORT=3000\nHOST=localhost\n' })
  assert.equal(addDataValue('env', env, parsed('env', env).root, '', 'PORT', '1').ok, false)
  assert.deepEqual(removeDataNode('env', env, parsed('env', env).root, 'PORT'), { ok: true, source: '' })
})

test('XML add/remove: elements, attributes, whole-line deletes', () => {
  const src = '<project name="demo">\n  <version>2</version>\n</project>\n'
  const added = addDataValue('xml', src, parsed('xml', src).root, 'project', 'license', 'MIT')
  assert.deepEqual(added, { ok: true, source: src.replace('\n</project>', '\n  <license>MIT</license>\n</project>') })
  const attrAdded = addDataValue('xml', src, parsed('xml', src).root, 'project', '@lang', 'en')
  assert.deepEqual(attrAdded, { ok: true, source: src.replace('<project name="demo">', '<project name="demo" lang="en">') })
  const removed = removeDataNode('xml', src, parsed('xml', src).root, 'project.version')
  assert.deepEqual(removed, { ok: true, source: '<project name="demo">\n</project>\n' })
  const attrRemoved = removeDataNode('xml', src, parsed('xml', src).root, 'project.@name')
  assert.deepEqual(attrRemoved, { ok: true, source: src.replace(' name="demo"', '') })
  // An empty element with attributes keeps them, and its text is settable.
  const emptyAttr = '<a href="x"></a>\n'
  const p = parsed('xml', emptyAttr)
  assert.equal(findDataNode(p.root, 'a.@href')?.value, 'x')
  assert.deepEqual(setDataScalar('xml', emptyAttr, findDataNode(p.root, 'a.#text')!, 'hi'),
    { ok: true, source: '<a href="x">hi</a>\n' })
})
