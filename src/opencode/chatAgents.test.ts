import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { FILE_CORE_TOOLS, SKETCH_ACTIVE_TOOLS } from '../agentTools.js'
import type { ChatSseResponse, ChatStreamEvent } from '../chatStream.js'

/**
 * Slice 7 integration: ALE agents + per-turn gating + brief
 * composition in the OpenCode translator, driven end to end
 * through the REAL translator against a RECORDING stub binary.
 *
 * The stub speaks the slice-1 protocol surface plus slice 7's
 * additions — session create (records the agent), agent switch
 * (records), session PATCH (records the permission rules) — and
 * plays scripted event scenarios per prompt, the chatGate.test.ts
 * pattern. The assertions read the RECORD: which agent each turn
 * ran under, the exact deny set PATCHed before each prompt, and
 * the prompt text the brief assembly produced. A stub page server
 * (VITE_ORIGIN) stands in for the project's own server so the
 * console capture and the verify gate run for real.
 *
 * The four tests share one session on purpose: the translator
 * keeps one session per project root, so agent SWITCHING (not
 * just creation) is part of what's proven.
 */

type Mod = typeof import('./chat.js')
type SettingsMod = typeof import('../agentSettings.js')

const STUB_BINARY = `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const sseClients = new Set()
let promptCount = 0
let scenarioHash = 0
function record(entry) {
  fs.appendFileSync(process.env.STUB_RECORDS_FILE, JSON.stringify(entry) + '\\n')
}
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
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let parsed = {}
    try { parsed = JSON.parse(body || '{}') } catch { /* empty */ }
    if (req.method === 'GET' && url.pathname === '/api/info') {
      res.end(JSON.stringify({ ok: true, version: '2.2.6-stub' }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/event') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': open\\n\\n')
      sseClients.add(res)
      // Deregister on the RESPONSE's close: this stub consumes
      // every request body, so the request's own 'close' fires as
      // soon as its (empty) body is read — long before the stream
      // ends. (chatGate's stub never reads bodies and can use the
      // request event; here it would drop the client instantly.)
      res.on('close', () => sseClients.delete(res))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/session') {
      record({ kind: 'create', agent: parsed.agent || null, model: parsed.model?.providerID || null })
      res.end(JSON.stringify({ data: { id: 'ses-stub-1' } }))
      return
    }
    const switchMatch = url.pathname.match(/^\\/api\\/session\\/([^/]+)\\/agent$/)
    if (req.method === 'POST' && switchMatch) {
      record({ kind: 'switch', agent: parsed.agent || null })
      res.statusCode = 204
      res.end()
      return
    }
    const patchMatch = url.pathname.match(/^\\/api\\/session\\/([^/]+)$/)
    if (req.method === 'PATCH' && patchMatch) {
      record({ kind: 'patch', permissions: parsed.permissions || [] })
      res.statusCode = 204
      res.end()
      return
    }
    const promptMatch = url.pathname.match(/^\\/api\\/session\\/([^/]+)\\/prompt$/)
    if (req.method === 'POST' && promptMatch) {
      try {
        const content = fs.readFileSync(process.env.STUB_SCENARIO_FILE, 'utf8')
        let h = 0
        for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0
        if (h !== scenarioHash) { scenarioHash = h; promptCount = 0 }
      } catch { /* keep counting */ }
      const index = promptCount
      promptCount += 1
      record({ kind: 'prompt', text: parsed.text || '' })
      res.end(JSON.stringify({ data: {} }))
      setTimeout(() => { void runScript(decodeURIComponent(promptMatch[1]), index) }, 30)
      return
    }
    if (req.method === 'POST' && /\\/interrupt$/.test(url.pathname)) { res.end('{}'); return }
    res.statusCode = 404
    res.end('{}')
  })
})
server.listen(port, '127.0.0.1')
`

interface RingEntry { seq: number, level: string, text: string, ts: number }
interface RecordEntry {
  kind: 'create' | 'switch' | 'patch' | 'prompt'
  agent?: string | null
  model?: string | null
  permissions?: Array<{ action: string, resource: string, effect: string }>
  text?: string
}

