---
adr: 6
title: The core loop is growth per delivery, a pick every half minute, and a map that fits one screen
date: 2026-10-10
status: Accepted
deciders: Vesa
---

# 0006: The core loop is growth per delivery, a pick every half minute, and a map that fits one screen

## Context

The same review as ADR 0005 found three more faults in the core loop:

- **Growth was hidden and all or nothing.** A town grew only when every
  good it wanted and travellers were all in store, month after month.
  Lahti fell from 75 % of its growth meter to 0 % in two years while the
  player supplied two of its three needs. In six years no house rose.
- **Too few decisions.** Three real choices in six game years. A train
  made 0.4 to 2.5 round trips a year at 90 seconds a year, so it
  delivered once every 40 to 200 seconds, and the cash for the next
  train took most of a year. In four of the six years the only input was
  fast forward. The year-end contract asked for what the player already
  did, and taking it cost nothing.
- **Too much to tend.** Travellers and mail added a third line to every
  town before the first two worked. Orders, the crew, the crane, the
  second platform and line lengthening each doubled a choice on a small
  screen and changed a small number. Harju was about seven portrait
  screens, so a drag often panned the map.

Vesa decided on 2026-10-10, ranked: lines never block each other (ADR
0005), every delivery grows the town where you see it, and a real
decision every 20 to 30 seconds.

## Decision

- **Every load a town gets grows it.** A town has a growth count. Each
  load delivered adds to it, more when the town got the other good it
  takes in the last half minute too, so a second chain speeds growth.
  Nothing takes growth away. The count to the next size is shown, and a
  house rises on the map every few loads, so the first deliveries show
  within a minute.
- **A pick every half minute.** At set times the sim holds and the
  player picks one of two upgrades (Mini Metro's weekly pick), for
  example one more wagon on every train of a line, or a bridge at half
  price. This replaces the year-end contract. The year end no longer
  holds the game; the ledger stays one tap away.
- **Trips take seconds.** Sites are closer and a round trip is 10 to 20
  seconds. Prices are scaled so the next train or line is affordable
  within half a minute of good play. A win of Harju takes about 10 to
  15 minutes.
- **The map fits one portrait screen.** Harju and Sawmill are redrawn
  smaller. In portrait the camera shows the whole map and does not pan
  or zoom. In landscape the map is as wide as the screen allows and pans
  up and down only.
- **Cut:** travellers and mail, the year-end contract, train orders and
  express stops, the crew, the crane and bought platforms, lengthening a
  line and mixed consists, and the route card when its two options do
  not differ (one must be cheaper and the other faster).
- **Kept:** "Lay track from here" with a price on every site, buying a
  train for any line at any time, the engines, the NEEDS row and the
  goal strip (they now count growth), goods as piles on the map, the
  ledger and the trips number on the buy card.

## Consequences

- Most of `docs/economy.md` (five steps of an economy built on yearly
  pace, contracts and fares) no longer describes the game. It stays as
  history with a note at the top, and the numbers move to
  `content/economy.ts`.
- The pick adds a modal card every half minute. It must be readable in
  two seconds and close with one tap, or it is an interruption.
- A smaller map has less room for route choices round lakes and ridges.
  Harju keeps one lake, one river and one ridge, so cheap and short
  routes still differ on a few links.
- The measure of done is no longer the bot. A scripted human-like
  playthrough on an iPhone 16 in portrait logs every decision with its
  game time, and must show a decision at least every 30 seconds, a town
  growing in the first 2 minutes, and a win in about 10 to 15 minutes.
