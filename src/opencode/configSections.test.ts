import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { McpConfig, McpServer } from '../mcp/mcpStore.js'
import {
  OPENCODE_HEADLESS_PERMISSIONS, opencodeMcpFor, opencodeMcpServerKey,
  opencodePermissionsFor, opencodeSkillDenyRules, opencodeSkillsFor,
} from './config.js'

/**
 * Slice 8 pins: the generated config's mcp / skills / permissions
 * sections are DERIVED from ALE's stores (the MCP manager's store,
 * the skills directory + panel toggles) with the v2 schema shapes
 * verified against the installed @opencode/schema 2.2.6 — and the
 * headless permission policy resolves every ask deliberately.
 */

const OPTS = { oauthRedirectUrl: 'http://127.0.0.1:5533/oauth/callback', oauthCallbackPort: 5533 }

function server(partial: Partial<McpServer> & { name: string }): McpServer {
  return {
    id: `srv-${partial.name}`, transport: 'stdio', enabled: true, tools: [], status: 'untested',
    ...partial,
  } as McpServer
}

const FIXTURE: McpConfig = {
  version: 1,
  budget: 40,
  settings: { chatToolsEnabled: true, protocolChoiceEnabled: false },
  servers: [
    server({
      name: 'Echo', command: 'node', args: ['/tmp/echo.mjs'], env: { FOO: 'bar' }, status: 'ok',
      tools: [
        { name: 'echo', description: '', enabled: true },
        { name: 'off-tool', description: '', enabled: false },
        { name: 'held-tool', description: '', enabled: true, needsReview: true },
      ],
    }),
    server({ name: 'Remote', transport: 'http', url: 'https://example.com/mcp', headers: { 'X-Test': '1' }, enabled: false }),
    server({
      name: 'OAuth Srv', transport: 'sse', url: 'https://example.com/sse',
      oauth: true, oauthClientId: 'client-123', status: 'needs-auth', protocolVersion: '2026',
    }),
    server({ name: 'Echo', command: 'node' }),
    server({ name: 'Broken' }),
  ],
}

describe('opencode mcp section generation (slice 8)', () => {
  it('maps a stdio server to a v2 local entry: command array, environment, direct tools (codemode off), no disabled when on', () => {
    const { mcp } = opencodeMcpFor(FIXTURE, OPTS)
    assert.deepEqual(mcp?.servers['Echo'], {
      type: 'local',
      command: ['node', '/tmp/echo.mjs'],
      environment: { FOO: 'bar' },
      codemode: false,
    })
  })

  it('maps a remote server with headers; a disabled server stays listed with disabled: true', () => {
    const { mcp } = opencodeMcpFor(FIXTURE, OPTS)
    assert.deepEqual(mcp?.servers['Remote'], {
      type: 'remote',
      url: 'https://example.com/mcp',
      codemode: false,
      headers: { 'X-Test': '1' },
      disabled: true,
    })
  })

  it('maps an oauth server: remote + oauth client identity on ALE’s loopback; protocol 2026 spelled as the v2 literal', () => {
    const { mcp } = opencodeMcpFor(FIXTURE, OPTS)
    assert.deepEqual(mcp?.servers['OAuth Srv'], {
      type: 'remote',
      url: 'https://example.com/sse',
      codemode: false,
      oauth: { client_id: 'client-123', redirect_uri: 'http://127.0.0.1:5533/oauth/callback', callback_port: 5533 },
      protocol: '2026-07-28',
    })
  })

  it('makes duplicate server names unique keys, and skips a stdio server with no command', () => {
    const { mcp } = opencodeMcpFor(FIXTURE, OPTS)
    assert.deepEqual(Object.keys(mcp?.servers ?? {}), ['Echo', 'Remote', 'OAuth Srv', 'Echo-2'])
    assert.equal(opencodeMcpServerKey('Echo', new Set(['Echo', 'Echo-2'])), 'Echo-3')
    assert.equal(opencodeMcpServerKey('  ', new Set()), 'server')
  })

  it('per-tool state becomes deny rules: switched-off and held-for-review tools, action names sanitized', () => {
    const { toolDenyRules } = opencodeMcpFor(FIXTURE, OPTS)
    assert.deepEqual(toolDenyRules, [
      { action: 'Echo_off_tool', resource: '*', effect: 'deny' },
      { action: 'Echo_held_tool', resource: '*', effect: 'deny' },
    ])
  })

  it('master switch off: every server listed disabled, and no per-tool rules are needed', () => {
    const off: McpConfig = { ...FIXTURE, settings: { chatToolsEnabled: false, protocolChoiceEnabled: false } }
    const { mcp, toolDenyRules } = opencodeMcpFor(off, OPTS)
    for (const [key, entry] of Object.entries(mcp?.servers ?? {})) {
      assert.equal(entry.disabled, true, `${key} must be disabled when the master switch is off`)
    }
    assert.deepEqual(toolDenyRules, [])
  })

  it('an empty store produces no mcp key at all', () => {
    const empty: McpConfig = { version: 1, budget: 40, settings: { chatToolsEnabled: true, protocolChoiceEnabled: false }, servers: [] }
    const r = opencodeMcpFor(empty, OPTS)
    assert.equal(r.mcp, undefined)
    assert.deepEqual(r.toolDenyRules, [])
  })
})

describe('opencode skills registration + headless permissions (slice 8)', () => {
  it('registers the skills directory as one absolute source path', () => {
    assert.deepEqual(opencodeSkillsFor('/editor/skills'), ['/editor/skills'])
  })

  it('disabled skills become sorted, deduped skill deny rules', () => {
    assert.deepEqual(opencodeSkillDenyRules(['paper-js', 'making-layouts', 'paper-js']), [
      { action: 'skill', resource: 'making-layouts', effect: 'deny' },
      { action: 'skill', resource: 'paper-js', effect: 'deny' },
    ])
    assert.deepEqual(opencodeSkillDenyRules([]), [])
  })

  it('the headless policy: catch-all allow first, .env reads DENIED after it, example files allowed last', () => {
    assert.deepEqual(OPENCODE_HEADLESS_PERMISSIONS, [
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'read', resource: '*.env', effect: 'deny' },
      { action: 'read', resource: '*.env.*', effect: 'deny' },
      { action: 'read', resource: '*.env.example', effect: 'allow' },
    ])
    assert.ok(
      OPENCODE_HEADLESS_PERMISSIONS.every((r) => r.effect !== 'ask'),
      'no rule in the headless policy may resolve to ask — nobody can answer it',
    )
  })

  it('extra deny rules ride after the headless policy, so they win their matches', () => {
    const extra = [{ action: 'Echo_off_tool', resource: '*', effect: 'deny' as const }]
    const all = opencodePermissionsFor(extra)
    assert.equal(all.length, OPENCODE_HEADLESS_PERMISSIONS.length + 1)
    assert.deepEqual(all[all.length - 1], extra[0])
    assert.deepEqual(all.slice(0, OPENCODE_HEADLESS_PERMISSIONS.length), OPENCODE_HEADLESS_PERMISSIONS)
  })
})
