import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { EXPECTED_SCHEMA_FINGERPRINT, type MuseClient, type Session } from '@muse-code/sdk'
import { museRunConfig, SANDBOX_POSTURES } from '../ui/lib/museSandbox.js'
import {
  ensureMusecodeHost, getOrStartMusecodeSession, musecodeServeArgs, musecodeSessionStartOptions,
  musecodeVersionNote, resetMusecodeSupervisor, resolveMusecodePosture, setMusecodeSpawner,
  type MusecodeSpawner,
} from './supervisor.js'

describe('musecodeServeArgs — posture → spawn flags', () => {
  it('unblocked: sandbox network + trust, never yolo, never sandbox-off', () => {
    const args = musecodeServeArgs(museRunConfig('unblocked'))
    assert.deepEqual(args, ['serve', '--sandbox-network', 'proxy-only', '--trust-workspace'])
  })

  it('strict: restricted network and NO trust flag', () => {
    const args = musecodeServeArgs(museRunConfig('strict'))
    assert.deepEqual(args, ['serve', '--sandbox-network', 'restricted'])
    assert.ok(!args.includes('--trust-workspace'))
  })

  it('no posture ever produces --yolo or --disable-sandbox', () => {
    for (const posture of SANDBOX_POSTURES) {
      const args = musecodeServeArgs(museRunConfig(posture))
      assert.ok(!args.includes('--yolo'), posture)
      assert.ok(!args.includes('--disable-sandbox'), posture)
    }
  })

  it('the managed-hooks slot lands as a -c entry at spawn', () => {
    const args = musecodeServeArgs(museRunConfig('sandboxed'), { managedHooksPath: '/ale/hooks.json' })
    assert.deepEqual(args.slice(-2), ['-c', 'managed_hooks_path="/ale/hooks.json"'])
    const bare = musecodeServeArgs(museRunConfig('sandboxed'))
    assert.ok(!bare.includes('-c'), 'no hooks file, no -c entry')
  })
})

describe('musecodeSessionStartOptions — session configuration generation', () => {
  it('carries the workspace and the posture’s approval mode per posture', () => {
    assert.equal(musecodeSessionStartOptions('/p', museRunConfig('unblocked')).approvalMode, 'allowAll')
    assert.equal(musecodeSessionStartOptions('/p', museRunConfig('sandboxed')).approvalMode, 'onRequest')
    assert.equal(musecodeSessionStartOptions('/p', museRunConfig('strict')).approvalMode, 'denyUnmatched')
    assert.equal(musecodeSessionStartOptions('/p', museRunConfig('unblocked')).workspaceRoot, '/p')
  })

  it('the MCP slot is absent when empty and verbatim when supplied (the spike’s shape)', () => {
    const bare = musecodeSessionStartOptions('/p', museRunConfig('unblocked'))
    assert.equal(bare.config, undefined)
    const withSlot = musecodeSessionStartOptions('/p', museRunConfig('unblocked'), {
      mcpServers: { aletest: { transport: 'stdio', command: 'node', args: ['/tmp/mcp-server.mjs'] } },
    })
    assert.deepEqual(withSlot.config, {
      mcpServers: { aletest: { transport: 'stdio', command: 'node', args: ['/tmp/mcp-server.mjs'] } },
    })
  })
})

describe('musecodeVersionNote — §14 drift record', () => {
  it('the tested version records no note', () => {
    assert.equal(musecodeVersionNote('1.4.15'), null)
  })
  it('a newer binary runs with a note', () => {
    assert.match(musecodeVersionNote('1.5.0') ?? '', /newer than the version this editor was tested with/)
  })
  it('an older binary runs with a note', () => {
    assert.match(musecodeVersionNote('1.3.9') ?? '', /older than the version this editor was tested with/)
  })
})

