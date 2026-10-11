# CLAUDE.md

Guidance for AI agents working in this repo. `README.md` is the player page:
what the game is and how to play it. Code, architecture and process notes
live here. `TODO.md` is forward-looking only. `docs/design.md` is the
design: the research behind it and what the game is meant to become. Read
it before changing a rule, a price or a control.

## What this is

**Raide** is a mobile Railroad Tycoon 2 (ADR 0007), in the browser, played
by touch in portrait. The loop is RT2's, copied: lay track anywhere (grades,
bridges, earthworks paid for), place stations whose square catchment decides
what cargo they gather and take, buy a locomotive and give it a route of
stops with the cars it leaves each stop with, earn by straight distance,
transit time and demand, pay upkeep, fuel, repairs and interest, borrow with
bonds, and meet a bronze, silver or gold goal before a deadline, or lose.
Industries convert (logs to lumber and paper, grain to food); towns grow
from service. Only the controls and the screen are adapted to a phone. The
plan is `docs/rt2-plan.md`. Finland from 1862: Sawmill (the tutorial) and
Harju (Tampere to Helsinki). Raide is Finnish for a railway track.

## Stack

The Räkkä architecture, copied from `sora` (ADR 0001):

- **Vite + TypeScript + React.** React renders the title, the HUD, the
  cards and the result. The map never goes through React.
- **Canvas 2D** for the map (ADR 0003), in Höyry's style: top down with a
  3/4 lean, flat colours, dark outlines, sprites drawn with canvas paths.
  A tile map larger than the screen that pans and pinches (ADR 0007), hills
  as one-tile terrace steps. No image assets, no WebGL.
- **A headless sim** under `src/game/`, stepped at a fixed `DT` of 1/60 s,
  the one authority on money, goods, trains and growth.
- **The bot plays the checks; human-like players measure the game.**
  `src/game/bot.ts` plays a careful and a careless plan headless in
  `npm run sim-check`; `scripts/human.mjs` plays Harju by touch in
  `make human`, logs every decision and trade-off and leaves a video.

## Where things live

```
src/
  game/               the simulation, no DOM anywhere in here
    types.ts          Site, Station (catchment size, waiting cargo, glut), Stop and Car (a route's cars per stop),
                        Train, Bond, Book and YearEnd, SimState
    grid.ts           the grid: eight directions, route() for a drag (A* over cell and heading, no turn over 45
                        degrees, the cheap and the level route, waypoints), the rail profile and the price,
                        trackPath() for a train (turns round at a station or a track end, never at a junction)
    state.ts          createState(scenario): the land cut into terraces, the sites' buildings, the towns' houses
    sim.ts            step(): production, stations taking cargo, trains (unload, change cars, load, wait for full,
                        run with grade and power, break down), pay, conversion, town growth, the month and year end,
                        bonds, bankruptcy, the goal. The player's moves: buildTrack, removeTrack, buildStation,
                        removeStation, buyTrain, setRoute, replaceLoco, sellTrain, issueBond, repayBond
    bot.ts            the player with no thumb: a careful and a careless plan per scenario
    content/
      economy.ts      every number the balance is made of: pay, glut, stations, industries, towns, locomotives,
                        upkeep, bonds
      scenarios.ts    the hand-made maps (Harju 64 by 88, Sawmill 44 by 56), the sites, the goal
  render/
    render2d.ts       the map in Canvas 2D: the camera (pan, pinch), the terrain and track cached per chunk of 16
                        tiles, sites, houses, stations, trains, the route being planned, the catchment, the cargo
                        overlay, the HTML overlay (names, waiting cargo, floats)
    draw2d.ts         the sprites: tiles, trees, track, bridges, buildings, engines and cars
  input/input.ts      fingers: browse (pan, pinch, tap), track (drag to lay, rest to bend), station (drag the
                        square), route (tap the stops)
  audio.ts            a few synthesised sounds; track.ts the tracker shim
  ui/
    Game.tsx          the loop, the HUD (year, cash, goal, speed), the tool bar and the cards: plan, track piece,
                        new station, station, site, train, route, trains, money, goal, cargo, menu, result
    Chart.tsx         profit and worth by year, on the money card and the result
    icons.tsx         the cargo icons
    Screens.tsx       the title and the scenario list
    Update.tsx        the newer-build banner; ErrorBoundary.tsx the crash screen
  styles.css          the chrome: brass and dark green, large round buttons
  i18n.ts             fi and en, tr() and L(); version.ts the build id and the update check
tools/
  sim-check.ts        npm run sim-check: the rules asserted headless; the careful plan wins, the careless loses
  balance.ts          npm run balance: a plan played headless (SCENARIO=harju PLAN=careful|careless)
scripts/
  human.mjs           make human: the measure of done, two human-like players by touch on an iPhone 16
  look.mjs            make look: the careful bot plays on an emulated iPhone 16, screenshots into shots/look/
  home.mjs            pictures of the start screen
  icon.mjs            renders public/icon.svg to the PNG icons
  pwa-check.mjs       manifest, icons, service worker, offline, against the live site
infra/                Terraform: the tracking pixel host (S3 + CloudFront + logs), see TRACKING.md
docs/
  rt2-plan.md         the plan of 2026-10-11: RT2's loop, what is in and cut, the touch controls
  design.md           the research of 2026-10-06; Part 2 is history since ADR 0007
  economy.md          history
  adr/                architecture decisions, one per file
```

