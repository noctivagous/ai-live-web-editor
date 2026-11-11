---
name: build-a-feature-graph
description: Build or extend an ALE feature graph with the ale_graph_* tools — when a graph build is warranted, how packs reconcile (missing / present / conflicting / extra), what provenance means, and when to ask the user instead of guessing. Use when the user talks about features, capabilities, or what the app should do, and the project has (or needs) a feature graph.
---

# Building a feature graph in ALE

The feature graph is ALE's shared picture of what the app *is*: regions
contain features; features have statuses; packs graft whole subtrees.
The user sees the same graph in the Features facet, so everything you
put in it is product surface, not scratch notes.

## When a graph build is warranted

- The user describes features or capabilities ("the app needs accounts,
  checkout, and emails") and no graph exists yet, or the graph lacks them.
- The user asks to plan or structure work before building it.
- A feature pack is being installed (`ale_graph_install_pack` grafts it).
- The graph has drifted from the disk (`ale_graph_reconcile`,
  target `feature-drift`, reports drift) and the user wants it true again.

Not warranted: a single small page fix, a styling change, or a bug hunt.
Don't grow the graph as a side effect of unrelated work — mention it and
let the user decide.

## Procedure

1. **Read first.** `ale_graph_read` with graph `features` (whole graph,
   or mode `overview` for the rollup). Never add nodes blind: duplicates
   and wrong parents are the common failure.
2. **Shape top-down.** Regions first (kind `region`), then features
   under them (`parentId`), then screens/components/settings/data as
   needed. Node kinds: `region | feature | screen | component |
   setting | data | service`.
3. **Statuses are the lifecycle.** `proposed → planned → building →
   done → verified`; `blocked` and `dropped` are terminal-ish states,
   `suggested` is reserved for derivation awaiting review. New nodes
   start `proposed` unless the work is already underway.
4. **Edges are relationships, containment is `parent`.** Edge types:
   `depends-on | configures | renders | data-flows | derived-from`.
   Don't encode containment as an edge.
5. **Apply in one change set** with `ale_graph_apply` — changes apply
   in order and each is validated by the store; read the per-change
   results and fix refusals rather than retrying blindly.
6. **Provenance.** A node that came from a pack carries its pack id
   (the graft stamps it). A node you invent carries a `note` saying
   where it came from (the user's words, a plan, a brief) — future
   readers trust stamped nodes differently from unstamped ones.

## Packs and reconciliation

Reconciling a pack against the project speaks one vocabulary:
**missing** (the pack would add it), **present** (already in place),
**conflicting** (something different is in place; following the pack
replaces it — surface this to the user, never resolve it silently),
**extra** (in the project, not in the pack — left alone, listed for
information). `ale_graph_reconcile` reports; `ale_graph_install_pack`
applies for feature packs. An install reports wired and unwired links:
unwired links are information, not failure, but report them.

## When to ask the user instead of guessing

- A feature could live under two regions and the choice changes the
  app's shape.
- A reconcile reports `conflicting` items.
- The user's description names a capability the catalog already has as
  a pack — ask (or state) whether to graft the pack or model it by hand.
- You would be deleting or dropping nodes (`remove-node`, status
  `dropped`). Proposing is cheap; removal is the user's call.
