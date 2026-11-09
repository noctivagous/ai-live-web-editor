import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { probeMcpServer } from './mcpProbe.js'

/** A minimal real MCP server over stdio, written to a temp file
 * and spawned by the probe exactly as a user's server would be. */
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
        { name: 'echo', description: 'Echoes text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
        { name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: {} } },
      ] } }) + '\\n')
    }
  }
})
`

function fixtureDir(script: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-probe-'))
  fs.writeFileSync(path.join(dir, 'server.mjs'), script, 'utf8')
  return dir
}

const ANNOTATED = (schemaProps: string) => `
import { createInterface } from 'node:readline';
const tools = [
  { name: 'read_thing', description: 'Reads a thing.', annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type: 'object', properties: { ${schemaProps} }, required: ['path'] } },
  { name: 'delete_thing', description: 'Deletes a thing.', annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
];
const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const send = o => process.stdout.write(JSON.stringify(o) + '\\n');
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'annotated-fixture', version: '2.0.0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools } });
  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
`

describe('mcpProbe', () => {
  it('captures tool annotations and a stable schema fingerprint', async () => {
    const dir = fixtureDir(ANNOTATED(`path: { type: 'string' }`))
    const dir2 = fixtureDir(ANNOTATED(`path: { type: 'string' }, force: { type: 'boolean' }`))
    try {
      const target = (d: string) => ({ transport: 'stdio' as const, command: process.execPath, args: [path.join(d, 'server.mjs')] })
      const r1 = await probeMcpServer(target(dir), 10_000)
      assert.equal(r1.ok, true)
      const read = r1.tools?.find(t => t.name === 'read_thing')
      const del = r1.tools?.find(t => t.name === 'delete_thing')
      assert.deepEqual(read?.annotations, { readOnly: true, destructive: false })
      assert.deepEqual(del?.annotations, { readOnly: false, destructive: true })
      assert.ok(read?.schemaHash, 'a fingerprint is recorded')
      const r2 = await probeMcpServer(target(dir), 10_000)
      assert.equal(r2.tools?.find(t => t.name === 'read_thing')?.schemaHash, read?.schemaHash, 'same schema, same fingerprint')
      const r3 = await probeMcpServer(target(dir2), 10_000)
      assert.notEqual(r3.tools?.find(t => t.name === 'read_thing')?.schemaHash, read?.schemaHash, 'changed schema, changed fingerprint')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('completes a real handshake and lists tools', async () => {
    const dir = fixtureDir(FIXTURE)
    try {
      const result = await probeMcpServer(
        { transport: 'stdio', command: process.execPath, args: [path.join(dir, 'server.mjs')] },
        10_000,
      )
      assert.equal(result.ok, true)
      assert.equal(result.serverName, 'fixture-server')
      assert.equal(result.serverVersion, '1.2.3')
      assert.deepEqual(result.tools?.map(t => t.name), ['echo', 'add'])
      assert.equal(result.tools?.[0].description, 'Echoes text back')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails a spec-sloppy server the chat client would also refuse (tools without inputSchema)', async () => {
    // The pre-unification probe listed these tools happily; the
    // SDK validates tools/list results, so Test must fail here
    // exactly as a chat turn would.
    const sloppy = `
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
        serverInfo: { name: 'sloppy-server', version: '0.1' },
      } }) + '\\n')
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [
        { name: 'echo', description: 'No inputSchema on purpose' },
      ] } }) + '\\n')
    }
  }
})
`
    const dir = fixtureDir(sloppy)
    try {
      const result = await probeMcpServer(
        { transport: 'stdio', command: process.execPath, args: [path.join(dir, 'server.mjs')] },
        10_000,
      )
      assert.equal(result.ok, false, 'a server missing inputSchema must not pass Test')
      assert.match(result.error ?? '', /Invalid result|inputSchema/, `error was: ${result.error}`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a missing command plainly', async () => {
    const result = await probeMcpServer({ transport: 'stdio', command: 'no-such-command-xyz-123' }, 5_000)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Command not found/)
  })

  it('times out on a server that never answers, including what it said', async () => {
    const dir = fixtureDir(`console.error('starting up but broken'); setInterval(() => {}, 1000)`)
    try {
      const result = await probeMcpServer(
        { transport: 'stdio', command: process.execPath, args: [path.join(dir, 'server.mjs')] },
        600,
      )
      assert.equal(result.ok, false)
      assert.match(result.error ?? '', /Timed out/)
      assert.match(result.error ?? '', /starting up but broken/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a server that exits immediately, with its stderr', async () => {
    const dir = fixtureDir(`console.error('bad api key'); process.exit(3)`)
    try {
      const result = await probeMcpServer(
        { transport: 'stdio', command: process.execPath, args: [path.join(dir, 'server.mjs')] },
        5_000,
      )
      assert.equal(result.ok, false)
      assert.match(result.error ?? '', /exited \(code 3\)/)
      assert.match(result.error ?? '', /bad api key/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a malformed URL plainly', async () => {
    const result = await probeMcpServer({ transport: 'http', url: 'not a url' })
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /valid URL/)
  })
})

/** A minimal Streamable HTTP MCP server on an ephemeral port.
 * /mcp is open; /secure demands Authorization: Bearer test-token;
 * /plain is not an MCP server at all. Stateless: no session id. */
function startHttpFixture(): Promise<{ base: string, close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/plain') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('hello, not an MCP server')
      return
    }
    if (url.pathname !== '/mcp' && url.pathname !== '/secure') {
      res.writeHead(404)
      res.end()
      return
    }
    if (url.pathname === '/secure' && req.headers.authorization !== 'Bearer test-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    if (req.method === 'GET') { // no server-initiated stream in stateless mode
      res.writeHead(405)
      res.end()
      return
    }
    let body = ''
    req.on('data', d => { body += String(d) })
    req.on('end', () => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(body) as Record<string, unknown> } catch {
        res.writeHead(400)
        res.end()
        return
      }
      if (msg.id === undefined) { // a notification
        res.writeHead(202)
        res.end()
        return
      }
      const reply = (result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
      }
      if (msg.method === 'initialize') {
        reply({
          protocolVersion: '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: 'http-fixture', version: '2.0.0' },
        })
      } else if (msg.method === 'tools/list') {
        reply({ tools: [
          { name: 'echo', description: 'Echoes text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
          { name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: {} } },
        ] })
      } else if (msg.method === 'tools/call') {
        reply({ content: [{ type: 'text', text: 'ok' }], isError: false })
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } }))
      }
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>(r => server.close(() => r())),
      })
    })
  })
}

describe('mcpProbe — URL servers (through the chat client machinery)', () => {
  it('connects to a Streamable HTTP server and lists its tools', async () => {
    const fx = await startHttpFixture()
    try {
      const result = await probeMcpServer({ transport: 'http', url: `${fx.base}/mcp` }, 15_000)
      assert.equal(result.ok, true, result.error)
      assert.equal(result.serverName, 'http-fixture')
      assert.equal(result.serverVersion, '2.0.0')
      assert.deepEqual(result.tools?.map(t => t.name), ['echo', 'add'])
      assert.equal(result.tools?.[0].description, 'Echoes text back')
      assert.ok(result.latencyMs >= 0)
    } finally {
      await fx.close()
    }
  })

  it('passes headers through — and reports a 401 in plain words without them', async () => {
    const fx = await startHttpFixture()
    try {
      const denied = await probeMcpServer({ transport: 'http', url: `${fx.base}/secure` }, 15_000)
      assert.equal(denied.ok, false)
      assert.match(denied.error ?? '', /HTTP 401/, `raw error was: ${denied.error}`)
      assert.match(denied.error ?? '', /authorization header/)
      const allowed = await probeMcpServer(
        { transport: 'http', url: `${fx.base}/secure`, headers: { Authorization: 'Bearer test-token' } },
        15_000,
      )
      assert.equal(allowed.ok, true, allowed.error)
      assert.deepEqual(allowed.tools?.map(t => t.name), ['echo', 'add'])
    } finally {
      await fx.close()
    }
  })

  it('reports an unreachable URL plainly', async () => {
    const probe = await startHttpFixture()
    const base = probe.base
    await probe.close() // the port is now closed
    const result = await probeMcpServer({ transport: 'http', url: `${base}/mcp` }, 15_000)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Could not connect/, `raw error was: ${result.error}`)
  })

  it('fails honestly against an endpoint that is not an MCP server', async () => {
    const fx = await startHttpFixture()
    try {
      const result = await probeMcpServer({ transport: 'http', url: `${fx.base}/plain` }, 15_000)
      assert.equal(result.ok, false)
      assert.ok((result.error ?? '').length > 0)
    } finally {
      await fx.close()
    }
  })
})
