import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { setAgentSettingsPath } from '../agentSettings.js'
import { setFsRoot } from '../launcher.js'
import type { GateVerdict } from '../mcpserver/gateVerdict.js'
import {
  ensureGateHookFiles, gateHookConfigArgs, gateVerdictForTurn, handleStopHook,
  listGateVerdicts, resetGateHookState, setGateVerdictRunner, verdictSummary,
} from './gateHook.js'

const cleanVerdict: GateVerdict = {
  ran: true, ok: true,
  layoutFindings: [], layoutFindingCount: 0, expectedFindings: [],
  consoleErrors: [], consoleErrorCount: 0, consoleEntries: [], unverified: [],
}
const failingVerdict: GateVerdict = {
  ran: true, ok: false,
  layoutFindings: [{ key: 'a', kind: 'overlap', detail: 'overlap' }], layoutFindingCount: 1,
  expectedFindings: [],
  consoleErrors: [{ level: 'error', text: 'boom' }], consoleErrorCount: 1,
  consoleEntries: [], unverified: ['frames skipped'],
}

describe('managed Stop hook → gate re-check (slice 9)', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-hook-'))
    setFsRoot(root)
    setAgentSettingsPath(path.join(root, 'agent-settings.json'))
    resetGateHookState()
  })
  afterEach(() => {
    setGateVerdictRunner(null)
    resetGateHookState()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('verdictSummary maps the verdict onto the turn surface shape', () => {
    const s = verdictSummary(failingVerdict)
    assert.equal(s.ran, true)
    assert.equal(s.clean, false)
    assert.equal(s.newLayout, 1)
    assert.equal(s.newConsole, 1)
    assert.deepEqual(s.unverified, ['frames skipped'])
    assert.equal(verdictSummary(cleanVerdict).clean, true)
  })

  it('a Stop payload runs the gate once and records the verdict against session + turn', async () => {
    let runs = 0
    setGateVerdictRunner(async () => { runs += 1; return failingVerdict })
    const payload = { hook_event_name: 'Stop', session_id: 'sess-1', turn_id: 'turn-1', cwd: root }
    const first = await handleStopHook(payload)
    assert.equal(first.action, 'recorded')
    assert.equal(first.record?.summary.clean, false)
    assert.equal(runs, 1)
    // The record is durable: on disk under the project and queryable.
    assert.equal(listGateVerdicts(root).length, 1)
    assert.ok(fs.existsSync(path.join(root, '.ai-live', 'gate-verdicts.json')))
    assert.equal(gateVerdictForTurn('sess-1', 'turn-1', root)?.turnId, 'turn-1')

    // A re-fired Stop for the same turn dedupes — no second gate run.
    const second = await handleStopHook(payload)
    assert.equal(second.action, 'duplicate')
    assert.equal(runs, 1)
    assert.equal(listGateVerdicts(root).length, 1)
  })

  it('a non-Stop event is ignored; a Stop for another project records a skip, not a gate run', async () => {
    let runs = 0
    setGateVerdictRunner(async () => { runs += 1; return cleanVerdict })
    const ignored = await handleStopHook({ hook_event_name: 'SessionStart', session_id: 's', cwd: root })
    assert.equal(ignored.action, 'ignored')
    const skipped = await handleStopHook({ hook_event_name: 'Stop', session_id: 's2', turn_id: 't2', cwd: path.join(root, 'other-project') })
    assert.equal(skipped.action, 'skipped')
    assert.match(skipped.record?.verdict.skipped ?? '', /not the editor’s active project/)
    assert.equal(runs, 0)
  })

  it('concurrent Stops for one session collapse into one re-check (the loop guard)', async () => {
    let runs = 0
    setGateVerdictRunner(async () => {
      runs += 1
      await new Promise((r) => setTimeout(r, 40))
      return cleanVerdict
    })
    const p1 = handleStopHook({ hook_event_name: 'Stop', session_id: 'sess-x', turn_id: 't1', cwd: root })
    const p2 = handleStopHook({ hook_event_name: 'Stop', session_id: 'sess-x', turn_id: 't2', cwd: root })
    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(r1.action, 'recorded')
    assert.equal(r2.action, 'in-flight')
    assert.equal(runs, 1)
  })

  it('the generated hook files carry the endpoint, the port, and the spawn arg shape', () => {
    const hooksPath = ensureGateHookFiles()
    assert.ok(hooksPath)
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'))
    const stop = hooks.hooks.Stop
    assert.equal(stop[0].matcher, '*')
    assert.match(stop[0].hooks[0].command, /^node "/)
    const scriptPath = stop[0].hooks[0].command.slice('node '.length).replace(/^"|"$/g, '')
    const script = fs.readFileSync(scriptPath, 'utf-8')
    assert.match(script, /\/api\/musecode\/stop-hook/)
    const args = gateHookConfigArgs(hooksPath)
    assert.deepEqual(args, ['-c', `managed_hooks_path=${JSON.stringify(hooksPath)}`])
    // Idempotent: a second ensure returns the same path without churn.
    assert.equal(ensureGateHookFiles(), hooksPath)
  })
})
