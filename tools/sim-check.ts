/**
 * npm run sim-check: the rules asserted headless. The bot plays both scenarios and must win
 * them; the first paid delivery lands inside 90 s; the routes offer a real choice at the lake
 * and the ridge; the strong engine beats the light one over the cutting with a load; a town
 * grows only when both goods reach it; demand falls and recovers; trains never share a block;
 * undo gives the cash back.
 */
import { createState, siteById } from '../src/game/state';
import { SAWMILL, HARJU } from '../src/game/content/scenarios';
import { step, plan, build, undo, buyTrain, DT, lineOf, along, trainLength, price, setFullLoad } from '../src/game/sim';
import { idx } from '../src/game/grid';
import { Bot } from './bot';
import { YEAR_SECONDS } from '../src/game/content/economy';
import type { SimState } from '../src/game/types';

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
const cell = (s: SimState, id: string) => idx(s, siteById(s, id).cx, siteById(s, id).cy);

// the routes and the undo, on the sawmill map
{
  const s = createState(SAWMILL);
  const r1 = plan(s, cell(s, 'forest'), cell(s, 'sawmill'));
  check(r1.length === 1 && r1[0].bridge.length === 0, `forest to sawmill is dry land and one route (${r1[0]?.cells.length} cells, cost ${r1[0]?.cost})`);
  check(r1[0].cost <= 80, `the first line is affordable with a train on top (${r1[0]?.cost} of 150)`);
  check(plan(s, cell(s, 'sawmill'), cell(s, 'town')).length === 0, 'a drag from a site with no station builds nothing');
  const line = build(s, r1[0]);
  check(!!line && s.stations.length === 2 && s.lines.length === 1, 'the build places the station and the line');
  const r2 = plan(s, cell(s, 'sawmill'), cell(s, 'town'));
  check(r2.length >= 1 && r2[0].bridge.length >= 2 && r2[0].bridge.length <= 4, `sawmill to town crosses the river on a bridge (${r2[0]?.bridge.length} bridge cells, cost ${r2[0]?.cost})`);
  const cash = s.cash;
  build(s, r2[0]);
  check(s.cash === cash - r2[0].cost, 'the build is paid');
  check(undo(s), 'the build can be taken back inside its second');
  check(s.cash === cash && s.lines.length === 1 && s.stations.length === 2, 'undo refunds the cash and removes the track, the station and the line');
  build(s, plan(s, cell(s, 'sawmill'), cell(s, 'town'))[0]);
  const t = buyTrain(s, line!.id, 'flat');
  check(!!t && s.trains.length === 1, 'a train is bought');
  check(!undo(s), 'a bought train closes the undo');
}

