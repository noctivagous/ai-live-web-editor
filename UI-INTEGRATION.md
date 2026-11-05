# UI-INTEGRATION.md — Deck artifacts + TASKS-APP into the 4112 UI

Status: **plan / inventory, prepared 2026-11-05. Slice 1 built locally 2026-11-05
(deck cards + Deck mode, see §5) — awaiting user review, nothing pushed.**
Baseline verified: local clone of `main` @ `b3f65ef` ("premade components"),
`npm install` + `npm run ui:build` succeeds clean (43 modules, ui-dist output).

Sources read in full: `web-artifacts/agentic-chat-deck_web_artifact_{1,2}.html`,
`src/ui/` (App, Chat, Preview, FileTree, Modal, SetupWizard, index.css, lib/*),
`TASKS-APP.md`, `TASKS.md`, `ARCHITECTURE.md`, `src/mastra/agents/editorAgent.ts`,
`src/server.ts` / `src/apiApp.ts` route lists.

---

## 1. What already carried over from the artifacts

The deck *tokens* are already the UI's tokens — this part is done, don't redo it:

- `:root` in `src/ui/index.css` matches the artifacts almost exactly
  (`--bg #0e0e10`, `--panel #141417`, `--card #1a1a1e`, `--border #26262c`,
  blue/green/amber/red, radial blue glow on `.deck-app`).
- Already in deck style: top bar + brand mark, status **pills** with dots,
  `.deck-btn` / `.deck-input` / `.deck-select`, 12px-radius **panels** with
  `.panel-head`, the setup wizard's check-rows, the Files/Live-sketch **seg** control.

What did *not* carry over is the deck *structure*: slides, cards, task rail,
timeline, overview. The current Chat is a single vertical log in a 360px
(default, 600px max) right sidebar:

- user / ai / error messages reuse the wizard's `.check-row` style,
- tools are plain mono text lines in `.chat-tools` (✓ / … / ✕ + detail),
- reasoning is one dashed `.chat-think` box.

## 2. Artifact inventory → live data source

Both artifacts are the same demo ("Add rate limiting to /api/login");
v2 is a superset of v1 (adds a reasoning card, per-slide token/cost,
search relevance scores, richer tool/diff cards). Port v2.

| Artifact feature | In current UI? | Real data source in this repo |
|---|---|---|
| Left rail: task list, status dots (done/running/queued/blocked) | No | Chat **turns**: `LogItem[]` in `src/ui/lib/chatSession.ts` (user → tools → ai). Running = `sending` + `workingLabel`; blocked = `error` items |
| Progress ring (% done) | No | Tool steps done / total in the current turn (`ToolStep.status`). Session-wide % has no honest meaning — scope it to the current turn |
| Rail chips: session, branch, agent, tokens | Partially (top-bar pills) | Project id (`/api/projects`), model (`/api/config`). **Branch: no git API exists. Tokens: see §4** |
| Slide per phase (Intent, Research, Implementation, Testing, Deploy) | No | **Do not fake the 5 phases.** Group by what's actually in the log: Intent = user item; Inspect = `list/grep/read/inspect-dom/take-snapshot/layout-*` steps; Edit = `str-replace/write-real-file` steps; Live = `patch-dom/eval-js` steps (sketch workflow); Result = ai item; Error = error item. A slide exists only if its group exists |
| Intent card (big ask text) | As small chat bubble | `LogItem {role:'user'}` |
| Plan card (checklist) | No | No plan tool/event exists. Honest v1 substitute: the turn's tool-step list rendered as a checklist. A real plan card needs a plan step from the agent (backend gap, §4) |
| Reasoning card (v2, collapsible steps) | As `.chat-think` | `LogItem {role:'think'}` / `reasoning-delta` events — already streamed |
| Tool card (pill, time, collapsible detail/result) | As text lines | `ToolStep {id,name,detail,result,status}` — already collected by `upsertToolStep` in Chat.tsx. **Elapsed time is not recorded** — can be added client-side when a step flips running→done |
| Search results grid | No | No web-search tool in the agent. `grep` results are the local equivalent — render grep/read steps as a compact results list, not a fake web grid |
| Diff card (+/−, mono lines) | No | `str-replace` steps carry old/new lengths in Chat.tsx's preview logic, but not the actual strings in the persisted log. Real diff lines need the tool args/result preserved (small chatSession extension) |
| Test card (spinner, pass list) | No | **No test-run tool exists in the agent.** Do not render test cards until there is one (TASKS-APP / backend gap, §4) |
| Reflect / result card | As ai bubble | `LogItem {role:'ai'}` |
| Bottom timeline pill (numbered turns, active state) | No | Turn index from the same grouping; click scrolls to / opens that turn |
| Overview grid (press O, click a slide to jump) | No | Same grouping, rendered scaled in an overlay — pure UI |
| "Live" pill (jump to running slide) | No | Visible while `sending`; jumps to the last (running) turn |
| Keyboard ←/→, O, Esc | Only Esc = stop in Chat input | Add in deck mode only, so Monaco shortcuts are untouched |
| Simulate Agent Activity button | n/a | Demo-only. Skip — our agent is real |
| Tailwind CDN + Lucide CDN | No (deliberately) | Repo UI is React + plain CSS, no icon lib. Port the CSS by hand into `index.css`; use text/unicode glyphs as the current UI does. **No new runtime deps for Slice 1** |

### The size problem (decides the shape)

Artifact slides are fixed 720px wide. The chat sidebar is 360px default /
600px max (`src/ui/lib/panes.ts`). The deck therefore cannot be pasted into
the sidebar. Two layers instead:

1. **Deck cards in the sidebar (always on).** The log becomes grouped
   turn-cards at sidebar width: Intent, Reasoning (collapsed), Tool cards
   (collapsed, status-coloured), Result, Error — plus a compact turn strip
   at the top of Chat (status dots + current-turn progress). Fits 360–600px,
   and the shared `Chat` component carries it into `/chat-embed` for free.
2. **Deck mode (expanded).** An Expand control in the Chat header opens the
   horizontal deck as an overlay over the centre panel (editor+preview):
   one slide per turn-group, scroll-snap, timeline pill, Overview (O),
   ←/→ navigation, Live pill. Esc closes. This is where the artifact's
   layout survives at full fidelity.

## 3. TASKS-APP.md → UI surfaces

TASKS-APP is a vision list, not specs. Mapped to concrete UI, in dependency order:

| TASKS-APP item | UI surface | Needs backend? |
|---|---|---|
| Premade, theme-able components; layout components (StackPanel-like) the agent knows about | **Library panel**: new left-panel tab (Files / Library) — browse/search a shipped catalog, preview a component, "Insert" (writes the file) or "Ask AI to use it" (seeds chat). Agent instruction lists the catalog so it imports instead of reinventing | Catalog files + one agent-prompt section. Insert can reuse `POST /api/fs/write`. No new API for v1 |
| "Skills" / script guidelines for dev tasks (layouts mobile/tablet-ready by default, etc.) | **Skills picker in Chat**: chips above the input; the chosen skill's guideline text is prepended to the turn (same mechanism as `Current file:` in `historyForAgent`) | No — guidelines can ship as UI-side strings first; later move to files the agent reads |
| Layout templates / schemes; module, compound, multi-column controls | **Templates section of the Library panel**: template cards (module / compound / multi-column …) → preview as SVG wireframe → "Use template" seeds chat + drops the wireframe spec in | Wireframe rendering is UI-side SVG; agent application is a chat turn |
| SVG layout & wireframe utils for the agent | **Layout view in Preview**: toggle showing `layout-svg` output beside the preview (the tool + `/api/layout/svg` already exist — currently no UI calls them) | No — API exists, unused by the UI |
| Annotation: drag representative boxes over regions + notes → layout box or issue; draggable wireframe controls over the page, Submit incorporates them | **Preview annotate v2**: drag-rectangle regions (today: click-one-element only, and disabled on Live :5173), a small wireframe-controls palette (box, row, column, text) you drag onto the page, notes per region, Submit → existing `/api/live-edit/submit` with region notes | Overlay JS work (`overlay.js` / Preview.tsx). Submit API shape may need a `region` note type — check `PageNote` (`selector,text,type?,targetSelector?`) before building |
| File System Access API (Chrome `showDirectoryPicker`) for a session directory | **"Open folder…" in the project dropdown area** | **Mismatch to resolve first:** the launcher owns the FS (`projects/<active>` on disk, agent writes there). A browser-picked directory can't become the agent's root without a new write path. Honest v1: pick a folder to *browse/import* into `projects/`, or defer until a client-side FS bridge is designed. Do not ship a picker that pretends to switch the workspace |
| Web-app specialisation: DevTools/debugger, Node/packages, React, Tailwind awareness; token-efficient search/replace/insert | Mostly agent-side (partly done: `grep`, ranged read, `str-replace` already shipped). UI slice: **Diagnostics strip** — package.json summary (deps, Tailwind present?) + last inspect selector, shown in the Files panel footer. Reads via existing `/api/fs/read` | No new API for the strip |
| Codebase markers / relations so the agent knows the codebase faster | **Working-set strip in Chat**: files touched this session (from tool steps) + active file, as clickable chips that open the file | No — derivable from `LogItem` tool steps client-side |
| Subagents / MCP server | Rail's agent chip in the artifact is the seed of this. UI now: nothing real to show (single Mastra agent, `maxSteps: 12`). Park the UI until a second agent/MCP tool actually exists | Yes — backend first |
| "Are we achieving our tight loop goal in a way that is superior?" | The deck itself is the answer surface: per-turn elapsed, steps, and (when instrumented) tokens make the loop *visible*. Slice 1 records step elapsed client-side | Token usage needs §4 |

### TASKS.md open items that belong in the same pass (cheap, high-friction)

- Replace both native `prompt()` calls (New Project in App.tsx, New File in
  FileTree/App.tsx) with a deck-style in-app dialog — Modal.tsx already has
  the Overlay pattern. (TASKS.md: "New File dialog")
- Dirty dot on the active file + Cmd/Ctrl+S save. (App.tsx: save is
  button + 800ms autosave; no keyboard handler, no dirty state.)
- File delete / rename — **needs a new API** (`POST /api/fs/delete`,
  rename) in both `server.ts` and `apiApp.ts`; UI is the easy half.
- Inspect selector input — there is currently no Inspect UI in the 4112
  shell at all (Inspect lives in the overlay/`NoticeDialog` path); fold
  into the Layout view above rather than reviving a hardcoded-`body` dialog.

## 4. Backend gaps the artifacts assume (do not fake in UI)

1. **Token / cost per turn** — `ChatStreamEvent` (`src/ui/lib/api.ts`) has no
   usage field; the `done` event carries nothing. Needs the stream handler
   (`src/chatStream.ts`) to forward Mastra usage on `done`.
2. **Plan steps** — no plan event/tool; the agent's "one short sentence
   before each group of tools" is the closest thing and already arrives as
   text deltas.
3. **Test runs** — no test tool in `editorAgent.ts`; test cards wait on one.
4. **Git branch/status** — no endpoint; rail chip would need one.
5. **Delete/rename FS endpoints** — see §3.

## 5. Proposed slices (each: build locally → `npm run ui:build` → you review → push only on your say-so)

- **Slice 1 — Deck cards + Deck mode for Chat (recommended first).**
  Pure UI (`Chat.tsx`, new `Deck.tsx` grouping module + tests in the style of
  `chatSession.test.ts` / `panes.test.ts`, `index.css`). Grouping logic is a
  pure function `groupTurns(log) → Turn[]` so it's testable without the agent.
  Includes: card types above, turn strip + current-turn progress, elapsed per
  tool step, working-set chips, Expand → horizontal deck + timeline +
  overview + Live pill + ←/→/O/Esc. No backend, no new deps, embed included.
- **Slice 2 — Library panel: premade components + layout templates + skills.**
  Left-panel tab; shipped catalog (start small: Stack/Row/Grid layout
  primitives + a few theme-able basics, using the existing deck tokens as
  the theme), SVG template previews, skills chips in Chat, agent prompt
  learns the catalog. Touches `editorAgent.ts` instructions + new catalog
  files — bigger blast radius, hence second.
- **Slice 3 — Preview annotate v2 + Layout view.**
  Drag-region annotations, wireframe-controls palette, `layout-svg` viewer.
  Touches overlay JS served on :5173 as well as the 4112 UI.
- **Quick wins (can ride along with Slice 1):** in-app New File / New
  Project dialog (kills both `prompt()`s), dirty dot, Cmd/Ctrl+S.

Open choice for the user: start with Slice 1 as above, jump straight to
Slice 2 (Library/components — the newest TASKS-APP push, "premade
components" was the last commit), or do the quick wins first.
