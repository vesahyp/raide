# CLAUDE.md

Guidance for AI agents working in this repo. `README.md` is the player page:
what the game is and how to play it. Code, architecture and process notes
live here. `TODO.md` is forward-looking only. `docs/design.md` is the
design: the research behind it and what the game is meant to become. Read
it before changing a rule, a price or a control.

## What this is

**Raide** is a railroad tycoon for the phone, in the browser, played with one
thumb. Drag from a station to a site and the game lays the track, bridges
the water and shows the cost on the line. Buy a train, and it runs the line
on its own: timber from the forest to the sawmill, boards from the sawmill
to the town, grain to the mill and flour to the towns, cash on every
delivery. Finland from 1862. Scenarios with one goal and a year limit: the
sawmill (deliver 20 boards before 1866, the tutorial) and Harju (two
chains, two towns, a lake and a ridge, grow both towns to size 3 before
1872, which takes a network). Raide is Finnish for a railway track.

## Stack

The Räkkä architecture, copied from `sora` (ADR 0001):

- **Vite + TypeScript + React.** React renders the title, the HUD, the
  cards and the result. The map never goes through React.
- **Canvas 2D** for the map. No engine, no image assets: the terrain, the
  sites, the track and the trains are drawn with paths.
- **A headless sim** under `src/game/`, stepped at a fixed `DT` of 1/60 s,
  the one authority on money, goods, trains and blocks.
- **The bot plays the checks.** `tools/bot.ts` plays the scenario headless
  in `npm run sim-check`; the hand in `tools/hand.ts` plays it by touch in
  `make playthrough` and leaves a video.

## Where things live

```
src/
  game/               the simulation, no DOM anywhere in here
    types.ts          ScenarioDef, Site, Station, Line, Train, SimState
    grid.ts           the grid the player never sees: eight directions, A* routing two ways (the
                        cheapest and the shortest, which bridges water and cuts a ridge), the costs
                        (track 1, cutting 3, bridge 4, station 20), the track links per cell
    state.ts          createState(scenario), siteAt, stationAt, siteById, goodsOnMap
    sim.ts            step(): months, production, upkeep, the trains and the one-train-per-block
                        rule, grades (a ridge cuts the speed by the engine's climb and the load),
                        loading, the full-load wait, paying, demand, town growth at the year end;
                        plan/build/undo/buyTrain/addWagon/setEngine/setFullLoad/sellTrain/
                        closeYearEnd are the player's moves, the UI and the bot call the same ones
    content/
      economy.ts      every number the balance is made of: prices, demand, the two engines, the
                        wagons and what they carry, growth
      scenarios.ts    the hand-made maps: size, water, ridge, sites, start, goal, the engines on sale
  render/
    camera.ts         the map fitted to the screen, turned a quarter in landscape; toScreen, toWorld
    renderer.ts       the baked land, water, sites, stations, track, bridges, trains, smoke, the
                        hand that shows the first drag, floats and labels; ?dbg=1 draws the path
  input/input.ts      one finger: drag from a station to build, tap to open a card; pointer events
  audio.ts            a few synthesised sounds; track.ts the tracker shim
  ui/
    Game.tsx          the loop, the HUD (year, cash, goal), the cards: the route choice after a lift
                        that met the lake or the ridge, the line (its trains, buy with wagons and
                        engine), the train (wagon, engine swap, full load, sell), the site (has,
                        wants, pays, growth), the year end, the result
    Screens.tsx       the title and the scenario list
    Update.tsx        the newer-build banner; ErrorBoundary.tsx the crash screen
  styles.css          the chrome: brass and dark green, large round buttons, a ledger page; the HUD
                        is a bar on top in portrait and a column on the left in landscape
  i18n.ts             fi and en, tr() and L(); version.ts the build id and the update check
tools/
  bot.ts              the player with no thumb: a plan per scenario, steps taken as the cash allows
                        (a line with the cheap or the short route, a train, a wagon, an engine)
  hand.ts             the thumb: the same plan as touches on the phone, with a hand's pace
  sim-check.ts        npm run sim-check: the rules asserted headless, the bot must win both maps
  balance.ts          npm run balance: the year by year numbers of the bot's game (SCENARIO=harju)
scripts/
  shots.mjs           phone screenshots with Playwright, the bot playing
  touch-check.mjs     lays track and buys a train by real touches on an emulated phone
  rotate-check.mjs    turns the phone mid-game: the state stays, the canvas and the HUD fit
  playthrough.mjs     a scenario by thumb (SCENARIO=harju by default), portrait and landscape, a
                        video and frame sheets
  icon.mjs            renders public/icon.svg to the PNG icons
  pwa-check.mjs       manifest, icons, service worker, offline, against the live site
infra/                Terraform: the tracking pixel host (S3 + CloudFront + logs), see TRACKING.md
docs/
  design.md           the research and the design
  adr/                architecture decisions, one per file
```

## Rules

1. **The sim is headless.** Nothing under `src/game/` may touch `window`,
   `document`, React or audio. Sounds are names pushed onto `state.sounds`.
2. **Fixed step.** The sim runs at `DT = 1/60`; the render loop accumulates
   real time and calls `step` a whole number of times. Never pass a frame
   delta into `step`. `?speed=3` runs the sim at triple pace for scripts.
3. **Content is data.** A new map is a `ScenarioDef` in `scenarios.ts`,
   with a plan for the bot in `tools/bot.ts`. A balance change is a number
   change in `economy.ts`, proved by `npm run balance` and
   `make playthrough` before it ships.
4. **The player's moves are sim functions.** `plan`, `build`, `undo`,
   `buyTrain`, `closeYearEnd` in `sim.ts`. The UI and the bot call the same
   ones, so what the bot can do the thumb can do and the other way round.
5. **No signals, no deadlock.** A block is the cells between two stations;
   one running train on it at a time, and two lines that share cells share
   the block; trains wait at stations. Nothing in the UI shows a signal. A
   free line laid over other lines' track is slow for this reason, and
   that is a choice the player can read on the map.
6. **Both orientations.** Every screen works in portrait and in landscape,
   and a turn of the phone mid-game keeps the state. `make rotate-check`
   holds this.
7. **Two languages in the game, English in the code.** Every player-facing
   string exists in Finnish and English (`src/i18n.ts`). Place names stay
   Finnish in both.

## Workflow

- `make dev` (http://localhost:5173, also on the LAN for a phone).
- **Before committing:** `make check` (typecheck, build, sim-check) must
  pass.
- **A control or balance change is proved by thumb, on video.**
  `make playthrough` plays the scenario on an emulated iPhone in portrait
  and in landscape with the hand in `tools/hand.ts`, every input a touch,
  and leaves a video and frame sheets per run in `shots/playthrough/`. Read
  the sheets and watch the video before claiming a change is felt.
- `make touch-check` after touching `input.ts` or the cards;
  `make rotate-check` after touching the canvas sizing or the HUD layout.
- Deploy is automatic: every push to `main` builds and publishes to GitHub
  Pages (`.github/workflows/deploy.yml`) at https://vesahyp.github.io/raide/.
- Screenshots come from `make shots`, never from a hand-held browser.
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
