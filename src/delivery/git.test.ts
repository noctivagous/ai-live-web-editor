import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  commitStaged, createBranch, draftCommitMessage, gitBranches, gitDiff, gitLog, gitStatus,
  gitWorktrees, isCheckpointSubject, parseGitLog, parsePorcelainV2, safeProjectPath,
  splitDiffHunks, stageFiles, stageHunks, switchBranch, unstageFiles, unstageHunks,
} from './git.js'

function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-git-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  git(['add', 'a.txt'])
  git(['commit', '-qm', 'first commit'])
  return dir
}

describe('parsePorcelainV2', () => {
  it('reads branch headers, ahead/behind, and splits staged / unstaged / untracked', () => {
    const out = [
      '# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 h h staged.txt',
      '1 .M N... 100644 100644 100644 h h dirty.txt',
      '1 MM N... 100644 100644 100644 h h both.txt',
      '? new.txt',
      '',
    ].join('\0')
    const s = parsePorcelainV2(out, '')
    assert.equal(s.branch, 'main')
    assert.equal(s.head, 'abc123')
    assert.equal(s.ahead, 2)
    assert.equal(s.behind, 1)
    assert.deepEqual(s.staged.map(c => c.path), ['staged.txt', 'both.txt'])
    assert.deepEqual(s.unstaged.map(c => c.path), ['dirty.txt', 'both.txt'])
    assert.deepEqual(s.untracked, ['new.txt'])
    assert.equal(s.clean, false)
  })

  it('keeps only the project subtree when the repo root is above the project', () => {
    const out = ['1 .M N... 100644 100644 100644 h h sub/kept.txt', '1 .M N... 100644 100644 100644 h h elsewhere.txt', ''].join('\0')
    const s = parsePorcelainV2(out, 'sub/')
    assert.deepEqual(s.unstaged.map(c => c.path), ['kept.txt'])
  })
})

describe('parseGitLog + checkpoints', () => {
  it('marks checkpoint subjects', () => {
    assert.equal(isCheckpointSubject('ale-checkpoint: after the fix'), true)
    assert.equal(isCheckpointSubject('a normal commit'), false)
    const entries = parseGitLog('h1\x1fs1\x1fA U Thor\x1f2026-01-01T00:00:00Z\x1fale-checkpoint: x\x1fHEAD -> main\x1e')
    assert.equal(entries.length, 1)
    assert.equal(entries[0].checkpoint, true)
  })
})

describe('git backend on a scratch repo', () => {
  it('status, log, branches, worktrees, and diff all read the real repo', async () => {
    const dir = scratchRepo()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'untracked\n')

    const status = await gitStatus(dir)
    assert.equal(status.isRepo, true)
    assert.equal(status.branch, 'main')
    assert.deepEqual(status.unstaged.map(c => c.path), ['a.txt'])
    assert.deepEqual(status.untracked, ['b.txt'])
    assert.equal(status.clean, false)

    const entries = await gitLog(dir)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].subject, 'first commit')

    const branches = await gitBranches(dir)
    assert.deepEqual(branches.map(b => [b.name, b.current]), [['main', true]])

    const worktrees = await gitWorktrees(dir)
    assert.equal(worktrees.length, 1)
    assert.equal(worktrees[0].current, true)
    assert.equal(worktrees[0].branch, 'main')

    const diff = await gitDiff(dir, 'a.txt', false)
    assert.match(diff, /\+two/)
  })

  it('a staged rename reports both paths', async () => {
    const dir = scratchRepo()
    execFileSync('git', ['mv', 'a.txt', 'renamed.txt'], { cwd: dir })
    const status = await gitStatus(dir)
    assert.equal(status.staged.length, 1)
    assert.equal(status.staged[0].path, 'renamed.txt')
    assert.equal(status.staged[0].origPath, 'a.txt')
  })

  it('a plain directory is honestly not a repo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-nogit-'))
    const status = await gitStatus(dir)
    assert.equal(status.isRepo, false)
  })

  it('safeProjectPath refuses escapes and absolute paths', () => {
    const dir = scratchRepo()
    assert.equal(safeProjectPath(dir, '../outside.txt'), null)
    assert.equal(safeProjectPath(dir, '/etc/passwd'), null)
    assert.equal(safeProjectPath(dir, 'a.txt'), 'a.txt')
    assert.equal(safeProjectPath(dir, 'sub/../a.txt'), 'sub/../a.txt')
  })
})

describe('git actions (slice 3)', () => {
  it('stage / unstage / commit move files through the states', async () => {
    const dir = scratchRepo()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n')
    fs.writeFileSync(path.join(dir, 'c.txt'), 'new\n')
    await stageFiles(dir, ['a.txt', 'c.txt'])
    let status = await gitStatus(dir)
    assert.deepEqual(status.staged.map(c => c.path).sort(), ['a.txt', 'c.txt'])
    await unstageFiles(dir, ['c.txt'])
    status = await gitStatus(dir)
    assert.deepEqual(status.staged.map(c => c.path), ['a.txt'])
    const { hash } = await commitStaged(dir, 'update a')
    assert.ok(hash.length >= 7)
    status = await gitStatus(dir)
    assert.equal(status.staged.length, 0)
    const entries = await gitLog(dir)
    assert.equal(entries[0].subject, 'update a')
  })

  it('hunk staging stages only the chosen hunk', async () => {
    const dir = scratchRepo()
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    fs.writeFileSync(path.join(dir, 'a.txt'), lines.join('\n') + '\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'thirty lines'], { cwd: dir })
    const changed = [...lines]
    changed[1] = 'line 2 CHANGED'
    changed[28] = 'line 29 CHANGED'
    fs.writeFileSync(path.join(dir, 'a.txt'), changed.join('\n') + '\n')
    const diff = await gitDiff(dir, 'a.txt', false)
    const { hunks } = splitDiffHunks(diff)
    assert.equal(hunks.length, 2)
    await stageHunks(dir, 'a.txt', [0])
    const status = await gitStatus(dir)
    assert.deepEqual(status.staged.map(c => c.path), ['a.txt'])
    assert.deepEqual(status.unstaged.map(c => c.path), ['a.txt'])
    const stagedDiff = await gitDiff(dir, 'a.txt', true)
    assert.match(stagedDiff, /line 2 CHANGED/)
    assert.doesNotMatch(stagedDiff, /line 29 CHANGED/)
    await unstageHunks(dir, 'a.txt', [0])
    const after = await gitStatus(dir)
    assert.equal(after.staged.length, 0)
  })

  it('branches: create and switch; invalid names fail in plain words', async () => {
    const dir = scratchRepo()
    await createBranch(dir, 'feat/one')
    await switchBranch(dir, 'feat/one')
    const status = await gitStatus(dir)
    assert.equal(status.branch, 'feat/one')
    await assert.rejects(() => createBranch(dir, 'bad name!'), /not a valid branch name/)
  })

  it('draftCommitMessage summarises the staged changes', async () => {
    const dir = scratchRepo()
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n')
    fs.writeFileSync(path.join(dir, 'new.txt'), 'new\n')
    await stageFiles(dir, ['a.txt', 'new.txt'])
    const msg = draftCommitMessage(await gitStatus(dir))
    assert.match(msg, /update a\.txt/)
    assert.match(msg, /add new\.txt/)
  })

  it('actions refuse paths outside the project', async () => {
    const dir = scratchRepo()
    await assert.rejects(() => stageFiles(dir, ['../escape.txt']), /not a path inside the project/)
  })
})
