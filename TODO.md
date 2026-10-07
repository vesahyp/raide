# TODO

Forward-looking only. Shipped items are deleted; git history is the record.
The design is in `docs/design.md`; its "first hour" table is the order.

## Next: the game in the top-down style

The plan to build the game in the look Vesa picked on 2026-10-07
(`docs/design.md`, Art direction; `docs/mockups/topdown/`). It replaces the
three.js renderer. **No game code starts until Vesa says go.**

**How the work runs.** The lead session runs on Opus. It splits each slice
into pieces, writes an exact brief for each piece, reviews every diff, runs
the checks, looks at the phone screenshots, commits and pushes. Sonnet
subagents write the code, one piece at a time unless Vesa allows more.
Each slice deploys to https://vesahyp.github.io/raide/ and is reported with
the link and three steps to try on the phone. A slice is judged by looking
at the screen on phone emulation. Scripted checks stay short.

### Slice 1: the big map, top down

Playable: Harju as it plays today, on a 120 by 90 tile map in the new look.
The player scrolls with one finger, pinches through the four zoom levels,
drags a line, buys a train and watches it haul.

- Sim (Sonnet): a scenario becomes a tile map, with one terrace level per
  tile (a whole number, 10 m each), water, forest and fields. Harju is
  redrawn as the mockup valley. Routing, the rail profile, and cut and fill
  work on the tile grid. The bot's plan follows the new map; `make check`
  passes and the bot wins.
- Renderer (Sonnet): `src/render/render2d.ts`, ported from
  `docs/mockups/topdown/scene.html`. The terrain is drawn once per chunk
  into cached canvases, the sprites are cached the Höyry way, the trains run
  on the track, and the whole-map zoom has its own simpler drawing.
  `render3d.ts` and the three dependency are deleted.
- Input and camera (Sonnet): one finger scrolls, a pinch zooms between
  close up and the whole map, a drag from a station builds, the map
  scrolls when the finger nears the edge during a drag, and a tap on a
  train follows it.
- Checks (Sonnet): `make look`, `drag-look`, `touch-check` and
  `rotate-check` on the new renderer, and a frame-rate check at play zoom
  on an emulated iPhone.
- ADR 0003, top-down Canvas 2D in place of ADR 0002 (Opus).

### Slice 2: the route under the finger

Playable: every drag is a decision. The route under the finger is coloured
by grade with chevrons uphill, with grey marks for cuttings and sand for
fills. The plate shows cost, length, worst grade, earthwork and the light
engine's speed on that grade. The way round is dashed beside it with its
own cost, and the lift picks one. A Cancel button is under the thumb for
the first second.

- Sim (Sonnet): the route options with their numbers for each engine.
- Renderer (Sonnet): the route, the marks and the dashed way round.
- UI (Sonnet): the plate and the choice after the lift.
- Checks (Sonnet): `drag-look` over the ridge in both orientations.

### Slice 3: goods you can see

Playable: what each site makes and wants is read from the map. Piles of
logs, boards and sacks grow and shrink with the stock. The chips show at
every zoom, and the whole map shows badges. A tap on a site opens its card:
what it has, what it wants, every buyer of its output with the price now
and the distance, and a button that starts a drag from there.

- Renderer (Sonnet): the piles from the stock, chips and badges by zoom.
- UI (Sonnet): the site card and its drag button.
- Sim (Sonnet): the buyers list with price and distance.

### Slice 4: trains you run

Playable: buy a train with an engine and wagons, add wagons, move a train
to another line. At close up the station loads the train wagon by wagon.
The train card shows the consist, the load, the trip time full and empty,
this year's earnings, and the speed on the line's worst grade for each
engine.

- Sim (Sonnet): moving a train to another line; the trip times and the
  earnings per train.
- UI (Sonnet): the buy card and the train card.
- Renderer (Sonnet): loading at the platform, the load tag on the train.

### Slice 5: a map worth a session

Playable: Harju with more sites: a second forest, a second farm and a
third town, so the first choice is what to connect first. Prices move on
the screen: a chip's bar falls as a town fills and comes back. Towns grow
house by house. The year-end ledger shows income by good as bars and cash
by year as a line.

- Content and balance (Sonnet): the sites, the numbers in `economy.ts`,
  the bot's plan. `npm run balance` shows the goal falls late in the
  scenario, not early.
- Renderer (Sonnet): houses added as a town grows.
- UI (Sonnet): the ledger with its charts.
- Check (Opus): one short thumb playthrough on video, watched.

### For Vesa to decide

- How many Sonnet subagents run at once. The default is one at a time.
  Two at once are possible where the pieces share no file, for example
  the renderer and the sim in slice 1.

Left in the design for a later build: tunnels, passengers and mail, loans,
the harbour and the export sink, eras and the coal unlock, industries that
close, branches and junctions, double track, lines with more than two
stops, autosave, stars in DynamoDB, the sandbox.

## After that

- Passengers and mail between the two towns, and the tunnel as a third
  route choice on a ridge.
- Scenario 4, Harbour: the export sink, loans, an industry that closes, the
  coal era unlock.
- Lines with more than two stops, so one train can serve a town from the
  sawmill and the mill.
- Branches: a drag from any point on existing track places a junction.
- Double track as a second drag over a line.
- Autosave at the year end and at every build; resume from the title.
- Scenario stars in DynamoDB behind one Lambda, once there is a records
  screen to show them on.
- The tracking rollup and the stats board, copied from sora once it has one.
- The name: Raide, Veturi or Ratapiha.
