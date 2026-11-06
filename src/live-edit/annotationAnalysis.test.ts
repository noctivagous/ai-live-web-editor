import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
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

describe('buildLiveEditPrompt component tag', () => {
  it('names the React component next to the selector', () => {
    const annotations = [{ selector: 'body > h1', text: 'Make it bolder', component: 'Hero' }]
    const prompt = buildLiveEditPrompt({
      annotations,
      summary: summarizeAnnotations(annotations),
      pageNotes: '',
      pageUrl: 'http://localhost:5173/',
    })
    assert.ok(prompt.includes('body > h1'))
    assert.ok(prompt.includes('<Hero>: Make it bolder'))
  })
})

describe('buildLiveEditPrompt placement', () => {
  it('renders generic placement instructions with coordinates and intersections', () => {
    const annotations = [{
      type: 'placement',
      text: 'newsletter signup',
      placement: { componentType: 'Card', kind: 'card', x: 100, y: 200, width: 320, height: 200 },
      intersects: ['main > section', 'main > section > h1'],
    }]
    const prompt = buildLiveEditPrompt({
      annotations,
      summary: summarizeAnnotations(annotations),
      pageNotes: '',
      pageUrl: 'http://localhost:5173/',
    })
    assert.ok(prompt.includes('Place a generic Card here: approx 320×200px at page (100, 200)'))
    assert.ok(prompt.includes('Intersects: main > section, main > section > h1'))
    assert.ok(prompt.includes('Specifics: newsletter signup'))
    assert.ok(prompt.includes('adapt to this UI'))
  })
})

describe('buildLiveEditPrompt modes', () => {
  it('sketch mode switches the prompt to patch-dom and never mentions file writes', () => {
    const annotations = [{ selector: 'body > h1', text: 'Make it bolder' }]
    const prompt = buildLiveEditPrompt({
      annotations,
      summary: summarizeAnnotations(annotations),
      pageNotes: '',
      pageUrl: 'http://localhost:5173/',
      mode: 'sketch',
    })
    assert.ok(prompt.includes('Live sketch mode'))
    assert.ok(prompt.includes('patch-dom with small sequential ops'))
    assert.ok(!prompt.includes('str-replace the fix'))
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
