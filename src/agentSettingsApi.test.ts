import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { currentAgentSettings, setAgentSettingsPath } from './agentSettings.js'
import { mountAgentSettingsApi } from './agentSettingsApi.js'

/**
 * The "Check console errors" toggle plumbing: both doors (Settings
 * and the chat header) write through POST /api/agent-settings, and
 * the chat stream reads the same store at turn start via
 * currentAgentSettings(). This pins the wire half of that circuit.
 */
function fakeApp() {
  const routes = new Map<string, (req: unknown, res: unknown) => void>()
  const app = {
    get: (p: string, h: (req: unknown, res: unknown) => void) => routes.set(`GET ${p}`, h),
    post: (p: string, h: (req: unknown, res: unknown) => void) => routes.set(`POST ${p}`, h),
  }
  const call = (method: string, p: string, body?: unknown) => {
    const handler = routes.get(`${method} ${p}`)
    assert.ok(handler, `route ${method} ${p} mounted`)
    let payload: unknown = null
    handler({ body }, { json: (v: unknown) => { payload = v } })
    return payload as { ok: boolean, settings: Record<string, unknown> }
  }
  return { app, call }
}

describe('agentSettingsApi — consoleCheck', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-settings-api-'))
    setAgentSettingsPath(path.join(dir, 'agent-settings.json'))
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('GET reports consoleCheck on by default', () => {
    const { app, call } = fakeApp()
    mountAgentSettingsApi(app as never)
    const res = call('GET', '/api/agent-settings')
    assert.equal(res.settings.consoleCheck, true)
  })

  it('POST flips it, and the turn-start read (currentAgentSettings) sees the same value', () => {
    const { app, call } = fakeApp()
    mountAgentSettingsApi(app as never)
    const off = call('POST', '/api/agent-settings', { consoleCheck: false })
    assert.equal(off.settings.consoleCheck, false)
    assert.equal(currentAgentSettings().consoleCheck, false, 'the chat stream reads this at turn start')
    const on = call('POST', '/api/agent-settings', { consoleCheck: true })
    assert.equal(on.settings.consoleCheck, true)
    assert.equal(currentAgentSettings().consoleCheck, true)
  })

  it('a POST that does not mention consoleCheck leaves it alone (and junk values sanitize)', () => {
    const { app, call } = fakeApp()
    mountAgentSettingsApi(app as never)
    call('POST', '/api/agent-settings', { consoleCheck: false })
    const other = call('POST', '/api/agent-settings', { contextTrim: false })
    assert.equal(other.settings.consoleCheck, false)
    assert.equal(other.settings.contextTrim, false)
    const junk = call('POST', '/api/agent-settings', { consoleCheck: 'off-please' })
    assert.equal(junk.settings.consoleCheck, true, 'only literal false turns it off')
  })

  it('the slice-8 doors are whitelisted: chatEngine + the override toggles round-trip', () => {
    const { app, call } = fakeApp()
    mountAgentSettingsApi(app as never)
    const get = call('GET', '/api/agent-settings')
    assert.equal(get.settings.chatEngine, 'musecode', 'fresh state defaults to musecode (the Muse Code flip)')
    assert.equal(get.settings.aleFsTools, false)
    assert.equal(get.settings.aleWebTools, false)
    assert.equal(get.settings.aleSkillTools, false)
    const on = call('POST', '/api/agent-settings', { chatEngine: 'opencode', aleWebTools: true, aleSkillTools: true })
    assert.equal(on.settings.chatEngine, 'opencode')
    assert.equal(on.settings.aleWebTools, true)
    assert.equal(on.settings.aleSkillTools, true)
    assert.equal(on.settings.aleFsTools, false, 'an unmentioned toggle is left alone')
    const legacy = call('POST', '/api/agent-settings', { chatEngine: 'mastra' })
    assert.equal(legacy.settings.chatEngine, 'mastra', 'an explicit mastra choice is honored after the flip')
    const junk = call('POST', '/api/agent-settings', { chatEngine: 'kilo', aleWebTools: 'yes' })
    assert.equal(junk.settings.chatEngine, 'musecode', 'unknown engines sanitize to the default (musecode since the Muse Code flip)')
    assert.equal(junk.settings.aleWebTools, false, 'only literal true turns an override on')
    const reread = call('GET', '/api/agent-settings')
    assert.equal(reread.settings.aleSkillTools, true, 'the saved value is what GET returns')
  })
})
