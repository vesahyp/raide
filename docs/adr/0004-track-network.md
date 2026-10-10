---
adr: 4
title: Track is a network the player lays freely; a line is a list of stops routed over it
date: 2026-10-10
status: Shared track superseded by 0005
deciders: Vesa
---

# 0004: Track is a network the player lays freely; a line is a list of stops routed over it

## Context

Vesa, testing on the phone, 2026-10-10: "Making tracks should be possible
to custom locations so you can do custom layouts." Until now every drag
went from a station to a site and made one line that owned its cells: track
and line were the same thing, so a layout was whatever the lines' straight
A* paths made it. The cells already store their track links as an
eight-direction bitmask, so the map can hold any shape of track; only the
model on top of it assumed one line per path.

Painting track tile by tile is what phone players disliked most in the
research (`docs/design.md`, Part 1: OpenTTD on Android, Train Valley). The
thumb-friendly version is the drag the game already has, freed of its
ends.

## Decision

- **Track is laid by a drag from a station or any point of existing track
  to any tile.** The game routes the cells as now (cheapest or shortest,
  grades, cuttings, bridges) and charges for the new ones. The drag may
  end on open ground: that is a track end, and a later drag can start
  from it. A drag that starts in the middle of existing track makes a
  junction there; the cell's bitmask carries three or more links.
- **The rail height belongs to the cell**, not to the first line over it,
  so free track has a profile of its own.
- **A line is a list of two to four stations.** Its path is found over the
  laid track (track cells cost their length, untracked cells are not
  passable) between each pair of neighbouring stops, and found again
  whenever track is laid or lifted. A drag that ends on a site builds the
  station and, when track joins it to the start station, makes the line
  as today, so the old one-drag line still works. A station's card can
  also make a line to any station the track reaches.
- **Rule 5 holds as it is:** one running train per block, a block being
  the cells of a leg; legs that share a cell share the block, and a train
  never stands over another line's cells unannounced (`standsOver`).
  Junctions add no signals.
- Lifting track removes cells that no line's path uses; a line whose path
  breaks is shown as cut, its trains wait at their last station, and the
  line card says which stretch is missing.

## Consequences

- The player designs the layout: shared trunks, branches, loops round a
  hill, a spur to a mine, with no change to how trains, blocks and
  loading work.
- A line's path can change when track is laid, so trip times, the route
  plate and the buy card are computed from the line's current path.
- Costs: a drag to open ground can leave dead track that costs upkeep
  every month; the tip and the line card must make that visible. Routing
  lines over a network is a new A* on track only, run on every build;
  it must stay cheap on 12 000 cells. The bot keeps its station-to-station
  plans; a custom-layout plan is added to prove a branch and a shared
  trunk run without deadlock.

## Update 2026-10-10

The shared track of this decision is superseded by ADR 0005: every line
has its own double track. The free track shapes were not finished and
are kept on the branch `custom-track-wip`.
