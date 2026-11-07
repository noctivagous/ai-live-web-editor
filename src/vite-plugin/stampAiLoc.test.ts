import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stampAiLoc, stampTarget } from './stampAiLoc.js'

describe('stampAiLoc', () => {
  it('stamps each JSX opening tag on its own line', () => {
    const out = stampAiLoc(
      `export default function App() {\n  return (\n    <div>\n      <h1>Hi</h1>\n    </div>\n  )\n}`,
      '/src/App.jsx',
    )
    assert.ok(out.includes('<div data-ai-loc="/src/App.jsx:3">'))
    assert.ok(out.includes('<h1 data-ai-loc="/src/App.jsx:4">'))
  })

  it('preserves line numbers', () => {
    const src = `line1\n<div>\nline3`
    assert.equal(stampAiLoc(src, '/x.jsx').split('\n').length, 3)
    assert.ok(stampAiLoc(src, '/x.jsx').split('\n')[1].includes(':2"'))
  })

  it('skips closing tags and fragments', () => {
    const out = stampAiLoc(`<>\n  <div />\n</>\n</div>`, '/x.jsx')
    assert.ok(!out.includes('<> data-ai-loc'))
    assert.ok(!out.includes('</div> data-ai-loc'))
    assert.ok(out.includes('<div data-ai-loc="/x.jsx:2" />'))
  })

  it('is idempotent', () => {
    const once = stampAiLoc(`<div>\n`, '/x.jsx')
    assert.equal(stampAiLoc(once, '/x.jsx'), once)
  })

  it('skips TS generics and comparisons', () => {
    const out = stampAiLoc(`const x = foo<Bar>(1)\nconst y = a<b`, '/x.tsx')
    assert.ok(!out.includes('data-ai-loc'))
  })

  it('skips import and comment lines', () => {
    const out = stampAiLoc(`import x from '<div>'\n// <div>\n<div>`, '/x.jsx')
    assert.ok(!out.includes(`from '<div> data-ai-loc`))
    assert.ok(out.includes('\n<div data-ai-loc="/x.jsx:3">'))
  })
})

describe('stampTarget', () => {
  it('targets project jsx/tsx only', () => {
    assert.equal(stampTarget('/proj/src/App.jsx', '/proj'), '/src/App.jsx')
    assert.equal(stampTarget('/proj/src/App.tsx', '/proj'), '/src/App.tsx')
    assert.equal(stampTarget('/proj/src/util.ts', '/proj'), null)
    assert.equal(stampTarget('/proj/node_modules/a/App.jsx', '/proj'), null)
    assert.equal(stampTarget('/other/App.jsx', '/proj'), null)
  })
})
