import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setEnvPath } from './env.js'

/**
 * Agent model resolution (provider cluster): the active connection
 * wins when usable; a probe-failed connection is never used; the
 * text modality default — previously storage the agent never read —
 * rescues the turn when the active connection is unusable.
 */

const KEY_A = 'sk-' + 'connatest12345'
const KEY_B = 'sk-or-' + 'v1-connbtest123'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-resolve-test-'))
const envFile = path.join(dir, '.env')

let A = ''
let B = ''

before(() => {
  fs.writeFileSync(envFile, '')
  setEnvPath(envFile)
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL
})

test('setup: two verified connections, A active, text default on B', async () => {
  const { upsertConnection, setModalityDefaults, publicStore } = await import('./connections.js')
  const a = upsertConnection({
    presetId: 'openai', model: 'gpt-4o', key: KEY_A,
    verifiedModels: [{ id: 'gpt-4o', modalities: ['text'] }],
  })
  const b = upsertConnection({
    presetId: 'openrouter', model: 'anthropic/claude-sonnet-4.5', key: KEY_B,
    verifiedModels: [{ id: 'anthropic/claude-sonnet-4.5', modalities: ['text'] }],
  })
  A = a.id
  B = b.id
  setModalityDefaults({ text: { connectionId: B, model: 'anthropic/claude-sonnet-4.5' } })
  assert.equal(publicStore().activeId, A)
})

test('the usable active connection wins over the text default', async () => {
  const { resolveConnectionModel } = await import('./connections.js')
  assert.equal(resolveConnectionModel()?.id, 'openai/gpt-4o')
})

test('a failed active connection falls back to the text modality default', async () => {
  const { recordProbe, resolveConnectionModel, resolveAgentContextWindow } = await import('./connections.js')
  recordProbe(A, [], false)
  const resolved = resolveConnectionModel()
  assert.equal(resolved?.id, 'openai/anthropic/claude-sonnet-4.5')
  assert.equal(resolveAgentContextWindow(), 200_000)
})

test('when active and default are both failed, resolution gives up to the env fallback', async () => {
  const { recordProbe, resolveConnectionModel, resolveAgentContextWindow } = await import('./connections.js')
  recordProbe(B, [], false)
  assert.equal(resolveConnectionModel(), null)
  process.env.OPENAI_MODEL = 'mystery-9000'
  assert.equal(resolveAgentContextWindow(), undefined)
  delete process.env.OPENAI_MODEL
})

test('a failed active connection is skipped even when it is re-activated', async () => {
  const { recordProbe, activateConnection, setModalityDefaults, resolveConnectionModel } = await import('./connections.js')
  recordProbe(A, [{ id: 'gpt-4o', modalities: ['text'] }], true)
  setModalityDefaults({ text: { connectionId: A, model: 'gpt-4o' } })
  activateConnection(B)
  // B is active but failed; the default (A, verified) serves the turn.
  assert.equal(resolveConnectionModel()?.id, 'openai/gpt-4o')
})
