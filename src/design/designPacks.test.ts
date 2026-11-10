import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyDesignPack, loadDesignPacks, previewDesignPack, sanitizeDesignPack } from './designPacks.js'
import { mapDesignImport } from './designImport.js'
import { getDesignGuide } from './designGuide.js'
import { packEnvelope, type FeaturePack } from '../catalog/packs.js'

describe('design packs', () => {
  it('the stock catalog carries at least one valid design pack', () => {
    const packs = loadDesignPacks()
    assert.ok(packs.length >= 1)
    assert.equal(packs[0].kind, 'design')
    assert.ok(packs[0].tokensFile)
  })

  it('sanitize rejects a pack of the wrong kind', () => {
    assert.equal(sanitizeDesignPack({ id: 'x', name: 'X', kind: 'feature', guide: { version: 1 } }), null)
  })

  it('preview uses the reconciliation states and apply stamps provenance', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-dpack-'))
    const pack = loadDesignPacks()[0]
    const before = previewDesignPack(pack, root)
    assert.ok(before.items.some(i => i.state === 'missing'))
    const applied = applyDesignPack(pack, root)
    assert.equal(applied.guide.provenance, pack.id)
    assert.ok(applied.tokensFile && fs.existsSync(path.join(root, applied.tokensFile)))
    assert.equal(getDesignGuide(root)?.provenance, pack.id)
    const after = previewDesignPack(pack, root)
    assert.ok(after.items.some(i => i.item === 'design guide' && i.state === 'present'))
    assert.ok(after.items.filter(i => i.item.startsWith('token')).every(i => i.state === 'present' || i.state === 'extra'))
  })
})

describe('feature pack envelope (§2.1)', () => {
  it('fills the common fields without a manifest rewrite', () => {
    const pack: FeaturePack = { id: 'p', name: 'P', description: 'd', nodes: [], edges: [], externalLinks: [] }
    const env = packEnvelope(pack)
    assert.equal(env.kind, 'feature')
    assert.equal(env.version, '1.0.0')
    assert.ok(env.contents.length)
  })
})

describe('design import mapping (§3.8)', () => {
  it('sorts files into mapped, unmapped, and missing', () => {
    const m = mapDesignImport([
      { path: 'theme.css', content: ':root { --brand: #123456; --gap: 8px; }' },
      { path: 'notes.md', content: '# Principles\nBe plain and calm.' },
      { path: 'icons/arrow.svg', content: '<svg/>' },
      { path: 'weird.xyz', content: '???' },
    ])
    assert.equal(m.isPack, false)
    assert.ok(m.mapped.some(x => x.field === 'tokens'))
    assert.ok(m.mapped.some(x => x.field === 'principles'))
    assert.ok(m.mapped.some(x => x.field === 'icons'))
    assert.ok(m.unmapped.some(x => x.source === 'weird.xyz'))
    assert.ok(m.missing.includes('name'))
    assert.equal(m.guide?.tokens?.source, 'css-variables')
  })

  it('a pack.json folder forks to the design-pack path', () => {
    const pack = loadDesignPacks()[0]
    const m = mapDesignImport([
      { path: 'pack.json', content: JSON.stringify({ id: pack.id, kind: 'design', name: pack.name, version: pack.version }) },
      { path: 'guide.json', content: JSON.stringify(pack.guide) },
    ])
    assert.equal(m.isPack, true)
    assert.equal(m.pack?.id, pack.id)
  })
})
