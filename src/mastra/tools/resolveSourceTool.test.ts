import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { indexProjectSources } from './resolveSourceTool.js'
import { resolveSelector } from '../../sourceMap/resolveSource.js'

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

describe('resolve-source sourceLoc passthrough', () => {
  it('stamp wins over ambiguous heuristic anchors', () => {
    const dup = 'export function Card() { return <article className="card">x</article> }'
    const files = [
      { path: '/A.jsx', content: dup },
      { path: '/B.jsx', content: dup },
    ]
    const heuristic = resolveSelector({ selector: 'article', classList: ['card'] }, files)
    assert.equal(heuristic.ok, false)
    assert.equal(heuristic.confidence, 'ambiguous')
    const exact = resolveSelector(
      { selector: 'article', classList: ['card'], sourceLoc: { file: '/B.jsx', line: 1 } },
      files,
    )
    assert.equal(exact.ok, true)
    assert.equal(exact.confidence, 'exact')
    assert.equal(exact.file, '/B.jsx')
  })

  it('falls back to heuristic when no stamp is passed', () => {
    const files = [{ path: '/App.jsx', content: 'export default function App() { return <main>hi</main> }' }]
    const r = resolveSelector({ selector: 'main' }, files)
    assert.equal(r.ok, true)
    assert.equal(r.confidence, 'heuristic')
  })
})
