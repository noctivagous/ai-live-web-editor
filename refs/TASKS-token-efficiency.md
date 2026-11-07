# TASKS — Token efficiency

What is left from `refs/` that can help ensure efficient token usage.
Focus: use our ability to put components and items into the app and
into the project directory so agent traversal is an index lookup,
not a re-derivation from file bodies.

Companions: [agent-context-and-edits.md](./agent-context-and-edits.md),
[agentic-editor-codebases.md](./agentic-editor-codebases.md),
[phase-11-05.md](./phase-11-05.md) (§§1–3, 8, 9),
[phase-11-06.md](./phase-11-06.md) (§H).

## Already done — do not rebuild

- [x] Surgical edits: `grep` → ranged `read-real-file` (20k char cap)
  → fail-closed `str-replace`, snippet-only result, placeholder-write
  guard (`src/mastra/tools/fsEdit.ts`, `src/mastra/tools/realFsTools.ts`)
- [x] Related context Layer 1: `historyForAgent` sends prior text
  turns + `Current file:` (`src/ui/lib/chatSession.ts`)
- [x] Project brief + catalog counts injected per turn via
  `projectBrief()` / `catalogSummary()`
  (`src/projectConfig.ts`, `src/catalog/catalog.ts`), with on-demand
  `find-component` (`src/mastra/tools/catalogTools.ts`)
- [x] Rung 0 `resolve-source` (`src/sourceMap/resolveSource.ts`),
  `take-snapshot` instead of DOM dumps
- [x] Per-turn token usage forwarding into the stream `done` event
  (`src/chatStream.ts`, phase-11-05 §9)

## 1. Codebase map + per-project component registry (biggest win)

Phase-11-05 §8 Rungs 1–2. No `codebase-map` tool, no
`.ai-live/map.json`, and no watcher-maintained index exist yet.
Every run still re-greps to answer "where is X rendered / who
imports Y."

Landed 2026-11-06 (branch feat/token-efficiency-map): extractor +
map + registry in `src/codebaseMap/` (extract / codebaseMap /
mapStore), tools `codebase-map` / `adopt-registry` /
`install-catalog-component` in the Files set, API at
`/api/codebase-map` (+ /adopt, /install) on both servers, watcher
rebuild in the launcher, Rung 2 injection in chatStream. 23 new
tests; suite 258/258, tsc + ui:build clean. Live smoke: lumen map
is 37 tokens (no injection, below threshold); the editor repo
itself maps 217 files in 947 tokens with injection on.

- [x] Rung 1 extractor: regex-lite parse of `.js/.jsx` (and
  `.ts/.tsx` when present) building
  `file → imports, exports, components`; fixture tests (component
  defined, re-exported, imported across files)
- [x] `codebase-map` tool: budgeted signature output (~≤1k tokens,
  like Aider's `--map-tokens`), in-degree ranking (most-imported
  first), explicit truncation note; add to the Files tool set.
  Acceptance on a 20-file fixture: map fits budget and names the
  entry component first
- [x] Generated marker data, never hand-written comments: persist
  the map to `.ai-live/map.json` in the project dir; models read
  the map, source stays clean
- [x] Watcher invalidation: map rebuilds on add/change/unlink under
  the active root (reuse the launcher chokidar watcher; debounce)
- [x] Rung 2 injection: inject top-N map signatures into Files-turn
  context only above a measured file-count threshold (below it,
  injection is wasted tokens — set the threshold from §5 yardstick
  data and record the decision here)
  Decision (2026-11-06, provisional pending §5): threshold is 15
  project files (`MAP_INJECTION_THRESHOLD` in
  `src/codebaseMap/codebaseMap.ts`) — lumen-scale starters (2–6
  files) stay silent; replace with the measured value when the
  yardstick lands
- [x] Registry loader: merge declared components (our catalog
  manifest, then shadcn files under its components dir — note
  `components.json` is config, not an installed-component list)
  with inferred components, deduped by file, each entry carrying
  `origin` + `confidence`. Fixtures: catalog project, shadcn
  project, bare imported project
- [x] Inferred registry: capitalised component definitions/exports
  under `src/components/**` (then anywhere), props from
  destructured parameters / TS prop types, ranked by used-by count.
  Entries that cannot be parsed are listed by file only — never
  fabricate props or when-to-use prose
- [x] Adopt action (opt-in, UI + agent-visible): write the inferred
  registry to `.ai-live/components.json`; watcher treats it as
  declared thereafter. Never write it silently on import/open
- [x] Install catalog alongside (never replacing) the project's own
  components, so installed components appear in the project
  registry/map and the agent imports by name in one lookup
- [x] Agent contract test: on an imported project, a "use the
  existing button/card if there is one" ask reuses the inferred
  component (check imports in the edit) instead of inventing one
