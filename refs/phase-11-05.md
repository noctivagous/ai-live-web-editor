# Phase 11-05 — TASKS-APP goals: where we are, and the detailed build plan

Date: 2026-11-05. Baseline: `main` @ `1584e7a` (Deck Slice 1 `42a7e7b` +
BYOK provider setup `cd7230d` merged). Companion docs:
[TASKS-APP.md](../TASKS-APP.md) (vision), [UI-INTEGRATION.md](../UI-INTEGRATION.md)
(slice plan), [agent-context-and-edits.md](./agent-context-and-edits.md),
[agentic-editor-codebases.md](./agentic-editor-codebases.md).

This file turns the vision into checkable work. Every step has:
**Where we are** (verified in code), **Web research** (what the field does
now), **Plan**, and `- [ ]` todos with acceptance checks. Nothing here is
done until its boxes are checked against a running build.

---

## 0. Scorecard — TASKS-APP goal → status today

| TASKS-APP goal | Status | One-line evidence |
|---|---|---|
| Live editor specialised for web apps | Done (core) | Launcher `:4112` + Vite `:5173`, Monaco, preview, chat |
| Token-tailored search / replace / insert | Done (v1) | `grep` + ranged `read-real-file` + `str-replace` (fail closed) |
| Live DOM / page awareness | Done (v1) | `inspect-dom`, `take-snapshot`, `patch-dom`, `eval-js`, page bridge |
| SVG layout + wireframe utils for the agent | Backend only | `layout-snapshot` / `layout-svg` tools exist; no UI calls them |
| Chrome DevTools (debugger etc.) | Not done | No console / network / trace / Lighthouse tool; no MCP client |
| Node / package / React / Tailwind awareness | Not done | No project-profile tool; starters have no Tailwind |
| File System Access API directory per session | Not done | Server owns `projects/<active>`; no `showDirectoryPicker` anywhere |
| Markers / codebase relations / faster knowing | Not done | No index, AST map, or symbol graph; `grep` only |
| Subagent processes | Not done | Single Mastra `editorAgent`, `maxSteps: 12` |
| MCP server (consume or expose) | Not done | No `@mastra/mcp` dependency or config |
| Premade, theme-able components agent knows | Not done | Commit `b3f65ef` only edited TASKS-APP; no catalog in code |
| Skills / script guidelines (mobile/tablet-ready) | Not done | One inline system prompt in `editorAgent.ts`; no `SKILL.md` |
| Layout templates / schemes (module, compound, multi-column) | Not done | No template files, no picker |
| Annotation: drag boxes over regions + notes | Partial | Click-one-element annotate; no drag-region, no wireframe palette |
| Tight loop *proven* superior | Not measurable | Stream `done` event carries no token usage (`src/chatStream.ts:12`) |

### Already shipped and not to be redone

- [x] Files vs Live-sketch workflows, gated by `activeTools`
  (`src/agentTools.ts`: `FILE_ACTIVE_TOOLS` / `SKETCH_ACTIVE_TOOLS`).
- [x] `str-replace` exact-unique-match, fail closed; `write-real-file`
  only for new files (`src/mastra/tools/realFsTools.ts:96`, prompt rule
  in `src/mastra/agents/editorAgent.ts:25-28`). Never placeholder-rewrite
  on a replace miss.
- [x] Live sketch patch engine with insert / move / restore + tests
  (`src/live-edit/patchEngine.js`, `patchEngine.test.ts`).
- [x] Deck Slice 1: turn cards, per-tool elapsed, working-set chips,
  Deck mode (`src/ui/lib/deck.ts`, `src/ui/components/Deck.tsx`).
- [x] BYOK provider setup: multiple connections, per-modality defaults
  (`src/connections.ts`, `src/ui/components/ProviderSetup.tsx`).
- [ ] Fix the two pre-existing `tsc` errors before any step that touches
  those files: `src/browserPool.ts:169` (`count` on `{elapsedMs}`) and
  `src/liveTarget.ts:35,46,59` (`"snapshot"` not in the action union).
  Acceptance: `npx tsc --noEmit` exits clean.

---

## Priority reframe (2026-11-05 review — read this first)

The steps below were written in TASKS-APP order. The build order is
not that order. Specialising in web apps only beats a generalist
(Cursor + file writes + browser MCP) where we take decisions away by
convention and join worlds the generalist keeps separate. Ranked:

- **P0-a. DOM ↔ source identity.** Selector → React component →
  file → JSX range → props. This fuses annotate, sketch, and the
  codebase map into one mechanism a file+MCP setup cannot easily
  copy. Lives in Step 8 (Rung 0) + Step 5 (sketch→source).
- **P0-b. Automatic web-shaped verification.** After an edit:
  layout geometry at 375/768/1280 + console, as a host gate, not a
  tool the model must remember. Lives in Steps 4 + 6 Tier 1.
- **P0-c. Sketch→source persistence.** Accept must land the patch
  log in source (Step 5). Without it the tightest loop we have is
  exploration-only.
- **P1. Generation defaults.** Project profile (Step 7), catalog
  (Step 1), templates (Step 3), skills (Step 2): the agent selects
  shipped patterns instead of composing from training data.
- **P2. Stack-aware edit primitives.** Tailwind-class, import, and
  prop-aware edits on top of `str-replace` (Step 8), dialect chosen
  by the Step 7 profile.
- **P3. Everything else.** Annotation v2 breadth (Step 5 UI),
  DevTools MCP Tier 2 (Step 6), folder import (Step 10),
  subagents/MCP server (Step 11). Real, but none of it is the moat.

Not the moat, do not let them jump the queue: more generic tools,
a bigger tool list, subagents for their own sake, an MCP server.
Anyone can bolt those on. §12 encodes this order.

---

## 1. Premade, theme-able components the agent knows about

### TASKS-APP wording

> "premade, generic, theme-able components that we ship with it, that the
> code editor agents know exist, so that apps are constructed rapidly
> rather than the AI building these things from scratch each time. This
> includes layout components, such as how there is StackPanel in XAML."

### Where we are

No catalog exists. `projects/lumen`, `projects/demo`, `projects/demo2`
are bare React + Vite (`react`, `react-dom` only). The agent invents
every button, card, and layout from training data on every turn. The
Library panel is designed in UI-INTEGRATION §3/§5 (Slice 2) but no code
was written; commit `b3f65ef` "premade components" changed only
`TASKS-APP.md`.

### Web research (2026-11-05)

