/**
 * /graph-update <target> — the command that keeps a durable graph
 * reconciled with the project it maps. `feature` is the first
 * target (the feature graph in ai-features/graph.json) and
 * `userflow` the second (the user flow graph in
 * ai-user-flows/graph.json); the command shape is deliberately
 * general — other graphs (architecture, data) plug into the same
 * verb later, and until one does, asking for it answers honestly
 * instead of pretending.
 *
 * Two launchers, one path: the graph pane's Build/Update button
 * and the chat slash command both call launchGraphUpdate, which
 * opens the pane (so the user watches the changes land) and sends
 * the instruction as a normal agent turn. Every write the agent
 * makes goes through the target graph's tools into the same store
 * the pane reads, so the pane's polling sees each change as it lands.
 */

export interface GraphUpdateTarget {
  id: string
  label: string
  ready: boolean
}

export const GRAPH_UPDATE_TARGETS: GraphUpdateTarget[] = [
  { id: 'feature', label: 'Feature graph', ready: true },
  { id: 'userflow', label: 'User Flow graph', ready: true },
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
  if (target === 'userflow') return userFlowUpdatePrompt()
  // Only ready targets reach the prompt; 'feature' is the default.
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

function userFlowUpdatePrompt(): string {
  return [
    "Run /graph-update for this project's user flow graph. Work only through the user flow tools",
    '(userflow-query, userflow-add-step, userflow-set-verification, userflow-link),',
    'so every change lands in ai-user-flows/graph.json and shows up live in the open graph pane.',
    '',
    '1. Start with userflow-query (overview) to see the current user flow graph — if there is none, you are building it, not updating it.',
    '2. Read the project as it actually is: the codebase map and the project files, the screens and routes the app really has, and the feature graph (feature-query) — the flow graph names the features each step exercises, so you need their node ids.',
    '3. Building: create a journey for each real path a person takes through the app, then the steps of that path in order — screens (what the user sees), actions (what the user does), outcomes (what should happen) — with typed edges where they truly hold (navigates-to, submits, branches-on, requires). Link each step to the feature nodes it exercises with userflow-link (type exercises). Verification must be earned: record ok with userflow-set-verification only for a step you have actually driven or seen work in this session; a step you only read about stays untested, and a block is recorded only with the evidence you actually saw.',
    '4. Updating: reconcile instead of rebuilding. Add journeys and steps for flows that exist in the app but not in the graph, fix step types and edges the evidence contradicts, and add exercises links that now hold. Keep verification records as they are unless this session\'s evidence contradicts them — never restart the graph.',
    '5. Finish with a short summary — journeys and steps added, edges and exercises links added, verification changed — one line each.',
  ].join('\n')
}

/**
 * The dogfood run: the second launch the User Flow tab carries.
 * Where /graph-update userflow reconciles the graph with the app
 * as read, a dogfood run drives the app as used — it walks the
 * flow graph against the live preview and writes back how each
 * step actually behaved (userflow-set-verification). The prompt
 * is the run's whole contract: the page tools it names are the
 * ones a Files turn really has (the senses are core / layout
 * group tools; run-in-page is the only actuation a Files turn
 * gets — there is no click tool), the no-page check keys off
 * what those tools answer when no page is connected, and the
 * recording rules keep an interrupted run honest.
 */
export function dogfoodRunPrompt(): string {
  return [
    "Dogfood run: drive this app's live preview against the user flow graph and record how each step actually behaves.",
    'Work through the user flow tools (userflow-query, userflow-set-verification, userflow-link, userflow-derive-suggestions) for graph writes, and the page',
    'senses (page-sections, take-snapshot, inspect-dom, layout-snapshot, get-console, get-network-failures) plus run-in-page for',
    'the page itself. Every verification you record lands in ai-user-flows/graph.json and shows up live in the open graph pane.',
    '',
    '0. FIRST CHECK — is there a live page to drive? Before anything else, call page-sections (or take-snapshot). If it answers',
    'that no live Vite page is connected, STOP: there is nothing to drive. Do not simulate driving, do not change any',
    'verification, do not mark anything. Say plainly that no live page is connected so no step could be driven, and offer the',
    'static alternative instead — /graph-update userflow reconciles or drafts the graph from the code, with steps staying',
    'untested until a run can drive them. Only continue past this check when a page actually answered.',
    '1. Start with userflow-query (overview), then userflow-query in journey mode for each journey, so you hold the steps,',
    'their edges, and their current verification. Pick ONE run id now — "dogfood-" plus the current date and time — and pass',
    'that same runId to every userflow-set-verification call in this run, so the pane can tell this run\'s records from older ones.',
    '2. Work journey by journey, steps in flow order: entry steps first (the ones no edge points into), then follow the edges —',
    'navigates-to and submits lead onward; at a branches-on fork, attempt the branch you can reach and say which you took.',
    'A requires edge A → B means B is the prerequisite: do not attempt A until B has verified ok in this run.',
    '3. Drive each step for real. Find the step\'s subject on the live page with the senses: page-sections for structure,',
    'take-snapshot for selectors and accessible names, inspect-dom for one element, layout-snapshot for geometry, get-console',
    'for page errors. To ACT, use run-in-page to dispatch the real gesture the step describes — click the element (el.click()),',
    'type by setting the field\'s value and firing input/change events, submit the form (form.requestSubmit()) — so the app\'s',
    'own handlers run; that is what makes this driving rather than pretending. There is no separate click tool: run-in-page is',
    'the hands, the senses are the eyes. Use run-in-page to operate the app as a user, never to change the app itself.',
    '4. Record each step IMMEDIATELY after attempting it, before moving on — userflow-set-verification with this run\'s id —',
    'so a run that is interrupted leaves honest partial state behind. ok only when you actually reached or performed the step',
    'AND observed the outcome the step promises. Otherwise blocked, with the kind that fits and concrete evidence:',
    'unreachable (the screen or route cannot be reached at all), missing-affordance (the control the step needs is not on the',
    'page — name it in the evidence), dead-end (you arrived but the flow goes nowhere the step expects), state-blocked (a',
    'prerequisite did not verify ok — see rule 5). When the page itself throws while you attempt a step, record error with',
    'kind console-error and the console error text as the evidence (check get-console).',
    '5. Propagate blocks, never skip silently: when a step\'s prerequisite (the target of its requires edge) ends this run',
    'blocked or in error, record the dependent step blocked with kind state-blocked and evidence naming the prerequisite step',
    'that blocked it. A step downstream of a block is never marked ok on inference, and never left unrecorded as if unattempted.',
    '6. This run MARKS, it does not patch. Never edit the project\'s files, never change the app to make a step pass, and never',
    'fix a block you find — recording it is the deliverable; fixing is separate work. The only writes are to the flow graph:',
    'verification records, and an exercises link (userflow-link, type exercises) only when driving makes it plain that a step',
    'exercises a feature that is not linked yet — obvious cases only, never a guess. runtime-state-set may arrange a starting',
    'state a journey assumes before its first step (for example stored state for a signed-in start), but never to manufacture',
    'the outcome a step claims — and any such setup is named in your final report.',
    '7. Attempt every step in the graph: a run re-earns every state, it does not inherit earlier runs\' results. Work',
    'economically — one page-sections per screen, scoped snapshots, one verification call per step — because a turn has a',
    'limited step budget. If the budget runs out, the steps already recorded stand; steps you never reached keep their earlier',
    'records (their run ids show their age), and your report names them as not attempted.',
    '8. Reflect the run into the feature graph: once every verification is recorded, call userflow-derive-suggestions once.',
    'It turns the steps\' records into suggested feature nodes in the feature graph — a fix suggestion for each blocked or',
    'error step, a coverage suggestion for each step exercising no feature — for the user to accept or dismiss in the pane.',
    'Deriving is the system\'s work, not yours: never invent, rename or hand-write suggestions, and never accept or dismiss',
    'one yourself. If it answers that there is no feature graph yet, say so in the report and move on.',
    '9. Finish with the run report, in this shape and nothing vaguer:',
    '   Dogfood run <runId> — <N> steps attempted, <M> ok.',
    '   Then one line per blocked or error step: — <step name>: <blocked|error> · <kind> — <the evidence, in a few words>.',
    '   Then, when any step was not attempted, one line naming those steps and why.',
    '   Then one line: Suggestions — <C> created, <W> withdrawn (the counts userflow-derive-suggestions returned).',
    '   The report must match what you wrote to the graph — the pane shows the same truth.',
  ].join('\n')
}

/** Which pane tab the last launch asked for. launchGraphUpdate
 * records it; the graph pane takes it (once) when it mounts or
 * when it hears the open event — the pane and the launcher load
 * at different times, so the request cannot ride the event alone. */
export type GraphPaneTab = 'feature' | 'userflow'
let pendingGraphTab: GraphPaneTab | null = null

export function takeGraphTabRequest(): GraphPaneTab | null {
  const tab = pendingGraphTab
  pendingGraphTab = null
  return tab
}

/** Open the graph pane and send the update turn. The pane polls the
 * graph store, so the user watches each tool write land. (The
 * ask-ai dispatch is inlined rather than imported from lib/api so
 * this module stays loadable outside the Vite runtime — api.ts
 * reads import.meta.env at module top.) */
export interface GraphSyncStamp { commit: string | null, at: number }

export type GraphCurrencyTone = 'ok' | 'warn' | 'muted'

/**
 * The one-line currency readout for the graph report header: whether
 * the saved stamp matches today's HEAD, how far behind it is, or why
 * there is nothing to compare (pre-stamp graph, no git repo, HEAD
 * unreadable). Pure — the API resolves `head` and `behind`.
 */
export function formatGraphCurrency(
  sync: GraphSyncStamp | null, head: string | null, behind: number | null,
): { text: string, title: string, tone: GraphCurrencyTone } {
  if (!sync) {
    return {
      text: 'Not stamped — run Update graph',
      title: 'This graph was saved before commit stamping. Run Update graph to record the commit and date.',
      tone: 'warn',
    }
  }
  const date = new Date(sync.at).toLocaleString()
  if (sync.commit === null) {
    return {
      text: `Updated ${date} · no git repo`,
      title: 'The project is not in a git repo, so only the update date is recorded.',
      tone: 'muted',
    }
  }
  const short = sync.commit.slice(0, 7)
  if (head === null) {
    return {
      text: `${short} · ${date} · HEAD unreadable`,
      title: 'The stamped commit and date are recorded, but HEAD cannot be read right now.',
      tone: 'muted',
    }
  }
  if (head === sync.commit) {
    return {
      text: `Current · ${short} · ${date}`,
      title: `The graph was saved against the current HEAD (${sync.commit}).`,
      tone: 'ok',
    }
  }
  if (behind !== null) {
    return {
      text: `${behind} commit${behind === 1 ? '' : 's'} behind · ${short} · ${date}`,
      title: `HEAD moved ${behind} commit${behind === 1 ? '' : 's'} since the graph was saved. Run Update graph to reconcile.`,
      tone: 'warn',
    }
  }
  return {
    text: `Repo moved · ${short} · ${date}`,
    title: 'HEAD differs from the stamped commit but the distance is not comparable. Run Update graph to reconcile.',
    tone: 'warn',
  }
}

export function launchGraphUpdate(target: string): void {
  pendingGraphTab = target === 'userflow' ? 'userflow' : 'feature'
  window.dispatchEvent(new CustomEvent('ai-live:graph-open', {}))
  window.dispatchEvent(new CustomEvent('ai-live:ask-ai', { detail: { text: graphUpdatePrompt(target) } }))
}

/** Open the graph pane on the User Flow tab and send the dogfood
 * run as a normal agent turn — the same two events as a graph
 * update launch, with the run's own seed. */
export function launchDogfoodRun(): void {
  pendingGraphTab = 'userflow'
  window.dispatchEvent(new CustomEvent('ai-live:graph-open', {}))
  window.dispatchEvent(new CustomEvent('ai-live:ask-ai', { detail: { text: dogfoodRunPrompt() } }))
}
