/**
 * Demo chat replays — the demo's chat, honestly labelled.
 *
 * There is no live agent in the demo. These are three recorded
 * turns, authored to the real ChatStreamEvent shapes (status,
 * tool calls, text deltas, a done event carrying the verify
 * gate's verdict in the Muse Code Stop-hook shape) and streamed
 * with realistic pacing through the unmodified chat UI. Every
 * fact in the answers comes from the sample project's fixture:
 * its feature graph, its git state, its (empty) test/CI/deploy
 * picture. The edit turn applies a real patch to the in-memory
 * fixture file, so the change is there to open afterwards.
 *
 * The composer offers these three prompts as chips; free text
 * gets the fallback turn, which says plainly that these are
 * replays and where the real agent runs.
 */
import type { ChatStreamEvent } from '../lib/api'

export const DEMO_REPLAY_LABEL = 'Demo replay — recorded turns, not a live agent.'

export interface DemoPatch { path: string, find: string, replace: string }

export type DemoStep =
  | { delayMs: number, event: ChatStreamEvent }
  | { delayMs: number, patch: DemoPatch }

export interface DemoReplay {
  id: string
  prompt: string
  match: string[]
  steps: DemoStep[]
}

const status = (text: string, delayMs = 350): DemoStep => ({ delayMs, event: { type: 'status', text } })
const toolCall = (id: string, name: string, detail: string, delayMs = 550): DemoStep =>
  ({ delayMs, event: { type: 'tool-call', id, name, detail } })
const toolResult = (id: string, name: string, detail: string, delayMs = 650): DemoStep =>
  ({ delayMs, event: { type: 'tool-result', id, name, ok: true, detail } })
const done = (extra: Partial<Extract<ChatStreamEvent, { type: 'done' }>> = {}): DemoStep =>
  ({ delayMs: 250, event: { type: 'done', model: 'Demo replay', usage: null, ...extra } })

/** Split an answer into word-boundary text deltas, streamed at
 * reading pace — the same shape a live turn arrives in. */
function textSteps(text: string): DemoStep[] {
  const steps: DemoStep[] = []
  let rest = text
  let first = true
  while (rest.length > 0) {
    let cut = Math.min(rest.length, 110)
    if (cut < rest.length) {
      const space = rest.lastIndexOf(' ', cut)
      if (space > 40) cut = space + 1
    }
    steps.push({ delayMs: first ? 300 : 45 + Math.floor(Math.random() * 40), event: { type: 'text-delta', text: rest.slice(0, cut) } })
    rest = rest.slice(cut)
    first = false
  }
  return steps
}

