import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  AGENT_SETTINGS_DEFAULTS, currentAgentSettings, loadAgentSettings, sanitizeAgentSettings, saveAgentSettings, setAgentSettingsPath,
} from './agentSettings.js'

describe('agentSettings', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-settings-'))
    setAgentSettingsPath(path.join(dir, 'agent-settings.json'))
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('defaults when no file exists — matching the previous fixed behavior', () => {
    assert.deepEqual(loadAgentSettings(), AGENT_SETTINGS_DEFAULTS)
    assert.equal(currentAgentSettings().contextTrim, true)
    assert.equal(currentAgentSettings().mapInjection, 'auto')
  })

  it('sanitize keeps only known values', () => {
    assert.deepEqual(
      sanitizeAgentSettings({ defaultWorkflow: 'sketch', contextTrim: false, mapInjection: 'always', extra: 1 }),
      { defaultWorkflow: 'sketch', contextTrim: false, mapInjection: 'always' },
    )
    assert.deepEqual(sanitizeAgentSettings({ defaultWorkflow: 'both', contextTrim: 'yes', mapInjection: 'sometimes' }), AGENT_SETTINGS_DEFAULTS)
    assert.deepEqual(sanitizeAgentSettings(null), AGENT_SETTINGS_DEFAULTS)
  })

  it('save persists, merges, and is what current reads back', () => {
    saveAgentSettings({ mapInjection: 'off' })
    assert.deepEqual(currentAgentSettings(), { defaultWorkflow: 'files', contextTrim: true, mapInjection: 'off' })
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'agent-settings.json'), 'utf8'))
    assert.deepEqual(onDisk, { defaultWorkflow: 'files', contextTrim: true, mapInjection: 'off' })
    saveAgentSettings({ contextTrim: false })
    assert.deepEqual(currentAgentSettings(), { defaultWorkflow: 'files', contextTrim: false, mapInjection: 'off' })
  })
})
