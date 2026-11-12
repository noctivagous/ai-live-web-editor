/**
 * The composed ALE MCP tool registry: every family module's
 * tools in one list, plus the call path the transport uses.
 * Families: page + verify (tools.ts, slice 5), graphs + brief
 * (graphTools.ts, slice 6), plans (planTools.ts, slice 7),
 * wizards (wizardTools.ts, slice 8), delivery (deliveryTools.ts,
 * Delivery facet §13.6).
 *
 * Facet gating (§10.2): a tool tagged with a facet is listed
 * and callable only while that facet is on. `ALE_TOOLS` is the
 * full composition; `visibleAleTools()` is what a session sees.
 */
import { facetOff } from '../facetState.js'
import { ALE_DELIVERY_TOOLS } from './deliveryTools.js'
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
  ...ALE_DELIVERY_TOOLS,
]

/** The tools a session may see right now: facet-tagged tools
 * whose facet is off are withdrawn (§10.2). */
export function visibleAleTools(): AleToolDef[] {
  return ALE_TOOLS.filter((t) => !t.facet || !facetOff(t.facet))
}

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
      result: { ok: false, error: `unknown ALE tool "${name}". Available: ${visibleAleTools().map((t) => t.name).join(', ')}` },
      isError: true,
    }
  }
  if (tool.facet && facetOff(tool.facet)) {
    return {
      result: { ok: false, error: `the ${tool.facet} facet is turned off, so "${name}" is not offered. Turn the facet on in Settings → Facets to use it.` },
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