export const DEMO_REPLAYS: DemoReplay[] = [
  {
    id: 'organisation',
    prompt: 'How is this project organised?',
    match: ['organis', 'organiz', 'structure', 'feature graph', 'laid out'],
    steps: [
      status('Reading the feature graph…'),
      toolCall('replay-1-tool', 'feature-query', 'Feature graph — regions and build state'),
      toolResult('replay-1-tool', 'feature-query', '23 nodes · 4 regions · 58% built'),
      ...textSteps(
        'Lumen is organised as four regions in its feature graph:\n\n' +
        '- **Inbox & Email** — the triage workspace and smart compose, with a thread-summarisation hook planned. Its email data store and inbox-zero stat component are done.\n' +
        '- **Today & Scheduling** — the schedule view and the calendar add + RSVP flow, over a finished events store.\n' +
        '- **People & Relationships** — the relationship view and a meeting-notes composer, over a finished people store.\n' +
        '- **App Shell & Design System** — the overview shell, the theme and view-switcher settings, the shared Button component, and the app entry. Most of this region is built; the overview screen itself is still marked building.\n\n' +
        'Across the graph: 19 counted features, screens, components, settings and services — 11 built, 58%. The pattern underneath: the data stores are done and the screens on top of them are still catching up.\n\n' +
        'This is the same graph the Features facet shows. Open it from the facet bar to browse every node and its state.'),
      done(),
    ],
  },
  {
    id: 'edit',
    prompt: 'Change the subject of Nora’s email to “Onboarding empty state: the first-run inbox pass”',
    match: ['nora', 'subject', 'retitle', 'rename'],
    steps: [
      status('Finding the thread…'),
      toolCall('replay-2-tool', 'str-replace', 'App.jsx — the subject of Nora Feldman’s email'),
      { delayMs: 400, patch: { path: '/App.jsx', find: "subject: 'Onboarding empty state needs a pass',", replace: "subject: 'Onboarding empty state: the first-run inbox pass'," } },
      toolResult('replay-2-tool', 'str-replace', '1 replacement in App.jsx'),
      status('Running the verify gate…', 500),
      ...textSteps(
        'Done — the subject now reads “Onboarding empty state: the first-run inbox pass”. Open App.jsx and you’ll see the change; edits in the demo live in your browser’s memory only, and the preview pane shows the project’s recorded build, so it won’t reflect them.\n\n' +
        'The verify gate ran after the edit, as it does after every agent turn in ALE. It came back with one new layout finding: at phone width, the longer subject now overflows its row in the thread list. No new console errors. The verdict is attached to this turn as the gate’s card — open the chat’s Deck view to see it — and locally that card offers to dispatch an agent to fix the finding.'),
      done({ verification: { ran: true, clean: false, newLayout: 1, newConsole: 0 } }),
    ],
  },
  {
    id: 'delivery',
    prompt: 'Is this project ready to ship?',
    match: ['ship', 'ready', 'deploy', 'delivery', 'release'],
    steps: [
      status('Checking the delivery state…'),
      toolCall('replay-3-git', 'ale_git_status', 'Git status and recent history'),
      toolResult('replay-3-git', 'ale_git_status', 'main · clean tree · 7 commits touch this project'),
      toolCall('replay-3-tests', 'ale_tests_overview', 'Test discovery and recorded runs', 400),
      toolResult('replay-3-tests', 'ale_tests_overview', 'No test suites discovered', 450),
      toolCall('replay-3-ci', 'ale_ci_status', 'CI summary', 400),
      toolResult('replay-3-ci', 'ale_ci_status', 'No CI provider detected', 450),
      ...textSteps(
        'On the recorded state of this sample: not yet — and Delivery is the facet where you’d watch that change.\n\n' +
        '- **Git** — on `main` with a clean working tree, so there’s a tidy baseline to ship from.\n' +
        '- **Tests** — no test suites are discovered in this project, so there’s no green run to point at. Locally, this section lists the suites it finds and keeps their run history.\n' +
        '- **CI** — the project has no CI workflows, so nothing checks it on push.\n' +
        '- **Deployment** — no target is detected (no Cloudflare or Vercel config in the project) and nothing has been deployed.\n\n' +
        'The Overview answers the same four questions at a glance. In a local install each section also acts: stage and commit, run the suites, trigger CI, deploy.'),
      done(),
    ],
  },
]

export const DEMO_FALLBACK_REPLAY: DemoReplay = {
  id: 'fallback',
  prompt: '',
  match: [],
  steps: [
    status('Demo replay…'),
    ...textSteps(
      'This chat is a recording, not a live agent — the demo can’t act on free-form requests. Three recorded turns show the main flows:\n\n' +
      '1. **“How is this project organised?”** — a tour of the feature graph.\n' +
      '2. **“Change the subject of Nora’s email…”** — a real edit to the sample’s files, with the verify gate’s verdict.\n' +
      '3. **“Is this project ready to ship?”** — the Delivery picture.\n\n' +
      'Use one of the prompts above the composer. To work with a live agent, run ALE locally — it edits your own projects, on your own machine.'),
    done(),
  ],
}

/** Pick the replay a message asks for: the chip prompts match
 * their own replay; free text is matched on plain keywords, in
 * the order edit → delivery → organisation (a question about
 * Nora's email is an edit even if it also mentions the project). */
export function pickReplay(userText: string): DemoReplay {
  const text = userText.toLowerCase()
  for (const replay of [DEMO_REPLAYS[1], DEMO_REPLAYS[2], DEMO_REPLAYS[0]]) {
    if (replay.match.some(m => text.includes(m))) return replay
  }
  return DEMO_FALLBACK_REPLAY
}
