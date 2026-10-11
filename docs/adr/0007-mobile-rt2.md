---
adr: 7
title: Raide is a mobile Railroad Tycoon 2; the loop is copied and only the controls change
date: 2026-10-11
status: Accepted
deciders: Vesa
---

# 0007: Raide is a mobile Railroad Tycoon 2; the loop is copied and only the controls change

## Context

Raide has had three cores and none was fun. The first was "drag a line, buy
a train, wait". The second (ADR 0005, ADR 0006, build Palanut Veturi) mixed
Mini Metro, Pocket Trains, RT2, Transport Fever 2 and OpenTTD and was tuned
so that a script made a decision every 30 seconds. It played worse: nothing
could be lost, nothing was traded off, and the map that fit one screen
removed the route choice.

Vesa decided on 2026-10-11: stop mixing games. Raide is a mobile Railroad
Tycoon 2. The plan is `docs/rt2-plan.md`.

## Decision

- Copy RT2's loop: free track laying with terrain cost, stations the player
  places with a catchment area, locomotives with a route and a consist set
  per stop, industries that produce, convert and consume, prices from
  distance, transit time and demand, towns that grow from service,
  maintenance, fuel, breakdowns, bonds, and a scenario with a deadline that
  can be failed.
- Change only the controls and the screen: one finger pans, two pinch, a tap
  opens a card from the bottom, a bottom bar holds the tools.
- Single track, any shape. Trains pass through each other, as in RT2 with
  collisions off, so there are no signals and no deadlock.
- The maps are larger than the screen again.
- Cut for now: the stock market, rivals, buying industries, station
  buildings, collisions, double track.
- The measure of done is a human-like run on an iPhone by touch that shows
  a win from careful play and a loss from careless play. A decision count
  is no longer a measure.

## Consequences

- ADR 0005 and ADR 0006 are superseded: lines that own their track, the
  pick of upgrades, growth per delivery and the one-screen map go.
  ADR 0004's free track network comes back in a simpler form: no blocks,
  since trains do not wait for each other.
- The sim, the cards and most of the renderer's line code are rewritten.
  The terrain, the sprites and the camera stay.
- Costs: the game is harder to learn. RT2 shows its numbers in windows; a
  phone has room for one card. Every card must say the one number the
  decision needs. Trains that pass through each other look wrong for a
  moment on single track.
- `tools/bot.ts`, `tools/sim-check.ts`, `scripts/human.mjs` and the checks
  that test lines are rewritten.
