import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { serializeSkillFile, skillsState, validateSkillName } from './skillsApi.js'
import { parseSkillFile, SKILL_INDEX_TOKEN_BUDGET, SKILL_INJECTION_TOKEN_BUDGET } from './skills.js'
import { setSkillEnabled } from './skillSettings.js'

describe('skills state (the panel read model)', () => {
  it('carries every shipped skill with the fields the panel renders', () => {
    const st = skillsState()
    assert.equal(st.ok, true)
    assert.deepEqual(st.skills.map(s => s.name), ['making-layouts', 'noct-grids', 'paper-js', 'state-machines'])
    for (const s of st.skills) {
      assert.ok(s.description.length > 0)
      assert.ok(s.category.length > 0)
      assert.ok(s.bodyTokens > 0 && s.body.length > 0)
      assert.ok(Array.isArray(s.files), 'bundled files list present (empty for the shipped set)')
    }
  })

  it('totals are the sum of the parts, and the budgets are the engine constants', () => {
    const st = skillsState()
    assert.equal(st.indexTokens, st.skills.reduce((n, s) => n + s.indexTokens, 0))
    assert.equal(st.indexBudget, SKILL_INDEX_TOKEN_BUDGET)
    assert.equal(st.injectionBudget, SKILL_INJECTION_TOKEN_BUDGET)
    assert.ok(st.indexTokens < st.indexBudget, 'the shipped set starts within the guide budget')
  })

  it('a disabled skill is flagged and stops counting toward the index total', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skills-state-')), 'skills.json')
    const saved = process.env.AI_LIVE_SKILLS_PATH
    process.env.AI_LIVE_SKILLS_PATH = file
    try {
      const before = skillsState()
      setSkillEnabled('paper-js', false, file)
      const after = skillsState()
      const paper = after.skills.find(s => s.name === 'paper-js')!
      assert.equal(paper.enabled, false)
      assert.equal(after.indexTokens, before.indexTokens - paper.indexTokens, 'the total is what requests actually pay')
      assert.ok(after.skills.every(s => s.name === 'paper-js' || s.enabled))
    } finally {
      if (saved === undefined) delete process.env.AI_LIVE_SKILLS_PATH
      else process.env.AI_LIVE_SKILLS_PATH = saved
      fs.rmSync(path.dirname(file), { recursive: true, force: true })
    }
  })
})

describe('skill authoring (slice 2)', () => {
  it('validates names by the spec rules', () => {
    assert.equal(validateSkillName('release-checks'), null)
    assert.equal(validateSkillName('a1'), null)
    assert.ok(validateSkillName(''))
    assert.ok(validateSkillName('Release_Checks'), 'no uppercase or underscores')
    assert.ok(validateSkillName('-lead'), 'no leading hyphen')
    assert.ok(validateSkillName('trail-'), 'no trailing hyphen')
    assert.ok(validateSkillName('double--hyphen'), 'no consecutive hyphens')
    assert.ok(validateSkillName('x'.repeat(65)), 'max 64 chars')
  })

  it('serializes a field set the loader parses back field-for-field', () => {
    const fields = {
      name: 'demo-skill',
      description: 'Use for demo work: when a demo is asked for.',
      category: 'Design & layout',
      triggers: ['demo', 'two words'],
      types: ['web-app'],
      dependsOn: ['paper'],
      body: '# Demo\n\nBody text.',
    }
    const parsed = parseSkillFile(serializeSkillFile(fields), 'demo-skill')
    assert.ok(parsed)
    assert.equal(parsed!.name, fields.name)
    assert.equal(parsed!.description, fields.description)
    assert.equal(parsed!.category, fields.category)
    assert.deepEqual(parsed!.triggers, fields.triggers)
    assert.deepEqual(parsed!.types, fields.types)
    assert.deepEqual(parsed!.dependsOn, fields.dependsOn)
    assert.equal(parsed!.body, fields.body)
    const general = parseSkillFile(serializeSkillFile({ ...fields, category: 'General', triggers: [], types: [], dependsOn: [] }), 'demo-skill')
    assert.equal(general!.category, 'General', 'the default category round-trips through omission')
  })
})
