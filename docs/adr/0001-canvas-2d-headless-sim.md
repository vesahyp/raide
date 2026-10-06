# 0001: The Räkkä architecture: Canvas 2D, a headless fixed-step sim, the bot plays the checks

Date: 2026-10-06. Status: accepted.

## Context

Raide is the fourth browser game in the family after Räkkä, Höyry and Sora.
Each one runs on a phone from GitHub Pages, draws its own sprites, and is
checked without a browser. The design (`docs/design.md`) says the sim is the
authority on money, prices, trains and blocks, and that any rule the bot
cannot check is suspect.

## Decision

- **Vite + TypeScript + React** for the menus, the HUD and the cards. The map
  never goes through React.
- **Canvas 2D** for the map, with procedural drawing and no engine, no image
  assets, no tile sets.
- **A headless sim** under `src/game/` with no DOM in it, stepped at a fixed
  `DT` of 1/60 s. The render loop accumulates real time and calls `step` a
  whole number of times.
- **The bot plays the checks.** `tools/bot.ts` plays every scenario in
  `npm run sim-check`, and `make playthrough` plays it again by touch on an
  emulated phone with a recorded video. A balance change ships after both.
- **Content is data.** A scenario is a `ScenarioDef`; the numbers of the
  economy live in `src/game/content/economy.ts`.

## Consequences

- The same sim runs in the page and in Node, so a bug found on the phone is
  reproduced in a check in seconds.
- Nothing visual can be a rule. Blocks, prices and the goal are in the sim;
  the renderer reads and draws.
- A later 3D view or a map engine would replace `src/render/` only.
