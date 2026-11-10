import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkTurnTool, clearTurnToolPolicy, handleToolCheck, setTurnToolPolicy } from './toolPolicy.js'

/**
 * Slice 7 backstop registry: the translator records each turn's
 * allowed set per session; the plugin's execute.before hook asks
 * before running an ALE tool. Only an explicit deny blocks.
 */
describe('per-turn tool policy registry', () => {
  it('allows tools in the recorded set, denies the rest with a named reason', () => {
    setTurnToolPolicy('ses-a', ['get-console', 'take-snapshot'], 'sketch')
    assert.deepEqual(checkTurnTool('ses-a', 'get-console'), { allow: true })
    const denied = checkTurnTool('ses-a', 'write-real-file')
    assert.equal(denied.allow, false)
    assert.match(denied.reason ?? '', /write-real-file is not available in this turn \(sketch workflow\)/)
  })

  it('a session with no recorded policy is allowed through (the permission layers govern)', () => {
    assert.deepEqual(checkTurnTool('ses-never-seen', 'write-real-file'), { allow: true })
    assert.deepEqual(checkTurnTool('', 'write-real-file'), { allow: true })
  })

  it('recording again replaces the turn’s set wholesale', () => {
    setTurnToolPolicy('ses-b', ['grep'], 'files')
    assert.equal(checkTurnTool('ses-b', 'patch-dom').allow, false)
    setTurnToolPolicy('ses-b', ['patch-dom'], 'sketch')
    assert.equal(checkTurnTool('ses-b', 'patch-dom').allow, true)
    assert.equal(checkTurnTool('ses-b', 'grep').allow, false)
  })

  it('clearing drops the policy (session dropped/recreated)', () => {
    setTurnToolPolicy('ses-c', ['grep'], 'files')
    clearTurnToolPolicy('ses-c')
    assert.deepEqual(checkTurnTool('ses-c', 'anything'), { allow: true })
  })

  it('handleToolCheck parses the hook’s body shape and tolerates malformed bodies', () => {
    setTurnToolPolicy('ses-d', ['grep'], 'files')
    assert.equal(handleToolCheck({ sessionID: 'ses-d', tool: 'grep' }).allow, true)
    assert.equal(handleToolCheck({ sessionID: 'ses-d', tool: 'eval-js' }).allow, false)
    assert.deepEqual(handleToolCheck(null), { allow: true })
    assert.deepEqual(handleToolCheck({}), { allow: true })
    assert.deepEqual(handleToolCheck({ sessionID: 42, tool: 'eval-js' }), { allow: true })
    assert.deepEqual(handleToolCheck({ sessionID: 'ses-d' }), { allow: true })
  })
})