## Rules

1. **The sim is headless.** Nothing under `src/game/` may touch `window`,
   `document`, React or audio. Sounds are names pushed onto `state.sounds`.
2. **Fixed step.** The sim runs at `DT = 1/60`; the render loop accumulates
   real time and calls `step` a whole number of times. Never pass a frame
   delta into `step`. `?speed=4` runs the sim four times as fast for scripts.
3. **Content is data.** A new map is a `ScenarioDef` in `scenarios.ts`,
   with a careful and a careless plan in `src/game/bot.ts`. A balance change
   is a number change in `economy.ts`, proved by `npm run balance`,
   `npm run sim-check` and `make human` before it ships.
4. **The player's moves are sim functions.** The UI and the bot call the
   same ones, so what the bot can do the thumb can do.
5. **RT2, not a mix (ADR 0007).** A rule, a price or a control comes from
   RT2, adapted only for a phone screen. Trains pass through each other on
   single track (RT2 with collisions off), so there are no signals and no
   deadlock. A player must be able to lose money and fail the scenario.
6. **Two languages in the game, English in the code.** Every player-facing
   string exists in Finnish and English (`src/i18n.ts`). Place names stay
   Finnish in both.

## Workflow

- `make dev` (http://localhost:5173, also on the LAN for a phone).
- **Before committing:** `make check` (typecheck, build, sim-check) must
  pass.
- **A renderer change is judged by looking at `make look`**, the pictures in
  `shots/look/`.
- **A control or balance change is proved by human-like players, on
  video.** `make human` plays Harju on an emulated iPhone 16 in portrait,
  every input a touch: a careful player and a careless one. It leaves the
  decision log with the trade-offs met, a picture per decision and a video
  per player in `shots/human/`, and fails unless the careful player wins and
  the careless player loses. A decision count is not a measure. Look at the
  pictures before claiming a change is felt.
- Deploy is automatic: every push to `main` builds and publishes to GitHub
  Pages (`.github/workflows/deploy.yml`) at https://vesahyp.github.io/raide/.
- Screenshots come from `make look` and `make human`, never from a hand-held browser.
- **The game installs as an app.** `public/manifest.webmanifest` and the
  icons are hand-written; `vite.config.ts` writes `sw.js` into the build.
  `make pwa-check` runs the install check against the live site.
- `make plan` and `make apply` for `infra/`: the tracking pixel host. The
  game learns its URL only from the build environment (`VITE_PIXEL_URL`):
  `make env` writes `.env.local` from the Terraform output for builds here,
  and the Pages deploy reads a GitHub repository variable of the same name.
  Never put the URL in a committed file. `TRACKING.md` has the events.
- When a change alters what the player sees or does, update `README.md` in
  player words.
