import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseWorkflowSnapshot,
  publishWorkflowChanged,
  subscribeWorkflow,
  workflowSnapshotsEqual,
  type WorkflowSyncSnapshot,
} from './workflowSync.js'

function snap(over: Partial<WorkflowSyncSnapshot> = {}): WorkflowSyncSnapshot {
  return {
    ok: true,
    mode: 'files',
    accepted: false,
    patches: [],
    ...over,
  }
}

describe('workflowSync snapshots', () => {
  it('treats identical snapshots as equal', () => {
    const a = snap({ patches: [{ id: '1', selector: 'h1', op: 'text', ok: true, detail: 'text h1' }] })
    const b = snap({ patches: [{ id: '1', selector: 'h1', op: 'text', ok: true, detail: 'text h1' }] })
    assert.equal(workflowSnapshotsEqual(a, b), true)
  })

  it('notices a mode switch (Files vs Live sketch)', () => {
    assert.equal(workflowSnapshotsEqual(snap(), snap({ mode: 'sketch' })), false)
  })

  it('notices patch-list changes', () => {
    const a = snap()
    const b = snap({ patches: [{ id: '1', selector: 'h1', op: 'text', ok: true, detail: 'text h1' }] })
    assert.equal(workflowSnapshotsEqual(a, b), false)
  })

  it('notices the accepted flag', () => {
    assert.equal(workflowSnapshotsEqual(snap(), snap({ accepted: true })), false)
  })

  it('parses a server snapshot and rejects junk', () => {
    const parsed = parseWorkflowSnapshot({
      ok: true,
      mode: 'sketch',
      accepted: false,
      patches: [{ id: '1', selector: 'h1', op: 'text', ok: true }],
    })
    assert.equal(parsed?.mode, 'sketch')
    assert.equal(parsed?.patches[0].detail, 'text h1')
    assert.equal(parseWorkflowSnapshot({ ok: true, mode: 'bogus', patches: [] }), null)
    assert.equal(parseWorkflowSnapshot(null), null)
  })
})

describe('workflowSync broadcast', () => {
  it('notifies every Chat instance when one publishes a change', async () => {
    if (typeof BroadcastChannel === 'undefined') return
    let sidebar = 0
    let overlay = 0
    const offA = subscribeWorkflow(() => { sidebar += 1 })
    const offB = subscribeWorkflow(() => { overlay += 1 })
    try {
      publishWorkflowChanged()
      const deadline = Date.now() + 1000
      while ((sidebar === 0 || overlay === 0) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20))
      }
      assert.equal(sidebar >= 1, true)
      assert.equal(overlay >= 1, true)
    } finally {
      offA()
      offB()
    }
  })
})
