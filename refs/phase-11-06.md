# Phase 11-06 — project types: the editor knows what kind of thing it's building

Goals list: TASKS-APP.md, the 2026-11-06 additions. Plan written
2026-11-06. The phase-11-05 steps stay the foundation; this phase
adds one organizing idea on top of them:

**A project has a declared type, stored in a file in the project.
The type keys everything else** — which device targets matter,
which guidance the agent follows, which tools it gets, which
styles and premade systems it should reach for, and which
knowledge packs are loaded. Xcode is the model: pick a target and
the SDK, templates, and rules follow. Nothing here replaces a
phase-11-05 step; each item names the step it extends.

**The point of the list (2026-11-06): responsive from the start.**
The AI builds with all declared device targets in mind from the
first file, not as a retrofit: the user gets a desktop app that
*always works* on the other targets, and can customize per-target
later if they want. Targets are therefore three things at once —
generation guidance (§D outcome rules), verification (the gate
checks real widths, §B), and a preview convenience — in that
order of importance.

## A. Project type + device targets — the manifest file (extends Step 7)

The manifest also carries the project's **format** — see §B2,
which is load-bearing enough to get its own section.

One file at the project root: `project.ai.json`.

```json
{
  "type": "web-app",
  "deviceTargets": ["phone", "tablet", "desktop"],
  "defaultDeviceTarget": "desktop",
  "styleSet": "lumen-dark",
  "features": ["settings", "chat"]
}
```

- `type` is a string key into the editor's registries (guidance,
  tools, styles, systems, knowledge). Starter set, drawn from the
  projects we actually have: `web-app` (lumen-like), `canvas-tool`
  (grid / Paper.js tools), `game`, `dashboard` (data-dense),
  `content-site`. New types are data, not code: a registry entry.
- **Undesignated is the default state.** A new or opened project
  has *no* designated type until the user designates one (or
  accepts a suggested designation). Absence of the file is a
  first-class state, never an error: undesignated projects get the
  generic guidance, the default tool set, and all-target
  verification. Inference may *suggest*; it never silently sticks.
- **The file is local config, gitignored** — like `providers.json`
  for connections. It lives in the project so every tool that
  opens the folder sees the same config, but it is one config
  file among possibly several, not project source, and it does
  not travel with commits or Step 10 imports. Starters ship the
  `.gitignore` line; the editor tolerates its absence everywhere.
- Read by: the launcher (project profile), the Vite plugin (what
  to inject / which viewport defaults), and the agent (context +
  tool selection). Step 7's `project-profile` tool is the reader;
  its inference fills defaults for projects without the file, so
  existing projects keep opening with zero ceremony — the file is
  written the first time the user sets a type or target.
- Todos: schema + reader in the profile tool; write-on-first-set;
  type shown in the launcher's project strip.
- Risk rejected: inferring type silently forever — inference is a
  bootstrap, the file is the truth once written.

## B. Device target segmented control (extends Steps 4, 7, 9)

Phone | Tablet | Desktop, in the preview bar (launcher) and
mirrored in the live window's chat header, same sync pattern as
the Files | Sketch control. **The control reflects state; it does
not own it** — the state is the project's (manifest) plus the
session's current selection, and the control is how the user sees
and changes it.

- Sets the preview viewport: iframe size in the launcher, pool
  page size on :5173.
- Verification follows the *declared targets*, not the current
  selection: the gate's check-frames (`src/verify/checkFrames.ts`,
  today `CHECK_WIDTHS = [375, 1280]`) become target-derived —
  phone 375, tablet 768, desktop 1280 — so "always works on the
  other targets" is a checked property, not a hope. The selected
  target is the design surface; the rest are the safety net.
  Layout annotations record which target they were made against.
- The selection persists per project (`defaultDeviceTarget`) when
  designated; in an undesignated project it is session-only.
- First slice is deliberately small: control + viewport sizing +
  persistence. Per-target layout snapshots ride the existing gate.

## C. Layout rects in annotation mode — rows & cols (Step 5 Rung 2, Step 4)

Agentation's layout mode already produces placement rects in
pixels. This item makes them *grid* rects:

- A per-project grid config (rows × cols, stored in the manifest
  or a sibling `layout.ai.json`), shown as an overlay grid while
  annotating.
