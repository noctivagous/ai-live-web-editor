import assert from 'node:assert/strict'
import test from 'node:test'
import { countNodes, isScalarNode, lineColAt, parseJsonDocument, replaceScalarValue } from './jsonDoc'

const PKG = `{
  // the app
  "name": "demo",
  "version": "1.2.0",
  "private": true,
  "scripts": {
    "dev": "vite --port 3000",
    "build": "tsc && vite build"
  },
  "dependencies": { "react": "^18.3.0" },
  "count": 3,
  "ratio": 1.5,
  "missing": null,
  "tags": ["a", "b",],
}
`

function rootObject(src: string) {
  const r = parseJsonDocument(src)
  if (r.ok === false) throw new Error(`expected a successful parse, got: ${r.error}`)
  if (r.root.kind !== 'object') throw new Error('expected object root')
  return r.root
}

test('parse: object entries in file order, offsets point at the exact values', () => {
  const root = rootObject(PKG)
  assert.deepEqual(root.entries.map((e) => e.key), ['name', 'version', 'private', 'scripts', 'dependencies', 'count', 'ratio', 'missing', 'tags'])
  for (const e of root.entries) {
    assert.equal(PKG.slice(e.keyStart, e.keyEnd), `"${e.key}"`)
    assert.ok(isScalarNode(e.value) || e.value.kind === 'object' || e.value.kind === 'array')
    assert.ok(e.value.end > e.value.start)
  }
  const name = root.entries[0].value
  assert.equal(name.kind, 'string')
  if (name.kind === 'string') {
    assert.equal(name.value, 'demo')
    assert.equal(PKG.slice(name.start, name.end), '"demo"')
  }
})

test('parse: JSONC trivia — comments counted, trailing commas accepted, file untouched', () => {
  const r = parseJsonDocument(PKG)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.comments, 1)
  const tsconfig = `{\n  /* opts */\n  "compilerOptions": { "strict": false, },\n}\n`
  assert.equal(parseJsonDocument(tsconfig).ok, true)
})

test('replace: only the value bytes change — comments, order and formatting preserved', () => {
  const root = rootObject(PKG)
  const version = root.entries.find((e) => e.key === 'version')!.value
  const next = replaceScalarValue(PKG, version, '2.0.0')
  assert.ok(next.includes('"version": "2.0.0"'))
  assert.ok(next.includes('// the app'))
  assert.equal(next.replace('"2.0.0"', '"1.2.0"'), PKG)

  const priv = root.entries.find((e) => e.key === 'private')!.value
  assert.equal(replaceScalarValue(PKG, priv, false).includes('"private": false'), true)

  const count = root.entries.find((e) => e.key === 'count')!.value
  assert.ok(replaceScalarValue(PKG, count, 42).includes('"count": 42'))

  // A nested scalar (a script command) splices at its own offsets.
  const scripts = root.entries.find((e) => e.key === 'scripts')!.value
  assert.equal(scripts.kind, 'object')
  if (scripts.kind === 'object') {
    const dev = scripts.entries.find((e) => e.key === 'dev')!.value
    const edited = replaceScalarValue(PKG, dev, 'vite --port 4000')
    assert.ok(edited.includes('"dev": "vite --port 4000"'))
    assert.ok(edited.includes('"build": "tsc && vite build"'))
  }
})

test('parse: strings with escapes, nested arrays and numbers', () => {
  const root = rootObject('{"a": "x\\n\\u0041", "b": [1, -2.5e3, true, null], "c": {}}')
  const a = root.entries[0].value
  assert.equal(a.kind === 'string' ? a.value : '', 'x\nA')
  const b = root.entries[1].value
  assert.equal(b.kind, 'array')
  if (b.kind === 'array') {
    assert.equal(b.items.length, 4)
    assert.equal(b.items[1].kind === 'number' ? b.items[1].value : 0, -2500)
  }
  assert.equal(countNodes(root), 8)
})

test('parse: invalid JSON reports an error and offset instead of throwing', () => {
  const bad = parseJsonDocument('{"name": }')
  assert.equal(bad.ok, false)
  if (!bad.ok) {
    assert.ok(bad.error.length > 0)
    assert.ok(bad.offset >= 0)
  }
  assert.equal(parseJsonDocument('').ok, false)
  assert.equal(parseJsonDocument('{"a": "unterminated').ok, false)
  assert.equal(parseJsonDocument('{} garbage').ok, false)
})

test('replace: non-scalar nodes are refused', () => {
  const root = rootObject(PKG)
  assert.throws(() => replaceScalarValue(PKG, root, 'x'))
})

test('lineColAt: 1-based line and column', () => {
  assert.deepEqual(lineColAt('ab\ncde\nf', 4), { line: 2, col: 2 })
  assert.deepEqual(lineColAt('ab', 0), { line: 1, col: 1 })
})
