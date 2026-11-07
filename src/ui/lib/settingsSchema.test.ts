import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SETTING_FIELDS, SETTING_SECTIONS, fieldsForSection, searchSettings, sectionById } from './settingsSchema.js'

describe('settingsSchema', () => {
  it('every field belongs to a declared section and ids are unique per store', () => {
    const sectionIds = new Set(SETTING_SECTIONS.map(s => s.id))
    for (const f of SETTING_FIELDS) assert.ok(sectionIds.has(f.section), `field ${f.id} -> unknown section ${f.section}`)
    const seen = new Set<string>()
    for (const f of SETTING_FIELDS) {
      const key = `${f.store}:${f.id}`
      assert.ok(!seen.has(key), `duplicate field ${key}`)
      seen.add(key)
    }
  })

  it('custom sections carry no generic fields; field sections are not custom', () => {
    for (const s of SETTING_SECTIONS) {
      if (s.custom) assert.equal(fieldsForSection(s.id).length, 0, `${s.id} is custom but has fields`)
      else assert.ok(fieldsForSection(s.id).length > 0, `${s.id} has no fields and is not custom`)
    }
  })

  it('select and checkboxes fields declare options; sliders declare a range', () => {
    for (const f of SETTING_FIELDS) {
      if (f.control === 'select' || f.control === 'checkboxes') assert.ok((f.options?.length ?? 0) > 0, f.id)
      if (f.control === 'slider') assert.ok(typeof f.min === 'number' && typeof f.max === 'number' && f.max > f.min, f.id)
    }
  })

  it('search finds settings by label, hint, and keywords', () => {
    const byLabel = searchSettings('mutability')
    assert.ok(byLabel.fields.some(f => f.id === 'planMutability'))
    const byKeyword = searchSettings('dotfiles')
    assert.ok(byKeyword.fields.some(f => f.id === 'fileShowHidden'))
    const bySection = searchSettings('brave')
    assert.ok(bySection.sections.some(s => s.id === 'search'))
    assert.equal(sectionById('project')?.scope, 'project')
    const all = searchSettings('')
    assert.equal(all.sections.length, SETTING_SECTIONS.length)
    assert.equal(all.fields.length, SETTING_FIELDS.length)
  })
})
