/**
 * The editor agent's long-term memory, on the shared LibSQL store.
 *
 * What it owns: conversation threads (one per project root — see
 * chatMemory.ts) and a per-thread working-memory note. What it does
 * NOT own: anything file-canonical in this codebase (plans, the
 * codebase map, project.ai.json, research briefs stay plain files).
 *
 * Deliberate limits:
 * - History is bounded by a token budget (messageHistory) sized for
 *   working memory plus about the last two turns, not half the model
 *   window. Older messages stay in storage; they are trimmed from
 *   context, not deleted. Tool dumps are folded before persist.
 * - Working memory is thread-scoped and agent-managed: the agent keeps
 *   a small working set (goal, files touched, decisions, open
 *   questions) current as it works — the session-compact working set
 *   from TASKS-token-efficiency §6, without a second summariser agent.
 * - No semantic recall: that needs a vector store + embedder, and
 *   vector/RAG indexing is on this project's rejected list.
 * - No title generation: an extra model call per thread for a title
 *   the UI never shows.
 */
import { Memory } from '@mastra/memory'
import type { MastraDBMessage } from '@mastra/core/agent'
import type { MemoryConfig } from '@mastra/core/memory'
import type { ObservabilityContext } from '@mastra/core/observability'
import { mastraStorage } from './storage.js'
import { resolveAgentContextWindow } from '../connections.js'
import { compactStoredMessage } from '../contextTrim.js'

/**
 * History recall budget: about two turns plus working set — 1/16 of
 * the window, floored at 4k, capped at 12k. Unknown window → 8k.
 * Computed once at construction from the model resolved at boot; a
 * connection switch mid-session re-sizes on the next server start.
 */
export const HISTORY_BUDGET_FLOOR = 4_000
export const HISTORY_BUDGET_CAP = 12_000

export function historyBudgetForWindow(windowTokens: number | undefined): number {
  if (!windowTokens || windowTokens <= 0) return 8000
  return Math.min(HISTORY_BUDGET_CAP, Math.max(HISTORY_BUDGET_FLOOR, Math.floor(windowTokens / 16)))
}

export const HISTORY_BUDGET = historyBudgetForWindow(resolveAgentContextWindow())

export const WORKING_MEMORY_TEMPLATE = [
  '# Project working set',
  '',
  '## Current goal',
  '',
  '## Files touched',
  '',
  '## Decisions',
  '',
  '## Open questions',
  '',
].join('\n')

class CompactedMemory extends Memory {
  async saveMessages({ messages, memoryConfig, observabilityContext }: {
    messages: MastraDBMessage[]
    memoryConfig?: MemoryConfig
    observabilityContext?: Partial<ObservabilityContext>
  }) {
    const compacted = messages.map((m) => compactStoredMessage(m))
    return super.saveMessages({ messages: compacted, memoryConfig, observabilityContext })
  }
}

export const editorMemory = new CompactedMemory({
  storage: mastraStorage,
  options: {
    generateTitle: false,
    messageHistory: { maxTokens: HISTORY_BUDGET },
    workingMemory: {
      enabled: true,
      scope: 'thread',
      template: WORKING_MEMORY_TEMPLATE,
    },
  },
})
