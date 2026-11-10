import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setCssVariable, setTokensJsonValue, setDesignToken } from './designTokens.js'

describe('setCssVariable', () => {
  it('replaces only the value bytes, preserving comments and layout', () => {
    const src = ':root {\n  /* brand */\n  --brand: #111111;  --gap: 8px;\n}\n'
    const out = setCssVariable(src, 'brand', '#222222')
    assert.equal(out, ':root {\n  /* brand */\n  --brand: #222222;  --gap: 8px;\n}\n')
  })
  it('returns null for an undeclared token', () => {
    assert.equal(setCssVariable(':root { --a: 1px; }', 'nope', '2px'), null)
  })
})

describe('setTokensJsonValue', () => {
  it('sets a $value leaf by hyphen-joined path', () => {
    const doc = { color: { brand: { $value: '#111111' } } }
    assert.equal(setTokensJsonValue(doc, 'color-brand', '#333333'), true)
    assert.equal(doc.color.brand.$value, '#333333')
  })
  it('reports a missing token', () => {
    assert.equal(setTokensJsonValue({ color: {} }, 'color-nope', 'x'), false)
  })
})

describe('setDesignToken', () => {
  it('writes back to a CSS token source and refuses a Tailwind one plainly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-tokens-'))
    fs.writeFileSync(path.join(root, 'theme.css'), ':root { --brand: #111111; }\n')
    const ok = setDesignToken('brand', '#abcdef', root)
    assert.equal(ok.ok, true)
    assert.match(fs.readFileSync(path.join(root, 'theme.css'), 'utf-8'), /--brand: #abcdef;/)
    const missing = setDesignToken('absent', '1px', root)
    assert.equal(missing.ok, false)

    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-tokens-tw-'))
    fs.writeFileSync(path.join(root2, 'tailwind.config.js'), 'export default { theme: { extend: { colors: { brand: "#111" } } } }\n')
    const tw = setDesignToken('color-brand', '#222222', root2)
    assert.equal(tw.ok, false)
    if (!tw.ok) assert.match(tw.error, /Tailwind/)
  })
})
