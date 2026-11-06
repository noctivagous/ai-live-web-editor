import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createSnapshotAt,
  listSnapshotsAt,
  revertSnapshotAt,
  scopeAllows,
  SELF_SCOPE,
} from './selfMode.js'

test('scopeAllows confines writes to src/ui', () => {
  assert.equal(scopeAllows('src/ui'), true)
  assert.equal(scopeAllows('src/ui/components/Chat.tsx'), true)
  assert.equal(scopeAllows('src/server.ts'), false)
  assert.equal(scopeAllows('src/ui-other/x.ts'), false)
  assert.equal(scopeAllows('catalog/components.json'), false)
})

function tmpRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-live-self-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.mkdirSync(path.join(root, SELF_SCOPE), { recursive: true })
  fs.writeFileSync(path.join(root, SELF_SCOPE, 'app.txt'), 'original\n')
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside\n')
  git('add', '-A')
  git('commit', '-qm', 'init')
  return root
}

test('snapshot + revert restores the scope and removes agent-created files only inside it', async () => {
  const root = tmpRepo()
  const snap = await createSnapshotAt(root, 'turn')
  assert.ok(snap.hash)
  assert.equal(listSnapshotsAt(root).length, 1)

  // Simulate a turn: modify + delete + create inside the scope, modify outside.
  fs.writeFileSync(path.join(root, SELF_SCOPE, 'app.txt'), 'broken\n')
  fs.writeFileSync(path.join(root, SELF_SCOPE, 'new-file.txt'), 'agent made this\n')
  fs.writeFileSync(path.join(root, 'outside.txt'), 'changed outside\n')
  // Tooling caches inside the scope (Vite's dep cache) are not agent output.
  fs.mkdirSync(path.join(root, SELF_SCOPE, 'node_modules', '.vite'), { recursive: true })
  fs.writeFileSync(path.join(root, SELF_SCOPE, 'node_modules', '.vite', 'cache.json'), '{}\n')

  const result = await revertSnapshotAt(root, snap.hash)
  assert.equal(result.ok, true)
  assert.equal(fs.readFileSync(path.join(root, SELF_SCOPE, 'app.txt'), 'utf-8'), 'original\n')
  assert.equal(fs.existsSync(path.join(root, SELF_SCOPE, 'new-file.txt')), false)
  assert.equal(fs.existsSync(path.join(root, SELF_SCOPE, 'node_modules', '.vite', 'cache.json')), true)
  if (result.ok) assert.deepEqual(result.removed, ['src/ui/new-file.txt'])
  // Outside the scope nothing is touched.
  assert.equal(fs.readFileSync(path.join(root, 'outside.txt'), 'utf-8'), 'changed outside\n')
})

test('revert rejects hashes that were never recorded', async () => {
  const root = tmpRepo()
  const result = await revertSnapshotAt(root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  assert.equal(result.ok, false)
})

test('a clean tree snapshots as HEAD and revert is a no-op restore', async () => {
  const root = tmpRepo()
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim()
  const snap = await createSnapshotAt(root, 'clean')
  assert.equal(snap.hash, head)
  const result = await revertSnapshotAt(root, snap.hash)
  assert.equal(result.ok, true)
})
