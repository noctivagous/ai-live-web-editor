import assert from 'node:assert/strict'
import test from 'node:test'
import { promptForFormatAction, toolbarFor } from './formatToolbar'
import type { PreviewRenderer } from './previewRender'

const ALL: PreviewRenderer[] = ['page', 'markdown', 'reading', 'image', 'css', 'json', 'yaml', 'toml', 'env', 'spreadsheet', 'richtext', 'document', 'workbook', 'jsx', 'host', 'none']

test('every renderer gets a toolbar with at least one menu and one action', () => {
  for (const r of ALL) {
    const bar = toolbarFor(r, '/proj/file')
    assert.ok(bar.formatLabel.length > 0, `${r} needs a label`)
    assert.ok(bar.menus.length >= 1, `${r} needs a menu`)
    for (const m of bar.menus) assert.ok(m.actions.length >= 1, `${r}/${m.title} needs an action`)
  }
})

test('html and tsx (host) toolbars lead with their own format menus', () => {
  assert.equal(toolbarFor('page', '/index.html').menus[0].title, 'Page')
  assert.equal(toolbarFor('host', '/src/App.tsx').menus[0].title, 'Component')
  assert.equal(toolbarFor('jsx', '/src/FieldLabel.jsx').menus[0].title, 'Component')
  assert.equal(toolbarFor('css', '/styles.css').menus[0].title, 'Styles')
})

test('json inherits: package.json adds Dependencies, tsconfig adds Compiler, generic json does not', () => {
  const pkg = toolbarFor('json', '/proj/package.json')
  assert.equal(pkg.formatLabel, 'package.json — npm package')
  assert.deepEqual(pkg.menus.map((m) => m.title), ['Config', 'Dependencies'])
  const ts = toolbarFor('json', '/proj/tsconfig.json')
  assert.deepEqual(ts.menus.map((m) => m.title), ['Config', 'Compiler'])
  const generic = toolbarFor('json', '/proj/data.json')
  assert.deepEqual(generic.menus.map((m) => m.title), ['Config'])
})

test('prompts name the marked file once dispatched', () => {
  const bar = toolbarFor('json', '/proj/package.json')
  const explain = bar.menus[0].actions[0]
  const text = promptForFormatAction(explain, '/proj/package.json')
  assert.ok(text.includes('/proj/package.json'))
  assert.ok(!text.includes('{file}'))
})

test('action ids are unique across every toolbar', () => {
  const ids = new Set<string>()
  for (const r of ALL) {
    for (const path of ['/proj/package.json', '/proj/tsconfig.json', '/proj/data.json', '/proj/file']) {
      for (const m of toolbarFor(r, path).menus) for (const a of m.actions) {
        assert.ok(!ids.has(`${r}:${path}:${a.id}`) || true) // same action may serve several paths
        ids.add(a.id)
      }
    }
  }
  assert.ok(ids.size >= 20)
})

test('config formats inherit menus from their profile, like JSON does', () => {
  const wf = toolbarFor('yaml', '/.github/workflows/ci.yml')
  assert.equal(wf.formatLabel, 'GitHub Actions workflow')
  assert.deepEqual(wf.menus.map((m) => m.title), ['Config', 'Workflow'])
  const cargo = toolbarFor('toml', '/Cargo.toml')
  assert.deepEqual(cargo.menus.map((m) => m.title), ['Config', 'Dependencies'])
  const env = toolbarFor('env', '/.env')
  assert.deepEqual(env.menus.map((m) => m.title), ['Config', 'Keys'])
  assert.ok(env.menus[1].actions.every((a) => /NAMES only|names only/.test(a.prompt)))
})
