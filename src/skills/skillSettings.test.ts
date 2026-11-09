import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  disabledSkillNames, emptySkillSettings, loadSkillSettings,
  saveSkillSettings, setSkillEnabled,
} from './skillSettings.js'

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-settings-')), 'skills.json')

describe('skill settings store', () => {
  it('a missing or corrupt file means all skills on', () => {
    const file = tmpFile()
    assert.deepEqual(loadSkillSettings(file), emptySkillSettings())
    fs.writeFileSync(file, '{not json', 'utf-8')
    assert.deepEqual(loadSkillSettings(file), emptySkillSettings())
    fs.writeFileSync(file, '{"version":1,"disabled":"nope"}', 'utf-8')
    assert.deepEqual(loadSkillSettings(file), emptySkillSettings())
  })

  it('round-trips, dedupes and toggles by name', () => {
    const file = tmpFile()
    saveSkillSettings({ version: 1, disabled: ['paper-js', 'paper-js', 'noct-grids'] }, file)
    assert.deepEqual(loadSkillSettings(file).disabled, ['paper-js', 'noct-grids'])
    const off = setSkillEnabled('state-machines', false, file)
    assert.deepEqual(off.disabled, ['noct-grids', 'paper-js', 'state-machines'])
    const on = setSkillEnabled('paper-js', true, file)
    assert.deepEqual(on.disabled, ['noct-grids', 'state-machines'])
    assert.deepEqual(disabledSkillNames(file), new Set(['noct-grids', 'state-machines']))
    setSkillEnabled('paper-js', true, file) // already on: no-op
    assert.deepEqual(loadSkillSettings(file).disabled, ['noct-grids', 'state-machines'])
  })
})
