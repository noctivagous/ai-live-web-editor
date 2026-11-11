---
name: use-a-wizard
description: Prefer ALE's wizard tools over hand-rolled effects — when to open the UI head (ale_open_wizard) because a real user decision is missing, and when to run the headless head (ale_run_wizard) because the brief already answers the wizard's questions.
---

# Using ALE's wizards

A wizard is a two-headed effect: a UI head the user drives, and a
headless head you can run with stated defaults. Both heads share one
validation and one effect, and both stamp provenance — what was
created, with what input, by which head. Hand-rolling the same effect
with file tools produces the files but not the record, and the stores
(features, plans, config) end up untrue.

## Prefer the wizard when one covers the effect

- Add a Feature (`add-feature`): grafts a feature pack with its
  defaults policy, wires links, and reports unwired ones.
- If no wizard covers the effect, do the work directly — and say the
  wizard doesn't exist rather than imitating one.

## Which head

- **`ale_open_wizard`** when a real user decision is missing: which
  pack, which option, anything the brief does not settle. The call
  stays open while the user completes or cancels the wizard in the
  editor; the result is the structured outcome (or a cancellation —
  a cancelled wizard is an answer, not an error: acknowledge it and
  don't retry the same open).
- **`ale_run_wizard`** when the brief already answers the wizard's
  questions: the user named the pack and accepted defaults, or a plan
  step specifies the effect. Defaults are the wizard's stated
  defaults; the outcome records that the headless head ran and with
  what input, so the user can see what was decided on their behalf.

## Manners

- One wizard at a time; don't open a second while one is pending.
- Report the outcome's ids (nodes created, plan slug) so the user can
  find the result in the facet panes.
- A wizard refusal (validation) is information about the project
  state — read it, fix the precondition if it's yours to fix, or
  report it. Don't fall back to hand-rolling around a refusal without
  telling the user.
