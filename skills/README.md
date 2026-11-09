# Skill format contract

A skill is a folder `skills/<name>/SKILL.md` that teaches the
editor's agent one task or one library, loaded by progressive
disclosure: cheap metadata always, the body only on trigger.

## Frontmatter (required)

```markdown
---
name: making-layouts
description: One or two sentences: what this skill teaches and when it pays.
triggers: layout, landing page, section
types: web-app, content-site
dependsOn: paper
---
```

- `name` (required) — kebab-case, matches the folder name.
- `description` (required) — the always-visible line. It is the
  only part most turns ever see, so it must say what the skill is
  *for*, not repeat its name.
- `category` (optional) — the Skills panel's display grouping
  (an ALE field, not one of the agentskills.io spec's six).
  Defaults to `General`.
- `triggers` (optional) — words or phrases in the user's ask that
  mean this skill applies. Keep them specific: a trigger that
  fires on unrelated turns taxes every one of those turns with
  the body.
- `types` (optional) — project types (from `project.ai.json`:
  web-app, canvas-tool, game, dashboard, content-site) the skill
  applies to.
- `dependsOn` (optional) — package names. The skill triggers when
  the project's `package.json` actually depends on one:
  knowledge follows evidence, not guesses.

Matching order: ask trigger > dependency evidence > project type.
A skill with no triggers, types or dependsOn can still be loaded
explicitly with the `read-skill` tool.

## Body rules

- **Under 5,000 tokens** (the loader flags anything over; the
  index stays cheap only if bodies stay concise). Aim for
  400–900 tokens: an API card, the idioms, the pitfalls, one
  canonical snippet at most.
- **One task per skill.** Two tasks means two skills; a body that
  covers everything teaches nothing at the moment it loads.
- **Cite names, not file bodies.** Refer to catalog components by
  tag (`Button`), templates by id (`pricing-section`) and tools by
  name (`place-template`). Bodies that paste source go stale and
  blow the budget.
- **Plain second-person task language.** No narration about the
  editor or the skill system itself; write what to do.

## What a skill is not

Not a system-prompt dumping ground (that is what the tiers
prevent), not documentation for humans browsing the repo (the
audience is the agent mid-task), and not a place for project
state — skills are shared across projects; project facts live in
the project's own files and brief.
