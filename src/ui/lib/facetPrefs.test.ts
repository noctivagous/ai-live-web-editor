import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  facetEnabled, facetTogglePatch, facetsOffSet, sanitizeFacetSectionsOff, sanitizeFacetsOff,
  sectionEnabled, sectionTogglePatch, type FacetPrefsSlice,
} from './facetPrefs.js'
import { validateUiPrefs } from './uiPrefs.js'

const ON: FacetPrefsSlice = { facetsOff: [], facetSectionsOff: {} }

describe('facetPrefs', () => {
  it('everything is on by default; Overview can never be off', () => {
    assert.equal(facetEnabled(ON, 'features'), true)
    assert.equal(facetEnabled(ON, 'overview'), true)
    const off: FacetPrefsSlice = { facetsOff: ['features'], facetSectionsOff: {} }
    assert.equal(facetEnabled(off, 'features'), false)
    assert.equal(facetEnabled(off, 'overview'), true)
    assert.deepEqual(facetTogglePatch(off, 'overview', false), {})
  })

  it('toggle patches round-trip and stay deduped', () => {
    const p1 = { ...ON, ...facetTogglePatch(ON, 'graphic-design', false) }
    assert.deepEqual(p1.facetsOff, ['graphic-design'])
    const p2 = { ...p1, ...facetTogglePatch(p1, 'graphic-design', true) }
    assert.deepEqual(p2.facetsOff, [])
    const s1 = { ...ON, ...sectionTogglePatch(ON, 'graphic-design', 'icons', false) }
    assert.equal(sectionEnabled(s1, 'graphic-design', 'icons'), false)
    assert.equal(sectionEnabled(s1, 'graphic-design', 'tokens'), true)
    const s2 = { ...s1, ...sectionTogglePatch(s1, 'graphic-design', 'icons', true) }
    assert.deepEqual(s2.facetSectionsOff, {})
  })

  it('sanitizers drop unknown facets, Overview, and unknown sections', () => {
    assert.deepEqual(sanitizeFacetsOff(['features', 'overview', 'styles', 'features', 7]), ['features'])
    assert.deepEqual(sanitizeFacetsOff('features'), [])
    assert.deepEqual(
      sanitizeFacetSectionsOff({ 'graphic-design': ['icons', 'nope'], styles: ['icons'], features: 'icons' }),
      { 'graphic-design': ['icons'] },
    )
  })

  it('uiPrefs validation carries the facet state through', () => {
    const prefs = validateUiPrefs({ facetsOff: ['architecture'], facetSectionsOff: { features: ['packs'] } })
    assert.deepEqual(prefs.facetsOff, ['architecture'])
    assert.deepEqual(prefs.facetSectionsOff, { features: ['packs'] })
    assert.deepEqual(facetsOffSet(prefs), new Set(['architecture']))
    const plain = validateUiPrefs({})
    assert.deepEqual(plain.facetsOff, [])
    assert.deepEqual(plain.facetSectionsOff, {})
  })
})
