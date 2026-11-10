import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { ChatDebugTurnRecord } from '../chatDebug.js'
import type { ChatSseResponse, ChatStreamEvent } from '../chatStream.js'

/**
 * Slice 9 integration: chatDebug on the OpenCode bus. The
 * translator records its turns through the SAME ChatDebugTurn
 * recorder the Mastra stream uses (chatGate.test.ts's harness —
 * a stub opencode binary + a stub page server — drives a real
 * gated turn): with AI_LIVE_CHAT_DEBUG=1 the JSONL gains one
 * chat-turn record in the Mastra shape, stamped engine:
 * 'opencode'; with the flag off, no file appears at all.
 */

type Mod = typeof import('./chat.js')

const STUB_BINARY = `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const sseClients = new Set()
let promptCount = 0
let scenarioHash = 0
function emit(ev) {
  const line = 'data: ' + JSON.stringify(ev) + '\\n\\n'
  for (const res of sseClients) { try { res.write(line) } catch { /* closed */ } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function runScript(sessionID, index) {
  let scripts = []
  try { scripts = JSON.parse(fs.readFileSync(process.env.STUB_SCENARIO_FILE, 'utf8')) } catch { /* none */ }
  const script = scripts[index] || []
  for (const step of script) {
    if (step.delayMs) await sleep(step.delayMs)
    else if (step.plant) {
      await fetch(process.env.STUB_PAGE_URL + '/__plant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(step.plant),
      }).catch(() => {})
    } else if (step.events) {
      for (const ev of step.events) emit({ type: ev.type, data: { sessionID, ...(ev.data || {}) } })
    }
  }
  emit({ type: 'session.execution.succeeded', data: { sessionID } })
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://stub')
  if (req.method === 'GET' && url.pathname === '/api/info') {
    res.end(JSON.stringify({ ok: true, version: '2.2.6-stub' }))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/event') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(': open\\n\\n')
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/session') {
    req.resume()
    req.on('end', () => res.end(JSON.stringify({ data: { id: 'ses-stub-1' } })))
    return
  }
  if (req.method === 'POST' && /\\/api\\/session\\/[^/]+\\/agent$/.test(url.pathname)) {
    req.resume()
    req.on('end', () => { res.statusCode = 204; res.end() })
    return
  }
  if (req.method === 'PATCH' && /^\\/api\\/session\\/[^/]+$/.test(url.pathname)) {
    req.resume()
    req.on('end', () => { res.statusCode = 204; res.end() })
    return
  }
  const promptMatch = url.pathname.match(/^\\/api\\/session\\/([^/]+)\\/prompt$/)
  if (req.method === 'POST' && promptMatch) {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try {
        const content = fs.readFileSync(process.env.STUB_SCENARIO_FILE, 'utf8')
        let h = 0
        for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0
        if (h !== scenarioHash) { scenarioHash = h; promptCount = 0 }
      } catch { /* keep counting */ }
      const index = promptCount
      promptCount += 1
      res.end(JSON.stringify({ data: {} }))
      setTimeout(() => { void runScript(decodeURIComponent(promptMatch[1]), index) }, 30)
    })
    return
  }
  if (req.method === 'POST' && /\\/interrupt$/.test(url.pathname)) { res.end('{}'); return }
  res.statusCode = 404
  res.end('{}')
})
server.listen(port, '127.0.0.1')
`

interface RingEntry { seq: number, level: string, text: string, ts: number }