describe('opencode translator: ALE agents + per-turn gating (slice 7)', () => {
  let chat: Mod
  let settings: SettingsMod
  let stopServer: () => void
  let baseDir: string
  let recordsPath: string
  let scenarioPath: string
  let watermarksPath: string
  let pageServer: http.Server
  const ring: RingEntry[] = []
  let ringSeq = 0
  const plant = (level: string, text: string) => {
    ring.push({ seq: ++ringSeq, level, text, ts: Date.now() })
  }

  before(async () => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-chatagents-'))
    const projectDir = path.join(baseDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'App.jsx'), 'export default function App() { return null }\n')
    recordsPath = path.join(baseDir, 'records.jsonl')
    scenarioPath = path.join(baseDir, 'scenario.json')
    fs.writeFileSync(recordsPath, '')
    fs.writeFileSync(scenarioPath, '[]')

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

    const envMod = await import('../env.js')
    envMod.setEnvPath(path.join(baseDir, '.env'))
    settings = await import('../agentSettings.js')
    settings.setAgentSettingsPath(path.join(baseDir, 'agent-settings.json'))
    const watermarks = await import('../verify/consoleWatermarks.js')
    watermarksPath = path.join(baseDir, 'console-watermarks.json')
    watermarks.setConsoleWatermarksPath(watermarksPath)
    const launcher = await import('../launcher.js')
    launcher.setFsRoot(projectDir)

    // Slice 8: the deny-set pins below are written against the
    // FULL tool universe, so all three override toggles are on
    // for the shared session's turns (the supervisor's stub spawn
    // registers every group). The final test flips them off and
    // pins the shrunk universe.
    settings.saveAgentSettings({
      chatEngine: 'opencode', consoleCheck: true,
      aleFsTools: true, aleWebTools: true, aleSkillTools: true,
    })
    const connections = await import('../connections.js')
    const conn = connections.upsertConnection({
      presetId: 'meta', name: 'Stub', model: 'stub-model', key: 'sk-' + 'stubkey123456',
    })
    connections.activateConnection(conn.id)

    const binPath = path.join(baseDir, 'opencode-stub.cjs')
    fs.writeFileSync(binPath, STUB_BINARY, { mode: 0o755 })
    process.env.OPENCODE_BIN = binPath
    process.env.STUB_RECORDS_FILE = recordsPath
    process.env.STUB_SCENARIO_FILE = scenarioPath
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
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  const textStep = (text: string) => ({
    events: [
      { type: 'session.text.delta', data: { delta: text } },
      { type: 'session.step.ended', data: { tokens: { input: 10, output: 5 } } },
    ],
  })
  const EDIT = {
    events: [
      { type: 'session.tool.input.started', data: { id: 'call-edit', name: 'edit' } },
      { type: 'session.tool.called', data: { id: 'call-edit', input: { path: 'src/App.jsx', oldString: 'null', newString: 'null' } } },
      { type: 'session.tool.success', data: { id: 'call-edit', content: [{ type: 'text', text: 'ok' }] } },
      { type: 'session.step.ended', data: { tokens: { input: 10, output: 5 } } },
    ],
  }

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

  /** Reset the record + scenario for one client turn. */
  const prepare = (scripts: unknown[][]) => {
    fs.writeFileSync(scenarioPath, JSON.stringify(scripts))
    fs.writeFileSync(recordsPath, '')
    ring.length = 0
    fs.rmSync(watermarksPath, { force: true })
  }
  const readRecords = (): RecordEntry[] => fs.readFileSync(recordsPath, 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as RecordEntry)
  const denyActions = (rec: RecordEntry) => (rec.permissions ?? []).map((p) => p.action)
  const doneOf = (events: ChatStreamEvent[]) => {
    const dones = events.filter((e) => e.type === 'done')
    assert.equal(dones.length, 1, 'exactly one done event per client turn')
    return dones[0] as Extract<ChatStreamEvent, { type: 'done' }>
  }

  it('files turn: session created under ale-files, core-set patch, brief-led prompt', async () => {
    prepare([[textStep('Added the button.')]])
    const events = await runTurn('add a button component please', 'files')
    doneOf(events)
    const records = readRecords()
    assert.deepEqual(records.map((r) => r.kind), ['create', 'patch', 'prompt'])
    assert.equal(records[0].agent, 'ale-files', 'the session is created under the files agent')
    const denied = denyActions(records[1])
    for (const tool of FILE_CORE_TOOLS) assert.ok(!denied.includes(tool), `core tool ${tool} must not be denied`)
    assert.ok(!denied.includes('find-component'), 'catalog group joined on the ask’s evidence')
    assert.ok(!denied.includes('console-expect'), 'console-expect rides when console checking is on')
    assert.ok(denied.includes('patch-dom'), 'sketch-only tools are denied')
    assert.ok(denied.includes('eval-js'), 'sketch-only tools are denied')
    assert.ok(denied.includes('feature-query'), 'no graph evidence: the feature group stays denied')
    assert.ok(denied.includes('web-search'), 'no research evidence: the research group stays denied')
    const prompt = records[2].text ?? ''
    assert.ok(prompt.includes('Project type:'), 'the project brief leads the prompt')
    assert.ok(prompt.endsWith('add a button component please'), 'the user text closes the prompt')
    assert.ok(!prompt.includes('Live sketch mode is ON'), 'no sketch preamble on a files turn')
  })

  it('sketch turn: the shared session switches to ale-sketch and the write tools are denied', async () => {
    prepare([[textStep('Made the heading bigger.')]])
    const events = await runTurn('make the heading bigger', 'sketch')
    doneOf(events)
    const records = readRecords()
    assert.deepEqual(records.map((r) => r.kind), ['switch', 'patch', 'prompt'], 'no new session: the shared one switches agent')
    assert.equal(records[0].agent, 'ale-sketch')
    const denied = denyActions(records[1])
    for (const tool of SKETCH_ACTIVE_TOOLS) assert.ok(!denied.includes(tool), `sketch tool ${tool} must not be denied`)
    assert.ok(!denied.includes('console-expect'))
    for (const tool of ['write-real-file', 'str-replace', 'delete-file', 'feature-add-node', 'data-set', 'doc-set-text', 'plan-finish', 'grep']) {
      assert.ok(denied.includes(tool), `${tool} must be denied in sketch`)
    }
    const prompt = records[2].text ?? ''
    assert.ok(prompt.startsWith('Live sketch mode is ON.'), 'the sketch preamble leads the prompt')
    assert.ok(prompt.includes('Project type:'), 'the brief rides on sketch turns too')
    assert.ok(prompt.endsWith('make the heading bigger'))
  })

  it('files turn after sketch: the session switches back and the patch is files-shaped again', async () => {
    prepare([[textStep('Fixed the readme.')]])
    const events = await runTurn('fix the readme markdown', 'files')
    doneOf(events)
    const records = readRecords()
    assert.deepEqual(records.map((r) => r.kind), ['switch', 'patch', 'prompt'])
    assert.equal(records[0].agent, 'ale-files')
    const denied = denyActions(records[1])
    assert.ok(denied.includes('patch-dom'), 'patch-dom is denied again back in files')
    assert.ok(!denied.includes('doc-set-text'), 'the doc group joined on the ask’s evidence')
    const prompt = records[2].text ?? ''
    assert.ok(!prompt.includes('Live sketch mode is ON'))
    assert.ok(prompt.endsWith('fix the readme markdown'))
  })

  it('gate follow-up: gated as its own files turn (second patch before the follow-up prompt)', async () => {
    prepare([
      [EDIT, { plant: { level: 'error', text: 'TypeError: boom in App' } }, textStep('Edited the app.')],
      [textStep('Fixed the boom.')],
    ])
    const events = await runTurn('change the app', 'files')
    const done = doneOf(events)
    assert.equal(done.verification?.followUp, true, 'the gate still runs end to end (slice-6 regression)')
    const records = readRecords()
    assert.deepEqual(
      records.map((r) => r.kind),
      ['patch', 'prompt', 'patch', 'prompt'],
      'no switch (same agent), but each prompt is preceded by its own permission patch',
    )
    const followDenied = denyActions(records[2])
    assert.ok(followDenied.includes('patch-dom'), 'the follow-up patch is files-shaped')
    assert.ok(!followDenied.includes('get-console'), 'the follow-up keeps the console tools')
    assert.match(records[3].text ?? '', /Automatic verification found new issues/, 'the follow-up prompt is the gate prompt, ungated-brief-free')
    assert.ok(!(records[3].text ?? '').includes('Project type:'), 'no per-turn brief on the follow-up, mirroring the Mastra follow-up payload')
  })

  it('overrides off: the patch is computed over the shrunk registered universe (slice 8)', async () => {
    settings.saveAgentSettings({ aleFsTools: false, aleWebTools: false, aleSkillTools: false })
    prepare([[textStep('All native now.')]])
    const events = await runTurn('make the heading bigger', 'sketch')
    doneOf(events)
    const records = readRecords()
    const patch = records.find((r) => r.kind === 'patch')
    assert.ok(patch, 'the turn still PATCHes its permissions')
    const denied = denyActions(patch)
    // The override groups are not registered in this spawn, so
    // they are absent from the policy entirely — neither offered
    // nor denied. Unconditional tools keep their slice-7 shape.
    for (const tool of ['write-real-file', 'str-replace', 'grep', 'web-search', 'fetch-page', 'research', 'read-skill']) {
      assert.ok(!denied.includes(tool), `${tool} is unregistered with its override off — no deny rule is computed for it`)
    }
    assert.ok(denied.includes('feature-add-node'), 'unconditional groups are still denied in sketch')
    assert.ok(denied.includes('data-set'), 'unconditional groups are still denied in sketch')
    for (const tool of SKETCH_ACTIVE_TOOLS) assert.ok(!denied.includes(tool), `sketch tool ${tool} must not be denied`)
  })

  it('connection switch: the cached session is recreated under the new provider (slice 8)', async () => {
    const connections = await import('../connections.js')
    const conn2 = connections.upsertConnection({
      presetId: 'meta', name: 'Stub2', model: 'stub-model', key: 'sk-' + 'stubkey22222',
    })
    connections.activateConnection(conn2.id)
    prepare([[textStep('Hello from the new connection.')]])
    const events = await runTurn('say hello', 'files')
    doneOf(events)
    const records = readRecords()
    // The session a connection-A turn created names provider
    // ale-stub; its model is fixed at creation and the respawned
    // server no longer serves that provider. The translator must
    // create a FRESH session under the new provider instead of
    // patching/prompting the stale one (which fails its turns
    // with "Model unavailable" over the event bus).
    assert.equal(records[0].kind, 'create', 'a fresh session is created, not a switch/patch on the stale one')
    assert.equal(records[0].model, 'ale-stub2')
    assert.equal(records[0].agent, 'ale-files')
  })
})
