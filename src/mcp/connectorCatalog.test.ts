import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { buildConnectorInstall, CONNECTOR_CATALOG, findConnector, type ConnectorEntry } from './connectorCatalog.js'
import { addMcpServer, emptyMcpConfig, loadMcpConfig, saveMcpConfig } from './mcpStore.js'

describe('the bundled connector catalog', () => {
  it('every entry is well-formed registry shape', () => {
    const ids = new Set<string>()
    for (const e of CONNECTOR_CATALOG) {
      assert.ok(!ids.has(e.id), `duplicate id ${e.id}`)
      ids.add(e.id)
      assert.ok(e.id.includes('/'), `${e.id} is namespaced`)
      assert.ok(e.title && e.version && e.publisher.name, `${e.id} carries title, version, publisher`)
      assert.ok(e.description.length > 0 && e.description.length <= 100, `${e.id} description within the 100-char registry cap (${e.description.length})`)
      // Exactly one payload: a launch spec or a URL, never both.
      if (e.server.transport === 'stdio') {
        assert.ok(e.server.command, `${e.id} stdio entry has a command`)
        assert.equal(e.server.url, undefined)
      } else {
        assert.ok(e.server.url?.startsWith('https://'), `${e.id} remote entry has an https URL`)
        assert.equal(e.server.command, undefined)
      }
      const names = new Set(e.inputs.map(i => i.name))
      assert.equal(names.size, e.inputs.length, `${e.id} input names are unique`)
      for (const i of e.inputs) {
        // stdio inputs arrive as env; remote inputs as headers.
        assert.equal(i.target, e.server.transport === 'stdio' ? 'env' : 'header', `${e.id}/${i.name} target matches the transport`)
      }
    }
  })

  it('the GitHub entry asks for its token as a required secret', () => {
    const gh = findConnector('io.modelcontextprotocol/github')
    assert.ok(gh)
    const token = gh.inputs.find(i => i.name === 'GITHUB_PERSONAL_ACCESS_TOKEN')
    assert.ok(token && token.isRequired && token.isSecret && token.target === 'env')
  })
})

describe('buildConnectorInstall', () => {
  const github = findConnector('io.modelcontextprotocol/github') as ConnectorEntry
  const context7 = findConnector('com.context7/context7') as ConnectorEntry

  it('delivers prompted values as env and stamps provenance', () => {
    const built = buildConnectorInstall(github, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' })
    if (built.ok === false) assert.fail(built.error)
    assert.equal(built.input.env?.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_test')
    assert.equal(built.input.command, 'npx')
    assert.deepEqual(built.input.origin, { catalogId: 'io.modelcontextprotocol/github', version: github.version })
  })

  it('a missing required value is an error, not an empty secret', () => {
    const built = buildConnectorInstall(github, {})
    assert.equal(built.ok, false)
    const blank = buildConnectorInstall(github, { GITHUB_PERSONAL_ACCESS_TOKEN: '   ' })
    assert.equal(blank.ok, false)
  })

  it('an optional input may be skipped, and fills its header when given', () => {
    const skipped = buildConnectorInstall(context7, {})
    assert.ok(skipped.ok)
    if (skipped.ok) assert.equal(skipped.input.headers, undefined)
    const given = buildConnectorInstall(context7, { CONTEXT7_API_KEY: 'ctx7-key' })
    assert.ok(given.ok)
    if (given.ok) assert.equal(given.input.headers?.CONTEXT7_API_KEY, 'ctx7-key')
  })

  it('a header value template wraps the prompted value', () => {
    const entry: ConnectorEntry = {
      id: 'com.example/api', title: 'Example', description: 'Example entry.', version: '2.0.0',
      publisher: { name: 'Example' },
      server: { name: 'example', transport: 'http', url: 'https://example.com/mcp' },
      inputs: [{ name: 'Authorization', description: 'An API token', isRequired: true, isSecret: true, target: 'header', valueTemplate: 'Bearer {value}' }],
    }
    const built = buildConnectorInstall(entry, { Authorization: 'tok' })
    assert.ok(built.ok)
    if (built.ok) assert.equal(built.input.headers?.Authorization, 'Bearer tok')
  })

  it('provenance survives a store save/load round trip', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-catalog-'))
    const prev = process.env.AI_LIVE_MCP_PATH
    process.env.AI_LIVE_MCP_PATH = path.join(dir, 'mcp.json')
    try {
      const cfg = emptyMcpConfig()
      const built = buildConnectorInstall(github, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' })
      if (built.ok === false) assert.fail(built.error)
      addMcpServer(cfg, built.input)
      saveMcpConfig(cfg)
      const back = loadMcpConfig()
      assert.deepEqual(back.servers[0].origin, { catalogId: 'io.modelcontextprotocol/github', version: github.version })
    } finally {
      if (prev === undefined) delete process.env.AI_LIVE_MCP_PATH
      else process.env.AI_LIVE_MCP_PATH = prev
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
