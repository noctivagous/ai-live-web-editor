import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { ChatSseResponse, ChatStreamEvent } from '../chatStream.js'

/**
 * Slice 6 integration: the verify gate + console arc on the
 * OpenCode path, driven end to end through the REAL translator.
 *
 * Two stubs stand in for the two processes the topology needs:
 * - a stub "opencode" binary (OPENCODE_BIN): speaks just enough
 *   of the v2 server protocol (info/session/prompt/event) and
 *   plays a scripted scenario per prompt — tool calls, text, and
 *   side effects (plant a console entry on the page, declare a
 *   console expectation through the real HTTP endpoint). Every
 *   prompt it receives is recorded, so tests can prove the gate
 *   follow-up is a second prompt in the SAME session.
 * - a stub page server (VITE_ORIGIN): answers the page bridge's
 *   HTTP fallback for console / layout-snapshot / eval, exactly
 *   like a plugin-hosted Vite process would — including the
 *   check-frames topology limit (the mount eval succeeds, the
 *   frames register with the page's own server), so gated turns
 *   honestly carry the FRAMES_REMOTE_NOTE in unverified.
 *
 * VITE_ORIGIN is read when pageBridge.js first evaluates, so all
 * app modules are imported dynamically in before(), after env.
 */

type Mod = typeof import('./chat.js')
type SettingsMod = typeof import('../agentSettings.js')

