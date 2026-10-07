# TODO

Forward-looking only. Shipped items are deleted; git history is the record.
The design is in `docs/design.md`; its "first hour" table is the order.

## Now: the look is on hold

Vesa, 2026-10-07: the 3D renderer stops here. The look he wants is Höyry's
flat style, top down and zoomed in like Prison Architect, on a big map that
scrolls. `docs/mockups/topdown/` has four screens in that style. Nothing is
built on either renderer until he picks.

## Next: the build that puts the design on the screen

Vesa played Harju on 2026-10-06: "drag a line, buy a train, wait". He could
not tell what a site makes or wants, and could not see the hill, so the
terrain cost was invisible. The design in `docs/design.md` already has the
answers; the slice used a small part of it. The mockups in
`docs/mockups/README.md` show the target. Nothing below starts until Vesa
says yes to them.

What the next build takes from the design, in this order:

1. **Height on the map.** A scenario carries a height field (the ridge and
   the hills as height, the lake as the low ground), drawn as colour bands,
   a contour every 10 m, and hill shading. The grade of a route comes from
   the height along it. Costs per the design: track 1 per cell, each
   percent of grade adds 25 %, bridge 4, cutting 3 and later tunnel 8.
2. **Goods on the map at all times.** Each site carries chips: what it has
   with a count and a stock bar, what it wants with the price now and a
   demand bar. Icons for timber, boards, grain and flour, the same icons on
   the wagons and on the cards.
3. **The route under the finger.** Cost, length, worst grade and trip time
   on the line while the finger moves, the grade as colour along the line
   with chevrons uphill, the way round drawn dashed beside it. After the
   lift, the two buttons carry the same numbers and what they mean for each
   engine. (Design: "Track laying with a thumb".)
4. **Trains that show their load.** Every wagon draws what it carries. A
   train on a grade carries its speed. The train card shows the consist, the
   load, the trip time full and empty, this year's earnings, and the speed
   on this line's worst grade for each engine and wagon count.
5. **The site card sends the next train.** What it has, what it wants, why it is
   stuck, and every buyer of its output with the price now and the distance,
   with a button that starts a drag from here. (Design: "What the player
   sees".)
6. **The ledger with charts.** Income by good as bars, cash by year as a
   line, which town grew, the one choice. (Design: "Money and goals".)
7. **A map with more than one answer.** Harju gets a second ridge or a hill
   so that the forest line also has a grade choice, and the lake shore
   bends so the way round the water is not obvious. The bot still has to
   win it.

Left in the design for a later build: tunnels, passengers and mail, loans,
the harbour and the export sink, eras and the coal unlock, industries that
close, branches and junctions, double track, lines with more than two
stops, pinch zoom, autosave, stars in DynamoDB, the sandbox.

## After that

- Passengers and mail between the two towns, and the tunnel as a third
  route choice on a ridge.
- Scenario 4, Harbour: the export sink, loans, an industry that closes, the
  coal era unlock.
- Lines with more than two stops, so one train can serve a town from the
  sawmill and the mill.
- Pinch to zoom and two-finger pan during a drag, for maps bigger than the
  screen.
- Branches: a drag from any point on existing track places a junction.
- Double track as a second drag over a line.
- Autosave at the year end and at every build; resume from the title.
- Scenario stars in DynamoDB behind one Lambda, once there is a records
  screen to show them on.
- The tracking rollup and the stats board, copied from sora once it has one.
- The name: Raide, Veturi or Ratapiha.
