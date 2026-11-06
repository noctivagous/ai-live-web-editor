import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { indexProjectSources } from './resolveSourceTool.js'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('indexProjectSources', () => {
  it('indexes source files but skips dotfiles, dist, and node_modules', () => {
    fs.writeFileSync(path.join(dir, 'App.jsx'), 'export default function App() {}', 'utf-8')
    fs.writeFileSync(path.join(dir, '.App.jsx'), 'stale backup', 'utf-8')
    fs.mkdirSync(path.join(dir, 'dist'))
    fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'minified', 'utf-8')
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'dep', 'utf-8')
    const paths = indexProjectSources(dir).map((f) => f.path)
    assert.deepEqual(paths, ['/App.jsx'])
  })
})
