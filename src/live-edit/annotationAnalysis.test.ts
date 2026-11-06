import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  agentationToAnnotations,
  buildLiveEditPrompt,
  classifyIntent,
  summarizeAnnotations,
} from './annotationAnalysis.js'

const NOTES = [
  { id: 'a1', type: 'note', selector: '[data-testid="nav-inbox"]', text: 'make it blue' },
]

describe('buildLiveEditPrompt with resolutions', () => {
  it('renders the resolved file hint per annotation', () => {
    const summary = summarizeAnnotations(NOTES)
    const prompt = buildLiveEditPrompt({
      annotations: NOTES,
      summary,
      pageNotes: '',
      pageUrl: 'http://localhost:5173/',
      resolutions: [{ selector: '[data-testid="nav-inbox"]', file: '/App.jsx', component: 'App', startLine: 2, endLine: 9, confidence: 'heuristic' }],
    })
    assert.ok(prompt.includes('/App.jsx App:2-9'))
    assert.ok(prompt.includes('resolve-source'))
  })

  it('flags unresolved selectors without breaking the old shape', () => {
    const summary = summarizeAnnotations(NOTES)
    const prompt = buildLiveEditPrompt({ annotations: NOTES, summary, pageNotes: '', pageUrl: '' })
    assert.ok(prompt.includes('source unresolved — call resolve-source first'))
  })

  it('omits the range when only a file resolved', () => {
    const summary = summarizeAnnotations(NOTES)
    const prompt = buildLiveEditPrompt({
      annotations: NOTES,
      summary,
      pageNotes: '',
      pageUrl: '',
      resolutions: [{ selector: '[data-testid="nav-inbox"]', file: '/App.jsx' }],
    })
    assert.ok(prompt.includes('(≈ /App.jsx)'))
  })
})

const ROOT = '/home/dev/projects/lumen'

describe('agentationToAnnotations', () => {
  it('maps a click annotation and relativises sourceFile against the project root', () => {
    const [a] = agentationToAnnotations([{
      id: 'a1',
      comment: 'Headline should be larger',
      element: 'h1 "Inbox"',
      elementPath: 'div > header > div > h1',
      fullPath: 'body > div#root > div > header > h1',
      sourceFile: `${ROOT}/App.jsx:647:13`,
      boundingBox: { x: 260, y: 35, width: 96, height: 30 },
      computedStyles: 'font-size: 22px',
    }], ROOT)
    assert.equal(a.selector, 'body > div#root > div > header > h1')
    assert.equal(a.text, 'Headline should be larger')
    assert.equal(a.sourceFile, '/App.jsx:647:13')
    assert.equal(a.boundingBox?.width, 96)
  })

  it('keeps an out-of-root sourceFile absolute', () => {
    const [a] = agentationToAnnotations([{
      comment: 'x',
      fullPath: 'body > div',
      sourceFile: '/elsewhere/App.tsx:1:1',
    }], ROOT)
    assert.equal(a.sourceFile, '/elsewhere/App.tsx:1:1')
  })

  it('synthesises text for placement and rearrange annotations', () => {
    const [p, r] = agentationToAnnotations([
      { id: 'p1', kind: 'placement', elementPath: 'div', placement: { componentType: 'card', width: 320.4, height: 200 } },
      { id: 'r1', kind: 'rearrange', rearrange: { selector: 'div.card', label: 'Card', originalRect: { x: 0, y: 0, width: 10, height: 10 }, currentRect: { x: 50, y: 60, width: 10, height: 10 } } },
    ], ROOT)
    assert.ok(p.text.includes('Place a card here (320x200)'))
    assert.ok(r.text.includes('Move Card from (0, 0) to (50, 60)'))
    assert.equal(r.selector, 'div.card')
  })

  it('drops empty entries and tolerates non-array input', () => {
    assert.deepEqual(agentationToAnnotations(null, ROOT), [])
    assert.deepEqual(agentationToAnnotations([{ comment: '  ' }], ROOT), [])
  })
})

describe('classifyIntent with Agentation kinds', () => {
  it('placement is layout, rearrange is move, fix tag is bug', () => {
    assert.equal(classifyIntent({ kind: 'placement', text: '' }), 'layout')
    assert.equal(classifyIntent({ kind: 'rearrange', text: '' }), 'move')
    assert.equal(classifyIntent({ intentTag: 'fix', text: 'this looks off' }), 'bug')
  })
})

describe('buildLiveEditPrompt with Agentation fields', () => {
  it('includes the source line and switches the workflow to source-first', () => {
    const annotations = agentationToAnnotations([{
      id: 'a1',
      comment: 'Make it bolder',
      element: 'h1 "Inbox"',
      fullPath: 'body > h1',
      sourceFile: `${ROOT}/App.jsx:647:13`,
    }], ROOT)
    const prompt = buildLiveEditPrompt({
      annotations,
      summary: summarizeAnnotations(annotations),
      pageNotes: '',
      pageUrl: 'http://localhost:5173/',
    })
    assert.ok(prompt.includes('Source: /App.jsx:647:13'))
    assert.ok(prompt.includes('annotations with a Source line name the exact rendering file'))
  })

  it('overlay-style notes keep the resolve-source workflow', () => {
    const annotations = [{ selector: 'div.card', text: 'too dark' }]
    const prompt = buildLiveEditPrompt({
      annotations,
      summary: summarizeAnnotations(annotations),
      pageNotes: '',
      pageUrl: 'http://localhost:4112/',
    })
    assert.ok(prompt.includes('resolve-source each selector'))
    assert.ok(!prompt.includes('Source:'))
  })
})