describe('resolveMusecodePosture — project override wins', () => {
  it('a project override resolves to itself; no override falls to the standing default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-posture-'))
    try {
      fs.writeFileSync(path.join(root, 'project.ai.json'), JSON.stringify({ museSandboxPosture: 'strict' }))
      assert.equal(resolveMusecodePosture(root), 'strict')
      fs.rmSync(path.join(root, 'project.ai.json'))
      // No project override: the device default of this test
      // process (fresh store → unset) resolves to 'unblocked'.
      assert.equal(resolveMusecodePosture(root), 'unblocked')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

/* ------------------------------------------------------------------ */
/* Lifecycle against a fake host (the spawn seam)                      */
/* ------------------------------------------------------------------ */

interface FakeClientShape {
  spawns: { args: string[] }[]
  starts: { opts: unknown }[]
  resumes: string[]
  closes: number
}

function fakeSpawner(shape: FakeClientShape, opts: { fingerprint?: string; exitNow?: boolean } = {}): MusecodeSpawner {
  return {
    spawn: async ({ args }) => {
      shape.spawns.push({ args })
      const client = {
        initializeResult: { schema: { fingerprint: opts.fingerprint ?? EXPECTED_SCHEMA_FINGERPRINT, version: 1 } },
        exit: opts.exitNow
          ? Promise.resolve({ kind: 'exited', code: 1 })
          : new Promise(() => { /* a healthy host does not exit */ }),
        close: async () => { shape.closes += 1 },
        startSession: async (startOpts: unknown) => {
          shape.starts.push({ opts: startOpts })
          return {
            sessionId: 'sess-fake-1',
            onApprovalError: () => { /* the supervisor registers a logger */ },
          } as unknown as Session
        },
        resumeSession: async ({ sessionId }: { sessionId: string }) => {
          shape.resumes.push(sessionId)
          return {
            sessionId,
            onApprovalError: () => { /* as above */ },
          } as unknown as Session
        },
      }
      return client as unknown as MuseClient
    },
  }
}

function freshShape(): FakeClientShape {
  return { spawns: [], starts: [], resumes: [], closes: 0 }
}

describe('musecode supervisor lifecycle (fake host)', () => {
  afterEach(() => {
    setMusecodeSpawner(null)
    resetMusecodeSupervisor()
  })

  it('spawns one host per project+posture and reuses it while the fingerprint holds', async () => {
    const shape = freshShape()
    setMusecodeSpawner(fakeSpawner(shape))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-host-'))
    const first = await ensureMusecodeHost(root)
    const second = await ensureMusecodeHost(root)
    assert.equal(shape.spawns.length, 1, 'the second ensure reuses the host')
    assert.equal(first.fingerprint, second.fingerprint)
    assert.equal(first.posture, 'unblocked')
    assert.ok(shape.spawns[0].args.includes('--trust-workspace'))
    // A posture-irrelevant slot change is no change; a hooks slot
    // change IS a fingerprint change and respawns.
    await ensureMusecodeHost(root, { managedHooksPath: '/ale/hooks.json' })
    assert.equal(shape.spawns.length, 2, 'a changed slot respawns the host')
    assert.ok(shape.spawns[1].args.includes('-c'))
  })

  it('starts a session with the posture’s approval mode and records the §14 facts', async () => {
    const shape = freshShape()
    setMusecodeSpawner(fakeSpawner(shape))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-session-'))
    const { session, record } = await getOrStartMusecodeSession(root, {
      mcpServers: { aletest: { transport: 'stdio', command: 'node', args: ['/tmp/mcp-server.mjs'] } },
    })
    assert.equal(session.sessionId, 'sess-fake-1')
    const startOpts = shape.starts[0].opts as { approvalMode: string; config?: { mcpServers: unknown } }
    assert.equal(startOpts.approvalMode, 'allowAll')
    assert.deepEqual(startOpts.config?.mcpServers, { aletest: { transport: 'stdio', command: 'node', args: ['/tmp/mcp-server.mjs'] } })
    assert.equal(record.posture, 'unblocked')
    assert.equal(record.approvalMode, 'allowAll')
    assert.equal(record.trustWorkspace, true)
    assert.equal(record.resumed, false)
    assert.ok(record.binaryVersion.length > 0, 'the binary version is recorded')
  })

  it('resumes the durable session on a fresh host after a respawn', async () => {
    const shape = freshShape()
    setMusecodeSpawner(fakeSpawner(shape))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-resume-'))
    await getOrStartMusecodeSession(root)
    // Force a respawn (slot change), then ask for the session
    // again: the new host resumes the durable id.
    await ensureMusecodeHost(root, { managedHooksPath: '/ale/hooks.json' })
    const { record } = await getOrStartMusecodeSession(root, { managedHooksPath: '/ale/hooks.json' })
    assert.deepEqual(shape.resumes, ['sess-fake-1'])
    assert.equal(record.resumed, true)
    assert.equal(record.sessionId, 'sess-fake-1')
  })

  it('a protocol fingerprint mismatch fails the start with a plain message', async () => {
    const shape = freshShape()
    setMusecodeSpawner(fakeSpawner(shape, { fingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-drift-'))
    await assert.rejects(
      () => ensureMusecodeHost(root),
      /session protocol has changed/,
    )
    assert.equal(shape.closes, 1, 'the drifted host is closed, not kept')
  })

  it('a host that keeps dying stops being respawned', async () => {
    const shape = freshShape()
    setMusecodeSpawner(fakeSpawner(shape, { exitNow: true }))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-muse-crash-'))
    for (let i = 0; i < 3; i++) {
      await ensureMusecodeHost(root)
      // Let the exit watcher retire the host + count the crash.
      await new Promise((r) => setTimeout(r, 10))
    }
    await assert.rejects(() => ensureMusecodeHost(root), /keeps stopping/)
  })
})
