# Raide as a mobile Railroad Tycoon 2

Plan of 2026-10-11. Vesa's decision: stop mixing games. Raide copies the
Railroad Tycoon 2 (RT2) loop and changes only the controls and the screen
for a portrait phone. This page replaces the core loop of ADR 0005 and
ADR 0006 (see ADR 0007).

## RT2's core loop

1. Look at the map: what each industry and town supplies and demands, and
   what a delivery there pays.
2. Lay track between two places. The terrain sets the cost: grades, bridges,
   cuttings. A detour is cheaper to build and slower to run.
3. Put a station on the track. Its catchment area decides what cargo it
   gets and what it accepts.
4. Buy a locomotive, give it a route of stations, and set the cars it
   carries and changes at each stop.
5. The train earns money by distance, speed and demand. Industries turn
   delivered cargo into new cargo (logs to lumber), so one delivery makes
   the next load. Towns that get service grow and want more.
6. Pay for it all: track and train maintenance, fuel, repairs of old
   locomotives. Borrow with bonds when the cash is short, and pay interest.
7. Meet the scenario goal before the deadline, or lose. Run out of money
   with no credit left, and lose earlier.

## What the player decides, minute to minute

- **Which connection next.** Logs pay at the sawmill and at the paper mill;
  the far buyer pays more and needs more track.
- **Which way the track goes.** Straight over the ridge (cheap, steep, slow
  trains), round it (long), or through it in a cutting (dear).
- **Where the station goes and how big.** A large station reaches the farm
  and the town both, and costs twice as much to build and to keep.
- **Which locomotive.** Fast and weak, slow and strong on grades, or cheap
  and unreliable.
- **The consist at each stop.** Bring logs in, take lumber out, or run back
  empty. Empty cars cost fuel and earn nothing.
- **Borrow or wait.** A bond builds the next line now and costs interest
  every year.
- **Fix what goes bad.** A price falls at an oversupplied station, an old
  locomotive breaks down, a train loses money: re-route, replace or sell.

## In the first playable version

| RT2 system | In Raide v1 |
|---|---|
| Free track laying, grade, bridge, terrain cost | Yes. Single track, any shape, junctions. |
| Stations placed by the player, catchment, three sizes | Yes. |
| Locomotives with speed, pulling power, reliability, age | Yes, three or four of the 1860s to 1880s. |
| Route of up to four stops, cars set per stop, wait for full load | Yes. |
| Industries that produce, convert and consume | Yes: forest, farm, sawmill, paper mill, mill, town. |
| Cargo | Passengers, mail, logs, lumber, paper, grain, food. |
| Price by distance, transit time and demand that falls with supply | Yes. |
| Towns that grow from service | Yes. |
| Track, station and train maintenance, fuel, breakdowns | Yes. |
| Bonds with interest, credit limit, bankruptcy | Yes. |
| Scenario with bronze, silver, gold goals and a deadline | Yes. Failing it ends the game. |

**Cut from v1:** the stock market, rival companies, buying industries,
station buildings (water tower, maintenance shop, hotels), collisions and
signals (trains pass through each other on single track, as with RT2's
collisions off), double track, troops, the personal fortune, the full era
list of locomotives. **Removed from the current game:** the pick of two
upgrades, lines that lay their own track, growth per delivery, a map that
fits one screen.

The setting stays: southern Finland from 1862, the Sawmill and Harju
scenarios. Both maps get larger, about three screens by four on a phone, so
there are real route choices round lakes and ridges.

## RT2 controls on a portrait phone

| RT2 (mouse) | Raide (thumb, portrait) |
|---|---|
| Scroll and zoom the map | One finger pans, two fingers pinch. A tap on an empty spot does nothing. |
| Click on anything for its info window | Tap: a card slides up from the bottom and covers at most half the screen. |
| Build-track tool, click and drag sections | Track button, then drag from a point to a point. A pause of the finger makes a bend point. On lift: the route, its cost, length and steepest grade, and Build or Cancel. |
| Remove track | In track mode, tap a piece of track: a card with Remove and the refund. |
| Station tool and size | Station button, then tap the track. The catchment square and the cargo it covers show before Build; Small, Medium, Large in the card. |
| Buy train, choose locomotive | Train button or a station card's Buy train: a list of locomotives with their numbers. |
| Route window: stops and cars per stop | Tap stations on the map to add stops. Each stop is a row in the card, with car buttons (add, remove) and a Wait for full load switch. |
| Train list and train window | Tap a train, or the Trains list in the bottom bar: profit, age, reliability, route; Replace loco, Sell. |
| Company finance, bonds | Money button: cash, debt, interest, Issue bond, Repay bond, the yearly profit chart. |
| Game speed, pause | Pause, normal and fast buttons in the top bar. Building works while paused. |
| Cargo overlay | A Cargo button that marks every place that supplies or demands the chosen cargo. |

## How it is proved

A scripted human-like run on an emulated iPhone 16 in portrait, every input
a touch, with a video and a picture per decision. Two runs: a careful one
that wins, and a careless one (an expensive route, empty return trips, too
many bonds) that loses money and fails the scenario. The log names each
trade-off the careful player made and what it cost.
