# TODO

Forward-looking only. Shipped items are deleted; git history is the record.
The design is in `docs/design.md`; its "first hour" table is the order.

## Now: the economy and the loop

Vesa on build Terävä Ratavalli, 2026-10-08: "It works. But isnt a game
yet." `docs/economy.md` is the plan: money that is tight, running costs,
station capacity in place of the train cap, upgrades bought where the
bottleneck is, mixed trains and passengers. Nothing is built until Vesa
says yes.

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

### Left from slices 1 to 5

- `make playthrough` loses Harju by thumb: it builds all six lines and
  trains but Hämeenlinna stays at size 1 while Tampere reaches 5. The bot
  wins headless (1869). The thumb plays slower, so the balance leans on
  speed; look at which town the hand's plan starves.
- A town fits about 7 houses in its yard, not 20: growth past size 3 shows
  as the market and the hall more than as houses. A bigger town yard would
  need the map to give it room.
- The Harju ridge is a flat-topped mesa of uniform width; the mockup's
  ridge was softer. Revisit with slice 5's map work.
- At Koskensaha the east points of the platform tracks sit on the bridge
  deck. At a terminus the train turns in one frame; an engine that runs
  round its train would read better.
- The "Join to the railway" pick mode and the "why it is stuck" line have
  no screenshot in `make goods` yet.

### For Vesa to decide

- How many Sonnet subagents run at once. The default is one at a time.

Left in the design for a later build: the crane and the longer platform
(station upgrades after the loading crew), tunnels, passengers and mail, loans,
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
