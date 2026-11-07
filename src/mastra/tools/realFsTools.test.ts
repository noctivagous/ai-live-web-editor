import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setFsRoot } from '../../launcher.js'
import { grepTool, readRealFileTool, strReplaceTool, writeRealFileTool } from './realFsTools.js'

/**
 * The file tools' execute() paths, exercised directly (basics audit
 * slice 1). Before the shared resolver, a relative write path silently
 * landed in a hidden dot-folder while reporting ok:true — these tests
 * pin the fixed behaviour: every path form lands in the same place,
 * results carry the canonical path, and escapes are error values.
 */

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realfs-tools-test-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'export default () => <div>hi</div>\n')
  setFsRoot(root)
  return root
}

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> }).execute(input, {})

describe('write-real-file path forms', () => {
  it('writes a relative path into the project, not a hidden dot-folder', async () => {
    const root = tmpProject()
    try {
      const r = await run(writeRealFileTool, { path: 'src/components/Badge.jsx', content: 'export const B = 1\n' })
      assert.equal(r.ok, true)
      assert.equal(r.path, '/src/components/Badge.jsx')
      assert.equal(r.created, true)
      assert.equal(fs.readFileSync(path.join(root, 'src', 'components', 'Badge.jsx'), 'utf-8'), 'export const B = 1\n')
      assert.equal(fs.existsSync(path.join(root, '.src')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('reports created:false on overwrite and accepts ./ and leading-slash forms', async () => {
    const root = tmpProject()
    try {
      const first = await run(writeRealFileTool, { path: './notes.txt', content: 'one' })
      assert.equal(first.created, true)
      assert.equal(first.path, '/notes.txt')
      const second = await run(writeRealFileTool, { path: '/notes.txt', content: 'two' })
      assert.equal(second.ok, true)
      assert.equal(second.created, false)
      assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf-8'), 'two')
      assert.equal(fs.existsSync(path.join(root, '.notes.txt')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses an escaping path as an error value and writes nothing', async () => {
    const root = tmpProject()
    try {
      const r = await run(writeRealFileTool, { path: '../escape-marker.txt', content: 'x' })
      assert.match(String(r.error), /escapes the project root/)
      assert.equal(fs.existsSync(path.join(root, '..', 'escape-marker.txt')), false)
      assert.equal(fs.existsSync(path.join(root, '...')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses to write onto a directory instead of throwing', async () => {
    const root = tmpProject()
    try {
      const r = await run(writeRealFileTool, { path: '/src', content: 'x' })
      assert.match(String(r.error), /Is a directory/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('read / str-replace / grep path forms', () => {
  it('reads and edits via relative paths, returning the canonical path', async () => {
    const root = tmpProject()
    try {
      const read = await run(readRealFileTool, { path: 'src/App.jsx' })
      assert.equal(read.path, '/src/App.jsx')
      assert.match(String(read.content ?? read.text ?? ''), /hi/)
      const edit = await run(strReplaceTool, { path: './src/App.jsx', old_string: 'hi', new_string: 'hello' })
      assert.equal(edit.ok, true)
      assert.equal(edit.path, '/src/App.jsx')
      assert.match(fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf-8'), /hello/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('returns readable error values for missing and escaping paths', async () => {
    const root = tmpProject()
    try {
      const missing = await run(readRealFileTool, { path: 'nope.txt' })
      assert.equal(missing.error, 'Not found: /nope.txt')
      const escape = await run(readRealFileTool, { path: '../secret.txt' })
      assert.match(String(escape.error), /escapes the project root/)
      const dirRead = await run(readRealFileTool, { path: '/src' })
      assert.match(String(dirRead.error), /Is a directory/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('greps under a relative directory path', async () => {
    const root = tmpProject()
    try {
      const r = await run(grepTool, { pattern: 'div', path: 'src' })
      assert.equal(r.count, 1)
      const bad = await run(grepTool, { pattern: 'div', path: '../' })
      assert.match(String(bad.error), /escapes the project root/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
