# TODO

Forward-looking only. Shipped items are deleted; git history is the record.
The design is in `docs/design.md`; the core loop is ADR 0005 and ADR 0006.

## Now: Vesa plays the core rebuild

The core loop was rebuilt on 2026-10-10 from the independent review: every
line has its own double track, every load grows its town, a pick of two
upgrades every half minute, Harju on one portrait screen. `make human`
is the measure. Vesa plays it on the phone before the next step starts.

Still weak, in the order a player meets it:

- The site labels and the NEEDS chips crowd a 30-tile map; at 12 px a
  tile they cover yards and track.
- Landscape shows the map as wide as the screen and pans up and down; it
  has not been played by the human-like script.
- The pick's options are drawn at random from two groups; whether every
  pair is a real choice needs a player's eye.

## Later

- Free track shapes (a drag to open ground, junctions), on the branch
  `custom-track-wip`, if Vesa wants custom layouts back on top of lines
  that own their track.
- Tunnels as a third route choice on a ridge.
- Scenario 4, Harbour: the export sink, an industry that closes, the coal
  era unlock.
- Autosave at every build; resume from the title.
- Scenario stars in DynamoDB behind one Lambda, once there is a records
  screen to show them on.
- The tracking rollup and the stats board, copied from sora once it has one.
- The name: Raide, Veturi or Ratapiha.
