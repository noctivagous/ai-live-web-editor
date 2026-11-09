import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  addMcpServer, applyMcpTestResult, emptyMcpConfig, loadMcpConfig, saveMcpConfig,
} from './mcpStore.js'
import { clearOAuthData, hasOAuthTokens, oauthStorageFor } from './mcpOAuth.js'
import { onMcpSignInSettled, startMcpSignIn } from './mcpAuth.js'
import { probeMcpServer } from './mcpProbe.js'
import { getMcpToolsetsForTurn } from './mcpClient.js'

/**
 * Slice 8's end-to-end: a local authorization server + OAuth-
 * protected MCP resource (the spike, productized). The flow
 * under test is the real one — RFC 9728 discovery, the
 * authorization-code grant with PKCE S256, the library's
 * loopback callback server, token storage, and connects that
 * carry the token — against an AS that checks the PKCE
 * verifier and only accepts the pre-registered client id.
 */

const CLIENT_ID = 'ale-test-client'
const codes = new Map<string, { challenge: string }>()
let base = ''
let httpServer: http.Server
let tmpDir = ''

function startFixture(): Promise<string> {
  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', base)
    const send = (code: number, obj: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(obj))
    }
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return send(200, { resource: `${base}/mcp`, authorization_servers: [base] })
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return send(200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (url.pathname === '/authorize') {
      if (url.searchParams.get('client_id') !== CLIENT_ID) return send(400, { error: 'unknown client' })
      const code = 'code-123'
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '' })
      const back = new URL(url.searchParams.get('redirect_uri') ?? '')
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      back.searchParams.set('iss', base)
      res.writeHead(302, { Location: back.toString() })
      return res.end()
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const p = new URLSearchParams(body)
        if (p.get('grant_type') === 'refresh_token') {
          return send(200, { access_token: 'tok-def', token_type: 'Bearer', expires_in: 3600, refresh_token: 'ref-uvw' })
        }
        const rec = codes.get(p.get('code') ?? '')
        const digest = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url')
        if (!rec || digest !== rec.challenge) return send(400, { error: 'invalid_grant' })
        return send(200, { access_token: 'tok-abc', token_type: 'Bearer', expires_in: 3600, refresh_token: 'ref-xyz' })
      })
      return
    }
    if (url.pathname === '/mcp') {
      const auth = req.headers.authorization ?? ''
      if (auth !== 'Bearer tok-abc' && auth !== 'Bearer tok-def') {
        return send(401, { error: 'unauthorized' }, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` })
      }
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        let m: { id?: unknown, method?: string }
        try { m = JSON.parse(body) } catch { return send(400, {}) }
        if (m.method === 'initialize') return send(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'oauth-fixture', version: '3.0.0' } } })
        if (m.method === 'tools/list') return send(200, { jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'secret_echo', description: 'Echoes, once signed in.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } })
        if (m.method === 'tools/call') return send(200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'secret: ok' }] } })
        if (m.id !== undefined) return send(200, { jsonrpc: '2.0', id: m.id, result: {} })
        res.writeHead(202)
        res.end()
      })
      return
    }
    return send(404, { error: 'not found' })
  })
  return new Promise(resolve => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address()
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
      resolve(base)
    })
  })
}

describe('mcpOAuth', () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-mcp-oauth-'))
    process.env.AI_LIVE_MCP_PATH = path.join(tmpDir, 'mcp.json')
    process.env.AI_LIVE_MCP_OAUTH_PATH = path.join(tmpDir, 'mcp-oauth.json')
    await startFixture()
  })
  after(() => {
    httpServer?.close()
    delete process.env.AI_LIVE_MCP_PATH
    delete process.env.AI_LIVE_MCP_OAUTH_PATH
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('storage is namespaced per server and reports token existence only', () => {
    const a = oauthStorageFor('srv-a')
    const b = oauthStorageFor('srv-b')
    a.set('k1', JSON.stringify({ access_token: 'x', token_type: 'Bearer' }))
    b.set('k1', 'plain-verifier')
    assert.equal(hasOAuthTokens('srv-a'), true)
    assert.equal(hasOAuthTokens('srv-b'), false)
    clearOAuthData('srv-a')
    assert.equal(hasOAuthTokens('srv-a'), false)
    assert.equal(b.get('k1'), 'plain-verifier')
    clearOAuthData('srv-b')
  })

  it('the full sign-in flow: needs-auth, browser leg, tokens, tools, chat', async () => {
    const cfg = emptyMcpConfig()
    const server = addMcpServer(cfg, {
      name: 'protected', transport: 'http', url: `${base}/mcp`, oauthClientId: CLIENT_ID,
    })
    saveMcpConfig(cfg)

    // 1. A test discovers the sign-in requirement.
    const first = await probeMcpServer(server, 15_000)
    assert.equal(first.ok, false)
    assert.equal(first.needsAuth, true)
    applyMcpTestResult(server, first)
    assert.equal(server.status, 'needs-auth')
    assert.equal(server.oauth, true)

    // 2. Sign in: the flow hands back the authorization URL;
    // the "browser" follows it to the loopback callback.
    const settled = new Promise<{ ok: boolean }>(resolve => {
      onMcpSignInSettled((id, ok) => { if (id === server.id) resolve({ ok }) })
    })
    const { authUrl } = await startMcpSignIn(server)
    assert.match(authUrl, /\/authorize\?/)
    assert.match(authUrl, /code_challenge_method=S256/)
    const authRes = await fetch(authUrl, { redirect: 'manual' })
    assert.equal(authRes.status, 302)
    const callbackRes = await fetch(authRes.headers.get('location') ?? '')
    assert.equal(callbackRes.status, 200)
    assert.deepEqual(await settled, { ok: true })
    assert.equal(hasOAuthTokens(server.id), true)

    // 3. A test now connects with the token and lists tools.
    const second = await probeMcpServer(server, 15_000)
    assert.equal(second.ok, true)
    assert.deepEqual(second.tools?.map(t => t.name), ['secret_echo'])
    applyMcpTestResult(server, second)
    assert.equal(server.status, 'ok')
    saveMcpConfig(cfg)

    // 4. Chat turns offer the tool under its namespaced name.
    const turn = await getMcpToolsetsForTurn(loadMcpConfig())
    try {
      assert.equal(turn.toolNames.length, 1)
      assert.match(turn.toolNames[0], /_secret_echo$/)
    } finally {
      await turn.close()
    }

    // 5. Signing out (forgetting the tokens) returns the
    // server to needs-auth on its next test.
    clearOAuthData(server.id)
    const third = await probeMcpServer(server, 15_000)
    assert.equal(third.needsAuth, true)
  })

  it('oauth identity fields round-trip through the store', () => {
    const cfg = emptyMcpConfig()
    const s = addMcpServer(cfg, {
      name: 'meta', transport: 'http', url: 'https://example.com/mcp',
      oauthClientMetadataUrl: 'https://clients.example.com/ale.json',
    })
    saveMcpConfig(cfg)
    const back = loadMcpConfig().servers.find(x => x.id === s.id)
    assert.equal(back?.oauthClientMetadataUrl, 'https://clients.example.com/ale.json')
  })
})
