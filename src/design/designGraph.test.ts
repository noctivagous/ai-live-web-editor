import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  contrastRatio, deriveDesignGraph, designReport, detectTokenSource,
  parseCssVariables, parseTokensJson, tokenGroup,
} from './designGraph.js'
import { saveDesignGuide } from './designGuide.js'

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-graph-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'icons'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/theme.css'), `:root {
  --color-bg: #ffffff;
  --color-text: #777777;
  --color-accent: var(--color-text);
  --space-unit: 8px;
  --radius-card: 12px;
  --brand-unused: #123456;
}
body { background: var(--color-bg); color: #ff0000; }
`)
  fs.writeFileSync(path.join(root, 'src/Button.tsx'), `
export function Button() {
  return <button style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', fontSize: '16px' }}>Go</button>
}
`)
  fs.writeFileSync(path.join(root, 'icons/star.svg'), '<svg/>')
  fs.writeFileSync(path.join(root, 'icons/heart.svg'), '<svg/>')
  saveDesignGuide({
    name: 'Fixture',
    tokens: { source: 'css-variables', file: 'src/theme.css' },
    typography: { families: [{ name: 'Inter' }], scale: [{ step: 'body', size: '16px' }, { step: 'mega', size: '64px' }] },
    icons: { sets: [{ name: 'local', source: 'icons', format: 'svg' }] },
    layout: { breakpoints: [{ name: 'desktop', minWidth: 1024 }] },
  }, root)
  return root
}

describe('designGraph parsing', () => {
  it('parses CSS variables and groups them', () => {
    const tokens = parseCssVariables(':root { --color-bg: #fff; --space-unit: 8px; --radius-card: 4px; }')
    assert.equal(tokens.length, 3)
    assert.equal(tokens.find(t => t.name === 'color-bg')?.group, 'colour')
    assert.equal(tokens.find(t => t.name === 'space-unit')?.group, 'spacing')
    assert.equal(tokens.find(t => t.name === 'radius-card')?.group, 'radius')
    assert.equal(tokenGroup('duration-fast', '200ms'), 'motion')
  })

  it('parses W3C tokens JSON by path', () => {
    const tokens = parseTokensJson(JSON.stringify({ color: { bg: { $value: '#ffffff' } }, spacing: { unit: { $value: '8px' } } }))
    assert.deepEqual(tokens.map(t => t.name).sort(), ['color-bg', 'spacing-unit'])
    assert.equal(tokens.find(t => t.name === 'color-bg')?.group, 'color')
  })

  it('contrast ratio follows WCAG', () => {
    assert.ok(Math.abs((contrastRatio('#000000', '#ffffff') ?? 0) - 21) < 0.1)
    assert.equal(contrastRatio('red', '#ffffff'), null)
  })
})

describe('designGraph derivation + report', () => {
  it('derives tokens, aliases, type steps, icons, and components from a fixture project', () => {
    const root = fixture()
    const source = detectTokenSource(root, null)
    assert.equal(source?.file, 'src/theme.css')
    const graph = deriveDesignGraph(root)
    const kinds = new Map<string, number>()
    for (const n of graph.nodes) kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1)
    assert.equal(kinds.get('token'), 6)
    assert.ok((kinds.get('token-group') ?? 0) >= 3)
    assert.equal(kinds.get('type-step'), 2)
    assert.equal(kinds.get('icon'), 2)
    assert.equal(kinds.get('layout-pattern'), 1)
    assert.ok(graph.edges.some(e => e.type === 'aliases' && e.from === 'token:color-accent' && e.to === 'token:color-text'))
    assert.ok(graph.edges.some(e => e.type === 'contains' && e.from === 'group:colour'))
  })

  it('the report flags unused tokens, hard-coded values, contrast, and unseen type steps', () => {
    const root = fixture()
    const graph = deriveDesignGraph(root)
    const report = designReport(root, graph)
    assert.ok(report.unusedTokens.includes('brand-unused'), `unused: ${report.unusedTokens}`)
    assert.ok(!report.unusedTokens.includes('color-bg'))
    assert.ok(report.hardcoded.some(h => h.value === '#ff0000'))
    // #777777 text on #ffffff bg is ~4.48 — flagged below 4.5.
    assert.ok(report.contrastFlags.some(f => f.background === 'color-bg' && f.text === 'color-text'), JSON.stringify(report.contrastFlags))
    assert.ok(report.unseenTypeSteps.includes('mega'))
    assert.ok(!report.unseenTypeSteps.includes('body'))
  })
})
