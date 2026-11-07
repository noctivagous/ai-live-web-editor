import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { joinSectionsToElements, MAX_PAGE_SECTIONS, normalizePageSections, PAGE_SECTIONS_PROGRAM, type PageSection } from './pageSections.js'

const RAW = {
  url: 'http://localhost:5173/',
  title: 'Shop',
  mode: 'landmarks',
  viewport: { w: 1280, h: 800 },
  sections: [
    {
      i: 0, name: 'Pricing plans', tag: 'section', role: '', selector: 'main > section.pricing',
      aiLoc: 'src/App.tsx:42', depth: 1, rect: { x: 10.4, y: 99.6, w: 600, h: 300 },
      digest: '  Plans   for every\n team  ', elements: 42, interactive: 3,
    },
    {
      i: 1, name: 'x'.repeat(200), tag: 'footer', role: '', selector: 'footer',
      aiLoc: '', depth: 0, rect: { x: 0, y: 700, w: 1280, h: 100 },
      digest: 'd'.repeat(300), elements: 5, interactive: 1,
    },
    'not-a-record',
    null,
  ],
  outline: [{ level: 2, text: 'Pricing plans' }, { level: 9, text: 'clamped' }],
}

describe('normalizePageSections', () => {
  it('accepts the bare program result and cleans every field', () => {
    const out = normalizePageSections(RAW)
    assert.ok(out)
    assert.equal(out.mode, 'landmarks')
    assert.equal(out.sections.length, 2)
    const [a, b] = out.sections
    assert.equal(a.name, 'Pricing plans')
    assert.equal(a.rect.x, 10)
    assert.equal(a.rect.y, 100)
    assert.equal(a.digest, 'Plans for every team')
    assert.equal(a.aiLoc, 'src/App.tsx:42')
    assert.ok(b.name.length <= 80)
    assert.ok(b.digest.length <= 120)
    assert.equal(out.outline.length, 2)
    assert.equal(out.outline[1].level, 3)
  })

  it('unwraps the pool envelope and a JSON-string result', () => {
    const viaPool = normalizePageSections({ via: 'playwright', result: RAW, elapsedMs: 12 })
    assert.ok(viaPool)
    assert.equal(viaPool.sections.length, 2)
    const viaString = normalizePageSections({ via: 'vite-page', result: JSON.stringify(RAW) })
    assert.ok(viaString)
    assert.equal(viaString.title, 'Shop')
  })

  it('caps the section count and defaults an unknown mode to landmarks', () => {
    const many = {
      ...RAW,
      mode: 'banana',
      sections: Array.from({ length: MAX_PAGE_SECTIONS + 25 }, (_, i) => ({
        name: `s${i}`, tag: 'section', role: '', selector: '', aiLoc: '', depth: 0,
        rect: { x: 0, y: 0, w: 10, h: 10 }, digest: '', elements: 0, interactive: 0,
      })),
    }
    const out = normalizePageSections(many)
    assert.ok(out)
    assert.equal(out.sections.length, MAX_PAGE_SECTIONS)
    assert.equal(out.mode, 'landmarks')
  })

  it('keeps structural mode and rejects payloads that are not section results', () => {
    const structural = normalizePageSections({ ...RAW, mode: 'structural' })
    assert.equal(structural?.mode, 'structural')
    assert.equal(normalizePageSections(null), null)
    assert.equal(normalizePageSections({ error: 'no page' }), null)
    assert.equal(normalizePageSections({ result: 'not json' }), null)
    assert.equal(normalizePageSections({ sections: 'nope' }), null)
  })

  it('joinSectionsToElements assigns the smallest containing section by centre', () => {
    const sec = (name: string, x: number, y: number, w: number, h: number, depth = 0): PageSection => ({
      name, tag: 'section', role: '', selector: '', aiLoc: '', depth,
      rect: { x, y, w, h }, digest: '', elements: 0, interactive: 0,
    })
    const sections = [sec('Page', 0, 0, 1000, 800), sec('Pricing plans', 100, 100, 400, 300, 1), sec('Features', 100, 500, 400, 200, 1)]
    const els: Array<{ rect?: { x: number, y: number, width: number, height: number }, section?: string }> = [
      { rect: { x: 150, y: 150, width: 50, height: 50 } },   // centre inside Pricing (and Page)
      { rect: { x: 150, y: 550, width: 50, height: 50 } },   // centre inside Features
      { rect: { x: 900, y: 750, width: 50, height: 40 } },   // centre inside Page only
      { rect: { x: 2000, y: 10, width: 10, height: 10 } },   // outside everything
      { rect: undefined },                                    // no rect — untouched
      {},                                                     // no rect field at all
    ]
    joinSectionsToElements(els, sections)
    assert.equal(els[0].section, 'Pricing plans')
    assert.equal(els[1].section, 'Features')
    assert.equal(els[2].section, 'Page')
    assert.equal(els[3].section, undefined)
    assert.equal((els[4] as { section?: string }).section, undefined)
    // Empty section list is a no-op.
    const bare = [{ rect: { x: 1, y: 1, width: 2, height: 2 } }]
    joinSectionsToElements(bare, [])
    assert.equal((bare[0] as { section?: string }).section, undefined)
  })

  it('the program is a single read-only IIFE with no mutation calls', () => {
    assert.ok(PAGE_SECTIONS_PROGRAM.startsWith('(() => {'))
    assert.ok(PAGE_SECTIONS_PROGRAM.endsWith('})()'))
    for (const banned of ['.remove(', 'innerHTML =', '.appendChild(', 'document.write', 'fetch(']) {
      assert.equal(PAGE_SECTIONS_PROGRAM.includes(banned), false, banned)
    }
  })
})
