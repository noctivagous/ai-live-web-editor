import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getFsRoot, setFsRoot } from './launcher.js'
import { resetSketchStateForTests, appendSketchPatch, getSketchState } from './sketchSession.js'
import { translateSketchToSource } from './workflowApi.js'

let savedRoot = ''
let dir = ''

function seedApp(content: string) {
  fs.writeFileSync(path.join(dir, 'App.jsx'), content, 'utf-8')
}

const APP = `export default function App() {
  return (
    <main>
      <h1>Hello page</h1>
    </main>
  )
}
`

beforeEach(() => {
  savedRoot = getFsRoot()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-test-'))
  setFsRoot(dir)
  resetSketchStateForTests()
})

afterEach(() => {
  setFsRoot(savedRoot)
  resetSketchStateForTests()
  fs.rmSync(dir, { recursive: true, force: true })
})

function patch(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    selector: 'main > h1:nth-of-type(1)',
    op: 'text',
    before: { textContent: 'Hello page' },
    after: { text: 'Hello world' },
    ok: true,
    ...over,
  } as Parameters<typeof appendSketchPatch>[0]
}

describe('translateSketchToSource', () => {
  it('translates a text patch into the resolved file', () => {
    seedApp(APP)
    appendSketchPatch(patch())
    const report = translateSketchToSource()
    assert.equal(report.translated.length, 1)
    assert.equal(report.translated[0].file, '/App.jsx')
    assert.equal(report.untranslated.length, 0)
    assert.ok(fs.readFileSync(path.join(dir, 'App.jsx'), 'utf-8').includes('Hello world'))
    assert.equal(getSketchState().patches.length, 1)
  })

  it('reports style patches as untranslatable instead of guessing', () => {
    seedApp(APP)
    appendSketchPatch(patch({ op: 'style', before: { cssText: 'color: red;' }, after: { style: 'color: blue;' } }))
    const report = translateSketchToSource()
    assert.equal(report.translated.length, 0)
    assert.equal(report.untranslated.length, 1)
    assert.ok(report.untranslated[0].reason.includes('not translatable'))
    assert.ok(fs.readFileSync(path.join(dir, 'App.jsx'), 'utf-8').includes('Hello page'))
  })

  it('fails closed when str-replace is not unique', () => {
    seedApp('export default function App() {\n  return (\n    <div>\n      <span>Hello there</span>\n      <span>Hello there</span>\n    </div>\n  )\n}\n')
    appendSketchPatch(patch({ selector: 'div > span:nth-of-type(1)', before: { textContent: 'Hello there' }, after: { text: 'Hi' } }))
    const report = translateSketchToSource()
    assert.equal(report.translated.length, 0)
    assert.equal(report.untranslated.length, 1)
    assert.ok(report.untranslated[0].reason.includes('str-replace refused'))
  })

  it('reports unresolvable selectors', () => {
    seedApp(APP)
    appendSketchPatch(patch({ selector: '#nope', before: { textContent: 'zzzqqq' }, after: { text: 'yyy' } }))
    const report = translateSketchToSource()
    assert.equal(report.translated.length, 0)
    assert.equal(report.untranslated.length, 1)
  })
})
