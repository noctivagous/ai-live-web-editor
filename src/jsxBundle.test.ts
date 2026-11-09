import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from './launcher.js'
import { bundleJsxComponent } from './jsxBundle.js'
import { getFsRoot } from './launcher.js'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jsx-bundle-test-'))
setFsRoot(ROOT)
assert.equal(getFsRoot(), ROOT)

test('bundles a component with a relative import, keeping react external', () => {
  fs.writeFileSync(path.join(ROOT, 'lib.js'), 'export const F = 4\n')
  fs.writeFileSync(path.join(ROOT, 'Card.jsx'), `import { useState } from 'react'
import { F } from './lib.js'
export function Card({ n = 1 }) {
  const [x] = useState(n * F)
  return <div>{x}</div>
}
`)
  const r = bundleJsxComponent('/Card.jsx')
  assert.equal(r.ok, true, r.error)
  assert.ok(r.code!.includes('Card'), 'component survives bundling')
  assert.ok(!r.code!.includes('./lib.js'), 'relative import is inlined')
  assert.ok(!/from\s*["']react["']/.test(r.code!), 'react is bundled in, not imported')
  assert.ok(r.code!.includes('No component export found'), 'mount wrapper is appended')
})

test('failures come back as { ok: false }, never throw', () => {
  const missing = bundleJsxComponent('/nope.jsx')
  assert.equal(missing.ok, false)
  assert.ok((missing.error ?? '').length > 0)
  fs.writeFileSync(path.join(ROOT, 'Bad.jsx'), 'export function Bad( { return <div>\n')
  const broken = bundleJsxComponent('/Bad.jsx')
  assert.equal(broken.ok, false)
  const escape = bundleJsxComponent('/../outside.jsx')
  assert.equal(escape.ok, false)
})
