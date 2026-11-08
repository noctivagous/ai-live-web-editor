/**
 * /graph-update <target> — the command that keeps a durable graph
 * reconciled with the project it maps. `feature` is the first
 * target (the feature graph in ai-features/graph.json); the command
 * shape is deliberately general — other graphs (architecture, data)
 * plug into the same verb later, and until one does, asking for it
 * answers honestly instead of pretending.
 *
 * Two launchers, one path: the graph pane's Build/Update button
 * and the chat slash command both call launchGraphUpdate, which
 * opens the pane (so the user watches the changes land) and sends
 * the instruction as a normal agent turn. Every write the agent
 * makes goes through the feature tools into the same store the
 * pane reads, so the pane's polling sees each change as it lands.
 */

export interface GraphUpdateTarget {
  id: string
  label: string
  ready: boolean
}

export const GRAPH_UPDATE_TARGETS: GraphUpdateTarget[] = [
  { id: 'feature', label: 'Feature graph', ready: true },
  { id: 'architecture', label: 'Architecture graph', ready: false },
  { id: 'data', label: 'Data graph', ready: false },
]

export function graphUpdateTarget(id: string): GraphUpdateTarget | undefined {
  return GRAPH_UPDATE_TARGETS.find(t => t.id === id)
}

/** Parse a chat line as a /graph-update command. Bare
 * `/graph-update` means the feature graph. Returns null when the
 * line is not this command. */
export function parseGraphUpdateCommand(text: string): { target: string } | null {
  const m = text.trim().match(/^\/graph-update(?:\s+(\S+))?\s*$/)
  if (!m) return null
  return { target: (m[1] ?? 'feature').toLowerCase() }
}

export function graphUpdatePrompt(target: string): string {
  // Only 'feature' is ready; other targets never reach the prompt.
  void target
  return [
    "Run /graph-update for this project's feature graph. Work only through the feature graph tools",
    '(feature-query, feature-add-node, feature-set-status, feature-link, feature-edit-node, feature-remove-node),',
    'so every change lands in ai-features/graph.json and shows up live in the open graph pane.',
    '',
    '1. Start with feature-query (overview) to see the current feature graph — if there is none, you are building it, not updating it.',
    '2. Read the project as it actually is: the codebase map and the project files, the packs installed from the Library, and project.ai.json.',
    '3. Building: create a region node for each of the app\'s real areas, then a node for each real feature, screen, component, setting, data store and service, contained under its region, with typed edges (depends-on, configures, renders, data-flows, derived-from) where they truly hold. Statuses must be earned: done or verified only when the code exists and works, building for partial work, planned or proposed for intended-but-absent, blocked only with a concrete blocker you name in the summary.',
    '4. Updating: reconcile instead of rebuilding. Add nodes for features that exist in the code but not in the graph, correct statuses the evidence contradicts, and wire edges that now hold. If a node claims built but its code is gone, flag it as drift in your summary rather than deleting it silently.',
    '5. Finish with a short summary — nodes added, statuses changed, edges added, drift or blocked items — one line each.',
  ].join('\n')
}

/** Open the graph pane and send the update turn. The pane polls the
 * graph store, so the user watches each tool write land. (The
 * ask-ai dispatch is inlined rather than imported from lib/api so
 * this module stays loadable outside the Vite runtime — api.ts
 * reads import.meta.env at module top.) */
export function launchGraphUpdate(target: string): void {
  window.dispatchEvent(new CustomEvent('ai-live:graph-open', {}))
  window.dispatchEvent(new CustomEvent('ai-live:ask-ai', { detail: { text: graphUpdatePrompt(target) } }))
}
