import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractSymbol, loaderForPath, primaryName, SYMBOL_SOURCE_CAP, unpackSource } from './unpack.js'

const MINIFIED = 'import{useState}from"react";const a=1,b=2;export function counter(){const[n,setN]=useState(0);return n+a}class Store{get(){return b}}const helper=(x)=>x*2;'

describe('unpackSource', () => {
  it('de-minifies a one-liner into many lines', () => {
    const out = unpackSource(MINIFIED, '/vendor.min.js')
    assert.equal(out.formatError, undefined)
    const lines = out.formatted.split('\n').length
    assert.ok(lines > 10, `expected a real reformat, got ${lines} lines`)
    assert.ok(out.formatted.includes('function counter'))
  })

  it('indexes top-level sections with names and line ranges', () => {
    const out = unpackSource(MINIFIED, '/vendor.min.js')
    const byKind = out.sections.map((s) => `${s.kind}:${s.name}`)
    assert.ok(byKind.some((s) => s.startsWith('imports:')), byKind.join(','))
    assert.ok(byKind.some((s) => s === 'export:counter'), byKind.join(','))
    assert.ok(byKind.some((s) => s === 'class:Store'), byKind.join(','))
    assert.ok(byKind.some((s) => s === 'function:helper'), byKind.join(','))
    for (const s of out.sections) {
      assert.ok(s.startLine >= 1 && s.endLine >= s.startLine, `${s.name} range`)
      assert.ok(s.signature.length > 0, `${s.name} signature`)
    }
    // Sections are in source order.
    const starts = out.sections.map((s) => s.startLine)
    assert.deepEqual(starts, [...starts].sort((x, y) => x - y))
  })

  it('strips TypeScript types and still finds the sections', () => {
    const out = unpackSource('interface P{ x: number }\nexport const f = (p: P): number => p.x * 2;', '/mod.ts')
    assert.equal(out.formatError, undefined)
    assert.ok(!out.formatted.includes('interface P'))
    assert.ok(out.sections.some((s) => s.name === 'f'), out.sections.map((s) => s.name).join(','))
  })

  it('reports a format error instead of throwing on invalid syntax', () => {
    const out = unpackSource('const = ;', '/bad.js')
    assert.ok(out.formatError)
    assert.equal(out.formatted, 'const = ;')
    assert.deepEqual(out.sections, [])
  })

  it('extractSymbol returns the named section source from the formatted copy', () => {
    const out = unpackSource(MINIFIED, '/vendor.min.js')
    const hits = extractSymbol(out.formatted, out.sections, 'helper')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].kind, 'function')
    assert.ok(hits[0].source.includes('helper'))
    assert.ok(hits[0].source.includes('x * 2'))
    assert.equal(hits[0].truncated, false)
    assert.ok(hits[0].startLine >= 1 && hits[0].endLine >= hits[0].startLine)
    // A nested or absent name finds nothing — the index is top-level.
    assert.deepEqual(extractSymbol(out.formatted, out.sections, 'setN'), [])
    assert.deepEqual(extractSymbol(out.formatted, out.sections, 'nope'), [])
  })

  it('extractSymbol matches a multi-declarator section by its primary name', () => {
    const out = unpackSource(MINIFIED, '/vendor.min.js')
    const a = out.sections.find((s) => s.name.startsWith('a '))
    assert.ok(a, 'expected the grouped a +1 section')
    assert.equal(primaryName(a), 'a')
    assert.equal(extractSymbol(out.formatted, out.sections, 'a').length, 1)
  })

  it('extractSymbol caps an oversized symbol and flags the truncation', () => {
    const padding = Array.from({ length: 2000 }, (_, i) => `  x += ${i};`).join('\n')
    const out = unpackSource(`function big(x) {\n${padding}\n  return x;\n}`, '/big.js')
    const hits = extractSymbol(out.formatted, out.sections, 'big')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].truncated, true)
    assert.equal(hits[0].source.length, SYMBOL_SOURCE_CAP)
  })

  it('picks loaders by extension', () => {
    assert.equal(loaderForPath('/a/b.ts'), 'ts')
    assert.equal(loaderForPath('/a/b.tsx'), 'tsx')
    assert.equal(loaderForPath('/a/b.jsx'), 'jsx')
    assert.equal(loaderForPath('/a/b.mjs'), 'jsx')
    assert.equal(loaderForPath('/a/b.css'), null)
    assert.equal(loaderForPath('/a/noext'), null)
  })
})
