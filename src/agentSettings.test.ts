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
      { defaultWorkflow: 'sketch', contextTrim: false, mapInjection: 'always', chatEngine: 'opencode', aleFsTools: false, aleWebTools: false, aleSkillTools: false, consoleCheck: true },
    )
    assert.equal(sanitizeAgentSettings({ chatEngine: 'opencode' }).chatEngine, 'opencode')
    assert.equal(sanitizeAgentSettings({ chatEngine: 'mastra' }).chatEngine, 'mastra', 'an explicitly saved mastra choice survives the slice-10 default flip')
    assert.equal(sanitizeAgentSettings({ chatEngine: 'kilo' }).chatEngine, 'opencode', 'unknown engines sanitize to the default (opencode since slice 10)')
    assert.deepEqual(sanitizeAgentSettings({ defaultWorkflow: 'both', contextTrim: 'yes', mapInjection: 'sometimes' }), AGENT_SETTINGS_DEFAULTS)
    assert.deepEqual(sanitizeAgentSettings(null), AGENT_SETTINGS_DEFAULTS)
  })

  it('aleFsTools defaults off and only a literal true turns it on', () => {
    assert.equal(AGENT_SETTINGS_DEFAULTS.aleFsTools, false)
    assert.equal(sanitizeAgentSettings({}).aleFsTools, false)
    assert.equal(sanitizeAgentSettings({ aleFsTools: true }).aleFsTools, true)
    assert.equal(sanitizeAgentSettings({ aleFsTools: 'yes' }).aleFsTools, false)
    assert.equal(sanitizeAgentSettings({ aleFsTools: 1 }).aleFsTools, false)
  })

  it('aleWebTools / aleSkillTools follow the same override idiom (default off, literal true only)', () => {
    assert.equal(AGENT_SETTINGS_DEFAULTS.aleWebTools, false)
    assert.equal(AGENT_SETTINGS_DEFAULTS.aleSkillTools, false)
    assert.equal(sanitizeAgentSettings({}).aleWebTools, false)
    assert.equal(sanitizeAgentSettings({}).aleSkillTools, false)
    assert.equal(sanitizeAgentSettings({ aleWebTools: true }).aleWebTools, true)
    assert.equal(sanitizeAgentSettings({ aleSkillTools: true }).aleSkillTools, true)
    assert.equal(sanitizeAgentSettings({ aleWebTools: 'yes' }).aleWebTools, false)
    assert.equal(sanitizeAgentSettings({ aleSkillTools: 1 }).aleSkillTools, false)
    saveAgentSettings({ aleWebTools: true })
    assert.equal(currentAgentSettings().aleWebTools, true)
    assert.equal(currentAgentSettings().aleSkillTools, false, 'the two switches are independent')
  })

  it('consoleCheck defaults on; only a literal false turns it off', () => {
    assert.equal(AGENT_SETTINGS_DEFAULTS.consoleCheck, true)
    assert.equal(sanitizeAgentSettings({}).consoleCheck, true)
    assert.equal(sanitizeAgentSettings({ consoleCheck: false }).consoleCheck, false)
    assert.equal(sanitizeAgentSettings({ consoleCheck: 'no' }).consoleCheck, true)
    saveAgentSettings({ consoleCheck: false })
    assert.equal(currentAgentSettings().consoleCheck, false)
  })

  it('save persists, merges, and is what current reads back', () => {
    saveAgentSettings({ mapInjection: 'off' })
    assert.deepEqual(currentAgentSettings(), { defaultWorkflow: 'files', contextTrim: true, mapInjection: 'off', chatEngine: 'opencode', aleFsTools: false, aleWebTools: false, aleSkillTools: false, consoleCheck: true })
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'agent-settings.json'), 'utf8'))
    assert.deepEqual(onDisk, { defaultWorkflow: 'files', contextTrim: true, mapInjection: 'off', chatEngine: 'opencode', aleFsTools: false, aleWebTools: false, aleSkillTools: false, consoleCheck: true })
    saveAgentSettings({ contextTrim: false })
    assert.deepEqual(currentAgentSettings(), { defaultWorkflow: 'files', contextTrim: false, mapInjection: 'off', chatEngine: 'opencode', aleFsTools: false, aleWebTools: false, aleSkillTools: false, consoleCheck: true })
  })
})
