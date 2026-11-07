---
name: making-layouts
description: How to build page and screen layouts in this editor: project components first, catalog primitives second, layout templates third, custom markup last; responsive across the project's device targets by default.
triggers: layout, landing page, section, responsive, columns, arrange, hero, pricing, dashboard layout
---

# Making layouts

Work in this order. Stop at the first level that covers the need.

1. **Reuse the project.** Call `codebase-map` — if the project
   already has a component for this region or pattern, import it.
   Never re-describe markup the project already owns.
2. **Catalog primitives.** Call `find-component` for the building
   blocks (Button, Card, Tabs, Dialog, Input, Separator and the
   rest of the shadcn stock). A search returns summaries; pass a
   tag for the full entry before using it, and install with
   `install-catalog-component` so the component lands in the
   project registry.
3. **Templates for arrangements.** A whole section is usually a
   template, not a fresh layout: `hero-module` (opening section),
   `multi-column-3` (three equal modules), `pricing-section`
   (heading + three tiers). Place with `place-template`, then
   customise the constants at the top of the placed file with
   str-replace. Do not generate a common arrangement from scratch.
4. **Custom markup last**, and only for what the levels above do
   not cover. Keep it in the project's own vocabulary: its
   components, its style set, its spacing habits.

## Format first

The brief states the project's format. Honour it:

- **app** (viewport-fit): the page never scrolls; regions and
  panels own their overflow and chrome stays pinned. Add controls
  inside regions, toolbars and panels. Adapt across targets by
  rearranging regions.
- **page** (document flow): the page scrolls and grows; content
  lives in sections. Adapt across targets by reflowing — stack
  columns, scale type — not by pinning.

## Responsive by default

- Build for every device target in the brief at once, not desktop
  first with mobile as an afterthought. Grid with
  `repeat(auto-fit, minmax(...))` and flex wrapping cover most
  reflow; reserve breakpoints for real rearrangements.
- Master-detail is the base layout for list-plus-detail screens
  (mail, files, settings): list region + detail region, collapsing
  to one region with a back affordance on the phone target.
- Keep tap targets and text sizes usable at the phone width; if a
  region cannot shrink honestly, stack it.

## Verify before claiming done

After a layout edit, run `run-project-check` and read
`layout-snapshot` at the target widths. Overflow findings are
judged by format (the gate knows which axis may scroll); fix or
explicitly waive every finding you leave behind.
