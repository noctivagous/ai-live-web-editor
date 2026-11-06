import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLiveEditPrompt, summarizeAnnotations } from './annotationAnalysis.js'

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