- [x] Map speaks our vocabulary: catalog components, templates,
  route entry (`main.jsx` → `App`), CSS/token files — e.g.
  "App renders <PricingGrid> (template multi-column-3)"

## 2. In-turn tool-result trimming (the real compaction manager)

Agent-context Layer 2. Within the 12-step run, `inspect-dom` HTML
and 20k file reads currently stay in context for every later step.

- [ ] Mastra `processToolResult` / output processor: clip or drop
  bulky tool results after the next step (`inspect-dom` HTML,
  full file reads, snapshot dumps)
- [ ] Keep signatures of recently touched files when trimming
  (Roo-style smart folding, small budget), not whole bodies
- [ ] Re-check history size: `historyForAgent` currently sends up
  to 12 raw text turns; measure cost, trim if the yardstick says so
- [ ] No second "compaction manager" agent — trimming lives in the
  existing agent run

## 3. Catalog tiering + templates

Phase-11-05 §§1, 3.

- [ ] Tier `find-component` results: search returns names +
  one-liners + prop names only (~300 tokens total); full entry
  (props, slots, emits, examples) only on exact `tag` lookup
- [ ] Library "Insert" / copy-own: write the catalog component file
  into the project so it lands in the project registry/map (§1)
  and later turns import it instead of re-describing markup
- [ ] "Ask AI to use it" seeds a chat turn naming the component
- [ ] Seed one starter (`projects/lumen`) with the catalog installed
  so the registry/injection path is exercised by default
- [ ] `catalog/templates/` alongside components: named, previewable
  arrangements (module, compound, multi-column) in the same
  manifest; a template install is one write + `str-replace`
  customisation, not a layout generated from scratch
- [ ] Templates get Insert + Ask-AI actions (same mechanics as
  components)

## 4. Skills / knowledge packs (progressive disclosure)

Phase-11-05 §2, phase-11-06 §H. No `SKILL.md` loader exists yet;
guidelines currently grow the agent instructions instead.

- [ ] Adopt `SKILL.md` folders (frontmatter + concise body; bodies
  cite catalog/template names, not file bodies)
- [ ] Metadata (~100 tokens per skill: `name` + `description`)
  always visible in instructions; body (<5k tokens) loads only
  when the task triggers it — a plain copy fix must not pay the
  layout body tokens
- [ ] First skills: `making-layouts` (catalog primitives first,
  templates second, mobile/tablet-ready by default),
  plus knowledge packs as skills (Paper.js, state machines,
  Noct libs / grids) per phase-11-06 §H
- [ ] Skill format contract documented (frontmatter required,
  body <5k tokens, one task per skill) so future skills stay cheap

## 5. Yardstick — prove it, then tune

Phase-11-05 §9. Usage is measured; savings are not yet proven.

- [ ] Create the 5-task yardstick (add counter, restyle card,
  build pricing section from template, fix injected runtime
  error, add form validation) as scripted or documented manual runs
- [ ] Record baseline (today's build) in phase-11-05 §9:
  median tokens, median turns, median elapsed per task
- [ ] Append a results row after each step above lands:
  step, median tokens, turns, elapsed vs baseline
- [ ] Use yardstick data to set the §1 map-injection file-count
  threshold, §2 history/trim limits, and §3 catalog tier sizes

## 6. Deferred — only when a real project demands it

- [ ] Rung 3 AST units (phase-11-05 §8): `read-symbol` returning
  one component/function body, AST-validated edits. Spike only
  after one real 50+ file project exists; keep/drop note appended
  to phase-11-05. Do not build speculatively
- [ ] P2 stack-aware edits on the resolver: Tailwind-class edit
  (preserve variants/responsive prefixes), add-import-for-component,
  add/change-prop. Each a `str-replace` wrapper with a fixture test,
  dialect from the project profile
- [ ] Exact DOM↔source stamp: Vite plugin tags JSX with
  `data-ai-loc="file:line"` in dev; `resolve-source` already
  honours a `sourceLoc` when supplied. Do it when nested catalog
  components prove systematically ambiguous for the heuristic join
- [ ] Session compact (Agent-context Layer 3): only after chat
  persists a long thread — keep last ~4 text turns + a 20-line
  working set (files touched, what changed, open questions) in a
  project `.ai-session.md`, summarize the rest, and re-read disk
  files after compact instead of trusting the summary

## Explicitly rejected (keep rejecting)

- [ ] Hand-written marker comments in generated code — the map is
  generated data (§1), comments rot and cost tokens forever
- [ ] Vector/RAG codebase indexing — tools + maps win at this scale
  (Continue deprecated `@Codebase` the same way)
- [ ] Loading all skill bodies into the system prompt — defeats
  the progressive-disclosure token story (§4)
- [ ] Full-AST tooling or a second compaction agent on day one —
  machinery in search of a problem at starter scale