- The ecosystem converged on **shadcn/ui + Tailwind** as the component
  system AI generates by default: v0, Bolt, Lovable, Cursor, and Claude
  Code all emit shadcn-style components; shadcn passed ~115k GitHub
  stars and was the #1 JS project of 2024 (JavaScript Rising Stars).
  Sources: [shadcndeck.com/blog/rise-of-shadcn-ui-2026](https://www.shadcndeck.com/blog/rise-of-shadcn-ui-2026),
  [aiwiki.ai/wiki/vercel_v0](https://aiwiki.ai/wiki/vercel_v0),
  [untitledui.com/blog/untitled-ui-vs-shadcn](https://www.untitledui.com/blog/untitled-ui-vs-shadcn).
- shadcn is **copy-own, not an npm dependency**: source files land in
  the user's project (`components.json` + CLI / registry). That matches
  this product perfectly — the agent edits real files, so components it
  "uses" should be real files it can also restyle with `str-replace`.
- The registry pattern is now agent-facing: registries expose named
  components/blocks the CLI (or agent) installs by name
  ([ui.aceternity.com/installation](https://ui.aceternity.com/installation),
  [shadcnblocks.com](https://www.shadcnblocks.com/blocks/blog)). A small
  in-repo registry + manifest gives the same affordance without an
  external service.
- Layout primitives already exist in that idiom (Stack, Row/Columns,
  Grid, Spacer, Divider) in community registries — e.g. termcn's layout
  set (Aspect Ratio, Box, Center, Columns, Grid, Stack). We only need a
  handful, themed on our existing deck tokens.

### Plan — ship a small in-repo registry, not a library package

Decisions (settled here, revisit only with evidence):

1. **Format:** plain React + CSS custom properties first, Tailwind
   variant second (see Step 7 — starters have no Tailwind yet). Each
   component is a single copy-own file the Library "Insert" writes into
   the active project. No new runtime dependency for the host.
2. **Theme:** CSS variables aligned with the deck tokens already in
   `src/ui/index.css` (`--bg`, `--panel`, `--card`, `--border`, accent
   blue/green/amber/red) so generated apps look like the editor family.
3. **Layout primitives first** (the StackPanel ask): `Stack` (vertical,
   gap, align), `Row` (horizontal, wrap, justify), `Grid` (columns,
   min-column-width, gap), `Spacer`, `Divider`, `Panel` (card surface),
   plus basics: `Button`, `Input`, `Card`, `Badge`, `Tabs` shell.
   Cap v1 at ~10 components; breadth is Step 3 templates' job.
4. **Manifest the agent reads:** `catalog/components.json` (name,
   file, props summary, when-to-use one-liner). The agent prompt gets
   the manifest (names + one-liners only, ~300 tokens), not bodies —
   same progressive-disclosure economics as Skills (Step 2).
5. **Library panel** (UI-INTEGRATION Slice 2): left-panel tab
   Files / Library, search, preview, **Insert** (reuses
   `POST /api/fs/write`) and **Ask AI to use it** (seeds chat).

### Todos

- [ ] Create `catalog/` in-repo: `components.json` manifest + one file
  per component (React, CSS-var themed, no external deps).
- [ ] Implement layout primitives: `Stack`, `Row`, `Grid`, `Spacer`,
  `Divider`, `Panel` with typed props (direction, gap, align, columns).
- [ ] Implement basics: `Button`, `Input`, `Card`, `Badge` on the same
  tokens; each renders correctly with zero project CSS setup beyond
  one `theme.css` the Insert flow can add.
- [ ] Add the manifest summary to `editorAgent` instructions
  (names + one-liners + "prefer catalog over inventing markup").
  Acceptance: agent asked for "a settings page" imports catalog
  components instead of hand-rolling divs (check tool calls / output).
- [ ] Library panel tab in the 4112 UI: list/search from the manifest,
  rendered preview, Insert writes the file (and `theme.css` once).
- [ ] "Ask AI to use it" seeds a chat turn naming the component.
- [ ] Seed one starter (`projects/lumen`) with the catalog installed so
  first-run generation uses it. Keep other starters untouched.
- [ ] Tests in repo style: manifest ↔ files consistency test (every
  manifest entry has a file, every file is listed); UI grouping tests
  if panel logic is non-trivial.
- [ ] `npm run ui:build` clean; verify in the running editor
  (insert → preview renders → agent edit via `str-replace` still works).

### Risks / alternatives rejected

- Building a bespoke npm component library: versioning + install
  friction, and models write shadcn-style code better anyway.
- Depending on the public shadcn CLI/registry at runtime: network +
  `components.json` requirements our starters don't meet yet. Revisit
  after Step 7 (Tailwind) lands; the manifest shape should stay
  CLI-compatible (`name`, `type`, `files`) so migration is cheap.

---

## 2. Skills / script guidelines for development tasks

### TASKS-APP wording

> "We can include script guidelines for various software development
> tasks like making layouts, what they call 'skills' in the agentic
> editors. It will use our techniques and foundations so that when it
> makes layouts they are mobile and tablet ready unless the user [says
> otherwise]."

### Where we are

No skills exist in any form. All guidance is one inline `instructions`
string in `src/mastra/agents/editorAgent.ts` (edit policy, workflow
routing, live-edit priority). UI-INTEGRATION §3 proposed UI-side skill
chips that prepend guideline text to a chat turn — workable, but it
invents a private format.

### Web research (2026-11-05)

- **Agent Skills is now an open standard.** Anthropic launched Skills
  in Claude (Oct 2025) and published the format at agentskills.io on
  2025-12-18; 40+ clients (Claude Code, Codex, Cursor, Copilot, …)
  read the same folder unmodified. In Oct 2026 Anthropic donated the
  standard to the Agentic AI Foundation (Linux Foundation).
  Sources: [shiplight.ai/blog/agent-skills](https://www.shiplight.ai/blog/agent-skills),
  [anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills),
  [atlan.com/know/ai-agent/ai-agent-skills](https://atlan.com/know/ai-agent/ai-agent-skills/what-are-agent-skills/).
- **Format:** a folder with `SKILL.md` = YAML frontmatter (`name`,
  `description`, optional `allowed-tools`) + Markdown body; optional
  `scripts/`, `references/`, `assets/` siblings.
- **Progressive disclosure is the token story:** metadata (~100 tokens
  per skill) always visible; body (<5k tokens) loads only when the
  task matches; references load on demand. This directly serves the
  TASKS-APP token goal — guidelines cost almost nothing until used.
  Sources: [denser.ai/blog/agent-skills-guide](https://denser.ai/blog/agent-skills-guide),
  [deepwiki.com/supabase/agent-skills/4-skill-structure](https://deepwiki.com/supabase/agent-skills/4-skill-structure).

### Plan — adopt `SKILL.md`, load it ourselves

Mastra has no built-in Skills loader, so the host implements the
three disclosure levels cheaply:

1. At agent build, scan `skills/*/SKILL.md` frontmatter; inject only
   `name` + `description` lines into instructions (~100 tokens each).
2. Add one tool `load-skill` (`name` → body text). The agent calls it
   when a description matches; body enters context for that run only.
3. Skill `references/` files are read via existing `read-real-file`-
   style access scoped to the skill folder (or a `load-skill-ref`).
4. UI-INTEGRATION's chips become a thin override: choosing a chip
   forces `load-skill` for that turn. No private guideline strings.

First skills (each encodes *our* foundations, per TASKS-APP):

- `making-layouts` — catalog primitives first (Step 1), templates
  (Step 3), layout-svg check (Step 4), mobile-first breakpoints:
  base single column; `≥640px` two-column where content allows;
  `≥1024px` full multi-column. (Tailwind defaults `sm 640 / md 768 /
  lg 1024` when Tailwind is present — Step 7 detects which world the
  project is in.) Source for breakpoint conventions:
  [handoffpro.dev/blog/responsive-design-handoff](https://www.handoffpro.dev/blog/responsive-design-handoff).
- `editing-web-files` — the existing prompt rules (grep → ranged read
  → str-replace; write only for new files) moved out of the system
  prompt so they load only for file work.
- `live-sketch` — snapshot → patch-dom sequencing, insert/move rules,
  Accept/Undo etiquette (today's Live-sketch prompt section).
- `checking-the-page` — when to use inspect/snapshot/layout-svg and
  (Step 6) console/network tools before claiming a fix works.

### Todos

- [ ] Create `skills/` with the four skills above as `SKILL.md`
  folders (frontmatter + concise body; bodies cite catalog/template
  names from Steps 1 and 3, not copies of them).
- [ ] Frontmatter scanner + instructions injection (metadata level
  only) in the agent wiring; unit test: instructions contain names,
  not bodies.
- [ ] `load-skill` tool (Files + Sketch sets as appropriate in
  `src/agentTools.ts`); test: unknown name fails cleanly, known name
  returns body once.
- [ ] Shrink `editorAgent.ts` inline instructions to routing + safety
  rules; move edit/layout guidance into the skills. Acceptance:
  a layout ask triggers `load-skill(making-layouts)` in the stream;
  a plain copy fix does not pay the layout body tokens.
- [ ] Optional chat chips (UI-INTEGRATION Slice 2): chip = forced
  `load-skill` for the turn. Only after the tool path works.
- [ ] Document authoring rules in `skills/README.md` (frontmatter
  required, body <5k tokens, one task per skill) so future skills
  stay cheap.

### Risks / alternatives rejected

- UI-only guideline strings: invisible to any other agent/client and
  duplicated with the prompt. The standard format is free to adopt.
- Loading all skill bodies into the system prompt: defeats the token
  goal; metadata-only + on-demand load is the entire point.

---

## 3. Layout templates / schemes (module, compound, multi-column)

### TASKS-APP wording

> "set of layout templates or schemes so that when the ai editor is
> working on layouts it has guidance and can choose from templates
> and arrangements instead of make things from its training data.
> will have module, compound, multi-column layout controls."

### Where we are

Nothing: no template files, no picker, no agent-side template names.
Every layout is improvised from training data — exactly what this
item says to stop doing.

### Web research (2026-11-05)

- The shadcn ecosystem's unit above components is the **block**: a
  self-contained section (hero, pricing grid, feature grid, blog card
  grid) installed by name from a registry
  ([shadcnblocks.com](https://www.shadcnblocks.com/blocks/blog),
  [shadcnuikit.com/components](https://shadcnuikit.com/components)).
  Blocks are the proven granularity for "choose an arrangement, then
  customise" — templates here should be blocks built on Step 1
  primitives, not full pages.
- Responsive template practice: fluid grids + a small breakpoint set,
  mobile-first (base styles small, `min-width` layers up). Designers
  hand off snapshots at 3–4 breakpoints; our templates should declare
  their behaviour at mobile / tablet / desktop explicitly.
  Sources: [handoffpro.dev/blog/responsive-design-handoff](https://www.handoffpro.dev/blog/responsive-design-handoff),
  [blog.jiteshprakash.com.np/blog/responsive-design-breakpoints](https://blog.jiteshprakash.com.np/blog/responsive-design-breakpoints/).

### Plan — a template is a named, previewable arrangement

1. **Template = manifest entry + source + SVG wireframe.** Store in
   `catalog/templates/` alongside components (Step 1 manifest gains a
   `templates` section or a sibling `templates.json`). Each entry:
   `name`, `kind` (`module` | `compound` | `multi-column`),
   `description`, `breakpoints` (how it collapses), `uses`
   (catalog components it composes), `file`.
2. **V1 set (cap at 6):**
   - `module-single` — one panel, header + body (the atomic module).
   - `module-stack` — vertical stack of modules, consistent gap.
   - `compound-split` — main module + side module (2fr/1fr →
     stacks on mobile).
   - `compound-dashboard` — header module + split below.
   - `multi-column-2` / `multi-column-3` — card grids,
     1 → 2 → 3 columns across breakpoints.
3. **Agent contract:** `making-layouts` skill (Step 2) lists template
   names + one-liners; agent picks one, inserts it (same write path
   as components), then customises content with `str-replace`.
4. **UI:** Templates section of the Library panel (Step 1) with the
   SVG wireframe as the preview image — the wireframe is generated
   from the same box data the agent receives (Step 4 format), so
   preview and agent guidance can never drift apart.

### Todos

- [ ] Define the template manifest schema (extend Step 1 manifest or
  sibling file) + consistency test (entry ↔ file ↔ wireframe).
- [ ] Implement the 6 v1 templates on Step 1 primitives, each
  verified at 375px / 768px / 1280px widths in the preview.
- [ ] Generate/store one SVG wireframe per template (Step 4 box
  format); Library panel renders it as the template preview.
- [ ] List templates (name + kind + one-liner) in the
  `making-layouts` skill body. Acceptance: "build a pricing page"
  starts from `multi-column-3` (or `compound-*`) instead of freehand
  divs — check the first file write of the run.
- [ ] Library panel Templates section: kind filter
  (module / compound / multi-column), wireframe preview,
  Insert + Ask-AI actions (same mechanics as components).
- [ ] One end-to-end dogfood: new project → agent builds a landing
  page from templates only → screenshot at mobile + desktop widths
  attached to the PR/commit notes.

### Risks / alternatives rejected

- Full-page templates: too rigid, age fast, and the agent spends its
  budget fighting them. Section-level blocks compose better.
- Training-data layouts with a "please be responsive" prompt line:
  that is the status quo this item exists to replace.

---

## 4. SVG layout & wireframe utils the agent actually uses

### TASKS-APP wording

> "ensure that the AI agent is making use of svg layout and wireframe
> utils when making layouts."

### Where we are

The backend is the most built-out unfinished piece: `layout-snapshot`
and `layout-svg` tools (`src/mastra/tools/layoutTools.ts:23,39`) over
a ~1,920-line `src/layout/layoutSnapshot.ts` and
`src/layout/pageLayout.ts`. Both tools are in the Files and Sketch
tool sets. But: no UI calls `/api/layout/svg` (UI-INTEGRATION §3
flags this), the agent prompt never tells the model *when* to call
them, and there is no wireframe *input* format — SVG is output only.

### Web research (2026-11-05)

- The loop that works elsewhere is **generate → render → inspect →
  fix**: Chrome DevTools MCP pairs screenshots/snapshots with
  `lighthouse_audit` and performance insights so the agent verifies
  instead of guessing ([mowgli.ai/blog/mcp-servers-for-ui-design-2026](https://mowgli.ai/blog/mcp-servers-for-ui-design-2026),
  Step 6). A layout SVG is our cheaper, structure-first version of
  the screenshot: boxes, roles, and text extents at a fraction of the
  tokens of a DOM dump.
- Agentation's wireframe mode (Step 5) shows the input side: fade the
  page, sketch boxes, hand the agent structured boxes — not pixels.
  Our SVG box format should be the shared currency for template
  previews (Step 3), layout inspection (this step), and annotation
  input (Step 5).

### Plan — one box format, three uses

1. **Freeze the box schema** emitted by `layoutSnapshot.ts`
   (id, role/tag, x/y/w/h, text snippet, children) as the wireframe
   interchange format. Template wireframes (Step 3) and annotation
   regions (Step 5) speak the same schema.
2. **Prompt the loop:** `making-layouts` + `checking-the-page` skills
   (Step 2) require: after any layout file edit, call `layout-svg`
   (or `layout-snapshot`) once and fix obvious overflow/overlap
   before reporting done.
3. **Layout view in Preview** (UI-INTEGRATION Slice 3): toggle that
   fetches the existing SVG endpoint and shows it beside the live
   preview, with viewport-width presets (375 / 768 / 1280) so the
   user sees the same boxes the agent sees.

### Todos

- [ ] Document the box schema (fields, coordinate space, truncation
  rules) in `src/layout/README.md`; add a schema-shape test next to
  `layoutSnapshot` tests if none covers the emitted shape.
- [ ] Add the "edit → layout-svg → fix" loop to the
  `making-layouts` and `checking-the-page` skills. Acceptance: a
  layout run's tool trace contains a `layout-svg` call after the
  last file edit, before the final message.
- [ ] Preview Layout toggle: render `/api/layout/svg` output beside
  the iframe; width presets 375/768/1280 re-request or re-scale.
- [ ] P0-b automatic gate, layout half: host runs `layout-snapshot`
  after a Files turn that edited layout-bearing files (before the
  final chat message is allowed to claim done), at the preview
  width plus 375/1280 checks; findings enter the turn as a tool
  result the agent must address or explicitly waive. Skill wording
  (Step 2) is the fallback, not the mechanism.
- [ ] Cap SVG/box payload size for the agent (top-N boxes by area,
  note truncation in the result) — layout dumps must not recreate
  the whole-file token problem in a new format.
- [ ] Dogfood: ask for a 3-column page, confirm the agent's layout
  check catches a deliberately broken (overflowing) column.

### Risks / alternatives rejected

- Screenshot-first verification as the default: heavier tokens and
  needs vision-capable models for every check. Keep screenshots for
  Step 6 audits; boxes are the everyday loop.
- A second, annotation-only wireframe format: guarantees drift
  between what the user draws and what the agent reads.

---

## 5. Annotation v2 — drag regions, wireframe controls, Submit

### TASKS-APP wording

> "annotation: representative boxes dragged over regions, with notes,
> can become layout box or describe issue."
> "wireframe UI controls draggable over page, submit button
> incorporates them into style"

### Where we are

Annotate exists at v1: `src/live-edit/overlay.js` (~768 lines) lets
the user click **one element**, attach note/move/style annotations
(`pushAnnotation(type, text, selector, targetSelector)`), drag a link
port for moves, and submit to `/api/live-edit/submit`;
`src/live-edit/annotationAnalysis.ts` classifies intent
(bug/move/layout/style/copy) and builds the agent prompt. Limits
(UI-INTEGRATION §3): click-one-element only, no free drag-region, no
draggable wireframe controls, and annotate is disabled on the live
`:5173` preview path.

**Tight-loop gap found on review (2026-11-05):** Live sketch's loop
is genuinely tighter than write-file → HMR for *iteration* —
`patch-dom` mutates the user's real DOM in-page (no write, watcher,
HMR, or reload, so page state survives), with before-state capture
and restore on Undo/Discard via the same engine. But the loop does
not yet *close*: Accept only marks the session accepted and keeps
the DOM (`workflowApi.ts` `accept` → `acceptSketch()`; Chat labels
it "Accept (keep on page)"). No patch is translated back to source,
so an accepted sketch is lost on reload/HMR/project switch
(`sketchSession.ts`: "Vite restart wipes the DOM"). Until
sketch→source conversion exists, sketch is a superior *exploration*
loop and an incomplete *delivery* loop; Cursor's slower
file-write loop still wins on durability. Closing this is part of
this step's work (see Todos).

### Web research (2026-11-05)

- [Agentation](https://www.agentation.com/features) is the reference
  point and has moved past click-to-annotate: multi-select, drag
  selection, text annotation, a **layout mode** with a palette of
  65+ draggable component types, repositioning existing sections,
  and a **wireframe mode** (fade page, sketch from scratch, purpose
  field) whose output is structured feedback for the agent.
- tldraw's "Make Real" proves the sketch→code direction but is a
  canvas product, not an in-page overlay — our advantage is annotating
  the *real* running page with real selectors.
  Source: [therundown.ai/tools/tldraw](https://www.therundown.ai/tools/tldraw).

### Plan — extend the existing overlay, keep the submit contract

1. **Drag-region annotation:** mousedown-drag on the overlay draws a
   representative box (viewport rect → Step 4 box schema + note).
   On submit, a region either (a) describes an issue on what's under
   it (resolve elements intersecting the rect → selectors), or
   (b) declares a *new* layout box ("put a X here") — the note's
   intent, classified in `annotationAnalysis.ts` alongside today's
   types. Extend `PageNote` with an optional `region` (rect +
   viewport) rather than inventing a parallel payload.
2. **Wireframe controls palette:** a small set (box, row, column,
   text, button — reuse Step 3 template kinds at miniature scale)
   the user drags onto the page; each lands as a proposed box with
   position/size. Submit folds them into the same prompt as regions:
   "add a `multi-column` block here, styled like the page".
3. **Submit incorporates style:** the prompt builder already emits
   style hints (`parseStyleHint`); extend it so wireframe boxes carry
   the page's detected theme tokens (Step 7 profile) — "incorporate
   them into style" means generated code uses existing tokens, not
   arbitrary colours.

### Todos

- [ ] Close the sketch loop: on Accept, convert the patch log to
  source — resolve each selector to its rendering file (grep /
  Step 8 map), apply the equivalent `str-replace` edits in Files
  mode, then verify with `layout-snapshot` after HMR and report any
  patch that could not be translated. Acceptance: accept a sketch,
  reload the page, the change is still there.
- [ ] Overlay: drag-rectangle region capture (with Esc-cancel and
  note prompt on release); store as `region` notes.
- [ ] `annotationAnalysis.ts`: classify region notes (issue vs
  new-box), resolve intersecting elements to selectors, emit Step 4
  box data in the prompt. Unit tests next to existing analysis tests.
- [ ] Wireframe palette in the overlay: box / row / column / text /
  button, drag-to-place, drag-to-move/resize after placement,
  delete control. Cap the set — this is a sketch tool, not Figma.
- [ ] Submit path: regions + wireframe boxes + style/theme hints in
  one `/api/live-edit/submit` payload; Sketch-mode runs apply via
  `patch-dom` insert, Files-mode runs via template insert (Step 3).
- [ ] Enable annotate on the live `:5173` preview (same-origin path
  UI-INTEGRATION flags), not only the static preview.
- [ ] Manual verification matrix: region-issue on an existing card;
  region-new-box on empty space; wireframe multi-column drop;
  each in Files and Sketch modes. Record results in the commit.

### Risks / alternatives rejected

- A separate canvas/wireframe page (tldraw-style): loses real
  selectors and the live page context that make our annotate useful.
- Pixel/freehand sketch input: the agent needs boxes + intent, not
  strokes. Representative boxes are the TASKS-APP wording and the
  right granularity.

---

## 6. Chrome DevTools depth — console, network, performance, debugger

### TASKS-APP wording

> "we can make use of anything in Chrome Dev Tools like the debugger
> to make code and check it."

### Where we are

The agent can see the DOM (`inspect-dom`, `take-snapshot`) and run JS
(`eval-js`, Sketch only), but it is blind to everything DevTools
knows: console errors, failed network requests, performance, audits.
Commit `eba9abe` deliberately did not wire the Chrome DevTools MCP
snapshot file (a Puppeteer wrapper) and built a live-page
`take-snapshot` instead. That call was right for snapshots; it left
the rest of DevTools unaddressed. The Playwright pool
(`src/browserPool.ts`, `src/poolPage.ts`) is our only real-browser
channel today and exposes no console/network surface to tools.

### Web research (2026-11-05)

- **Chrome DevTools MCP is official and standard now.** Google's
  Chrome team shipped it as public preview 2025-09-23; by Dec 2025 it
  connects to a live Chrome session (`--autoConnect`, Chrome 144+).
  ~29–60 tools across: navigation/input, `list_console_messages` /
  `get_console_message`, `list_network_requests` /
  `get_network_request`, `performance_start_trace` /
  `performance_analyze_insight`, `lighthouse_audit` (a11y/SEO/best
  practice; performance via traces), screenshots, heap snapshots,
  emulation. Sources: [developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session),
  [chatforest.com/reviews/chrome-devtools-mcp-server](https://chatforest.com/reviews/chrome-devtools-mcp-server),
  [test-lab.ai/blog/chrome-devtools-mcp-vs-playwright-mcp-cli](https://www.test-lab.ai/blog/chrome-devtools-mcp-vs-playwright-mcp-cli).
- **Division of labour in the field:** Playwright MCP/CLI for
  automation (click/type/test flows), DevTools MCP for *diagnosis*
  (console, network, traces, Lighthouse). We already own the
  Playwright side; DevTools is the missing half.
- Mastra speaks MCP natively: `MCPClient` (consume servers) and
  `MCPServer` (expose ours) in `@mastra/mcp`, over stdio / Streamable
  HTTP ([mastra.ai/docs/connections/mcp](https://mastra.ai/docs/connections/mcp)).
  No framework change is needed — this is an integration, not a
  rewrite. (Step 11 uses the server half.)

### Plan — two tiers, cheapest first

**Routing correction (2026-11-05 review):** the Vite bridge stays
the default for the Vite app; Playwright does **not** become the
default. The bridge targets the exact page the user sees (top tab or
preview iframe, `pickPageResult` prefers the iframe), needs no
browser launch, and Live sketch is hard-routed to it
(`liveTarget.ts`: `sketchOnVite` bypasses the pool) because
Undo/Discard must restore what the user sees. The pool remains for
foreign origins, `LIVE_TARGET=pool`, and deterministic runs. Both
paths already share the same patch/snapshot engines
(`browserPool.ts` inlines `patchEngine.js` / `pageSnapshot.js`), so
the choice is transport/location, not capability. DevTools depth
arrives via Tier 1 capture on both paths and the optional Tier 2
MCP client — never by swapping the default target.

**Tier 1 (native, no new dependency):** the page bridge and the
Playwright pool already sit inside a real page. Capture what the
page already emits:

1. Console: bridge/pool records `console` + `pageerror` events into a
   ring buffer per live target; tool `get-console` (level filter,
   last-N, since-timestamp).
2. Network: pool (Playwright `requestfailed` / response status ≥400)
   and bridge (Performance API resource timing as the poor-man's
   list) → tool `get-network-failures`. Honest labelling: bridge data
   is timing-level, pool data is request-level.
3. Add both tools to Files + Sketch sets; `checking-the-page` skill
   (Step 2): after an edit that touches behaviour, check console
   before claiming success.

**Tier 2 (MCP client):** optional `@mastra/mcp` `MCPClient` wiring
for `chrome-devtools-mcp` (stdio, `npx chrome-devtools-mcp@latest`),
gated by a Settings toggle like the pool. This buys traces,
Lighthouse, heap snapshots, and live-session attach without us
reimplementing CDP. Its tools join the agent only when enabled, and
Deck cards already render unknown tool names generically.

Debugger proper (breakpoints/stepping) stays out of scope: no agent
in the field drives interactive breakpoints productively; console +
network + traces cover the "make code and check it" intent.

### Todos

- [ ] Tier 1 console capture: ring buffer in page bridge
  (`src/vite-plugin/client/page-bridge.js`) and pool
  (`src/browserPool.ts`); cap (e.g. 200 entries), include level,
  text, timestamp, stack first line for errors.
- [ ] `get-console` Mastra tool (wraps bridge/pool by live target);
  add to both active-tool sets; test with a page that logs + throws.
- [ ] Tier 1 network failures: pool request/response capture +
  bridge resource-timing fallback; `get-network-failures` tool;
  test with a page fetching a 404.
- [ ] Skill update (`checking-the-page`): console check is mandatory
  before "done" on behaviour changes. Acceptance: introduce a
  runtime error via chat edit; agent spots it in console output
  without being told.
- [ ] P0-b automatic gate, console half: host polls the bridge/pool
  console buffer after HMR settles on behaviour edits and injects
  new errors into the turn (same gate as Step 4's layout half —
  one verification gate, two signals). No console tool call by the
  model is required for the gate to fire.
- [ ] Tier 2 spike (timeboxed): `@mastra/mcp` + chrome-devtools-mcp
  behind a Settings flag; document attach mode vs launched-Chrome
  behaviour on this machine; keep or drop based on the spike notes
  appended to this file.
- [ ] If Tier 2 stays: expose `lighthouse_audit` +
  `performance_start_trace` in Deck as audit cards (scores, not raw
  trace JSON); raw traces never enter chat context (file ref only).

### Risks / alternatives rejected

- Reimplementing CDP ourselves: the official server exists and is
  maintained by the DevTools team; Tier 1 only covers what our
  existing bridge gets for free.
- Turning on the full DevTools tool list by default: ~60 tools of
  schema is real context cost. Gate behind the flag, curate the set.

---

## 7. Web-app awareness — node, packages, React, Tailwind

### TASKS-APP wording

> "We can make the app and system aware of node, node packages,
> React such that it has its own functions inside for natively
> dealing with what people do in web apps, often Tailwind, etc."

### Where we are

Zero explicit awareness. The agent discovers the stack by reading
files (usually `App.jsx`) every run. Starters are React+Vite only —
no Tailwind, no TypeScript in the app template, no `components.json`.
The Files panel has no diagnostics/package summary (UI-INTEGRATION
§3 proposed a "diagnostics strip" reading `package.json` via the
existing `/api/fs/read`; not built).

### Web research (2026-11-05)

- Stack detection by manifest is the established pattern: agent
  skills/tools check `package.json` dependencies + config files
  (`vite.config.*`, `tailwind.config.*`, `components.json`) to decide
  framework and styling system before writing code
  ([eliteai.tools/agent-skills/web-projects](https://eliteai.tools/agent-skills/web-projects)).
- Tailwind v4 changed the integration shape: `@tailwindcss/vite`
  plugin + CSS-first `@theme`, automatic content detection, no
  `tailwind.config` required ([deepwiki.com/microsoft/vscode-agent-lab-soc-ops](https://deepwiki.com/microsoft/vscode-agent-lab-soc-ops/3.2-tailwind-css-v4-styling-system)).
  Detection must check both worlds: v3 (`tailwind.config.*` +
  directives) and v4 (dep + `@import "tailwindcss"`).
- shadcn presence is detectable via `components.json` (aliases,
  style, registries) — the same file agents use to place components
  ([ui.aceternity.com/installation](https://ui.aceternity.com/installation)).
  This is the bridge between this step and Step 1's catalog.

### Plan — one `project-profile` tool + one UI strip

1. **Tool `project-profile`** (deterministic, no LLM): reads
   `package.json`, lockfile presence, `vite.config.*`,
   `tailwind.config.*` / CSS entry, `components.json`, `src` entry
   files under the active root. Returns a small JSON:
   `{ runtime: node version?, framework: react|vue|none, reactMajor,
   bundler: vite, styling: tailwind-v4|tailwind-v3|css|none,
   tailwindConfig?, shadcn: bool, typescript: bool, scripts: {...},
   deps: [name@major…] }`. Cached per root, invalidated by the
   existing file watcher.
2. **Prompt:** profile JSON (few hundred tokens) is injected as
   context on Files turns (like `Current file:` today), so the agent
   knows "Tailwind v4, no shadcn, React 18" before its first tool
   call. Skills (Step 2) branch on it: catalog components emit
   Tailwind classes or CSS-var styles accordingly.
3. **New-project seeding offers Tailwind:** the create flow gains a
   styling choice (plain CSS = today's seed; Tailwind v4 = seed +
   `@tailwindcss/vite` + entry CSS). Existing projects untouched.
4. **UI diagnostics strip** (UI-INTEGRATION §3): Files panel footer
   shows framework / styling / dep count from the same profile API.

### Todos

- [ ] Implement `project-profile` as a host function + Mastra tool;
  unit tests with fixture `package.json` variants (v3, v4, no
  Tailwind, shadcn present, non-React).
- [ ] Inject profile into Files-turn context (`src/chatStream.ts` /
  Chat request assembly); confirm token size stays <~400.
- [ ] Branch Step 1 catalog output on `styling` (Tailwind classes vs
  CSS vars) and Step 2's `making-layouts` skill on the same field.
- [ ] `GET /api/project/profile` (launcher + plugin `apiApp.ts`
  parity) and the Files-panel diagnostics strip in the UI.
- [ ] New-project dialog: styling choice (CSS / Tailwind v4) wired
  into the seed + install path in `src/launcher.ts`.
- [ ] Node awareness basics: profile includes `engines`/`.nvmrc` if
  present and the `dev`/`build` script names; agent instructed to
  use the project's own scripts, never invent commands.

### Risks / alternatives rejected

- Making the agent `read package.json` ad hoc each run (status quo):
  repeated tokens, inconsistent conclusions.
- Auto-installing Tailwind into existing user projects: mutating a
  user's stack is a decision for the user, offered at seed time or
  via an explicit chat ask — never implicit.

---

## 8. Codebase markers & relations — knowing the code faster

### TASKS-APP wording

> "should we have it write code and edit code in a way that includes
> markers about the code and code base relations? search tools? that
> way it will know the code base more quickly."
> "This may result in fewer tokens being generated, which is another
> topic that we can also tailor our search, replace, insert functions
> for web apps as well."

### Where we are

V1 of the token story is done and was the right first move (see
[agent-context-and-edits.md](./agent-context-and-edits.md)):
`grep` → ranged read → `str-replace`, working-set chips in Deck
(files touched this session). What does not exist: any persistent
marker, index, or relation data. Every run re-derives "where is X
rendered / who imports Y" from grep. For the current 3–6-file
starters that is fine; it stops being fine at ~50+ files.

### Web research (2026-11-05)

- **Edit format is a measured lever, and we're on the right side of
  it.** Aider's benchmarks show diff/search-replace formats roughly
  triple refactor pass rates vs whole-file for the same model
  (20%→61% in the cited GPT-4 Turbo experiment); `str_replace` is the
  reliable primitive across Claude Code / OpenHands / SWE-agent.
  Sources: [kondasamy.com/blog/2026/how-ai-coding-agents-edit-code](https://kondasamy.com/blog/2026/how-ai-coding-agents-edit-code),
  [github.com/overbrilliant/ob-1/docs/research/claude-code-alternatives-architecture](https://github.com/overbrilliant/ob-1/blob/HEAD/docs/research/claude-code-alternatives-architecture.md).
- **The next lever is structural, not textual.** CodeStruct (2026):
  AST-scoped `readCode`/`editCode` over syntactic units improved
  SWE-bench Verified Pass@1 by 1.2–5.0% while *reducing* tokens
  12–38% for most models ([arxiv.org/html/2604.05407v3](https://arxiv.org/html/2604.05407v3)).
  SWE-Edit similarly splits Viewer/Editor so reads return units, not
  files.
- **Repo maps are the proven "markers" mechanism.** Aider parses the
  repo with tree-sitter, builds a file→symbol reference graph, ranks
  with PageRank, and injects a ~1k-token signature map (definitions,
  not bodies). It is the most-copied context idea in the field.
  Sources: [aider.chat/2023/10/22/repomap.html](https://aider.chat/2023/10/22/repomap.html)
  (also summarised in [agentic-editor-codebases.md](./agentic-editor-codebases.md)),
  [pondero.ai/coding/guides/aider-for-legacy-codebases](https://pondero.ai/coding/guides/aider-for-legacy-codebases).
- **Markers in the code itself** (the TASKS-APP phrasing) have a
  cheaper realisation than comment conventions: generated, external
  marker data — a `.ai-live/map.json` (or in-memory) index of
  file → exports/components → imports → rendered-by relations,
  regenerated by the file watcher. Models read the map; source stays
  clean. Hand-written marker comments rot and cost tokens forever.

### Plan — four rungs, ship only as file counts demand

**Rung 0 (P0, first): DOM ↔ source identity.** The bridge already
emits `stableId` / `parentStableId` and snapshot selectors; nothing
maps them back to source. Two mechanisms, spike the cheap one first:
(a) heuristic join — snapshot selector + component name → grep the
rendering file (works on our generated code, no build change);
(b) exact join — the Vite plugin tags JSX elements in dev with a
source attribute (file + line) via transform, bridge reads it back.
Whichever survives the spike, the contract is one resolver:
`selector → { file, component, jsxRange?, props? }`, consumed by
annotate (Step 5), sketch→source (Step 5), and the map below.

**Rung 1 (now, tiny): import/component graph from regex-lite parsing.**
For JS/JSX starters, a dependency-light extractor (import statements,
default/named exports, JSX component definitions) builds
`file → imports, exports, components`. Exposed as tool
`codebase-map` returning signatures within a token budget, ranked by
in-degree (most-imported first — PageRank's cheap cousin). No
tree-sitter dependency yet.

**Rung 2: watcher-maintained map + prompt injection.** The existing
chokidar watcher keeps the map fresh; Files turns inject the top-N
signatures (~≤1k tokens, budgeted like Aider's `--map-tokens`) when
the project exceeds a file-count threshold (below it, injection is
wasted tokens — measure, Step 9).

**Rung 3 (only if Rung 1–2 prove out): tree-sitter AST units.**
`read-symbol` (return one component/function body) and AST-validated
edits. This is CodeStruct's win, but it is real machinery; the
starters don't justify it today.

Web-app tailoring within scope: the extractor understands the shapes
we generate — catalog components (Step 1), templates (Step 3), route
entry (`main.jsx` → `App`), CSS/token files — so the map says
"App renders <PricingGrid> (template multi-column-3)" in our
vocabulary, not generic symbols only.

**Component registry lives here, not only in Step 1.** Step 1 authors
our shipped catalog; this step is where a *project's* registry —
whatever its origin — becomes marker data in the map. One unified
registry shape (`name, file, propsSummary, whenToUse?, origin,
confidence`), three origins, in precedence order:

1. **Declared (ours):** the project carries our catalog manifest
   (seeded starter, or Library Insert installed it). Authoritative:
   props and when-to-use are curated, `origin: catalog`,
   `confidence: declared`. Coverage is total by construction.
2. **Declared (theirs):** an imported project with shadcn
   (`components.json` + components dir) or an equivalent manifest.
   Parse the manifest + component files; props come from the source.
   `origin: shadcn|manifest`, `confidence: declared` for existence,
   `inferred` for prop summaries we had to extract.
3. **Inferred (no registry at all):** the common import case — a
   dropped-in or Path 2 Vite app with no manifest. The Rung 1
   extractor synthesises the registry: capitalised component
   definitions/exports under `src/components/**` (then anywhere),
   props from destructured parameters / TS prop types, ranked by
   used-by count from the import/render graph. Everything is
   `origin: inferred`, so the agent and UI must show it as
   discovered, not curated. No when-to-use prose is fabricated; the
   agent falls back to names + prop shapes.

The registry is a slice of the same map (component nodes, renders/
imported-by edges), not a second index. Agent injection is the
Step 1 contract (~names + one-liners) when declared, and
names + prop shapes when inferred. Two upgrades close the gap for
imported projects, both opt-in: **Adopt** writes the inferred
registry to `.ai-live/components.json` (generated marker data, same
rule as the map — never hand-marker comments) so it can be curated
over time; **Install catalog** offers Step 1's primitives alongside
the project's own components, never replacing them.

### Todos

- [ ] Rung 0 spike (timeboxed): heuristic selector→file join on
  `projects/lumen`; measure hit rate on snapshot selectors. If
  <~80%, spike the Vite-plugin JSX source tag. Record outcome here.
- [ ] Rung 0 resolver tool `resolve-source` (`selector` →
  file/component/range), used by annotate + sketch→source; test on
  nested catalog components (Step 1) where grep alone is ambiguous.
- [ ] P2 stack-aware edits on the resolver: Tailwind-class edit
  (preserve variants/responsive prefixes), add-import-for-component,
  add/change-prop threaded to callers. Each is a `str-replace`
  wrapper with a fixture test, dialect from Step 7 profile.
- [ ] Rung 1 extractor: imports/exports/components for `.js/.jsx`
  (and `.ts/.tsx` when present); fixture tests (component defined,
  re-exported, imported across files).
- [ ] `codebase-map` tool: budgeted signature output, in-degree
  ranking, truncation note; add to Files tool set. Acceptance on a
  20-file fixture: map fits budget and names the entry component
  first.
- [ ] Registry loader: merge declared (our catalog manifest, then
  shadcn files under its components dir — note `components.json` is
  config, not an installed-component list) with inferred components,
  deduped by file, each entry carrying `origin` + `confidence`.
  Fixtures: catalog project, shadcn project, bare imported project.
- [ ] Inferred-registry quality bar: on the bare-import fixture, the
  top used-by components are found with file + prop shape; entries
  that cannot be parsed are listed by file only, never given
  fabricated props or when-to-use prose.
- [ ] Adopt action (opt-in, UI + agent-visible): write the inferred
  registry to `.ai-live/components.json`; watcher treats it as
  declared thereafter. Never write it silently on import/open.
- [ ] Agent contract test: on an imported project, a "use the
  existing button/card if there is one" ask reuses the inferred
  component (check imports in the edit) instead of inventing one.
- [ ] Watcher invalidation: map rebuilds on add/change/unlink under
  the active root (reuse the launcher watcher; debounce).
- [ ] Rung 2 injection: top-N map in Files-turn context only above a
  measured file threshold; record the threshold decision here with
  Step 9 token data.
- [ ] Evaluate Rung 3 after one real 50+ file project exists:
  spike tree-sitter `read-symbol` on that project; keep/drop note
  appended to this file. Do not build it speculatively.
- [ ] Explicitly reject (and keep rejecting) hand-written marker
  comments in generated code; the map is generated data. Note any
  exception request here with reasoning.

### Risks / alternatives rejected

- Vector/RAG codebase indexing: Continue itself deprecated `@Codebase`
  RAG in favour of tools + maps for this scale (see
  [agentic-editor-codebases.md](./agentic-editor-codebases.md)).
- Full AST tooling on day one: machinery in search of a problem at
  starter scale; rungs keep each step measurable.

---

## 9. Proving the tight loop — tokens, cost, tests, plan

### TASKS-APP wording

> "are we achieving our tight loop goal in a way that is superior?"
> "how do we make the ai agent as efficient as existing apps?"

### Where we are

Unanswerable today, by our own instrumentation: `ChatStreamEvent`'s
`done` carries nothing (`src/chatStream.ts:12`,
`src/ui/lib/api.ts:233`); Deck shows per-tool elapsed (client-timed)
but no tokens, no cost, no per-turn totals. UI-INTEGRATION §4 lists
the same gaps (usage, plan events, test-run tool, git status). The
Deck is the right answer surface; it is currently showing time only.

### Web research (2026-11-05)

- **Streaming hides usage unless you ask.** OpenAI-compatible APIs
  return no `usage` in streamed chunks unless
  `stream_options: { include_usage: true }` (or the Responses API's
  `response.completed`); several tools shipped "0 tokens" bugs from
  exactly this. Sources: [dev.to/gabrielanhaia/streamed-llm-responses-hide-their-token-count](https://dev.to/gabrielanhaia/streamed-llm-responses-hide-their-token-count-where-usage-lives-in-3-typescript-apis-5hg2),
  [dev.to/vola-trebla/your-llm-streaming-traces-are-lying-to-you](https://dev.to/vola-trebla/your-llm-streaming-traces-are-lying-to-you-53f0).
- **Mastra already carries the data:** `step-finish` / `finish`
  chunks of `agent.stream()`'s `fullStream` expose `totalUsage`
  (`inputTokens`/`outputTokens`/`totalTokens`); recent `@mastra/core`
  also passes usage to output processors for per-step budgets. The
  gap is our `chunkToRunEvent`-style mapping dropping it, not the
  framework. Sources: github.com/deserveto/chekku token-quota design
  (documents the same drop), Mastra 1.26 release notes via
  releaseport.com.
- **The comparison set** for "as efficient as existing apps": code-
  owning editors (Cursor, Windsurf/Devin Desktop) compete on
  multi-file agent edits + codebase index; hosted builders (Bolt,
  v0, Lovable) on prompt→hosted app. Our measurable edge claims
  should be narrow: tokens-per-accepted-change and
  turns-to-working-page on web tasks, not general SWE-bench.
  Sources: [vibedoctor.io/blog/best-vibe-coding-tools-2026](https://vibedoctor.io/blog/best-vibe-coding-tools-2026),
  [buildra.dev/best-ai-app-builders](https://buildra.dev/best-ai-app-builders).

### Plan — instrument first, claim later

1. **Forward usage:** chat stream maps Mastra `finish` usage into
   `done { usage: {input, output, total}, model }`; BYOK connection
   pricing (if configured) derives a cost estimate, labelled as
   estimate. Deck turn card + turn strip show tokens (and cost when
   priced). Persist per-turn usage in the chat log so sessions can
   be compared.
2. **A test/check tool, honestly scoped:** no test runner exists in
   starters. Add tool `run-project-check` = run the project's own
   `build` script (Step 7 profile knows its name) with a timeout,
   return tail of output. Only then may Deck render a Test card
   (UI-INTEGRATION §4 rule: no fake cards). Vitest later if starters
   grow tests.
3. **Plan visibility without a fake plan tool:** keep grouping
   (Intent/Inspect/Edit/Live/Result) as today; if plan cards are
   wanted, add an explicit lightweight `plan` tool the agent calls
   before multi-step work — real event, real card — rather than
   rendering the tool list as a "plan" retroactively.
4. **A repeatable yardstick:** 5 fixed dogfood tasks (add counter,
   restyle card, build pricing section from template, fix injected
   runtime error, add form validation) run after each step lands;
   record median tokens + turns + elapsed in this file. That table
   is the "are we superior?" answer, updated per step.

### Todos

- [ ] Forward Mastra usage into the SSE `done` event (verify the
  provider actually emits it — BYOK gateways vary; log a warning
  path when usage is absent instead of showing 0).
- [ ] Deck: per-turn token display (+ estimated cost when pricing
  exists on the connection); session total in the turn strip.
- [ ] Persist usage in the chat log (`src/ui/lib/chatSession.ts`)
  with a test; old logs without usage render as "—", never 0.
- [ ] `run-project-check` tool (project `build` script, timeout,
  output tail capped); Deck Test card renders only from this tool's
  real results.
- [ ] Decide plan card: implement the explicit `plan` tool or
  formally keep tool-list-as-checklist; record the decision here.
- [ ] Create the 5-task yardstick (script or documented manual runs)
  and record baseline numbers (today's build) in this section
  before Steps 1–8 change the system.
- [ ] Append a results row after each subsequent step lands:
  step, median tokens, turns, elapsed vs baseline.

### Yardstick results (fill in, do not pre-claim)

| Date | Build / step | Median tokens | Median turns | Median elapsed | Notes |
|---|---|---|---|---|---|
| — | baseline (pre-Step 1) | — | — | — | not yet measured |

### Risks / alternatives rejected

- Showing "0 tokens" when a gateway omits usage: actively misleading
  (the field's known bug). Absent = "not reported".
- Benchmarking against Cursor/Bolt marketing numbers: not comparable
  surfaces. Only our own before/after on fixed tasks counts.

---

## 10. File System Access API — user-picked directory per session

### TASKS-APP wording

> "use File API that is only avail. in Chrome so that user can select
> a directory to work on in a session."

### Where we are

Not implemented, and the architecture currently assumes the opposite:
the **server** owns the filesystem. The launcher serves
`projects/<active>` via `getFsRoot()` (`src/launcher.ts`), the agent
writes there, Vite runs there. A grep finds no `showDirectoryPicker`
or `FileSystemDirectoryHandle` anywhere in `src/`. UI-INTEGRATION §3
already flags the mismatch: "A browser-picked directory can't become
the agent's root without a new write path… Do not ship a picker that
pretends to switch the workspace."

### Web research (2026-11-05)

- The picker half of the File System Access API
  (`showDirectoryPicker`, `showOpenFilePicker`, `showSaveFilePicker`)
  is **Chromium-only** (Chrome/Edge/Opera, desktop), requires a user
  gesture, and handles can be persisted in IndexedDB for re-grant
  flows. OPFS (the sandboxed half) works cross-browser but is not
  the user's real disk. Sources:
  [allyxone.com/blog/file-system-access-api-no-upload-2026](https://allyxone.com/blog/file-system-access-api-no-upload-2026),
  [openpwa.net/reference/capabilities/file-system-access](https://openpwa.net/reference/capabilities/file-system-access/),
  [github.com/software-a-g/meet-ai/docs/research/06-fs-access-patterns](https://github.com/software-a-g/meet-ai/blob/HEAD/docs/research/06-fs-access-patterns.md).
- The API powers browser IDEs (e.g. VS Code web's local-folder flow)
  — proven pattern, but those are client-side editors. Our agent,
  Vite child, and file watcher are server-side processes; the
  browser holding a directory handle does not give them access.

### Plan — honest v1: pick to import; design the bridge before promising more

1. **v1 "Open folder…"** (UI-INTEGRATION's honest option): picker →
   enumerate the chosen directory client-side → copy (import) it into
   `projects/<name>` via existing write APIs → it becomes a normal
   project (agent, watcher, Vite all work unchanged). Clearly
   labelled *Import a copy*, with size/file-count guards and
   skip-list (`node_modules`, `.git`).
2. **Explicitly not v1:** live two-way sync with the picked folder.
   That needs a client-side FS bridge (browser writes agent edits
   back through handles, watcher replaced by polling/diffs) — a
   design task of its own, only worth it if users reject import.
3. **Path 2 reminder:** the Vite-plugin route already lets a user run
   the editor inside *their own* app directory (server-side, no
   picker). For many "work on my folder" asks, that is the answer
   today; the picker work should say so in its UI copy.

### Todos

- [x] "Open folder…" button by the project dropdown:
  `showDirectoryPicker()` behind a Chromium feature-check with a
  plain fallback message elsewhere. (`src/ui/App.tsx`, `isFolderImportSupported`)
- [x] Client-side import walk: enumerate, skip `node_modules`/`.git`/
  binaries, enforce caps (file count + total bytes, stated in UI),
  upload in small batches to `POST /api/projects/import`, then select.
  Deviation from the draft: a dedicated batch endpoint instead of N×
  `POST /api/fs/write` — per-file writes would merge with the seed
  template from `/create` (pollution) and run `npm install` before the
  files land (wrong order). Same `safePath` discipline, no seed files,
  `npm install` only when a `package.json` arrived. (`src/server.ts`,
  `src/ui/lib/folderImport.ts`)
- [x] Over-limit dialog: above 50 MB default / 2000 files the UI shows
  totals and offers Cancel / import-first-N / import-everything-anyway.
  Never silently truncates. (`OverLimitDialog`)
- [x] Import report: files copied / skipped / failed, shown in-app
  (no silent truncation). (`ImportReportDialog`)
- [x] Persist the `FileSystemDirectoryHandle` in IndexedDB +
  "re-import" (refresh copy) action. Shipped: handles are
  structured-cloneable so persistence works; `queryPermission` /
  `requestPermission({mode:'read'})` re-grant on restore, "Re-import"
  button appears only when a stored handle re-validates. Revoked
  permission falls back to "use Open folder… again". Overwrite path
  wipes the project dir first (explicit confirm) and re-runs install.
- [x] Spike note (timeboxed): a true live bridge would require (1) a
  client-side write-back loop (watch agent edits, write through
  handles — needs write permission + per-file handles retained);
  (2) external-change detection (poll `getFile()` lastModified —
  expensive, no FS events in the API); (3) Vite root problem (Vite
  must serve the picked folder — only solvable by running the
  launcher/Vite against it, i.e. Path 2, not the browser). Verdict:
  **drop** — import-a-copy + Re-import covers the need; revisit only
  if users reject the copy model.

Landed 2026-11-06: `src/ui/lib/folderImport.ts` (+ tests),
`src/ui/components/FolderImport.tsx`, `POST /api/projects/import`,
`writeImportFiles` (+ tests). Verified: 13/13 new tests pass,
`npm run ui:build` clean, `tsc` shows only the two pre-existing
§0 errors. Live browser + endpoint smoke test not run (sandbox
blocks listening sockets); verify by opening the built launcher and
importing a fixture folder.

### Risks / alternatives rejected

- Shipping a picker that silently can't affect the agent's root —
  the exact fake UI-INTEGRATION warns against.
- OPFS-as-workspace: cross-browser, but files stop being the user's
  real files, breaking the product's "real files on disk" premise.

---

## 11. Subagents and MCP — processes beyond the single agent

### TASKS-APP wording

> "what about subagent processes? mcp server?"

### Where we are

Neither exists. One Mastra `editorAgent` (`maxSteps: 12`) with a
fixed tool object; workflows are host-side `activeTools` gating, not
agents. No `@mastra/mcp` in `package.json`, no MCP config, no
subagent spawning, no second model role (e.g. reviewer). The Deck
rail's "agent" chip idea (UI-INTEGRATION §3) is parked until a second
agent is real.

### Web research (2026-11-05)

- **The field's split is stable:** a *subagent* answers "who does
  this work" (isolated context, returns a summary); *MCP* answers
  "how does the agent reach an outside system" (server exposes
  tools/resources/prompts). Conflating them produces mush.
  Sources: [kousigan.com/blog/skills-vs-agents-vs-mcp-ai-coding](https://www.kousigan.com/blog/skills-vs-agents-vs-mcp-ai-coding),
  [trussary.com/blog/skills-mcp-subagents](https://trussary.com/blog/skills-mcp-subagents).
- **Subagents are now table stakes in coding agents** — Claude Code,
  Codex, Kimi Code (`coder`/`explore`/`plan`), Grok Build all ship
  isolated-context subagents for parallel exploration/review; the
  win is context isolation (the parent never sees the search
  debris), not raw parallelism. Sources:
  [marktechpost.com/2026/06/06/moonshot-ai-releases-kimi-code-cli](https://www.marktechpost.com/2026/06/06/moonshot-ai-releases-kimi-code-cli-a-terminal-ai-coding-agent-built-in-typescript-for-next-gen-agents/),
  [mem0.ai/library/coding-agents/openai-codex-vs-claude-code](https://mem0.ai/library/coding-agents/openai-codex-vs-claude-code-which-ai-coding-agent-wins-in-2026).
- **Mastra supports both directions:** `MCPClient` to consume (Step 6
  Tier 2 is our first consumer use), `MCPServer` to expose our
  agents/tools to other clients (Claude Code, Cursor) over stdio /
  Streamable HTTP ([mastra.ai/docs/connections/mcp](https://mastra.ai/docs/connections/mcp)).
  Mastra agents can also call other agents as tools / in workflows
  for the subagent pattern without new infrastructure.

### Plan — sequence by payoff, not by fashion

1. **First subagent: `explore` (read-only).** Parent delegates
   "find where X is rendered / how Y flows" to a child with only
   `grep` / `read-real-file` / `codebase-map` (Step 8), which returns
   a short summary + file:line refs. Parent context stays clean —
   the measured win in the field, and it compounds with Step 9's
   token yardstick. Files workflow only; never in Live sketch.
2. **Second, later: `review` (read-only).** After a multi-file edit,
   a child re-reads the diff + console/layout checks (Steps 4/6) and
   reports issues; parent fixes. Only if yardstick data shows
   first-pass errors are a real cost.
3. **MCP server (expose us):** `MCPServer` exposing the safe,
   already-tested tool surface (list/grep/read/str-replace against
   the active root + layout snapshot) so external agents can drive
   *this* workspace. This is distribution, not capability — schedule
   after Steps 1–9 make the surface worth exposing. Writes stay
   behind the same `safePath` rules.
4. **Deck:** only when 1 lands — subagent runs render as nested
   tool cards (child name + summary), never as fake separate users.

### Todos

- [ ] Design note (this file, before code): subagent contract —
   input (task + optional file hints), output (summary + refs,
   max length), timeout/step cap, failure surface to parent.
- [ ] Implement `explore` as a Mastra agent + parent tool
   (`delegate-explore`) in the Files set; read-only tools only.
  Acceptance: "how does routing work here?" answered via one
  delegation, parent trace shows summary not raw grep dumps.
- [ ] Token check (Step 9 yardstick): delegation must not raise
  median tokens on the explore-heavy yardstick task; record result.
- [ ] Decide `review` subagent from yardstick error data; implement
  or formally defer here.
- [ ] MCP server spike: `MCPServer` over stdio exposing read-only
  tools; connect from one external client (Claude Code or Cursor)
  against a fixture project; record setup friction here.
- [ ] If spike passes: add write tools behind the same safety path,
  document `mcp` config snippet in README; Settings shows server
  status. Deck agent chip becomes real only at this point.

### Risks / alternatives rejected

- Parallel write-capable subagents on one file tree: merge/race
  problems with zero current demand. Read-only children return
  summaries; the parent remains the only writer.
- Building our own agent-to-agent protocol: Mastra + MCP are
  already the substrate; inventing a third is pure cost.

---

## 12. Order of work, dependencies, and definition of done

### Recommended sequence (each step: build → test → yardstick → commit)

P0 — close the loop we already have (the moat):

1. [ ] **Step 9 baseline first** — usage forwarding + yardstick
   numbers recorded, so every later step is measurable. (Small,
   unblocks all claims.)
2. [ ] **Step 8 Rung 0** — DOM ↔ source resolver (spike heuristic
   join, exact tag if needed). Consumed by everything below.
3. [ ] **Step 5 sketch→source** — Accept converts the patch log via
   the resolver; reload proves persistence. (Annotation UI breadth
   stays P3; only this todo is P0.)
4. [ ] **Steps 4 + 6 Tier 1 as one automatic gate** — layout
   geometry (375/768/1280) + console after edits, host-fired.
   Preview Layout view ships here. Tier 2 MCP stays P3.

P1 — generation defaults (opinionation):

5. [ ] **Step 7 `project-profile`** — cheap, deterministic, and
   Steps 1–3 branch on it.
6. [ ] **Step 1 catalog** (layout primitives + basics) → **Step 3
   templates** on top of it.
7. [ ] **Step 2 skills**, moving prompt guidance into `SKILL.md`
   (needs Steps 1/3 names to cite, and cites the P0 gate instead of
   asking the model to remember checks).

P2 — sharper edits:

8. [ ] **Step 8 Rung 1–2 + stack-aware edits** — codebase map,
   Tailwind/import/prop-aware edit wrappers on the resolver.

P3 — breadth, in this order, none before P0 lands:

9. [ ] **Step 5 annotation v2 UI** (drag regions, wireframe palette;
   uses Step 4 box schema + Step 3 templates), **Step 6 Tier 2**
   DevTools MCP spike, **Step 10 import-a-folder**, then
   **Step 11** explore subagent → MCP server.

### Cross-step rules (apply to every step above)

- [ ] No fake UI: a card/panel ships only when its real data source
  exists (UI-INTEGRATION §4 rule — tokens, tests, git, plans).
- [ ] Every new agent tool lands in the correct `activeTools` set
  (`src/agentTools.ts`) and in `editorAgent` instructions/skills.
- [ ] Every new payload to the agent is token-budgeted with the
  truncation stated in the result (maps, layout boxes, console).
- [ ] Tests in repo style (`npx tsx --test`) for pure logic;
  `npm run ui:build` clean for UI changes; `npx tsc --noEmit` clean
  (see the two pre-existing errors in §0).
- [ ] Per standing workflow: `git add -u` and a concise commit per
  landed step; yardstick row appended to Step 9's table in the
  same commit.

### What "done" means for this phase

- [ ] A new user can: pick/import a project, see its stack profile,
  ask for a page, and watch the agent build it from catalog
  templates, verify layout + console itself, and report tokens —
  with every claim in the UI backed by a real tool result.
- [ ] The P0 loop closes end to end: annotate or sketch on the real
  page → Accept → source changed via the DOM↔source resolver →
  page reloaded → change persists and passes the layout + console
  gate.
- [ ] TASKS-APP.md's questions ("superior tight loop?", "subagents /
  MCP?") have written, measured answers in this file — not vibes.

---

## Sources (web research, 2026-11-05)

Consolidated from per-step citations above; all fetched this session.

- Chrome DevTools MCP: developer.chrome.com blog (2025-09-23 launch;
  2025-12-11 live-session attach), chatforest.com review,
  test-lab.ai comparison vs Playwright MCP.
- Agent Skills standard: anthropic.com engineering post,
  shiplight.ai, atlan.com, denser.ai (progressive disclosure),
  deepwiki.com/supabase/agent-skills (structure).
- Components/blocks: shadcndeck.com (rise of shadcn), aiwiki.ai (v0),
  shadcnblocks.com, shadcnuikit.com, ui.aceternity.com (registry).
- Edit/context economics: kondasamy.com (agent edit architectures),
  ob-1 research (Aider 20%→61%), arxiv.org/html/2604.05407v3
  (CodeStruct), aider.chat repomap, pondero.ai (repo map).
- Usage/streaming: dev.to (gabrielanhaia; vola-trebla) on hidden
  streaming usage; Mastra usage in `fullStream` (`totalUsage`).
- File System Access API: allyxone.com, openpwa.net,
  meet-ai research notes (Chromium-only pickers, OPFS scope).
- Market/subagents/MCP roles: vibedoctor.io, buildra.dev,
  kousigan.com, trussary.com, marktechpost.com (Kimi Code),
  mastra.ai/docs/connections/mcp (`MCPClient`/`MCPServer`).
- Annotation/wireframe: agentation.com/features (layout/wireframe
  modes), therundown.ai (tldraw Make Real).
- Responsive/templates: handoffpro.dev (breakpoints handoff),
  jiteshprakash.com.np (breakpoint choice).

