# TODO

Forward-looking only. Shipped items are deleted; git history is the record.
The design is in `docs/design.md`; its "first hour" table is the order.

## Now: play the economy

All five steps of `docs/economy.md` are built: money that is tight, towns
that use what they get, the upgrades and the contract, mixed trains, and
travellers and mail. Vesa plays it on the phone before the next step starts.
What the plan left out (double track, engines by era) is listed there.

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

- A mixed train (forest, sawmill, town) earns about a third less per
  engine than two single trains, because each wagon loads on one leg. It
  pays where cash is short. Vesa decides whether that is the right
  trade-off.

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
- The name: Raide, Veturi or Ratapiha.## Now: the overnight push (2026-10-08 to 09)

Vesa: "I hope to have a good game by morning." Harju was played by touch
on an iPhone 16 after the economy plan's five steps shipped (build Iloinen
Satama). What works: the first ten minutes, and tight money in the early
years. The three things that most stop it being a good game, fixed in this
order, each deployed and replayed:

1. **The player loses the thread mid-game.** The thumb sat on 1400 to 3000
   cash from 1868 while Myllykylä held 20 flour with no line out and every
   town stayed at size 1. Nothing says what is stuck or what to do next;
   the goal chip "Size 3 0/2" names no town and no missing good.
2. **Half the map and the first choice do not matter.** Korpela, Niittylä,
   Peltola and Lahti get no deliveries in the bot's game; which forest to
   start from changes nothing.
3. **Dead time.** Long stretches where nothing needs the player, and no
   way to run the clock faster.


