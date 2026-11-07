import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LibSQLStore } from '@mastra/libsql'

// Point the store at a temp file BEFORE the module under test is loaded,
// so test runs never touch the real `.ai-live/mastra.db`.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastra-storage-test-'))
process.env.AI_LIVE_STORAGE = path.join(tmp, 'test.db')

const { mastra, storageUrl } = await import('./index.js')

describe('mastra storage', () => {
  before(() => {
    assert.ok(fs.existsSync(tmp), 'store dir should exist after import')
  })

  it('uses a persistent LibSQL store, not the in-memory fallback', () => {
    const storage = mastra.getStorage()
    assert.ok(storage, 'mastra should configure storage')
    assert.ok(
      storage instanceof LibSQLStore,
      `expected LibSQLStore, got ${storage?.constructor?.name}`,
    )
  })

  it('honours the AI_LIVE_STORAGE override', () => {
    assert.equal(storageUrl(), `file:${path.join(tmp, 'test.db')}`)
  })
})
