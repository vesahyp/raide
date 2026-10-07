# 0002: The map is three.js, the land is a height field, the camera tilts and zooms

Date: 2026-10-07. Status: accepted. Changes the Canvas 2D part of ADR 0001.

## Context

Vesa played the Harju slice on 2026-10-06 and could not tell what a site
makes or wants, or how much hill there is, so the terrain cost was invisible
and the game was "drag a line, buy a train, wait". Flat 2D mockups with
contour lines did not change his mind: "Do we need to go 3d or isometric?
Im looking for the rail building sim experience but on phone." A three.js
look test (`docs/mockups/3d/`) did: "These look better."

## Decision

- **The map is drawn with three.js** on a WebGL canvas, low poly, flat
  shaded, with one directional light and shadows. No image assets: every
  building, tree, wagon and pile is a few boxes, cones and cylinders.
- **The land is a height function** on the scenario (`terrain(x, y)` in
  metres, continuous). The sim reads it at cell centres; water is where it
  is below zero. The renderer samples it between cells and carves it along
  every built line: a cutting where the rail is below the land, an
  embankment where it is above, a bridge on piers over water.
- **A route has a rail profile.** The land along the cells is clamped so
  that no step is steeper than `GRADE_MAX`; the cut and fill that takes is
  paid for. A train's speed on a step is its engine's climb share on the
  grade, less its load. The grade is drawn as colour on the route under the
  finger and shown on its plate.
- **The camera is orthographic and tilted** 40 degrees, so the view reads
  as isometric and the whole map fits on one screen. One finger from a
  station builds; one finger elsewhere pans; two fingers pinch to zoom and
  twist to turn; a tap on a train makes the camera follow it.
- **Text is HTML.** Names, chips, floats and the plate are DOM elements in
  an overlay, placed each frame by projecting world points.
- **The sim stays headless** and unchanged in shape: ADR 0001's fixed step,
  bot and checks hold. `src/game/` still has no DOM in it.

## Consequences

- The map's look and the terrain cost are the same thing now: a hill the
  player sees is a grade the train feels and a cutting the player pays for.
- Playwright needs the GPU flags from sora to draw WebGL at speed; every
  phone script launches with them.
- The 2D renderer and its affine camera are gone; scripts that read
  `cam.m` use `project(x, y)` and `pick(sx, sy)` instead.
- three.js adds about 600 kB to the bundle. The first paint on a phone is
  under two seconds on the tested devices; the service worker keeps it
  offline after that.
