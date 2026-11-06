import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validProjectId, writeImportFiles } from './launcher.js'

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
