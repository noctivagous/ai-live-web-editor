import { projectBrief } from './projectConfig.js'

/**
 * Per-turn context assembly — ONE stack for every chat surface.
 *
 * The streamed route, both non-stream /api/chat copies, and any
 * future surface all build their per-turn context here: the project
 * brief, the codebase-map injection, and triggered skill bodies,
 * ordered stable -> volatile and inserted as system messages just
 * before the newest user message (withContextBeforeLastUser), so the
 * conversation ahead of them stays a cacheable prefix.
 *
 * History of divergence (basics audit §D): the apiApp /api/chat copy
 * sent the brief only — no skills, no map — and server.ts's copy had
 * skills but no map, so the same prompt got a different agent
 * depending on which server file served it. Live-edit still presents
 * its brief through the same insertion helper rather than gluing it
 * onto its synthetic prompt.
 */

/** The newest user message's text, or '' when there is none. */
export function latestUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string, content?: unknown }
    if (m?.role === 'user' && typeof m.content === 'string') return m.content
  }
  return ''
}

/**
 * The context parts for one turn. The brief always leads. Map and
 * skill injections are Files-mode only and best-effort — a failure
 * in either never breaks the turn.
 */
export async function buildTurnContext(
  userText: string,
  opts: { mode: string, onSkillsUsed?: (used: { name: string, via: string }[]) => void },
): Promise<string[]> {
  const parts: string[] = []
  // Project brief (phase-11-06): type, device targets, style set —
  // every agent turn knows what kind of project it is building.
  parts.push(projectBrief())
  if (opts.mode === 'files') {
    // Codebase map (token-efficiency §1): inject top map signatures —
    // below the file-count threshold the greps are cheaper than the
    // map. Settings-gated (agentSettings.mapInjection).
    try {
      const { currentAgentSettings } = await import('./agentSettings.js')
      const injectionMode = currentAgentSettings().mapInjection
      if (injectionMode !== 'off') {
        const { buildMapForRoot } = await import('./codebaseMap/mapStore.js')
        const { mapInjectionText } = await import('./codebaseMap/codebaseMap.js')
        const injection = mapInjectionText(buildMapForRoot(), injectionMode === 'always' ? 0 : undefined)
        if (injection) parts.push(injection)
      }
    } catch { /* map injection is an optimisation, not a requirement */ }
    // Skills (§4): a body loads only when this turn triggers it — an
    // explicit ask trigger, library evidence in package.json, or the
    // project type. Untriggered turns pay nothing.
    try {
      const { skillInjectionDetailForTurn } = await import('./skills/skills.js')
      const detail = userText ? skillInjectionDetailForTurn(userText) : null
      if (detail?.text) parts.push(detail.text)
      if (detail && detail.included.length && opts.onSkillsUsed) {
        try { opts.onSkillsUsed(detail.included) } catch { /* reporting never breaks a turn */ }
      }
    } catch { /* skill injection is an optimisation, not a requirement */ }
  }
  return parts
}
