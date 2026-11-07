---
name: paper-js
description: Knowledge pack for Paper.js vector/canvas work: scope and item-tree model, paths and boolean ops, hit-testing, the onFrame loop, and the pitfalls that cost the most time.
triggers: paper.js, paperjs, bezier, vector path, hit test, hit-test
dependsOn: paper
---

# Paper.js pack

## The model in one paragraph

One `PaperScope` per canvas. Everything drawable is an `Item` in a
tree: `project` -> layers -> groups/paths. Points are paper's own
`Point` (not `{x, y}` literals — convert at boundaries).
`view.onFrame` is the animation loop; nothing moves unless you
mutate items there or call `view.update()` / rely on the built-in
draw after events.

## API card

- Setup: `paper.setup(canvas)` or `new paper.PaperScope()` for
  offscreen/multiple canvases; `scope.activate()` before using
  the global-style API in that scope.
- Paths: `new Path({ segments: [p1, p2], strokeColor, closed })`,
  `path.smooth()`, `path.flatten()`, `path.simplify()`.
- Compound work: `path.unite(other)`, `intersect`, `subtract`,
  `exclude` return new paths — assign or add them; the originals
  stay in the tree until removed.
- Hit testing: `project.hitTest(point, { segments: true, stroke: true, fill: true, tolerance: 5 })`;
  the result's `item` is the deepest hit — walk `item.parent`
  when the user thinks in groups.
- Text: `PointText` with `content`; measure via `bounds`, not DOM.

## Idioms

- Keep a name->item map for anything the UI refers to twice;
  searching the tree by class on every frame is the classic
  slow-down.
- Group related items and transform the group; per-item matrix
  math drifts.
- Remove with `item.remove()` when done — setting `visible =
  false` keeps dead items in hit tests and bounds forever.

## Pitfalls

- Import `paper/dist/paper-full` (or the scoped package entry)
  in browser builds; the bare `paper` main is the Node build in
  some bundlings and silently lacks view handling.
- Coordinates: paper uses top-left origin, y down — the same as
  the DOM, unlike most vector tools' exports. SVG import flips
  are the usual source of upside-down art.
- Boolean ops on paths with `insertItems: false` in the
  constructor options leak invisible originals into the project.
- `onFrame` receives `event.delta` (seconds) and `event.count`;
  integrate motion with delta, never per-frame constants, or the
  speed depends on refresh rate.
