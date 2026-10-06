/**
 * npm run sim-check: the rules of the slice, asserted headless. The bot plays the sawmill
 * scenario and must win it; the first paid delivery lands inside 90 s; the route to the town
 * crosses the river on a bridge; trains never share a block; undo gives the cash back.
 */
import { createState } from '../src/game/state';
import { SAWMILL } from '../src/game/content/scenarios';
import { step, plan, build, undo, buyTrain, DT, lineOf, along, trainLength } from '../src/game/sim';
import { idx } from '../src/game/grid';
import { Bot } from './bot';
import { YEAR_SECONDS } from '../src/game/content/economy';

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};

// the routes
{
  const s = createState(SAWMILL);
  const site = (id: string) => {
    const x = s.sites.find((o) => o.id === id)!;
    return idx(s, x.cx, x.cy);
  };
  const r1 = plan(s, site('forest'), site('sawmill'));
  check(!!r1 && r1.bridge.length === 0, `forest to sawmill is dry land (${r1?.cells.length} cells, cost ${r1?.cost})`);
  check(!!r1 && r1.cost <= 80, `the first line is affordable with a train on top (${r1?.cost} of 300)`);
  check(!plan(s, site('sawmill'), site('town')), 'a drag from a site with no station builds nothing');
  const line = build(s, r1!);
  check(!!line && s.stations.length === 2 && s.lines.length === 1, 'the build places the station and the line');
  const r2 = plan(s, site('sawmill'), site('town'));
  check(!!r2 && r2.bridge.length >= 2 && r2.bridge.length <= 4, `sawmill to town crosses the river on a bridge (${r2?.bridge.length} bridge cells, cost ${r2?.cost})`);
  const cash = s.cash;
  build(s, r2!);
  check(s.cash === cash - r2!.cost, 'the build is paid');
  check(undo(s), 'the build can be taken back inside its second');
  check(s.cash === cash && s.lines.length === 1 && s.stations.length === 2, 'undo refunds the cash and removes the track, the station and the line');
  const r2b = plan(s, site('sawmill'), site('town'));
  check(!!r2b && r2b.cost === r2!.cost, 'the same drag costs the same after the undo');
  build(s, r2b!);
  const t = buyTrain(s, line!.id, 'flat');
  check(!!t && s.trains.length === 1, 'a train is bought');
  check(!undo(s), 'a bought train closes the undo');
}

// the bot wins
{
  const s = createState(SAWMILL);
  const bot = new Bot();
  let overlap = 0;
  let maxTrains = 0;
  const limit = (SAWMILL.goal.beforeYear - SAWMILL.startYear) * YEAR_SECONDS + 10;
  for (let t = 0; t < limit && !s.result; t += DT) {
    bot.act(s);
    step(s);
    maxTrains = Math.max(maxTrains, s.trains.length);
    // two running trains on one block is the bug the rule forbids
    const running = s.trains.filter((o) => o.state === 'run');
    for (let i = 0; i < running.length; i++)
      for (let j = i + 1; j < running.length; j++) {
        const a = lineOf(s, running[i]);
        const b = lineOf(s, running[j]);
        if (a === b || [...a.block].some((c) => b.block.has(c))) overlap++;
      }
  }
  for (const l of bot.log) console.log(`  ${l}`);
  check(!!s.result && s.result.won, `the bot wins the sawmill scenario (${s.result ? `${s.result.won ? 'won' : 'lost'} in ${s.result.year}, cash ${s.result.cash}, ${s.result.stars} stars` : 'not over'})`);
  check(s.firstPayAt !== null && s.firstPayAt < 90, `the first paid delivery lands inside 90 s (${s.firstPayAt?.toFixed(0)} s)`);
  check(overlap === 0, `trains never run the same block at once (${overlap} frames)`);
  check(maxTrains === 3, `the bot runs three trains (${maxTrains})`);
  check(!!s.result && s.result.year <= SAWMILL.goal.beforeYear - 1, `the goal falls with a year to spare (${s.result?.year})`);
  check(!!s.result && s.result.stars >= 2, `the bot's cash earns two stars or more (${s.result?.cash}, ${s.result?.stars} stars)`);
  // a train draws inside the map
  for (const t of s.trains) {
    const line = lineOf(s, t);
    const p = along(line, t.s, s.w);
    check(p.x >= 0 && p.x <= s.w && p.y >= 0 && p.y <= s.h, `train ${t.id} is on the map (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), length ${trainLength(t).toFixed(1)}`);
  }
}

console.log(failed ? 'sim-check failed' : 'sim-check ok');
if (failed) throw new Error("sim-check failed");
