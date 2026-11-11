import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { setAgentSettingsPath } from '../agentSettings.js'
import { setFsRoot } from '../launcher.js'
import type { GateVerdict } from '../mcpserver/gateVerdict.js'
import { museRunConfig } from '../ui/lib/museSandbox.js'
import {
  acceptDispatch, diffTree, dispatchExecArgs, packageBrief, rejectDispatch,
  resetDispatchState, restoreTree, runDispatch, setDispatchExecRunner, snapshotTree,
} from './dispatch.js'

const cleanVerdict: GateVerdict = {
  ran: true, ok: true,
  layoutFindings: [], layoutFindingCount: 0, expectedFindings: [],
  consoleErrors: [], consoleErrorCount: 0, consoleEntries: [], unverified: [],
}
const failingVerdict: GateVerdict = { ...cleanVerdict, ok: false, consoleErrorCount: 1 }

describe('headless dispatch (slice 10)', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-dispatch-'))
    setFsRoot(root)
    setAgentSettingsPath(path.join(root, 'agent-settings.json'))
    resetDispatchState()
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>before</h1>\n')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 1\n')
  })
  afterEach(() => {
    setDispatchExecRunner(null)
    resetDispatchState()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('snapshot → diff → restore round-trips changed, added and deleted files', () => {
    const snap = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-snap-'))
    const manifest = snapshotTree(root, snap)
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>after</h1>\n')
    fs.writeFileSync(path.join(root, 'new.txt'), 'new\n')
    fs.rmSync(path.join(root, 'src', 'app.js'))
    const diff = diffTree(root, manifest)
    assert.deepEqual(diff.changed, ['index.html'])
    assert.deepEqual(diff.added, ['new.txt'])
    assert.deepEqual(diff.deleted, [path.join('src', 'app.js')])
    restoreTree(root, snap, manifest)
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf-8'), '<h1>before</h1>\n')
    assert.equal(fs.existsSync(path.join(root, 'new.txt')), false)
    assert.equal(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf-8'), 'export const x = 1\n')
    fs.rmSync(snap, { recursive: true, force: true })
  })

  it('exec args carry the posture, the approval mapping and the hook — never --yolo, never a -c MCP registration', () => {
    for (const posture of ['unblocked', 'sandboxed', 'strict'] as const) {
      const args = dispatchExecArgs(museRunConfig(posture), { promptFile: '/tmp/brief.md', hooksPath: '/tmp/hooks.json' })
      assert.ok(!args.includes('--yolo'), posture)
      assert.equal(args[0], 'exec')
      assert.ok(args.includes('--prompt-file'))
      // Exec refuses MCP registration via -c in every shape
      // (probed live); registration rides the project .mcp.json.
      assert.ok(!args.some((a) => a.startsWith('mcpServers')), posture)
      assert.ok(args.some((a) => a.startsWith('managed_hooks_path=')))
    }
    const unblocked = dispatchExecArgs(museRunConfig('unblocked'), { promptFile: '/tmp/b.md', hooksPath: null })
    assert.equal(unblocked[unblocked.indexOf('--approval-mode') + 1], 'never')
    const strict = dispatchExecArgs(museRunConfig('strict'), { promptFile: '/tmp/b.md', hooksPath: null })
    assert.equal(strict[strict.indexOf('--approval-mode') + 1], 'untrusted')
  })

  it('the brief packages the failing evidence, the criteria and the project shape', () => {
    const brief = packageBrief({ title: 'Fix the boom', evidence: 'pageerror: boom', criteria: ['no console errors'], source: 'console' }, root)
    assert.match(brief, /Fix: Fix the boom/)
    assert.match(brief, /pageerror: boom/)
    assert.match(brief, /no console errors/)
    assert.match(brief, /ale_verify_gate/)
    assert.match(brief, /Change as little as possible/)
  })

  it('a dispatch is judged by the gate verdict, and reject restores the tree', async () => {
    setDispatchExecRunner(async (_bin, _args, cwd) => {
      fs.writeFileSync(path.join(cwd, 'index.html'), '<h1>fixed</h1>\n')
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const record = await runDispatch(
      { title: 'Fix it', evidence: 'boom', source: 'console' },
      { judge: async () => cleanVerdict, settlePollMs: 10, settleQuietMs: 20 },
    )
    assert.equal(record.status, 'fixed')
    assert.deepEqual(record.changedFiles, ['index.html'])
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf-8'), '<h1>fixed</h1>\n')
    const rejected = rejectDispatch(record.id)
    assert.equal(rejected?.status, 'rejected')
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf-8'), '<h1>before</h1>\n')
  })

  it('a still-failing gate marks the run not-fixed even on exit 0, and accept keeps the tree', async () => {
    setDispatchExecRunner(async (_bin, _args, cwd) => {
      fs.writeFileSync(path.join(cwd, 'index.html'), '<h1>attempted</h1>\n')
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const record = await runDispatch(
      { title: 'Try', evidence: 'boom', source: 'gate' },
      { judge: async () => failingVerdict, settlePollMs: 10, settleQuietMs: 20 },
    )
    assert.equal(record.status, 'not-fixed')
    const accepted = acceptDispatch(record.id)
    assert.equal(accepted?.status, 'accepted')
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf-8'), '<h1>attempted</h1>\n')
  })
})
