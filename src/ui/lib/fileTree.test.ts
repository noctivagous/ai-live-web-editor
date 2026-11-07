import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allDirPaths, buildTree, countMatches, entriesUnder, filterTree, findNode,
  flattenVisible, isHiddenPath, siblingNames, sortTree, validateEntryName, visibleTree,
} from './fileTree.js'

const FILES = ['/index.html', '/src/App.tsx', '/src/lib/panel.ts', '/src/lib/deck.ts', '/src/index.css', '/.env', '/README.md']

describe('buildTree', () => {
  it('nests files under derived folders', () => {
    const tree = buildTree(FILES)
    const src = findNode(tree, '/src')!
    assert.equal(src.isDir, true)
    assert.deepEqual(src.children.map(c => c.name).sort(), ['App.tsx', 'index.css', 'lib'])
    assert.equal(findNode(tree, '/src/lib/panel.ts')!.isDir, false)
  })

  it('includes empty folders from the server dir list', () => {
    const tree = buildTree(FILES, ['/assets', '/src/empty'])
    assert.equal(findNode(tree, '/assets')!.isDir, true)
    assert.deepEqual(findNode(tree, '/src/empty')!.children, [])
    assert.ok(allDirPaths(tree).includes('/assets'))
  })
})

describe('sortTree', () => {
  it('groups folders first, then files by name', () => {
    const tree = sortTree(buildTree(FILES), 'name')
    const src = findNode(tree, '/src')!
    assert.deepEqual(src.children.map(c => c.name), ['lib', 'App.tsx', 'index.css'])
  })

  it('sorts files by extension in type mode', () => {
    const tree = sortTree(buildTree(FILES), 'type')
    const src = findNode(tree, '/src')!
    assert.deepEqual(src.children.filter(c => !c.isDir).map(c => c.name), ['index.css', 'App.tsx'])
  })

  it('sorts newest first in modified mode using mtimes', () => {
    const mtimes = { '/src/App.tsx': 100, '/src/index.css': 300, '/src/lib/panel.ts': 200, '/src/lib/deck.ts': 50 }
    const tree = sortTree(buildTree(FILES), 'modified', mtimes)
    const src = findNode(tree, '/src')!
    assert.deepEqual(src.children.filter(c => !c.isDir).map(c => c.name), ['index.css', 'App.tsx'])
  })
})

describe('filter + flatten + hidden', () => {
  it('keeps ancestors of matches and drops the rest', () => {
    const tree = filterTree(buildTree(FILES), 'panel')
    assert.equal(countMatches(buildTree(FILES), 'panel'), 1)
    const rows = flattenVisible(tree, new Set())
    assert.deepEqual(rows.map(r => r.node.path), ['/src', '/src/lib', '/src/lib/panel.ts'])
  })

  it('a matching folder keeps its whole subtree', () => {
    const tree = filterTree(buildTree(FILES), 'lib')
    const rows = flattenVisible(tree, new Set())
    assert.ok(rows.some(r => r.node.path === '/src/lib/deck.ts'))
    assert.ok(rows.some(r => r.node.path === '/src/lib/panel.ts'))
  })

  it('collapsed folders hide their children in the flat rows', () => {
    const rows = flattenVisible(buildTree(FILES), new Set(['/src']))
    assert.ok(!rows.some(r => r.node.path === '/src/App.tsx'))
    assert.ok(rows.some(r => r.node.path === '/src'))
  })

  it('hides dot-paths unless showHidden is on', () => {
    assert.equal(isHiddenPath('/.env'), true)
    assert.equal(isHiddenPath('/src/.cache/x.ts'), true)
    assert.equal(isHiddenPath('/src/App.tsx'), false)
    const hidden = visibleTree(buildTree(FILES), false)
    assert.ok(!findNode(hidden, '/.env'))
    assert.ok(findNode(visibleTree(buildTree(FILES), true), '/.env'))
  })
})

describe('entriesUnder + validateEntryName + siblingNames', () => {
  it('counts everything under a folder', () => {
    const tree = buildTree(FILES)
    assert.equal(entriesUnder(findNode(tree, '/src')!), 5)
    assert.equal(entriesUnder(findNode(tree, '/index.html')!), 0)
  })

  it('validates names the way the server will refuse them', () => {
    const sibs = siblingNames(buildTree(FILES), '/src')
    assert.equal(validateEntryName('', sibs), 'Name required')
    assert.match(validateEntryName('a/b.ts', sibs)!, /cannot contain/)
    assert.match(validateEntryName('App.tsx', sibs)!, /already exists/)
    assert.equal(validateEntryName('New.tsx', sibs), null)
    assert.deepEqual([...siblingNames(buildTree(FILES), '')].sort(), ['.env', 'README.md', 'index.html', 'src'])
  })
})
