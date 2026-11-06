import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyCaps, classifyPath, fmtBytes, sanitizeProjectName } from './folderImport.js'

describe('classifyPath', () => {
  it('keeps ordinary source files', () => {
    assert.equal(classifyPath('src/App.jsx'), 'keep')
    assert.equal(classifyPath('package.json'), 'keep')
    assert.equal(classifyPath('src/logo.svg'), 'keep')
  })
  it('skips dependency, VCS, and build directories at any depth', () => {
    assert.equal(classifyPath('node_modules/react/index.js'), 'skip-dir')
    assert.equal(classifyPath('src/node_modules/x/y.js'), 'skip-dir')
    assert.equal(classifyPath('.git/HEAD'), 'skip-dir')
    assert.equal(classifyPath('dist/bundle.js'), 'skip-dir')
    assert.equal(classifyPath('.vite/deps/x.js'), 'skip-dir')
  })
  it('does not treat dotfiles as skip-dirs (only listed dirs)', () => {
    assert.equal(classifyPath('.env'), 'keep')
  })
  it('skips binaries by extension, case-insensitively', () => {
    assert.equal(classifyPath('assets/photo.PNG'), 'skip-binary')
    assert.equal(classifyPath('fonts/a.woff2'), 'skip-binary')
    assert.equal(classifyPath('lib/native.node'), 'skip-binary')
  })
  it('skips OS junk files', () => {
    assert.equal(classifyPath('.DS_Store'), 'skip-name')
    assert.equal(classifyPath('img/Thumbs.db'), 'skip-name')
  })
})

describe('applyCaps', () => {
  const f = (path: string, size: number) => ({ path, size })
  it('passes small sets through untouched', () => {
    const plan = applyCaps([f('b.js', 10), f('a.js', 20)], { maxBytes: 100, maxFiles: 10 })
    assert.equal(plan.over, false)
    assert.deepEqual(plan.within.map(x => x.path), ['a.js', 'b.js'])
    assert.equal(plan.totalBytes, 30)
  })
  it('splits deterministically by sorted path when over the byte cap', () => {
    const plan = applyCaps([f('c.js', 60), f('a.js', 30), f('b.js', 30)], { maxBytes: 60, maxFiles: 10 })
    assert.equal(plan.over, true)
    assert.deepEqual(plan.within.map(x => x.path), ['a.js', 'b.js'])
    assert.deepEqual(plan.overCap.map(x => x.path), ['c.js'])
  })
  it('enforces the file-count cap', () => {
    const plan = applyCaps([f('a.js', 1), f('b.js', 1), f('c.js', 1)], { maxBytes: 100, maxFiles: 2 })
    assert.equal(plan.over, true)
    assert.equal(plan.within.length, 2)
  })
})

describe('fmtBytes', () => {
  it('formats B/KB/MB', () => {
    assert.equal(fmtBytes(512), '512 B')
    assert.equal(fmtBytes(2048), '2.0 KB')
    assert.equal(fmtBytes(50 * 1024 * 1024), '50.0 MB')
  })
})

describe('sanitizeProjectName', () => {
  it('cleans folder names into valid project ids', () => {
    assert.equal(sanitizeProjectName('my app (v2)'), 'my-app-v2')
    assert.equal(sanitizeProjectName('  demo  '), 'demo')
    assert.equal(sanitizeProjectName('!!!'), 'imported-folder')
  })
})
