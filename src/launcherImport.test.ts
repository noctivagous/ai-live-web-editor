import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deleteSyncFiles, listProjectFiles, validProjectId, writeImportFiles } from './launcher.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'import-test-'))
}

describe('validProjectId', () => {
  it('accepts the same ids as project create', () => {
    assert.equal(validProjectId('demo'), true)
    assert.equal(validProjectId('my-app_2'), true)
    assert.equal(validProjectId('../evil'), false)
    assert.equal(validProjectId(''), false)
  })
})

describe('writeImportFiles', () => {
  it('writes nested text files and reports counts', () => {
    const dest = tmpDir()
    try {
      const r = writeImportFiles(dest, [
        { path: '/src/App.jsx', content: 'export default 1' },
        { path: '/package.json', content: '{}' },
      ])
      assert.equal(r.received, 2)
      assert.deepEqual(r.writeErrors, [])
      assert.equal(fs.readFileSync(path.join(dest, 'src/App.jsx'), 'utf-8'), 'export default 1')
    } finally {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })
  it('rejects traversal and bad payloads per file without aborting the batch', () => {
    const dest = tmpDir()
    try {
      const r = writeImportFiles(dest, [
        { path: '/ok.txt', content: 'fine' },
        { path: '/../../evil.txt', content: 'no' },
        { path: '/missing.txt', content: null },
      ])
      assert.equal(r.received, 1)
      assert.equal(r.writeErrors.length, 2)
      assert.ok(r.writeErrors.some(e => e.error.includes('traversal')))
      assert.ok(!fs.existsSync(path.join(dest, '..', 'evil.txt')))
      assert.ok(fs.existsSync(path.join(dest, 'ok.txt')))
    } finally {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })
})

describe('listProjectFiles', () => {
  it('lists nested files with mtimes and skips dep/build dirs', () => {
    const dest = tmpDir()
    try {
      fs.mkdirSync(path.join(dest, 'src'), { recursive: true })
      fs.mkdirSync(path.join(dest, 'node_modules', 'react'), { recursive: true })
      fs.mkdirSync(path.join(dest, 'dist'), { recursive: true })
      fs.writeFileSync(path.join(dest, 'src/App.jsx'), 'x')
      fs.writeFileSync(path.join(dest, 'package.json'), '{}')
      fs.writeFileSync(path.join(dest, 'node_modules', 'react', 'index.js'), 'dep')
      fs.writeFileSync(path.join(dest, 'dist', 'bundle.js'), 'out')
      const listed = listProjectFiles(dest).map(e => e.path).sort()
      assert.deepEqual(listed, ['/package.json', '/src/App.jsx'])
      const entry = listProjectFiles(dest).find(e => e.path === '/src/App.jsx')
      assert.ok(entry && entry.mtimeMs > 0 && entry.size === 1)
    } finally {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })
  it('returns an empty list for a missing dir instead of throwing', () => {
    assert.deepEqual(listProjectFiles(path.join(tmpDir(), 'nope')), [])
  })
})

describe('deleteSyncFiles', () => {
  it('deletes named files and reports counts', () => {
    const dest = tmpDir()
    try {
      fs.mkdirSync(path.join(dest, 'src'), { recursive: true })
      fs.writeFileSync(path.join(dest, 'src/a.js'), 'a')
      fs.writeFileSync(path.join(dest, 'b.js'), 'b')
      const r = deleteSyncFiles(dest, ['/src/a.js'])
      assert.equal(r.deleted, 1)
      assert.deepEqual(r.deleteErrors, [])
      assert.ok(!fs.existsSync(path.join(dest, 'src/a.js')))
      assert.ok(fs.existsSync(path.join(dest, 'b.js')))
    } finally {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })
  it('rejects traversal, directories, and missing files per entry', () => {
    const dest = tmpDir()
    try {
      fs.mkdirSync(path.join(dest, 'sub'), { recursive: true })
      fs.writeFileSync(path.join(dest, 'ok.js'), 'ok')
      const r = deleteSyncFiles(dest, ['/ok.js', '/../../evil.js', '/sub', '/gone.js', 42])
      assert.equal(r.deleted, 1)
      assert.equal(r.deleteErrors.length, 4)
      assert.ok(r.deleteErrors.some(e => e.error.includes('traversal')))
      assert.ok(r.deleteErrors.some(e => e.error.includes('Not a file')))
      assert.ok(r.deleteErrors.some(e => e.error.includes('Not found')))
      assert.ok(fs.existsSync(path.join(dest, 'ok.js')) === false)
      assert.ok(fs.existsSync(path.join(dest, 'sub')))
    } finally {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })
})


