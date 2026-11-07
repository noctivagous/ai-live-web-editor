import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import path from 'node:path'
import { projectPathOrThrow, resolveProjectPath } from './projectPath.js'

const ROOT = path.join(path.sep, 'proj')

describe('resolveProjectPath', () => {
  it('accepts the leading-slash canonical form', () => {
    const r = resolveProjectPath(ROOT, '/src/a.ts')
    assert.deepEqual(r, { ok: true, full: path.join(ROOT, 'src', 'a.ts'), rel: '/src/a.ts' })
  })

  it('accepts relative and ./ forms, returning the same canonical path', () => {
    for (const p of ['src/a.ts', './src/a.ts', 'src//a.ts', 'src/./a.ts']) {
      const r = resolveProjectPath(ROOT, p)
      assert.deepEqual(r, { ok: true, full: path.join(ROOT, 'src', 'a.ts'), rel: '/src/a.ts' }, p)
    }
  })

  it('folds interior .. segments that stay inside the project', () => {
    const r = resolveProjectPath(ROOT, 'src/lib/../a.ts')
    assert.deepEqual(r, { ok: true, full: path.join(ROOT, 'src', 'a.ts'), rel: '/src/a.ts' })
  })

  it('resolves the project root itself', () => {
    for (const p of ['/', '.', './']) {
      const r = resolveProjectPath(ROOT, p)
      assert.deepEqual(r, { ok: true, full: ROOT, rel: '/' }, p)
    }
  })

  it('refuses escapes instead of relocating them', () => {
    for (const p of ['../evil.ts', 'src/../../evil.ts', '..']) {
      const r = resolveProjectPath(ROOT, p)
      assert.equal(r.ok, false, p)
      if (r.ok === false) assert.match(r.error, /escapes the project root/)
    }
  })

  it('refuses empty and non-string paths', () => {
    for (const p of ['', '   ', undefined, null, 42]) {
      assert.equal(resolveProjectPath(ROOT, p).ok, false, String(p))
    }
  })

  it('treats backslashes as separators', () => {
    const r = resolveProjectPath(ROOT, 'src\\lib\\a.ts')
    assert.deepEqual(r, { ok: true, full: path.join(ROOT, 'src', 'lib', 'a.ts'), rel: '/src/lib/a.ts' })
  })
})

describe('projectPathOrThrow', () => {
  it('returns the absolute path and throws a readable error on escape', () => {
    assert.equal(projectPathOrThrow(ROOT, 'src/a.ts'), path.join(ROOT, 'src', 'a.ts'))
    assert.throws(() => projectPathOrThrow(ROOT, '../evil.ts'), /escapes the project root/)
  })
})
