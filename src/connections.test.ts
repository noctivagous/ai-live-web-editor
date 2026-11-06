import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setEnvPath } from './env.js'

const LEGACY_KEY = 'sk-' + 'legacytest1234'
const ROUTER_KEY = 'sk-or-' + 'v1-demo123456'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-test-'))
const envFile = path.join(dir, '.env')

before(() => {
  fs.writeFileSync(envFile, 'OPENAI_API_KEY=' + LEGACY_KEY + '\nOPENAI_MODEL=gpt-4o\n')
  setEnvPath(envFile)
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL
})

test('legacy triple migrates into a first connection', async () => {
  const { publicStore, resolveConnectionModel, hasValidConnection } = await import('./connections.js')
  const pub = publicStore()
  assert.equal(pub.connections.length, 1)
  const conn = pub.connections[0]
  assert.equal(conn.presetId, 'openai')
  assert.equal(conn.model, 'gpt-4o')
  assert.equal(conn.keyLast4, '1234')
  assert.equal(conn.hasKey, true)
  assert.equal(conn.active, true)
  assert.equal(pub.modalityDefaults.text?.model, 'gpt-4o')
  assert.equal(hasValidConnection(), true)
  const resolved = resolveConnectionModel()
  assert.equal(resolved?.id, 'openai/gpt-4o')
  assert.equal(resolved?.apiKey, 'sk-legacytest1234')
  // The key itself is stored per-connection in .env, never only in providers.json.
  const envText = fs.readFileSync(envFile, 'utf-8')
  assert.match(envText, /CONN_KEY_OPENAI=sk-legacytest1234/)
  const json = fs.readFileSync(path.join(dir, 'providers.json'), 'utf-8')
  assert.ok(!json.includes('sk-legacytest1234'), 'providers.json must not contain the full key')
})

test('a second connection can be added, activated, and removed', async () => {
  const { publicStore, upsertConnection, activateConnection, removeConnection, resolveConnectionModel } = await import('./connections.js')
  const c2 = upsertConnection({
    presetId: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5',
    key: 'sk-or-v1-demo123456',
    verifiedModels: [{ id: 'anthropic/claude-sonnet-4.5', modalities: ['text'] }],
  })
  assert.equal(c2.keyLast4, '3456')
  activateConnection(c2.id)
  assert.equal(resolveConnectionModel()?.id, 'openai/anthropic/claude-sonnet-4.5')
  // Mirror: the legacy triple now points at the active connection.
  assert.equal(process.env.OPENAI_API_KEY, 'sk-or-v1-demo123456')
  removeConnection(c2.id)
  const pub = publicStore()
  assert.equal(pub.connections.length, 1)
  assert.equal(pub.activeId, pub.connections[0].id)
})

test('modality defaults only accept verified models of that type', async () => {
  const { setModalityDefaults, publicStore } = await import('./connections.js')
  const conn = publicStore().connections[0]
  assert.throws(() => setModalityDefaults({ video: { connectionId: conn.id, model: 'gpt-4o' } }), /not a verified video model/)
  setModalityDefaults({ text: { connectionId: conn.id, model: 'gpt-4o' } })
  assert.equal(publicStore().modalityDefaults.text?.model, 'gpt-4o')
})