- Placements snap to cells and reach the agent as
  `{row, col, rowSpan, colSpan}` boxes — the Step 4 box format —
  which the agent turns into real grid layout in source, using the
  Step 3 template kinds (module / compound / multi-column).
- This is the concrete form Step 5 Rung 2 was waiting for: same
  adapter, one more mapping (px rect → cells, using the page's
  grid rect at capture time).
- First slice: adapter-side conversion + prompt wording; the
  in-page grid overlay is the follow-up.

## D. Guidance structures per type (extends Step 2)

Step 2 adopted the `SKILL.md` mechanism; types give it content.

- Editor-side packs: `guidance/<type>.md` in the editor package —
  how apps of this type are structured, and **outcome rules**
  stated as checkable outcomes where possible (canvas-tool:
  "every action reachable by keyboard alone"; web-app: "usable at
  360px wide, no horizontal scroll"; dashboard: "dense but aligned
  to the grid").
- Project-side overrides: `<project>/ai-guidance/` files win over
  the pack, so a project can amend its own rules.
- Loaded by the same loader as skills, keyed by the manifest
  type, budgeted like the Step 8 map injection.
- The verify gate grows per-type checks only where an outcome is
  mechanically testable; the rest stays guidance prose. Don't fake
  checks.

## E. Tools per project type — the Xcode rule (extends Step 8, agentTools)

`activeToolsForMode(mode)` already selects tools by Files/Sketch.
It becomes `activeToolsFor(type, mode)`:

- A type tool pack is a named list in a registry next to
  agentTools (canvas-tool: grid/paper helpers + state-machine
  inspection; dashboard: table/chart helpers; web-app: the
  current default set).
- Packs compose with the mode sets (type pack ∩ mode rules: no
  file tools in sketch mode, whatever the type).
- Adding a type's tools is registering a list + writing the tools;
  no agent surgery. The agent's instructions name the pack it's
  running under so its choices are explainable.

## F. Style manager (extends Steps 1, 7)

Styles are data the project points at and the agent must consult
*before* generating UI — not vibes in a prompt.

- Editor-side library of named **GUI styles** (tokens: color,
  type scale, spacing, radius, control look) and **page styles**
  (app-shell arrangements: sidebar+content, master-detail,
  canvas-full, …). Lumen's `THEMES` are the seed example of the
  token half; NCTGraphite's noct-code-appkit ships the grown-up
  version — `noct-theme` (token provider) plus
  `styles/theme-tokens.css` and a `rectangular-dark.css`
  reference theme — and is the baseline to adopt rather than
  starting tokens from zero.
- Project state: `styleSet` in the manifest + a `styles.ai.json`
  when a project customizes tokens. The launcher gets a Style
  panel: list, live preview on the current page, apply (writes
  the file; the agent and the verify gate read it).
- Agent rule, enforced by prompt + gate: new UI uses the active
  style's tokens; the layout verify can flag off-token colors /
  font sizes the way it flags overflow today.
- First slice: token sets only (no page-style application), panel
  read/apply, agent context line naming the active set + tokens.

## G. Premade systems + the reference database (extends Step 1)

Step 1's component registry grows from components to **systems**:
settings, app shell, chat, master-detail, Mastra+AI backend
wiring. A system is a small file bundle plus a registry card:
name, when to use it, its files, its knobs, how it adapts to a
style set.

- Seed stock exists: noct-code-appkit's `app/` group *is* a
  systems shelf (app shell, settings panel, auth form +
  protected region, router, modal, toast, upload, user menu),
  and its `meta/` group shows how the cards should work —
  components self-describe via exported metadata and a registry
  element serves AI introspection. Build the catalogue over
  that stock (and its other groups for components) instead of
  starting empty; see the AppKit note in phase-11-05 Step 1 for
  the format decision (pilot Lit copy-own, don't port wholesale).
- "The database" is the registry itself, made queryable: a
  `find-system` tool (search cards by intent — "user preferences
  UI" → settings system) the agent is instructed to consult
  **before** building anything common from scratch.
- Cards live with the code they describe (in the editor package),
  versioned with it — no external service, no embeddings needed
  at this size; keyword + type filtering is enough until the
  catalogue is much bigger.
- Systems are the payload the Install flow (I) delivers.

## H. Knowledge packs — Paper.js, state machines, Noct libs (extends Step 2)

Same loading mechanism as guidance, different content: how to
work a specific library well.

- A pack = concise API card + idioms + pitfalls + 1–2 canonical
  snippets. Seed packs: Paper.js (paths, hit-testing, the
  onFrame model), state machines (XState-style: states as data,
  no boolean-flag soup), and **Noct libs**: the grid substrates
  from grid-paint-labs packaged as an importable lib with its own
  card, so a canvas-tool project starts from our grids instead of
  reinventing them.
- Packs load when the manifest type implies them or the project's
  package.json actually depends on the library (Step 7 profile
  detection) — knowledge follows evidence, not guesses.
- Noct libs are real code in the editor package (importable by
  path), not just documentation.

## I. "Install app feature…" (new; delivers G through F)

The user-facing flow that ties systems, styles, and guidance
together. Shape:

1. Pick a feature (settings, chat, …) from the systems catalogue.
2. The editor drafts an **install plan as a file**
   (`ai-plans/<feature>.md` in the project): files to add, wiring
   points, how it takes the active style set, what it registers.
3. **Questions before changes**: the plan lists its open choices
   (chat: page, panel, or overlay? in the nav or a launcher
   button? local-only or Mastra-backed?) — the user answers in
   the plan or a small form; defaults are pre-filled from the
   project type + style set. **Layout is a standard question
   dimension** (§J): every system declares the base layouts it
   supports, and an under-specified request ("a settings panel")
   gets the layout question with that supported set — "what
   layout? — master-detail" — before anything is built. The same
   question applies to ordinary generation, not only installs.
4. **Amendments**: the user can edit the plan — add constraints,
   strike steps — before approving. The plan file is the record;
   an install is resumable from it.
5. Execute: the agent runs the plan steps, verify gate per step,
   and the result is summarized against the plan (done / changed /
   skipped), with the manifest's `features` list updated.

- First slice: one feature end-to-end (settings system — it's
  the example in the goals and lumen needs it least, so use a
  scratch project), plan file + questions + execute. AppKit's
  `noct-app-settings` is the obvious first payload: the install
  flow then proves plan + questions + adaptation against a real
  system instead of a toy. The chat system is the second
  install, not the first.

## J. Base layouts — master-detail is one (new layer under G and I)

Master-detail is not a feature; it is a **base layout** — one of
the shells a feature or page is built on. Three layers, kept
distinct:

- **Base layouts** (this section): app/page shells — master-detail,
  sidebar+content, single-column, tabbed, canvas-full. A layout
  says where regions are and how they collapse across device
  targets (master-detail on phone becomes list → detail push;
  that collapse rule is part of the layout, which is how the
  responsive-by-default promise is kept).
- **Systems / features** (§G): settings panel, chat, shell —
  built *on* a base layout; each declares which layouts it
  supports.
- **Templates** (Step 3): module / compound / multi-column
  arrangements of content *inside* a region.

The user-facing consequence: requests are often under-specified
("a settings panel"), and the missing dimension is usually the
layout. The agent asks — "what layout? — master-detail" — with
the system's supported set, defaulted from the project type, and
remembers the answer as the default for that system. Base
layouts are registry entries like everything else: name, regions,
per-target collapse rules, a Step 4 box schema the layout tools
can emit.

## K. Conversations (editor UI)

The launcher's conversation surface becomes master-detail in
shape — list (per project, searchable, status/last activity) +
detail (the full conversation with its deck). The Deck overlay
already proves the detail half; this gives conversations a home
that isn't a single scrolling chat. (It also dogfoods §J: our
own UI on the base layout we ship.)

## Integration points (where each piece hooks into the code, 2026-11-06)

Found before building, per the goals discussion. The pattern to
notice: most of these already have a home; the phase is wiring,
not new subsystems.

| Piece | Hook |
|---|---|
| Manifest read/write | Launcher side, beside the projects API (`src/launcher.ts` `getFsRoot` / `/api/projects`); both servers share it the way `agentationSubmit` is shared. Absence = undesignated, always tolerated. Starters gain the `.gitignore` line. |
| Project brief → agent | `src/chatStream.ts` workflow routing + `editorAgent` instructions: one budgeted context block (type, targets, style set, layout defaults) injected like the sketch preamble and the Step 8 map. Annotation submits build the same brief (`agentationSubmit` / submit handlers). |
| Per-type tools | `src/agentTools.ts`: `activeToolsForMode` becomes `activeToolsFor(type, mode)`; call sites already pass through it. |
| Guidance packs | The Step 2 skill loader, keyed by manifest type, project overrides under `<project>/ai-guidance/`. |
| Device state sync | `src/ui/lib/workflowSync.ts`: the `WorkflowSnapshot` both chat surfaces already consume gains `deviceTarget`; the launcher and the live window stay in sync the way Files \| Sketch does. |
| Segmented control UI | `src/ui/components/Preview.tsx` preview bar (it already hosts Live :5173 + Annotate); mirrored in the chat header via the same snapshot. `noct-segmented` is the component pattern. |
| Responsive verification | `src/verify/checkFrames.ts`: `CHECK_WIDTHS` becomes target-derived (375 / 768 / 1280); `runGate` already keys frames by width. |
| Annotation target | The agentation adapter records the session's current `deviceTarget` on submit, so layout rects (§C) know their frame; check-frames give the px→cell conversion a deterministic width. |
| Live-page injection | The Vite plugin already injects `window.__AI_LIVE_LAUNCHER__` and mounts UI in the page; the chat-embed header reads device state from the workflow snapshot — no new channel. |
| Install flow | Plan files under `<project>/ai-plans/` (plain files, via the existing fs API); questions ride the chat + the plan file; completion updates the manifest `features` list through the launcher API above. |
| Systems / layouts registries | New `catalog/` data in the editor package (Step 1's home), cards in the AppKit metadata shape; `find-system` is one more tool in `src/mastra/tools/`. |

## Status

- **Foundation slice BUILT 2026-11-06** (branch
  `feat/project-foundation`; PUSHED TO MAIN same day as
  snapshot commit 9716d9e, hand-merged onto the
  Agentation-removal main; merged tree verified 192/192
  tests, tsc + ui:build clean, brief re-verified live): `src/projectConfig.ts`
  (manifest read/write/sanitize, brief, target widths) +
  `src/projectConfigApi.ts` (`GET/POST /api/project/config`,
  both servers; explicit empty type un-designates) +
  `src/deviceSession.ts` (session target; workflow snapshot
  carries `deviceTarget`; POST /api/workflow sets it; opening a
  project adopts its `defaultDeviceTarget`). Brief injected into
  streamed + non-streamed chat and both annotation submit paths.
  UI: type select + Phone/Tablet/Desktop segmented in the Preview
  bar (iframe width follows: 375/768/full) and an icon segmented
  in the chat header on both surfaces via the workflow sync.
  Gate: `checkFrames.currentCheckWidths()` derives widths from
  declared targets (undesignated = all three). Verified: 189/189
  tests (7 new), tsc clean, ui:build clean, live E2E (designate
  via API → session adopts phone default → Preview select shows
  web-app → Phone click shrinks preview iframe to 375px → mock
  provider confirms the brief in the chat system messages).
  NCTGraphite cloned to ~/workspace/nctgraphite for the pilot.
- **Landscape change (user, 2026-11-06, on main): Agentation was
  removed and the overlay annotation restored** (their commit
  4236099, with a note in phase-11-05). The foundation was
  hand-merged onto that main: the brief now rides the overlay
  submit handlers (the agentation submit path no longer exists),
  and §C's premise changes — layout capture is the overlay's
  again, so grid-cell rects build on the overlay's placement
  data, not Agentation's. Rung 2 as written in phase-11-05
  Step 5 is superseded by that decision; reconcile there before
  building §C.

## Order of work

A (manifest + profile reader) → B (segmented control) → D + E
(guidance + tools keyed by type) → F (style manager, tokens
first) → C (grid rects; converges with Step 5 Rung 2) → G
(systems catalogue + find-system) → I (install flow, settings
first) → H (packs, ongoing; grids early since canvas-tool needs
them) → J (independent; any time).

A is the foundation: every other item keys off the manifest, so
it lands first and small. B is a quick visible win on top of it.
§J's base-layout registry lands with G (systems declare against
it); K is independent UI work, any time.
