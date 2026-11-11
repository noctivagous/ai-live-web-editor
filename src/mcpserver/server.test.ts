import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  aleMcpSessionConfig, aleMcpState, handleAleMcpBody, resetAleMcpState, waitForAleToolsListed,
} from './server.js'
import { ALE_TOOLS, aleResultIsError, aleToolByName, callAleTool } from './registry.js'

describe('ALE MCP tool registry (slice 5)', () => {
  it('every tool is ale_-prefixed with a description and an object schema', () => {
    assert.ok(ALE_TOOLS.length >= 13)
    for (const t of ALE_TOOLS) {
      assert.match(t.name, /^ale_[a-z_]+$/)
      assert.ok(t.description.length > 40, `${t.name} description should speak to a coding agent`)
      assert.equal((t.inputSchema as any).type, 'object')
    }
  })

  it('the page family rides the page dispatch names and verify is present', () => {
    for (const n of ['ale_page_patch', 'ale_page_eval', 'ale_page_snapshot', 'ale_page_inspect', 'ale_page_sections', 'ale_page_layout', 'ale_page_layout_svg', 'ale_page_run', 'ale_page_open', 'ale_page_console', 'ale_verify_gate', 'ale_verify_network', 'ale_verify_resolve_source']) {
      assert.ok(aleToolByName(n), n)
    }
  })

  it('unknown tool names are error values, never throws', async () => {
    const { result, isError } = await callAleTool('ale_nope', {})
    assert.equal(isError, true)
    assert.match((result as any).error, /unknown ALE tool/)
  })

  it('aleResultIsError follows the host verdict shape', () => {
    assert.equal(aleResultIsError({ ok: false, error: 'x' }), true)
    assert.equal(aleResultIsError({ error: 'x' }), true)
    assert.equal(aleResultIsError({ ok: true }), false)
    assert.equal(aleResultIsError({ entries: [] }), false)
    assert.equal(aleResultIsError(null), false)
  })
})

describe('ALE MCP JSON-RPC transport (slice 5)', () => {
  beforeEach(() => resetAleMcpState())

  it('initialize answers with the requested protocol version and records the connection', async () => {
    const { status, body } = await handleAleMcpBody({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    assert.equal(status, 200)
    const b = body as any
    assert.equal(b.result.protocolVersion, '2025-03-26')
    assert.equal(b.result.serverInfo.name, 'ale')
    assert.equal(aleMcpState().initializeCount, 1)
  })

  it('tools/list returns the registry and is countable for the presence assertion', async () => {
    const { body } = await handleAleMcpBody({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const names = (body as any).result.tools.map((t: any) => t.name)
    assert.ok(names.includes('ale_page_patch'))
    assert.ok(names.includes('ale_verify_gate'))
    assert.equal(aleMcpState().toolsListCount, 1)
    assert.equal(await waitForAleToolsListed(0, 50), true)
    assert.equal(await waitForAleToolsListed(1, 50), false)
  })

  it('notifications answer 202 with no body; unknown methods are -32601', async () => {
    const n = await handleAleMcpBody({ jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(n.status, 202)
    assert.equal(n.body, undefined)
    const u = await handleAleMcpBody({ jsonrpc: '2.0', id: 9, method: 'nope/nope' })
    assert.equal((u.body as any).error.code, -32601)
  })

  it('tools/call for an unknown tool returns isError content, not a transport error', async () => {
    const { status, body } = await handleAleMcpBody({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ale_missing', arguments: {} } })
    assert.equal(status, 200)
    assert.equal((body as any).result.isError, true)
    assert.match((body as any).result.content[0].text, /unknown ALE tool/)
  })

  it('the session config registers the server as streamableHttp on the editor port', () => {
    const cfg = aleMcpSessionConfig() as any
    assert.equal(cfg.ale.transport, 'streamableHttp')
    assert.match(cfg.ale.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/mcp\/ale$/)
  })
})
