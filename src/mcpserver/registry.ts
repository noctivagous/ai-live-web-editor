/**
 * The composed ALE MCP tool registry: every family module's
 * tools in one list, plus the call path the transport uses.
 * Families: page + verify (tools.ts, slice 5), graphs + brief
 * (graphTools.ts, slice 6), plans (planTools.ts, slice 7),
 * wizards (wizardTools.ts, slice 8).
 */
import { ALE_GRAPH_TOOLS } from './graphTools.js'
import { ALE_PLAN_TOOLS } from './planTools.js'
import { ALE_PAGE_VERIFY_TOOLS, type AleToolDef } from './tools.js'
import { ALE_WIZARD_TOOLS } from './wizardTools.js'

export type { AleToolDef }

export const ALE_TOOLS: AleToolDef[] = [
  ...ALE_PAGE_VERIFY_TOOLS,
  ...ALE_GRAPH_TOOLS,
  ...ALE_PLAN_TOOLS,
  ...ALE_WIZARD_TOOLS,
]

export function aleToolByName(name: string): AleToolDef | undefined {
  return ALE_TOOLS.find((t) => t.name === name)
}

/** Whether a host result value declares failure — the MCP
 * isError flag follows the host's own verdict, it is not a
 * second judgment. */
export function aleResultIsError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  if (r.ok === false) return true
  if (typeof r.error === 'string' && r.error && r.ok !== true) return true
  return false
}

/** Call one tool by name; unknown names are an error value,
 * never a throw (the dispatch endpoints' standing contract). */
export async function callAleTool(name: string, input: Record<string, any>): Promise<{ result: unknown; isError: boolean }> {
  const tool = aleToolByName(name)
  if (!tool) {
    return {
      result: { ok: false, error: `unknown ALE tool "${name}". Available: ${ALE_TOOLS.map((t) => t.name).join(', ')}` },
      isError: true,
    }
  }
  try {
    const result = await tool.run(input ?? {})
    return { result, isError: aleResultIsError(result) }
  } catch (e: any) {
    return { result: { ok: false, error: e?.message || String(e) }, isError: true }
  }
}
