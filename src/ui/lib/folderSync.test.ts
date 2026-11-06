import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diffSnapshots, planSync, type Snapshot } from './folderSync.js'

const snap = (entries: [string, number, number][]): Snapshot => Object.fromEntries(
  entries.map(([path, mtime, size]) => [path, { mtime, size }]),
)

describe('diffSnapshots', () => {
  it('separates created, modified, and deleted, sorted', () => {
    const base = snap([['/a.js', 1, 10], ['/b.js', 1, 10], ['/c.js', 1, 10]])
    const cur = snap([['/b.js', 2, 10], ['/c.js', 1, 10], ['/d.js', 3, 5]])
    assert.deepEqual(diffSnapshots(base, cur), {
      created: ['/d.js'],
      modified: ['/b.js'],
      deleted: ['/a.js'],
    })
  })
  it('treats size-only changes as modified', () => {
    const d = diffSnapshots(snap([['/a.js', 1, 10]]), snap([['/a.js', 1, 11]]))
    assert.deepEqual(d.modified, ['/a.js'])
  })
  it('is quiet when nothing changed', () => {
    const s = snap([['/a.js', 1, 10]])
    assert.deepEqual(diffSnapshots(s, { ...s }), { created: [], modified: [], deleted: [] })
  })
})

describe('planSync', () => {
  const baseDisk = snap([['/a.js', 1, 10], ['/b.js', 1, 10]])
  const baseServer = ['/a.js', '/b.js']

  it('uploads disk-only changes and downloads server-only changes', () => {
    const plan = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: snap([['/a.js', 2, 10], ['/b.js', 1, 10]]),
      serverChanged: ['/b.js'],
      serverDeleted: [],
    })
    assert.deepEqual(plan.upload, ['/a.js'])
    assert.deepEqual(plan.download, ['/b.js'])
    assert.deepEqual(plan.conflicts, [])
    assert.deepEqual(plan.diskDeleted, [])
    assert.deepEqual(plan.serverDeleted, [])
  })
  it('downloads brand-new server files (create on disk)', () => {
    const plan = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: { ...baseDisk },
      serverChanged: ['/new.js'],
      serverDeleted: [],
    })
    assert.deepEqual(plan.download, ['/new.js'])
  })
  it('flags changed-on-both-sides as conflicts', () => {
    const plan = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: snap([['/a.js', 2, 10], ['/b.js', 1, 10]]),
      serverChanged: ['/a.js'],
      serverDeleted: [],
    })
    assert.deepEqual(plan.conflicts, ['/a.js'])
    assert.deepEqual(plan.upload, [])
    assert.deepEqual(plan.download, [])
  })
  it('flags edit-vs-delete in both directions as conflicts', () => {
    const editedOnDiskDeletedOnServer = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: snap([['/a.js', 2, 10], ['/b.js', 1, 10]]),
      serverChanged: [],
      serverDeleted: ['/a.js'],
    })
    assert.deepEqual(editedOnDiskDeletedOnServer.conflicts, ['/a.js'])

    const deletedOnDiskEditedOnServer = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: snap([['/b.js', 1, 10]]),
      serverChanged: ['/a.js'],
      serverDeleted: [],
    })
    assert.deepEqual(deletedOnDiskEditedOnServer.conflicts, ['/a.js'])
  })
  it('converges deleted-on-both-sides silently', () => {
    const plan = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: snap([['/b.js', 1, 10]]),
      serverChanged: [],
      serverDeleted: ['/a.js'],
    })
    assert.deepEqual(plan, { upload: [], download: [], conflicts: [], diskDeleted: [], serverDeleted: [] })
  })
  it('proposes one-sided deletions instead of acting on them', () => {
    const diskDeleted = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: snap([['/b.js', 1, 10]]),
      serverChanged: [],
      serverDeleted: [],
    })
    assert.deepEqual(diskDeleted.diskDeleted, ['/a.js'])

    const serverDeleted = planSync({
      baseDisk,
      baseServerPaths: baseServer,
      disk: { ...baseDisk },
      serverChanged: [],
      serverDeleted: ['/a.js'],
    })
    assert.deepEqual(serverDeleted.serverDeleted, ['/a.js'])
  })
})
