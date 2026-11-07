/**
 * The editor agent's long-term memory, on the shared LibSQL store.
 *
 * What it owns: conversation threads (one per project root — see
 * chatMemory.ts) and a per-thread working-memory note. What it does
 * NOT own: anything file-canonical in this codebase (plans, the
 * codebase map, project.ai.json, research briefs stay plain files).
 *
 * Deliberate limits:
 * - History is bounded by a token budget (messageHistory), replacing
 *   the old client-side "last 12 turns × 2,000 chars" clip with a
 *   server-side equivalent. Older messages stay in storage; they are
 *   trimmed from context, not deleted.
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
import { mastraStorage } from './storage.js'

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

export const editorMemory = new Memory({
  storage: mastraStorage,
  options: {
    generateTitle: false,
    messageHistory: { maxTokens: 8000 },
    workingMemory: {
      enabled: true,
      scope: 'thread',
      template: WORKING_MEMORY_TEMPLATE,
    },
  },
})
