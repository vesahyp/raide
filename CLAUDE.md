# CLAUDE.md

Guidance for AI agents working in this repo. `README.md` is the player page:
what the game is and how to play it. Code, architecture and process notes
live here. `TODO.md` is forward-looking only. `docs/design.md` is the
design: the research behind it and what the game is meant to become. Read
it before changing a rule, a price or a control.

## What this is

**Raide** is a railroad tycoon for the phone, in the browser, played with one
thumb. The whole map fits a portrait screen. Drag from a station to a site
and the game lays the line's own double track, bridges the water and shows
the cost on the line. Buy a train, and it runs the line on its own: timber
from the forest to the sawmill, boards from the sawmill to the town, grain
to the mill and flour to the towns, cash on every delivery, and every load
grows the town it reaches. Every half minute the game holds and offers two
upgrades to pick one of. Finland from 1862. Scenarios with one goal and a
year limit: the sawmill (deliver 15 boards before 1865, the tutorial) and
Harju (two chains, three towns, a lake and a ridge, grow two towns to size
3 before 1872, about 10 to 15 minutes of play). The core loop is ADR 0005
and ADR 0006. Raide is Finnish for a railway track.

## Stack

The Räkkä architecture, copied from `sora` (ADR 0001):

- **Vite + TypeScript + React.** React renders the title, the HUD, the
  cards and the result. The map never goes through React.
- **Canvas 2D** for the map (ADR 0003), in Höyry's style: top down with a
  3/4 lean, flat colours, dark outlines, sprites drawn with canvas paths.
  A tile map that fits the portrait screen (ADR 0006), hills as one-tile
  terrace steps. No image assets, no WebGL.
- **A headless sim** under `src/game/`, stepped at a fixed `DT` of 1/60 s,
  the one authority on money, goods, trains and growth.
- **The bot plays the checks; a human-like player measures the fun.**
  `tools/bot.ts` plays the scenario headless in `npm run sim-check`;
  `scripts/human.mjs` plays Harju by touch in `make human`, logs every
  decision with its game time and leaves a video.

## Where things live