const STUB_BINARY = `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const sseClients = new Set()
let promptCount = 0
let scenarioMtime = 0
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
    } else if (step.declare) {
      await fetch(process.env.STUB_API_URL + '/api/console/expect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: step.declare }),
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
  // Slice 7: the translator switches the session agent and PATCHes
  // per-turn permissions before every prompt. Accept both (204,
  // like the real server); the slice-7 harness records them.
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
      let text = ''
      try { text = JSON.parse(body).text || '' } catch { /* keep empty */ }
      // A rewritten scenario file starts a new turn sequence: the
      // per-prompt script index restarts with it.
      try {
        const content = fs.readFileSync(process.env.STUB_SCENARIO_FILE, 'utf8')
        let h = 0
        for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0
        if (h !== scenarioMtime) { scenarioMtime = h; promptCount = 0 }
      } catch { /* keep counting */ }
      const index = promptCount
      promptCount += 1
      fs.appendFileSync(process.env.STUB_PROMPTS_FILE, JSON.stringify({ sessionID: decodeURIComponent(promptMatch[1]), text }) + '\\n')
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

describe('opencode translator: verify gate + console arc (slice 6)', () => {
  let chat: Mod
  let settings: SettingsMod
  let stopServer: () => void
  let baseDir: string
  let projectDir: string
  let pageServer: http.Server
  let apiServer: http.Server
  let watermarksPath: string
  let promptsPath: string
  let scenarioPath: string
  const ring: RingEntry[] = []
  let ringSeq = 0
  const plant = (level: string, text: string) => {
    ring.push({ seq: ++ringSeq, level, text, ts: Date.now() })
  }

  before(async () => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-chatgate-'))
    projectDir = path.join(baseDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'App.jsx'), 'export default function App() { return null }\n')
    promptsPath = path.join(baseDir, 'prompts.jsonl')
    scenarioPath = path.join(baseDir, 'scenario.json')
    fs.writeFileSync(promptsPath, '')
    fs.writeFileSync(scenarioPath, '[]')

    // Stub page (the project's own server in the real topology).
    pageServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        let payload: Record<string, unknown> = {}
        try { payload = JSON.parse(body || '{}') } catch { /* empty */ }
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/__plant') {
          plant(String(payload.level || 'log'), String(payload.text || ''))
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

    // Env + settings + watermarks all live in the temp dir.
    const envMod = await import('../env.js')
    envMod.setEnvPath(path.join(baseDir, '.env'))
    settings = await import('../agentSettings.js')
    settings.setAgentSettingsPath(path.join(baseDir, 'agent-settings.json'))
    const watermarks = await import('../verify/consoleWatermarks.js')
    watermarksPath = path.join(baseDir, 'console-watermarks.json')
    watermarks.setConsoleWatermarksPath(watermarksPath)
    const launcher = await import('../launcher.js')
    launcher.setFsRoot(projectDir)

    // The API app (the stub binary declares expectations through
    // its real /api/console/expect endpoint).
    const { createApiApp } = await import('../apiApp.js')
    const api = createApiApp()
    apiServer = await new Promise<http.Server>((resolve) => {
      const s = api.listen(0, '127.0.0.1', () => resolve(s))
    })
    const apiPort = (apiServer.address() as { port: number }).port
    process.env.STUB_API_URL = `http://127.0.0.1:${apiPort}`

    settings.saveAgentSettings({ chatEngine: 'opencode', consoleCheck: true })
    const connections = await import('../connections.js')
    const conn = connections.upsertConnection({
      presetId: 'meta', name: 'Stub', model: 'stub-model', key: 'sk-' + 'stubkey123456',
    })
    connections.activateConnection(conn.id)

    // The stub opencode binary.
    const binPath = path.join(baseDir, 'opencode-stub.cjs')
    fs.writeFileSync(binPath, STUB_BINARY, { mode: 0o755 })
    process.env.OPENCODE_BIN = binPath
    process.env.STUB_PROMPTS_FILE = promptsPath
    process.env.STUB_SCENARIO_FILE = scenarioPath
    delete process.env.AI_LIVE_VERIFY

    chat = await import('./chat.js')
    const supervisor = await import('./supervisor.js')
    stopServer = supervisor.stopOpencodeServer
  })

  after(async () => {
    try { stopServer() } catch { /* never started */ }
    await new Promise((resolve) => apiServer.close(resolve))
    await new Promise((resolve) => pageServer.close(resolve))
    delete process.env.OPENCODE_BIN
    delete process.env.VITE_ORIGIN
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  /* Script builders: one script per prompt the stub will receive. */
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

  const prepare = (scripts: unknown[][]) => {
    fs.writeFileSync(scenarioPath, JSON.stringify(scripts))
    fs.writeFileSync(promptsPath, '')
    ring.length = 0
    fs.rmSync(watermarksPath, { force: true })
  }
  const readPrompts = () => fs.readFileSync(promptsPath, 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { sessionID: string, text: string })
  const doneOf = (events: ChatStreamEvent[]) => {
    const dones = events.filter((e) => e.type === 'done')
    assert.equal(dones.length, 1, 'exactly one done event per client turn')
    return dones[0] as Extract<ChatStreamEvent, { type: 'done' }>
  }

  it('error finding: full console detail on done + ONE follow-up prompt in the same session', async () => {
    prepare([
      [EDIT, { plant: { level: 'error', text: 'TypeError: boom in App' } }, textStep('Edited the app.')],
      [textStep('Fixed the boom.')],
    ])
    const events = await runTurn('change the app', 'files')
    const prompts = readPrompts()
    assert.equal(prompts.length, 2, 'the gate follow-up is a second prompt')
    assert.equal(prompts[0].sessionID, prompts[1].sessionID, 'same session')
    assert.match(prompts[1].text, /TypeError: boom in App/, 'the follow-up carries the gate prompt with the finding')
    const texts = events.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text).join('')
    assert.match(texts, /Fixed the boom\./, 'follow-up events fold into the same client turn')
    const done = doneOf(events)
    assert.equal(events[events.length - 1], done, 'the single done is the last event')
    const v = done.verification!
    assert.equal(v.ran, true)
    assert.equal(v.followUp, true)
    assert.equal(v.newConsole, 1)
    assert.ok(v.unverified?.some((u) => u.includes('per-width checks unavailable')), 'frames honesty note rides along')
    assert.equal(v.console?.errorTotal, 1)
    assert.match(v.console!.errors[0].text, /boom in App/)
    assert.equal(v.console?.editorCount, 0)
  })

  it('warning-only: detail present, NO follow-up (warnings are reported, never chased)', async () => {
    prepare([
      [EDIT, { plant: { level: 'warn', text: 'Warning: deprecated thing' } }, textStep('Edited.')],
    ])
    const events = await runTurn('change the app', 'files')
    assert.equal(readPrompts().length, 1)
    const v = doneOf(events).verification!
    assert.equal(v.followUp, false)
    assert.equal(v.console?.warningTotal, 1)
    assert.match(v.console!.warnings[0].text, /deprecated thing/)
    assert.equal(v.console?.errorTotal, 0)
  })

  it('consoleCheck off: no console detail, no console follow-up', async () => {
    settings.saveAgentSettings({ consoleCheck: false })
    try {
      prepare([
        [EDIT, { plant: { level: 'error', text: 'TypeError: unseen while off' } }, textStep('Edited.')],
      ])
      const events = await runTurn('change the app', 'files')
      assert.equal(readPrompts().length, 1)
      const v = doneOf(events).verification!
      assert.equal(v.console, undefined, 'no console detail rides the done event')
      assert.equal(v.newConsole, undefined, 'console findings stay out of the summary')
      assert.equal(v.followUp, false)
    } finally {
      settings.saveAgentSettings({ consoleCheck: true })
    }
  })

  it('since-last-chat: an error planted BETWEEN turns shows in the next turn’s group', async () => {
    prepare([[textStep('hello')], [textStep('again')]])
    const first = await runTurn('say hi', 'files')
    assert.equal(doneOf(first).verification?.console, undefined, 'a quiet first turn reports nothing')
    plant('error', 'between turns crash')
    const second = await runTurn('say hi again', 'files')
    const v = doneOf(second).verification!
    assert.equal(v.console?.sinceLastChatTotal, 1)
    assert.match(v.console!.sinceLastChat[0].text, /between turns crash/)
    assert.equal(v.console?.errorTotal, 0, 'it is not counted as this turn’s error')
  })

  it('missing expectation on a write turn fires the follow-up and lands in the detail', async () => {
    prepare([
      [EDIT, { declare: 'EXPECTED-TAG-6' }, textStep('Planted and declared.')],
      [textStep('Investigating the missing tag.')],
    ])
    const events = await runTurn('plant the probe', 'files')
    const prompts = readPrompts()
    assert.equal(prompts.length, 2, 'a missing expectation triggers the follow-up on its own')
    assert.match(prompts[1].text, /EXPECTED-TAG-6/)
    const v = doneOf(events).verification!
    assert.equal(v.followUp, true)
    assert.deepEqual(v.console?.expectations, [{ text: 'EXPECTED-TAG-6', matched: false }])
  })

  it('matched expectation: reported matched in the detail, no follow-up', async () => {
    prepare([
      [EDIT, { declare: 'PLANTED-TAG-6' }, { plant: { level: 'log', text: 'boot: PLANTED-TAG-6 ok' } }, textStep('Done.')],
    ])
    const events = await runTurn('plant the probe', 'files')
    assert.equal(readPrompts().length, 1)
    const v = doneOf(events).verification!
    assert.equal(v.followUp, false)
    assert.equal(v.console?.expectations.length, 1)
    assert.equal(v.console?.expectations[0].matched, true)
    assert.match(v.console?.expectations[0].matchedText ?? '', /PLANTED-TAG-6 ok/)
  })

  it('sketch turn: console detail attaches, the gate does not run', async () => {
    prepare([
      [{ plant: { level: 'error', text: 'sketch page error' } }, textStep('Drew it.')],
    ])
    const events = await runTurn('draw a red circle on the page', 'sketch')
    assert.equal(readPrompts().length, 1)
    const v = doneOf(events).verification!
    assert.equal(v.ran, false, 'no gate in sketch mode')
    assert.equal(v.skipped, undefined)
    assert.equal(v.console?.errorTotal, 1)
    assert.match(v.console!.errors[0].text, /sketch page error/)
  })
})
