import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DESIGN_GUIDE_SCHEMA, designGuideSummary, getDesignGuide, guideDesignated,
  sanitizeDesignGuide, saveDesignGuide,
} from './designGuide.js'

describe('designGuide sanitize', () => {
  it('keeps the §3.3 fields and drops everything else', () => {
    const g = sanitizeDesignGuide({
      version: 99,
      name: '  Lumen  ',
      description: 'A calm system',
      principles: '## Principles\nBe calm.',
      bogus: 'drop me',
      tokens: { source: 'css-variables', file: 'src/theme.css', groups: ['colour', 'spacing', 'colour'] },
      typography: {
        families: [{ name: 'Inter', role: 'UI' }, { role: 'no name' }],
        scale: [{ step: 'body', size: '16px', weight: '400' }, { step: 'no-size' }],
      },
      layout: { grid: { columns: 12, gutter: '16px' }, breakpoints: [{ name: 'phone', minWidth: 0 }, { name: 'bad' }], spacingBase: 4 },
      icons: { sets: [{ name: 'lucide', format: 'svg' }], usage: 'Icons name what they do' },
      components: [{ name: 'Button', note: 'Primary action' }],
    })
    assert.equal(g.version, 1)
    assert.equal(g.name, 'Lumen')
    assert.equal(g.tokens?.source, 'css-variables')
    assert.deepEqual(g.tokens?.groups, ['colour', 'spacing'])
    assert.equal(g.typography?.families.length, 1)
    assert.equal(g.typography?.scale.length, 1)
    assert.equal(g.layout?.breakpoints.length, 1)
    assert.equal(g.layout?.grid?.columns, 12)
    assert.equal(g.icons?.sets[0].name, 'lucide')
    assert.equal(g.components?.[0].name, 'Button')
    assert.equal('bogus' in g, false)
  })

  it('an empty or junk guide is undesignated', () => {
    assert.equal(guideDesignated(sanitizeDesignGuide(null)), false)
    assert.equal(guideDesignated(sanitizeDesignGuide({ version: 1 })), false)
    assert.equal(guideDesignated(sanitizeDesignGuide({ name: 'X' })), true)
    assert.equal(guideDesignated(null), false)
  })

  it('rejects unknown token source kinds', () => {
    const g = sanitizeDesignGuide({ tokens: { source: 'sketch-file', file: 'theme.sketch' } })
    assert.equal(g.tokens?.source, undefined)
    assert.equal(g.tokens?.file, 'theme.sketch')
  })
})

describe('designGuide store', () => {
  it('round-trips through ai-design/guide.json under a root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-guide-'))
    assert.equal(getDesignGuide(root), null)
    const saved = saveDesignGuide({ name: 'Round Trip', tokens: { source: 'tokens-json', file: 'design-tokens.json' } }, root)
    assert.equal(saved.name, 'Round Trip')
    assert.ok(fs.existsSync(path.join(root, 'ai-design', 'guide.json')))
    const read = getDesignGuide(root)
    assert.equal(read?.name, 'Round Trip')
    assert.equal(read?.tokens?.file, 'design-tokens.json')
  })

  it('the brief summary names the guide, the token file, and the principles digest', () => {
    const line = designGuideSummary(sanitizeDesignGuide({
      name: 'Lumen',
      tokens: { source: 'css-variables', file: 'src/theme.css' },
      principles: 'Be calm.\nUse space.',
      typography: { families: [{ name: 'Inter' }], scale: [] },
    }))
    assert.match(line, /Design guide: Lumen/)
    assert.match(line, /src\/theme\.css/)
    assert.match(line, /Be calm\. Use space\./)
    assert.match(line, /Inter/)
    assert.equal(designGuideSummary(null), '')
  })

  it('the JSON Schema export covers the §3.3 top-level fields', () => {
    const props = Object.keys(DESIGN_GUIDE_SCHEMA.properties)
    for (const k of ['name', 'description', 'principles', 'tokens', 'typography', 'layout', 'icons', 'components', 'voice', 'motion', 'provenance']) {
      assert.ok(props.includes(k), `schema is missing ${k}`)
    }
  })
})
