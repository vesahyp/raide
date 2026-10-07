---
adr: 3
title: The map is top-down Canvas 2D in Höyry's style, on a big tile map with terrace hills
date: 2026-10-07
status: Accepted
deciders: Vesa
---

# 0003: The map is top-down Canvas 2D in Höyry's style, on a big tile map with terrace hills

Supersedes ADR 0002.

## Context

ADR 0002 put the map in three.js: a tilted low-poly height field that fit
on one screen. Vesa held that build on 2026-10-07. The look he wants is
Höyry's: top down and zoomed in like Prison Architect, on a big map that the
player scrolls, where hills, rivers and forest are clear from the drawing
itself. Four still screens in that style (`docs/mockups/topdown/`) got:
"These look great! The zoom levels all seem relevant. Tile step hills also
brilliant! Can see them clearly."

## Decision

- **The map is Canvas 2D again**, drawn the Höyry way: flat colours, a dark
  outline on everything, a soft drop shadow, a 3/4 lean, sprites drawn with
  canvas paths and cached. No WebGL, no image assets. three.js and
  `render3d.ts` are deleted.
- **A scenario is a big tile map.** About 120 by 90 tiles for a full
  scenario; a tile is 100 m. The land is whole terraces of 10 m
  (`TERRACE_M`), drawn as one-tile steps with a front face, so height reads
  without contour lines. A cover layer (forest, field, street) is drawing
  data on the scenario; the sim does not price it.
- **A site is one cell with a yard.** The station is the site's cell; its
  buildings and piles stand in a yard north of it that track cannot cross.
- **The camera scrolls and zooms, it does not turn.** Four zoom levels with
  a smooth pinch between them: close up, play zoom, route zoom and the
  whole map, which draws a simpler map.
- **The terrain is cached.** The land, the track and the static objects are
  drawn once per chunk of tiles into canvases and redrawn only when a line
  is built or the zoom changes a lot. Trains, smoke, piles, the route under
  the finger and the HTML overlay are drawn every frame.
- ADR 0001 holds as it was: the headless fixed-step sim, the bot, the
  checks. The renderer keeps the public shape scripts already use:
  `project(x, y)`, `pick(sx, sy)`, `follow(train)`, `trainAt(sx, sy)`.

## Consequences

- The map can be as big as a scenario needs, and a hill the player sees is
  still the grade the train feels and the cutting the player pays for.
- No GPU flags are needed in Playwright, and the bundle loses about 600 kB.
- Costs: the 3D work of slice 1 (the carved height field, the camera that
  turns) is thrown away. One-tile steps make a gentle slope look like
  stairs, by choice. Trains are drawn after the land, so a terrace in front
  of a cutting does not hide a train in it. A big map needs scrolling during
  a drag, and a route on the whole-map zoom is too small to lay, so the
  player zooms in to build. The per-cell numbers of the economy were
  re-scaled for the 100 m tile, so the balance is new and proved again by
  the bot.
