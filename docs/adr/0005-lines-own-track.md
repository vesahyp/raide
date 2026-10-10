---
adr: 5
title: Every line has its own double track; no train waits for a train of another line
date: 2026-10-10
status: Accepted
deciders: Vesa
---

# 0005: Every line has its own double track; no train waits for a train of another line

## Context

An independent review played Harju on the live build (2594b42) for six
game years on an emulated iPhone 16 (artifact "Is Raide fun?",
2026-10-10). Its verdict: Raide is not fun yet. The main cause is in the
core loop. Since ADR 0004 lines share single track, and only one train
runs on a shared stretch at a time. The router merged four lines on one
trunk without asking, each new line made the old ones slower, and nothing
on the screen said why. In 1867 the network delivered nothing. A second
train on a two-stop line added 0.0 trips a year, and the tip still told
the player to buy it.

In the games players like, building more makes the network carry more:
Mini Metro lines never block each other, and Pocket Trains gives each
line its own track. `docs/design.md` already marked "a line owns its
track (Pocket Trains)" as the thumb-friendly choice before ADR 0004
changed it.

Vesa decided on 2026-10-10 to rebuild the core around the review, and
put this change first.

## Decision

- **A line owns its track.** A drag from a station to a site lays a new
  line's own cells. The route never runs along another line's track. It
  may cross another line at a right angle or on a diagonal (a level
  crossing), and the trains of the two lines pass through the crossing
  without waiting. The straight approach to a station is shared by the
  lines that use that side of it, and each line has its own platform
  track there.
- **A line is double track.** Trains that run in opposite directions
  pass each other. A train keeps a gap behind the train of its own line
  ahead of it in the same direction, and waits behind it at a platform.
  So one more train on a line always adds trips, until the trains wait
  for loads at the pile, which the player can see on the map.
- **A line has two stops.** Lengthening a line and mixed consists go
  (ADR 0006).
- The blocks, the turn order at a shared block (`GATE_RESERVE`), the
  passing siding, bought platforms, the patience siding, and train orders
  that pass a station through all go from the sim and from CLAUDE.md
  rule 5. Nothing here can deadlock: trains of a line move in two
  one-way queues, and lines do not interact.
- The shared-track part of ADR 0004 is superseded. Its free track shapes
  (a drag to open ground, junctions) never reached `main` and are kept on
  the branch `custom-track-wip`.

## Consequences

- The capacity lever is simple: buy a train, or a wagon. The buy card's
  trips number can be a sum of the trains' free-running trips, capped by
  what the source makes.
- Two lines to the same town do not share a trunk. A player who wants a
  second line along a busy corridor pays for all of its track again.
  Track is the main cost of a new line, and this is the reason it is.
- Double track is less true to 1862 Finland, where branch lines were
  single track. The game takes the simpler rule for a thumb.
- A station takes a limited number of lines: one platform track each,
  as many as the renderer draws beside the platform. A drag that would
  add one more is refused, and the plate says so.
- Lines cross in level crossings with no wait. Two trains can be drawn
  over each other at the crossing for a moment.
- `tools/bot.ts`, `tools/sim-check.ts` and every script that tested
  blocks, sidings, platforms or orders are rewritten or removed.
