import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { EXPECTED_SCHEMA_FINGERPRINT, type MuseClient } from '@muse-code/sdk'
import type { ChatSseResponse, ChatStreamEvent } from '../chatStream.js'
import { setFsRoot } from '../launcher.js'
import { setAgentSettingsPath } from '../agentSettings.js'
import { setAleSkillInstallRunner } from '../mcpserver/skills.js'
import { resetMuseCodeAvailabilityCache } from './availability.js'
import { musecodeHostSlots, pipeMusecodeChatStream, setMusecodeHostSlots } from './chat.js'
import { resetMusecodeSupervisor, setMusecodeSpawner } from './supervisor.js'
import { musecodeUnavailableMessage } from './unavailable.js'

function fakeRes(): { res: ChatSseResponse; events: () => ChatStreamEvent[] } {
  const writes: string[] = []
  const res = {
    setHeader: () => { /* no-op */ },
    write: (chunk: string) => { writes.push(chunk); return true },
    end: () => { /* the tests read the writes */ },
  } as unknown as ChatSseResponse
  return {
    res,
    events: () => writes
      .filter((w) => w.startsWith('data: '))
      .map((w) => JSON.parse(w.slice('data: '.length)) as ChatStreamEvent),
  }
}

/** A fake host whose session streams two revisions of one agent
 * message and settles completed with usage — the pipe's whole
 * path (availability → posture → session → translator → done)
 * with no model call. */
function fakeTurnSpawner(): void {
  // The pipe's lazy skill install (§12) must not shell out to
  // the real Muse CLI from tests: a no-op runner that reports
  // every skill installed.
  setAleSkillInstallRunner(async () => ({ stdout: JSON.stringify({ installed: { id: 'stub' } }), stderr: '' }))
  // The install pass writes its hash manifest beside the agent
  // settings — keep test runs out of the repo tree.
  setAgentSettingsPath(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-settings-')), 'agent-settings.json'))
  setMusecodeSpawner({
    spawn: async () => {
      const session = {
        sessionId: 'sess-pipe-1',
        onApprovalError: () => { /* the supervisor registers a logger */ },
        fold: { pendingUserInputs: () => [] },
        sendUserTurn: async () => ({
          turnId: 'turn-1',
          items: async function* () {
            yield { itemId: 'm1', kind: 'agentMessage', status: 'inProgress', revision: 1, text: 'Hel' }
            yield { itemId: 'm1', kind: 'agentMessage', status: 'completed', revision: 2, text: 'Hello' }
          },
          completed: Promise.resolve({
            kind: 'completed',
            params: {
              terminal: 'completed', sessionId: 'sess-pipe-1', turnId: 'turn-1', viewCursor: '1',
              usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0 },
            },
          }),
          cancel: async () => ({}),
        }),
      }
      const client = {
        initializeResult: { schema: { fingerprint: EXPECTED_SCHEMA_FINGERPRINT, version: 1 } },
        exit: new Promise(() => { /* healthy host */ }),
        close: async () => { /* no-op */ },
        startSession: async () => session,
        resumeSession: async () => session,
      }
      return client as unknown as MuseClient
    },
  })
}

describe('musecode host slots', () => {
  afterEach(() => setMusecodeHostSlots({}))
  it('starts empty and round-trips what a later slice supplies', () => {
    assert.deepEqual(musecodeHostSlots(), {})
    setMusecodeHostSlots({ managedHooksPath: '/ale/hooks.json' })
    assert.equal(musecodeHostSlots().managedHooksPath, '/ale/hooks.json')
  })
})

describe('pipeMusecodeChatStream', () => {
  afterEach(() => {
    setMusecodeSpawner(null)
    setAleSkillInstallRunner(null)
    resetMusecodeSupervisor()
  })

  it('runs a full turn: status, streamed text, done with usage', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-pipe-'))
    setFsRoot(root)
    fakeTurnSpawner()
    const { res, events } = fakeRes()
    await pipeMusecodeChatStream([{ role: 'user', content: 'hello' }], res, {})
    const got = events()
    assert.equal(got[0].type, 'status')
    const deltas = got.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text)
    assert.deepEqual(deltas, ['Hel', 'lo'], 'the reply streams as revision diffs')
    const done = got[got.length - 1] as Extract<ChatStreamEvent, { type: 'done' }>
    assert.equal(done.type, 'done')
    assert.deepEqual(done.usage, { input: 10, output: 5, total: 15 })
  })

  it('with no binary on this machine, answers with the plain not-available message and nothing else', async () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-nobin-'))
    const savedHome = process.env.HOME
    const savedPath = process.env.PATH
    process.env.HOME = emptyHome
    process.env.PATH = emptyHome
    resetMuseCodeAvailabilityCache()
    try {
      const { res, events } = fakeRes()
      await pipeMusecodeChatStream([{ role: 'user', content: 'hello' }], res, {})
      const got = events()
      assert.equal(got.length, 1)
      assert.deepEqual(got[0], { type: 'error', error: musecodeUnavailableMessage(false) })
    } finally {
      process.env.HOME = savedHome
      process.env.PATH = savedPath
      resetMuseCodeAvailabilityCache()
      fs.rmSync(emptyHome, { recursive: true, force: true })
    }
  })
})
