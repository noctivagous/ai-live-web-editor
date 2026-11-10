/**
 * Parity for the OpenCode web tool ports (slice 5, wave 4 group B)
 * vs their Mastra originals, with NO external network dependence:
 * fetch-page is pointed at a local HTTP server — which it refuses
 * (loopback is blocked by design), identically through both
 * implementations; web-search and research run against this
 * workspace's connection store, which has no search backend
 * configured — both implementations must surface the same
 * backend error, proving the port reaches the same plumbing
 * (and that no key material crosses: the plugin side sends only
 * { tool, input }, covered in plugin.test.ts). All three error
 * paths are deterministic, so every result deepEquals.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { setFsRoot } from '../launcher.js'
import { fetchPageTool, researchTool, webSearchTool } from '../mastra/tools/webTools.js'
import { runWebTool } from './webTools.js'

const runMastra = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<any> }).execute(input, {})

const MASTRA_WEB: Record<string, unknown> = {
  'web-search': webSearchTool,
  'fetch-page': fetchPageTool,
  'research': researchTool,
}

let server: http.Server
let base = ''
let root = ''

before(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><head><title>Local Page</title></head><body><main><h1>Hello local</h1><p>Some readable body text for the fetch parity check.</p></main></body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-oc-web-'))
  setFsRoot(root)
})

after(async () => {
  setFsRoot('')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('opencode web tools — parity with the Mastra originals', () => {
  it('fetch-page refuses the same local page identically (loopback is blocked by design)', async () => {
    // fetch-page refuses loopback/private hosts on purpose — an
    // agent tool must not become a way to read the local network.
    // Parity therefore means the identical refusal, which is also
    // what proves the ported tool reaches the same fetch plumbing.
    const url = `${base}/page`
    const a = await runMastra(fetchPageTool, { url })
    const b = await runWebTool('fetch-page', { url })
    assert.deepEqual(b, a)
    assert.match(JSON.stringify(b), /loopback\/private hosts are blocked/)
    assert.ok(server.listening)
  })

  it('web-search surfaces the same no-backend error through both implementations', async () => {
    const a = await runMastra(webSearchTool, { query: 'parity probe' })
    const b = await runWebTool('web-search', { query: 'parity probe' })
    assert.deepEqual(b, a)
    assert.ok('error' in (b as Record<string, unknown>), 'expected the unconfigured-backend error in this workspace')
  })

  it('research fails identically with no search backend, and saveTo writes nothing on failure', async () => {
    const input = { question: 'What is parity?', queries: ['parity probe one', 'parity probe two'] }
    const a = await runMastra(researchTool, input)
    const b = await runWebTool('research', input)
    assert.deepEqual(b, a)
    assert.equal((b as { ok: boolean }).ok, false)

    const savedA = await runMastra(researchTool, { ...input, saveTo: '/report.md' })
    const savedB = await runWebTool('research', { ...input, saveTo: '/report.md' })
    assert.deepEqual(savedB, savedA)
    assert.equal(fs.existsSync(path.join(root, 'report.md')), false, 'a failed research run must not write a brief')

    const badSave = await runWebTool('research', { ...input, saveTo: '/report.txt' })
    const badSaveA = await runMastra(researchTool, { ...input, saveTo: '/report.txt' })
    // Both fail at the same stage (search backend is off in this
    // workspace, so the run errors before the saveTo check) — the
    // results must still be identical.
    assert.deepEqual(badSave, badSaveA)
  })

  it('unknown tool names are an error value naming the set', async () => {
    const r = (await runWebTool('nope', {})) as { ok: boolean; error: string }
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown web tool "nope"/)
    assert.ok(MASTRA_WEB)
  })
})
