/**
 * The gate as a standalone verdict (Muse Code design §7/§11):
 * one implementation, two callers — the ale_verify_gate MCP
 * tool and the managed Stop hook's re-check (musecode/
 * gateHook.ts). Both ask the same question — "is the current
 * tree/page OK right now?" — and both get the same structured
 * answer.
 *
 * The turn-arc gate diffs a turn against its own start; a
 * standalone verdict has no turn start, so the baseline is
 * emptied: every current layout finding and console entry
 * counts. The verdict is structured (counts + findings),
 * never a log dump.
 */
import { captureBaseline, runVerifyGate, type GateResult } from '../verify/runGate.js'
import { isErrorLevel } from '../verify/gate.js'

export interface GateVerdict {
  ran: boolean
  ok: boolean
  skipped?: string
  layoutFindings: unknown[]
  layoutFindingCount: number
  expectedFindings: unknown[]
  consoleErrors: unknown[]
  consoleErrorCount: number
  consoleEntries: unknown[]
  unverified: string[]
}

export function shapeGateVerdict(result: GateResult): GateVerdict {
  const consoleErrors = result.console.filter((e) => isErrorLevel(e.level))
  return {
    ran: result.ran,
    ...(result.skipped ? { skipped: result.skipped } : {}),
    ok: result.ran && result.layout.length === 0 && consoleErrors.length === 0,
    layoutFindings: result.layout,
    layoutFindingCount: result.layout.length,
    expectedFindings: result.expected,
    consoleErrors,
    consoleErrorCount: consoleErrors.length,
    consoleEntries: result.console,
    unverified: result.unverified,
  }
}

export async function runGateVerdict(): Promise<GateVerdict> {
  const baseline = await captureBaseline()
  if (!baseline) {
    return {
      ran: false,
      ok: false,
      skipped: 'The verify gate is disabled in this editor (ALE_VERIFY_GATE is off), so no verdict was produced.',
      layoutFindings: [], layoutFindingCount: 0, expectedFindings: [],
      consoleErrors: [], consoleErrorCount: 0, consoleEntries: [], unverified: [],
    }
  }
  const emptyPreState = {
    ...baseline,
    bridgeLayout: [],
    frames: baseline.frames.map((f) => ({ ...f, findings: [], seq: 0 })),
    bridgeSeq: 0,
    poolSeq: 0,
    unverified: [] as string[],
  }
  return shapeGateVerdict(await runVerifyGate(emptyPreState))
}
