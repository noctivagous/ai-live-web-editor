---
name: noct-grids
description: Knowledge pack for the Noct grid substrates from grid-paint-labs (Hull, Dot Shading, Hex Paint, Metaball Grid, Vector Field) and the key-click interaction model: mouse aims, keys act.
category: Libraries & code
triggers: grid paint, substrate, hex grid, metaball, dot shading, key-click, vector field
types: canvas-tool, game
---

# Noct grids pack

## The interaction model: key-clicks

The mouse aims; keys act. Moving the pointer only moves the
cursor cell — nothing is deposited until a key is held or
pressed. Holding a key deposits continuously at the aimed cell;
different keys are different tools (deposit, erase, lift, seed).
This is the house model for canvas tools here: prefer it over
click-drag painting unless the user asks for drag explicitly.

## The substrates

Each substrate is a grid of cells plus a field the tools write
into; rendering derives from the field, never the other way round.

- **Hull** — cells accumulate mass; the visible shape is the hull
  (contour) of the mass field. Good for blob-building and
  territory.
- **Dot Shading** — each cell renders a dot whose radius follows
  its value; deposit raises value, so shading is sculpted.
  Good for halftone and relief effects.
- **Hex Paint** — axial-coordinate hex grid; deposits colour a
  cell and its neighbours by falloff. Mind the axial<->pixel
  conversion; pointy-top and flat-top are different layouts, pick
  one and keep it in a constant.
- **Metaball Grid** — point charges on a coarse grid; the surface
  is the iso-contour of summed falloff. Deposit adds charge;
  rendering cost follows grid resolution, not charge count.
- **Vector Field** — each cell holds a direction; tools rotate or
  align the field, and particles (if any) ride it. Flow visuals
  come from integrating the field, not from drawing the arrows.

## Structure for a canvas-tool project

- Keep the substrate (cells + field + step) independent of the
  renderer (canvas 2D today, something else later) and of the
  input layer (pointer position -> cell, key map -> tool).
- One fixed-timestep step for the field; render reads state,
  never mutates it.
- Pointer->cell conversion lives in exactly one function per
  substrate; hit behaviour bugs are almost always a second,
  divergent conversion hiding in a handler.

## Status note

This pack is the knowledge card for the substrates. Packaging
them as an importable library inside the editor package is the
phase-11-06 §H follow-on; until then, a new canvas-tool project
starts from the substrate structure above, in the project's own
files.
