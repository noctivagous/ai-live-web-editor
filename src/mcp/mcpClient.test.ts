import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  assignMcpServerKeys, buildMcpServerDefinition, filterMcpToolset, getMcpToolsetsForTurn,
  mcpServerKey, mcpToolName,
} from './mcpClient.js'
import { emptyMcpConfig, type McpServer } from './mcpStore.js'

describe('mcpClient naming', () => {
  it('server keys are provider-safe, short and stable', () => {
    assert.equal(mcpServerKey('GitHub'), 'github')
    assert.equal(mcpServerKey('My Cool Server!'), 'my-cool-server')
    assert.equal(mcpServerKey('chrome devtools'), 'chrome-devtools')
    assert.equal(mcpServerKey('!!!'), 'server')
    assert.ok(mcpServerKey('a'.repeat(60)).length <= 24)
  })

  it('duplicate names get unique keys', () => {
    const mk = (id: string, name: string): McpServer => ({
      id, name, transport: 'stdio', command: 'x', enabled: true, tools: [], status: 'untested',
    })
    const keys = assignMcpServerKeys([mk('1', 'github'), mk('2', 'github'), mk('3', 'GitHub')])
    assert.deepEqual([...keys.values()], ['github', 'github-2', 'github-3'])
  })

  it('tool names are namespaced and capped at 64 chars', () => {
    assert.equal(mcpToolName('github', 'create_issue'), 'github_create_issue')
    assert.equal(mcpToolName('github', 'weird name'), 'github_weird-name')
    assert.ok(mcpToolName('a'.repeat(24), 'b'.repeat(80)).length <= 64)
  })

  it('filtering keeps only enabled tools, under namespaced names', () => {
    const server: McpServer = {
      id: 'x', name: 'Fixture', transport: 'stdio', enabled: true, status: 'ok',
      tools: [
        { name: 'echo', description: '', enabled: true },
        { name: 'add', description: '', enabled: false },
      ],
    }
    const fake = { echo: { id: 'echo' }, add: { id: 'add' }, mystery: { id: 'mystery' } } as never
    const out = filterMcpToolset(server, 'fixture', fake)
    assert.deepEqual(Object.keys(out), ['fixture_echo'])
  })
})

/** A spec-compliant fixture: advertises the tools capability,
 * gives every tool an inputSchema, answers tools/call. */
const FIXTURE = `
let buf = ''
process.stdin.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'fixture-server', version: '1.2.3' },
      } }) + '\\n')
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [
        { name: 'echo', description: 'Echoes text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
        { name: 'add', description: 'Adds numbers', inputSchema: { type: 'object', properties: {} } },
      ] } }) + '\\n')
    } else if (msg.method === 'tools/call') {
      const text = (msg.params && msg.params.arguments && msg.params.arguments.text) || ''
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: 'echo: ' + text }], isError: false,
      } }) + '\\n')
    }
  }
})
`

describe('mcpClient turn toolsets (real servers)', () => {
  it('connects, filters, namespaces, executes — and isolates a broken server', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-client-'))
    const script = path.join(dir, 'server.mjs')
    fs.writeFileSync(script, FIXTURE, 'utf8')
    try {
      const cfg = emptyMcpConfig()
      cfg.servers = [
        {
          id: 'a', name: 'Fixture One', transport: 'stdio', command: process.execPath, args: [script],
          enabled: true, status: 'ok',
          tools: [
            { name: 'echo', description: '', enabled: true },
            { name: 'add', description: '', enabled: false },
          ],
        },
        {
          id: 'b', name: 'Off Server', transport: 'stdio', command: process.execPath, args: [script],
          enabled: false, status: 'ok',
          tools: [{ name: 'echo', description: '', enabled: true }],
        },
        {
          id: 'c', name: 'Broken', transport: 'stdio', command: 'no-such-cmd-xyz-123',
          enabled: true, status: 'ok',
          tools: [{ name: 'echo', description: '', enabled: true }],
        },
      ]
      const turn = await getMcpToolsetsForTurn(cfg)
      try {
        assert.deepEqual(turn.toolNames, ['fixture-one_echo'])
        assert.deepEqual(turn.summary, [{ server: 'Fixture One', key: 'fixture-one', tools: 1 }])
        assert.equal(turn.failures.length, 1)
        assert.equal(turn.failures[0].server, 'Broken')
        const tool = turn.toolsets['fixture-one']['fixture-one_echo'] as unknown as {
          execute: (input: { text: string }, ctx: unknown) => Promise<{ content: { text: string }[] }>
        }
        const out = await tool.execute({ text: 'hi' }, {})
        assert.equal(out.content[0].text, 'echo: hi')
      } finally {
        await turn.close()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an empty config yields no toolsets and no failures', async () => {
    const turn = await getMcpToolsetsForTurn(emptyMcpConfig())
    assert.deepEqual(turn.toolNames, [])
    assert.deepEqual(turn.failures, [])
    await turn.close()
  })

  it('the Settings master switch connects nothing at all', async () => {
    const cfg = emptyMcpConfig()
    cfg.settings.chatToolsEnabled = false
    cfg.servers = [{
      id: 'c', name: 'Broken', transport: 'stdio', command: 'no-such-cmd-xyz-123',
      enabled: true, status: 'ok',
      tools: [{ name: 'echo', description: '', enabled: true }],
    }]
    const turn = await getMcpToolsetsForTurn(cfg)
    // A connection attempt would have produced a failure entry.
    assert.deepEqual(turn.toolNames, [])
    assert.deepEqual(turn.failures, [])
    await turn.close()
  })
})

describe('buildMcpServerDefinition — the protocol pin and its gate', () => {
  const stdio = { transport: 'stdio' as const, command: 'x' }
  it('pins legacy by default, gate off or on', () => {
    assert.equal(buildMcpServerDefinition(stdio).protocolVersion, 'legacy')
    assert.equal(buildMcpServerDefinition(stdio, true).protocolVersion, 'legacy')
  })
  it('the gate off overrides a stored choice', () => {
    assert.equal(buildMcpServerDefinition({ ...stdio, protocolVersion: '2026' }, false).protocolVersion, 'legacy')
    assert.equal(buildMcpServerDefinition({ ...stdio, protocolVersion: 'auto' }, false).protocolVersion, 'legacy')
  })
  it('the gate on applies the stored choice', () => {
    assert.equal(buildMcpServerDefinition({ ...stdio, protocolVersion: '2026' }, true).protocolVersion, '2026-07-28')
    const auto = buildMcpServerDefinition({ ...stdio, protocolVersion: 'auto' }, true)
    assert.ok(!('protocolVersion' in auto), 'auto leaves the definition unpinned so the client probes')
  })
})