```
src/
  game/               the simulation, no DOM anywhere in here
    types.ts          ScenarioDef, Site (stock, a town's store and growth points), Station, Line (two stops, its own
                        path, a platform slot at each end), Train, Pick and Perks (the upgrades), SimState
    grid.ts           the grid the player never sees: eight directions, A* routing two ways (the cheapest and the
                        shortest), the rail profile (the land clamped to GRADE_MAX, cut and fill paid for), the costs per
                        100 m tile; a route never runs along laid track, crosses it only straight over a straight piece
                        (a level crossing) and shares only a station's straight approach (ADR 0005)
    state.ts          createState(scenario): the land cut into 10 m terraces, the cover layer, the yards; yardOf,
                        siteAt, stationAt, siteById, goodsOnMap
    sim.ts            step(): months, production, upkeep, the trains (two one-way queues per line on its double
                        track, a gap to the train ahead, a wait at the loading stop for a full load), loading and
                        paying, growth per delivered load with the bonus for both goods, the year end (a record for
                        the ledger, it does not hold the game), the pick every PICK_SECONDS; lineYear is the loads a
                        minute a line's trains move, capped by what the source makes, the buy card's number.
                        plan/build/undo/buyTrain/addWagon/removeWagon/setEngine/sellTrain/liftLine/takePick/borrow/repay
                        are the player's moves, the UI and the bot call the same ones
    advice.ts         what the player should look at next, data only: the tip and the goal towns
    content/
      economy.ts      every number the balance is made of: prices, demand, distance, the engines, wagons, growth
                        (GROW_NEED, the variety bonus), the pick and its upgrades
      scenarios.ts    the hand-made tile maps (Harju 30 by 42, Sawmill 30 by 36): the land as a height function in
                        metres (water below zero), the cover, sites, start, goal
  render/
    render2d.ts       the map in Canvas 2D: the camera (the whole map in portrait, as wide as the screen and panning
                        up and down in landscape), the terrain cached per chunk of 16 tiles, each line's second track,
                        the trains (a train running back is on the second track), smoke and piles, the route under
                        the finger, the HTML overlay (names, chips, floats, the hand, the plate, the buy buttons)
    town.ts           a town's buildings laid out for all five sizes; the renderer raises them one by one as the
                        town's growth points come in
    draw2d.ts         the sprites: tiles, faces, trees, track, bridges, buildings, piles, engines and wagons
  input/input.ts      fingers: one from a station builds, a tap opens a card; pointer events
  audio.ts            a few synthesised sounds; track.ts the tracker shim
  ui/
    Game.tsx          the loop, the HUD (year, cash, goal strip, tip), the cards: the route choice when the two
                        ways differ, the line (its trains, buy with engine and wagons), the train, the site, the goal,
                        money, the pick, the result
    Ledger.tsx        the ledger of the last closed year, from the money card
    tips.tsx          the tip's words and the goal strip
    Screens.tsx       the title and the scenario list
    Update.tsx        the newer-build banner; ErrorBoundary.tsx the crash screen
  styles.css          the chrome: brass and dark green, large round buttons; the HUD is a bar on top in portrait
                        and a column on the left in landscape, the tip sits at the bottom in portrait
  i18n.ts             fi and en, tr() and L(); version.ts the build id and the update check
tools/
  bot.ts              the player with no thumb: a plan per scenario, steps taken as the cash allows, a preference
                        order at the pick
  sim-check.ts        npm run sim-check: the rules asserted headless, the bot must win both maps in time
  balance.ts          npm run balance: the bot's moves, the towns and the money (SCENARIO=harju)
scripts/
  human.mjs           make human: the measure of done, a human-like player on an iPhone 16 by touch, the decision
                        log with game times, a picture per decision and a video into shots/human/
  look.mjs            make look: the bot plays on an emulated iPhone 16, screenshots in both orientations
  shots.mjs           phone screenshots with Playwright, the bot playing
  touch-check.mjs     lays track and buys a train by real touches on an emulated phone
  buy-check.mjs       buys a train three ways by touch
  rotate-check.mjs    turns the phone mid-game: the state stays, the canvas and the HUD fit
  home.mjs, advice.mjs, wants.mjs, result.mjs   pictures of the start screen, the tip, the wants and the result
  icon.mjs            renders public/icon.svg to the PNG icons
  pwa-check.mjs       manifest, icons, service worker, offline, against the live site
infra/                Terraform: the tracking pixel host (S3 + CloudFront + logs), see TRACKING.md
docs/
  design.md           the research and the design
  economy.md          the economy plan of 2026-10-08; history since ADR 0006, the numbers live in economy.ts
  mockups/            the static screens the look is judged against (`make mockups`, `make topdown`)
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
   `buyTrain`, `takePick` in `sim.ts`. The UI and the bot call the same
   ones, so what the bot can do the thumb can do and the other way round.
5. **No signals, no deadlock, no line waits for another (ADR 0005).** Every
   line owns its double track. Trains of a line in one direction keep
   FOLLOW_GAP to the train ahead and wait behind it at the platform;
   trains in opposite directions pass; lines meet only in level crossings
   and at a station's approach, and never wait for each other. One more
   train adds loads until the source's pile is the limit, and the buy card
   says which.
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
- **A renderer change is judged by looking at `make look`**, the pictures in
  `shots/look/`, in both orientations, against `docs/mockups/topdown/png/`.
- **A control or balance change is proved by a human-like player, on
  video.** `make human` plays Harju on an emulated iPhone 16 in portrait,
  every input a touch, and leaves the decision log, a picture per decision
  and a video in `shots/human/`. It fails unless a decision comes at least
  every 30 s of game time, a town grows inside 2 minutes and the win takes
  about 10 to 15 minutes. Look at the pictures before claiming a change
  is felt.
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