describe('opencode translator: chatDebug records (slice 9)', () => {
  let chat: Mod
  let stopServer: () => void
  let baseDir: string
  let pageServer: http.Server
  let scenarioPath: string
  let debugFile: string
  const ring: RingEntry[] = []
  let ringSeq = 0

  before(async () => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-chatdebug-'))
    const projectDir = path.join(baseDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'App.jsx'), 'export default function App() { return null }\n')
    scenarioPath = path.join(baseDir, 'scenario.json')
    fs.writeFileSync(scenarioPath, '[]')
    debugFile = path.join(baseDir, 'chat-debug.jsonl')

    // Stub page (the project's own server in the real topology).
    pageServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        let payload: Record<string, unknown> = {}
        try { payload = JSON.parse(body || '{}') } catch { /* empty */ }
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/__plant') {
          ring.push({ seq: ++ringSeq, level: String(payload.level || 'log'), text: String(payload.text || ''), ts: Date.now() })
          res.end('{}')
          return
        }
        if (req.url === '/api/page/console') {
          const sinceSeq = Number(payload.sinceSeq || 0)
          const maxEntries = Number(payload.maxEntries || 200)
          const entries = ring.filter((e) => e.seq > sinceSeq).slice(-maxEntries)
          res.end(JSON.stringify({ ok: true, entries, latestSeq: ringSeq, instance: 'stub-page-1' }))
          return
        }
        if (req.url === '/api/page/eval') {
          res.end(JSON.stringify({ ok: true, result: { ok: true, ensured: [375, 768, 1280] } }))
          return
        }
        if (req.url === '/api/page/layout-snapshot') {
          res.end(JSON.stringify({
            ok: true, schemaVersion: 2,
            page: { url: 'http://stub-page/', viewport: { width: 1280, height: 800 } },
            elements: [],
          }))
          return
        }
        res.end(JSON.stringify({ ok: false, error: 'stub page: unsupported op' }))
      })
    })
    await new Promise<void>((resolve) => pageServer.listen(0, '127.0.0.1', resolve))
    const pagePort = (pageServer.address() as { port: number }).port
    process.env.VITE_ORIGIN = `http://127.0.0.1:${pagePort}`
    process.env.STUB_PAGE_URL = `http://127.0.0.1:${pagePort}`

    const envMod = await import('../env.js')
    envMod.setEnvPath(path.join(baseDir, '.env'))
    const settings = await import('../agentSettings.js')
    settings.setAgentSettingsPath(path.join(baseDir, 'agent-settings.json'))
    const watermarks = await import('../verify/consoleWatermarks.js')
    watermarks.setConsoleWatermarksPath(path.join(baseDir, 'console-watermarks.json'))
    const launcher = await import('../launcher.js')
    launcher.setFsRoot(projectDir)

    settings.saveAgentSettings({ chatEngine: 'opencode', consoleCheck: true })
    const connections = await import('../connections.js')
    const conn = connections.upsertConnection({
      presetId: 'meta', name: 'Stub', model: 'stub-model', key: 'sk-' + 'stubkey123456',
    })
    connections.activateConnection(conn.id)

    const binPath = path.join(baseDir, 'opencode-stub.cjs')
    fs.writeFileSync(binPath, STUB_BINARY, { mode: 0o755 })
    process.env.OPENCODE_BIN = binPath
    process.env.STUB_SCENARIO_FILE = scenarioPath
    process.env.AI_LIVE_CHAT_DEBUG_FILE = debugFile
    delete process.env.AI_LIVE_VERIFY

    chat = await import('./chat.js')
    const supervisor = await import('./supervisor.js')
    stopServer = supervisor.stopOpencodeServer
  })

  after(async () => {
    try { stopServer() } catch { /* never started */ }
    await new Promise((resolve) => pageServer.close(resolve))
    delete process.env.OPENCODE_BIN
    delete process.env.VITE_ORIGIN
    delete process.env.AI_LIVE_CHAT_DEBUG
    delete process.env.AI_LIVE_CHAT_DEBUG_FILE
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  const toolStep = (name: string, input: Record<string, unknown>) => ({
    events: [
      { type: 'session.tool.input.started', data: { id: `call-${name}`, name } },
      { type: 'session.tool.called', data: { id: `call-${name}`, input } },
      { type: 'session.tool.success', data: { id: `call-${name}`, content: [{ type: 'text', text: 'ok' }] } },
      { type: 'session.step.ended', data: { tokens: { input: 10, output: 5 } } },
    ],
  })
  const textStep = (text: string) => ({
    events: [
      { type: 'session.text.delta', data: { delta: text } },
      { type: 'session.step.ended', data: { tokens: { input: 10, output: 5 } } },
    ],
  })
  const EDIT = toolStep('edit', { path: 'src/App.jsx', oldString: 'null', newString: 'null' })

  const runTurn = async (text: string, workflow: string) => {
    const chunks: string[] = []
    const res: ChatSseResponse = {
      setHeader: () => {},
      write: (c: string) => { chunks.push(c); return true },
      end: () => {},
    }
    await chat.pipeOpencodeChatStream([{ role: 'user', content: text }], res, {}, workflow)
    return chunks
      .filter((c) => c.startsWith('data: '))
      .map((c) => JSON.parse(c.slice(6)) as ChatStreamEvent)
  }

  const turnRecords = (): ChatDebugTurnRecord[] => {
    if (!fs.existsSync(debugFile)) return []
    return fs.readFileSync(debugFile, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as ChatDebugTurnRecord)
      .filter((r) => r.kind === 'chat-turn')
  }

  it('debug on: a gated turn writes ONE chat-turn record in the Mastra shape, engine-stamped', async () => {
    process.env.AI_LIVE_CHAT_DEBUG = '1'
    fs.writeFileSync(scenarioPath, JSON.stringify([
      [EDIT, { plant: { level: 'error', text: 'TypeError: boom in App' } }, textStep('Edited the app.')],
      [textStep('Fixed the boom.')],
    ]))
    ring.length = 0
    const events = await runTurn('change the app', 'files')
    assert.equal(events.filter((e) => e.type === 'done').length, 1, 'the turn itself completed with one done')

    const records = turnRecords()
    assert.equal(records.length, 1, 'one record for the whole client turn, follow-up included')
    const rec = records[0]
    // The engine marker + the core Mastra-shape fields.
    assert.equal(rec.engine, 'opencode')
    for (const key of [
      'ts', 'endedAt', 'durationMs', 'projectRoot', 'projectId', 'mode', 'workflowSwitched',
      'toolsOffered', 'toolSignals', 'gateArmed', 'gateBaselineCaptured', 'gate',
      'events', 'textChars', 'reasoningChars', 'finalTextHead', 'usage', 'model',
      'error', 'aborted', 'writes',
    ] as const) {
      assert.ok(key in rec, `record carries ${key}`)
    }
    assert.equal(rec.mode, 'files')
    assert.equal(rec.workflowSwitched, false)
    assert.equal(rec.projectRoot, path.join(baseDir, 'project'))
    assert.equal(rec.error, null)
    assert.equal(rec.aborted, false)
    assert.match(rec.model ?? '', /stub-model/)
    // Offered set: this turn's allowed ALE tools (console arc on).
    assert.ok(rec.toolsOffered?.includes('get-console'), 'core ALE tools recorded as offered')
    assert.ok(rec.toolsOffered?.includes('console-expect'), 'console-expect joins a checked turn')
    assert.ok(!rec.toolsOffered?.includes('patch-dom'), 'sketch-only tools are not in a Files offer')
    // Gate state: armed, the edit triggered it, the follow-up ran,
    // and the verification (with its console editorCount) rides
    // the record exactly as the Mastra record carries it.
    assert.equal(rec.gateArmed, true)
    assert.equal(rec.gate?.decision, true)
    assert.deepEqual(rec.gate?.toolTrace, ['edit'])
    assert.equal(rec.gate?.verification?.followUp, true)
    assert.equal(rec.gate?.verification?.console?.errorTotal, 1)
    assert.equal(rec.gate?.verification?.console?.editorCount, 0)
    // Events + usage folded from the bus (main turn + follow-up).
    const toolCall = rec.events.find((e) => e.type === 'tool-call')
    assert.deepEqual(toolCall, { type: 'tool-call', id: 'call-edit', name: 'edit', detail: 'edit src/App.jsx' })
    assert.equal(rec.events.filter((e) => e.type === 'tool-result' && e.ok).length, 1)
    assert.deepEqual(rec.usage, { input: 30, output: 15, total: 45 })
    assert.match(rec.finalTextHead, /Edited the app\./)
    // Write claims resolve from the tool call's input path.
    assert.equal(rec.writes.length, 1)
    assert.equal(rec.writes[0].tool, 'edit')
    assert.equal(rec.writes[0].claimedPath, 'src/App.jsx')
    assert.equal(rec.writes[0].claimSource, 'args')
    assert.equal(rec.writes[0].exists, true)
  })

  it('debug off: the same turn shape writes NO record and creates no file', async () => {
    delete process.env.AI_LIVE_CHAT_DEBUG
    fs.rmSync(debugFile, { force: true })
    fs.writeFileSync(scenarioPath, JSON.stringify([[textStep('All good.')]]))
    const events = await runTurn('say something', 'files')
    assert.equal(events.filter((e) => e.type === 'done').length, 1)
    assert.equal(fs.existsSync(debugFile), false, 'no debug file with the flag off')
  })
})