// the choices on the harju map
{
  const s = createState(HARJU);
  build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0]);
  const lake = plan(s, cell(s, 'sawmill'), cell(s, 'tampere'));
  check(lake.length === 2 && lake[0].mode === 'cheap' && lake[1].mode === 'short' && lake[1].bridge.length >= 4 && lake[1].cost > lake[0].cost && lake[1].length < lake[0].length - 2, `the lake offers the cheap way round and the dear bridge (${lake.map((o) => `${o.mode} ${o.cost} for ${o.length.toFixed(0)} cells`).join(', ')})`);
  build(s, plan(s, cell(s, 'sawmill'), cell(s, 'farm'))[0]);
  const ridge = plan(s, cell(s, 'farm'), cell(s, 'mill'));
  check(ridge.length === 2 && ridge[1].cutting.length >= 1 && ridge[1].cost > ridge[0].cost && ridge[1].length < ridge[0].length, `the ridge offers the way round and the cutting (${ridge.map((o) => `${o.mode} ${o.cost} for ${o.length.toFixed(0)} cells`).join(', ')})`);
  // the engines over the cutting, both with a full load of grain: the strong one is faster
  const line = build(s, ridge[1])!;
  const trip = (engine: 'hilma' | 'jyry') => {
    const s2 = createState(HARJU);
    s2.cash = 9999;
    build(s2, plan(s2, cell(s2, 'forest'), cell(s2, 'sawmill'))[0]);
    build(s2, plan(s2, cell(s2, 'sawmill'), cell(s2, 'farm'))[0]);
    const l = build(s2, plan(s2, cell(s2, 'farm'), cell(s2, 'mill'))[1])!;
    const t = buyTrain(s2, l.id, 'hopper', engine)!;
    siteById(s2, 'farm').stock = 6;
    let t0 = -1;
    for (let k = 0; k < 60 * 120; k++) {
      step(s2);
      if (t0 < 0 && t.state === 'run') t0 = s2.time;
      if (t0 >= 0 && t.state === 'stop' && t.at === l.path[l.path.length - 1]) return { time: s2.time - t0, cargo: siteById(s2, 'mill').delivered };
    }
    return { time: Infinity, cargo: 0 };
  };
  const h = trip('hilma');
  const j = trip('jyry');
  check(h.cargo === 2 && j.cargo === 2 && j.time < h.time * 0.8, `Jyry pulls a full load over the cutting faster than Hilma (${j.time.toFixed(1)} s against ${h.time.toFixed(1)} s)`);
  void line;
  // demand falls with deliveries and recovers over months
  const p0 = price(s, 'boards', 'hameenlinna', 10);
  siteById(s, 'hameenlinna').taken.boards = 10;
  const p1 = price(s, 'boards', 'hameenlinna', 10);
  check(p1 <= p0 * 0.45, `a filled town pays the floor (${p0} -> ${p1})`);
  s.cash = 9999;
  build(s, plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'))[0]);
  for (let k = 0; k < 60 * YEAR_SECONDS * 0.6; k++) step(s);
  const p2 = price(s, 'boards', 'hameenlinna', 10);
  check(p2 === p0, `the price recovers within a few months (${p1} -> ${p2})`);
  // a train set to wait for a full load waits
  const l2 = s.lines.find((l) => l.path[0] === cell(s, 'forest'))!;
  siteById(s, 'forest').stock = 1;
  siteById(s, 'forest').rate = 0;
  const w = buyTrain(s, l2.id, 'flat')!;
  setFullLoad(s, w.id, true);
  // inside the month, so the forest cuts nothing more
  for (let k = 0; k < 60 * 6; k++) step(s);
  check(w.state === 'stop' && w.cargo === 1 && w.at === l2.path[0], `a train set to wait for a full load waits at the forest (${w.cargo} of ${w.nWagons} loaded, ${w.state})`);
  siteById(s, 'forest').stock = 4;
  for (let k = 0; k < 60 * 1.5; k++) step(s);
  check(w.state === 'run' && w.cargo === w.nWagons, `and leaves when the load is full (${w.cargo} loaded, ${w.state})`);
}

// the bot wins both scenarios
function play(sc: typeof SAWMILL) {
  const s = createState(sc);
  const bot = Bot.for(s);
  let overlap = 0;
  let maxTrains = 0;
  const limit = (sc.goal.beforeYear - sc.startYear) * YEAR_SECONDS + 10;
  for (let t = 0; t < limit && !s.result; t += DT) {
    bot.act(s);
    step(s);
    maxTrains = Math.max(maxTrains, s.trains.length);
    const running = s.trains.filter((o) => o.state === 'run');
    for (let i = 0; i < running.length; i++)
      for (let j = i + 1; j < running.length; j++) {
        const a = lineOf(s, running[i]);
        const b = lineOf(s, running[j]);
        if (a === b || [...a.block].some((c) => b.block.has(c))) overlap++;
      }
  }
  for (const l of bot.log) console.log(`  ${l}`);
  const r = s.result;
  check(!!r && r.won, `the bot wins ${sc.id} (${r ? `${r.won ? 'won' : 'lost'} in ${r.year}, cash ${r.cash}, ${r.stars} stars` : 'not over'})`);
  check(s.firstPayAt !== null && s.firstPayAt < 90, `${sc.id}: the first paid delivery lands inside 90 s (${s.firstPayAt?.toFixed(0)} s)`);
  check(overlap === 0, `${sc.id}: trains never run the same block at once (${overlap} frames)`);
  check(maxTrains === sc.trainsMax, `${sc.id}: the bot runs every train allowed (${maxTrains} of ${sc.trainsMax})`);
  check(!!r && r.year <= sc.goal.beforeYear - 1, `${sc.id}: the goal falls with a year to spare (${r?.year})`);
  check(!!r && r.stars >= 2, `${sc.id}: the bot's cash earns two stars or more (${r?.cash}, ${r?.stars} stars)`);
  for (const t of s.trains) {
    const p = along(lineOf(s, t), t.s, s.w);
    check(p.x >= 0 && p.x <= s.w && p.y >= 0 && p.y <= s.h, `${sc.id}: train ${t.id} is on the map (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), length ${trainLength(t).toFixed(1)}`);
  }
  return s;
}
play(SAWMILL);
const h = play(HARJU);
check(h.sites.filter((x) => x.kind === 'town').every((x) => x.size >= 3), `harju: both towns reached size 3 (${h.sites.filter((x) => x.kind === 'town').map((x) => `${x.id} ${x.size}`).join(', ')})`);

console.log(failed ? 'sim-check failed' : 'sim-check ok');
if (failed) throw new Error('sim-check failed');
