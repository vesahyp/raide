# TODO

Forward-looking only. Shipped items are deleted; git history is the record.
The design is in `docs/design.md`; its "first hour" table is the order.

## Now: Vesa plays the overnight build

All five steps of `docs/economy.md` shipped on 2026-10-08, then Harju was
played by touch on an iPhone 16 overnight and the weaknesses a player hits
were fixed in order: the game now says what is stuck and what to do next
(a tip, a marker, a goal chip that names its towns), every start and far
site is a real choice, a fast clock, pick mode asks before lengthening a
line, a goal sensible play can win with stars for winning early and a
result card, and no train stands on another. Vesa plays it before the
next step starts. What the economy plan left out (double track, engines by
era) is listed there.

Still weak, in the order a player meets it:

- Towns grow from size 3 by a market and a hall more than by houses (a
  yard fits about 7); growth past the goal is not much to look at.
- The bot's three Harju plans end within 35 % of each other in net worth,
  not 20 %: a route never crosses laid track in an X now, which costs the
  mixed plan. The choice is real but not even.
- Passengers earn little against goods; a coach line is a growth need
  more than a business.
- The playthrough is flaky at normal speed on a loaded machine
  (`SPEED=0.5` is steady).

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

### Left from slices 1 to 5 and the night

- A mixed train (forest, sawmill, town) earns about a third less per
  engine than two single trains, because each wagon loads on one leg. It
  pays where cash is short. Vesa decides whether that is the right
  trade-off.

- The Harju ridge is a flat-topped mesa of uniform width; the mockup's
  ridge was softer. Revisit with slice 5's map work.
- At Koskensaha the east points of the platform tracks sit on the bridge
  deck. At a terminus the train turns in one frame; an engine that runs
  round its train would read better.
- The "Join to the railway" pick mode and the "why it is stuck" line have
  no screenshot in `make goods` yet.

### For Vesa to decide

- How many Sonnet subagents run at once. The default is one at a time.

Left in the design for a later build: the longer platform
(a station upgrade after the loading crew), tunnels, shrinking towns, loans,
the harbour and the export sink, eras and the coal unlock, industries that
close, branches and junctions, double track, lines with more than two
stops, autosave, stars in DynamoDB, the sandbox.

## After that

- The tunnel as a third route choice on a ridge.
- Scenario 4, Harbour: the export sink, loans, an industry that closes, the
  coal era unlock.
- Branches: a drag from any point on existing track places a junction.
- Double track as a second drag over a line.
- Autosave at the year end and at every build; resume from the title.
- Scenario stars in DynamoDB behind one Lambda, once there is a records
  screen to show them on.
- The tracking rollup and the stats board, copied from sora once it has one.
- The name: Raide, Veturi or Ratapiha.
