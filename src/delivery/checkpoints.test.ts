import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createCheckpoint, maybeCheckpointAfterVerifiedTurn, readDeliverySettings, writeDeliverySettings } from './checkpoints.js'
import { gitLog, gitStatus } from './git.js'

function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-ckpt-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  git(['add', 'a.txt'])
  git(['commit', '-qm', 'first'])
  return dir
}

describe('checkpoints', () => {
  it('createCheckpoint commits the whole tree under the marker; a clean tree is a plain no-op', async () => {
    const dir = scratchRepo()
    const clean = await createCheckpoint(dir)
    assert.equal(clean.created, false)
    assert.match(clean.reason ?? '', /clean/)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'new\n')
    const made = await createCheckpoint(dir, 'after the fix')
    assert.equal(made.created, true)
    const status = await gitStatus(dir)
    assert.equal(status.clean, true)
    const entries = await gitLog(dir)
    assert.equal(entries[0].subject, 'ale-checkpoint: after the fix')
    assert.equal(entries[0].checkpoint, true)
  })

  it('the verified-turn door is shut until the project opts in', async () => {
    const dir = scratchRepo()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    assert.deepEqual(readDeliverySettings(dir), { agentCheckpoints: false })
    const shut = await maybeCheckpointAfterVerifiedTurn(dir)
    assert.equal(shut.created, false)
    assert.match(shut.reason ?? '', /not enabled/)
    writeDeliverySettings(dir, { agentCheckpoints: true })
    const open = await maybeCheckpointAfterVerifiedTurn(dir)
    assert.equal(open.created, true)
    const entries = await gitLog(dir)
    assert.equal(entries[0].subject, 'ale-checkpoint: verified turn')
  })
})
