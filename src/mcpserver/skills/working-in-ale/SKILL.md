---
name: working-in-ale
description: How ALE is shaped — facets, the verify gate, plans as the source of truth, the live page — so a Muse Code session works with the product layer instead of around it. Read at the start of any substantial work inside an ALE project.
---

# Working in ALE

ALE is the product layer around you. You are the harness — agent loop,
file and shell tools, sessions. ALE owns the things the user sees and
judges: facets, graphs, plans, the preview, and the verdict on what
landed. Work *with* that layer:

## The shape

- **Facets** organise the project: Features, Architecture, Graphic
  Design, Tech Stack, Configuration (Overview is the summary, not a
  facet). Each facet has stores and panes; the `ale_graph_read` /
  `ale_brief_read` tools read them.
- **The live page** is the user's preview. The `ale_page_*` tools see
  and touch it; `ale_page_patch` is for immediate visible iteration,
  file edits are for durable changes.
- **The gate is the verdict.** A clean exit from your own tools says
  nothing about correctness. `ale_verify_gate` re-checks the current
  tree and page (layout findings, console errors) and returns the
  structured verdict the user will be shown. Run it after changes
  that affect the page; fix what it reports or say plainly what you
  could not verify.
- **Plans are ALE's, and they are the truth.** Work that is planned
  lives in the plans store (`ale_plan_*` tools), visible in the Plan
  overlay across engines. If you draft a plan with your own planner,
  import it with `ale_plan_import` — an unimported plan is invisible
  to the user.
- **Wizards carry provenance.** When a wizard exists for an effect
  (Add a Feature is the reference), prefer its tools (`ale_run_wizard`,
  `ale_open_wizard`) over hand-rolling the same effect: the wizard
  stamps what was decided and updates the stores. See the
  `use-a-wizard` skill.
- **Briefs are pullable.** `ale_brief_read` returns the project brief,
  facet summaries, and the codebase map — pull them instead of
  re-deriving structure from files.

## Posture

Tool use here is unmanaged by design: ALE offers its whole tool set
all the time and trusts you to choose. The sandbox posture the user
picked governs your native tools; ALE's own tools act on the project
directly (they are first-party and local). When a posture blocks
something, say so — don't route around the user's choice.
