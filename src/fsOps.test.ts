import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { countEntries, deletePath, mkdirPath, renamePath } from './fsOps.js'

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsops-test-'))
  fs.mkdirSync(path.join(root, 'src', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a')
  fs.writeFileSync(path.join(root, 'src', 'lib', 'b.ts'), 'b')
  fs.writeFileSync(path.join(root, 'index.html'), '<html>')
  return root
}

describe('renamePath', () => {
  it('renames a file and moves a file across folders', () => {
    const root = tmpRoot()
    try {
      assert.deepEqual(renamePath(root, '/src/a.ts', '/src/renamed.ts'), { from: '/src/a.ts', to: '/src/renamed.ts', isDir: false })
      assert.equal(fs.existsSync(path.join(root, 'src', 'renamed.ts')), true)
      renamePath(root, '/src/lib/b.ts', '/b.ts')
      assert.equal(fs.existsSync(path.join(root, 'b.ts')), true)
      assert.equal(fs.existsSync(path.join(root, 'src', 'lib', 'b.ts')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('renames a folder with its contents', () => {
    const root = tmpRoot()
    try {
      const r = renamePath(root, '/src/lib', '/src/util')
      assert.equal(r.isDir, true)
      assert.equal(fs.existsSync(path.join(root, 'src', 'util', 'b.ts')), true)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses existing targets, missing sources, traversal, and folder-into-itself', () => {
    const root = tmpRoot()
    try {
      assert.throws(() => renamePath(root, '/src/a.ts', '/index.html'), /Already exists/)
      assert.throws(() => renamePath(root, '/nope.ts', '/x.ts'), /Not found/)
      assert.throws(() => renamePath(root, '/../evil.ts', '/x.ts'), /traversal|absolute/)
      assert.throws(() => renamePath(root, '/src/a.ts', '/../evil.ts'), /traversal|absolute/)
      assert.throws(() => renamePath(root, '/src', '/src/lib/inner'), /into itself/)
      assert.throws(() => renamePath(root, '/', '/x'), /project root|absolute/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('deletePath', () => {
  it('deletes files and empty folders', () => {
    const root = tmpRoot()
    try {
      assert.deepEqual(deletePath(root, '/src/a.ts'), { path: '/src/a.ts', isDir: false })
      fs.mkdirSync(path.join(root, 'empty'))
      assert.deepEqual(deletePath(root, '/empty'), { path: '/empty', isDir: true })
      assert.equal(fs.existsSync(path.join(root, 'empty')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses a non-empty folder without recursive, deletes with it', () => {
    const root = tmpRoot()
    try {
      assert.throws(() => deletePath(root, '/src'), /not empty/)
      assert.equal(fs.existsSync(path.join(root, 'src', 'a.ts')), true)
      deletePath(root, '/src', true)
      assert.equal(fs.existsSync(path.join(root, 'src')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses the project root and missing paths', () => {
    const root = tmpRoot()
    try {
      assert.throws(() => deletePath(root, '/'), /project root/)
      assert.throws(() => deletePath(root, '/ghost.ts'), /Not found/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('mkdirPath + countEntries', () => {
  it('creates nested folders and refuses collisions', () => {
    const root = tmpRoot()
    try {
      assert.deepEqual(mkdirPath(root, '/src/new/deep'), { path: '/src/new/deep' })
      assert.equal(fs.statSync(path.join(root, 'src', 'new', 'deep')).isDirectory(), true)
      assert.throws(() => mkdirPath(root, '/src/new'), /already exists/)
      assert.throws(() => mkdirPath(root, '/index.html'), /file already exists/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('counts a file as 1 and a folder as its full entry count', () => {
    const root = tmpRoot()
    try {
      assert.equal(countEntries(root, '/index.html'), 1)
      assert.equal(countEntries(root, '/src'), 3) // a.ts, lib, lib/b.ts
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
