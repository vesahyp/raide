/**
 * npm run sim-check: the rules asserted headless. The bot plays both scenarios and must win
 * them; the first paid delivery lands inside 90 s; the routes offer a real choice at the river
 * and the ridge; the strong engine beats the light one over the cutting with a load; a town
 * grows only when both goods reach it; demand falls and recovers; trains never share a block;
 * undo gives the cash back.
 */
import { createState, siteById } from '../src/game/state';
import { SAWMILL, HARJU } from '../src/game/content/scenarios';
import { step, closeYearEnd, plan, routeTrips, build, undo, buyTrain, DT, lineOf, along, trainLength, price, setFullLoad, buyers, moveTrain, lineTrips, tripTimes, buyCrew, dwellAt } from '../src/game/sim';
import { idx, route, APPROACH } from '../src/game/grid';
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
  const river = plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'));
  check(river.length === 2 && river[0].bridge.length >= 2 && river[1].cutting.length >= 1, `sawmill to Hämeenlinna crosses the river on a bridge, and the short way cuts the hill (${river.map((o) => `${o.mode} ${o.cost} for ${o.length.toFixed(0)} tiles, bridge ${o.bridge.length}, cut ${o.cutting.length}`).join(', ')})`);
  build(s, river[0]);
  const ridge = plan(s, cell(s, 'hameenlinna'), cell(s, 'farm'));
  check(ridge.length === 2 && ridge[0].mode === 'cheap' && ridge[1].mode === 'short' && ridge[1].cutting.length >= 1 && ridge[1].cost > ridge[0].cost && ridge[1].length < ridge[0].length - 5, `the ridge offers the way round through the saddle and the cutting (${ridge.map((o) => `${o.mode} ${o.cost} for ${o.length.toFixed(0)} tiles, worst ${o.worst.toFixed(1)} %, cut ${o.cutting.length}, fill ${o.fill.length}`).join(', ')})`);
  check(ridge[1].worst > 3 && ridge[1].worst <= 5.01 && ridge[0].worst < ridge[1].worst, `the cutting is a real climb inside the grade limit and the way round is flatter (${ridge[1].worst.toFixed(1)} % against ${ridge[0].worst.toFixed(1)} %)`);
  check(!ridge[0].cells.some((c) => s.yardMask[c] === 1) && !ridge[1].cells.some((c) => s.yardMask[c] === 1), 'no route crosses a yard');
  const over = ridge.find((o) => o.mode === 'short')!;
  const tj = routeTrips(s, over, 'jyry');
  const th = routeTrips(s, over, 'hilma');
  check(tj > th, `over the ridge Jyry makes more trips a year than Little Hilma (${tj.toFixed(1)} against ${th.toFixed(1)})`);
  // A* on 12000 cells: the second search, once the code is warm, takes under 15 ms
  route(s, cell(s, 'hameenlinna'), cell(s, 'farm'));
  const t0 = performance.now();
  route(s, cell(s, 'hameenlinna'), cell(s, 'farm'), 'cheap');
  const ms = performance.now() - t0;
  check(s.w * s.h === 12000 && ms < 15, `route() from Hämeenlinna to Peltola on ${s.w * s.h} cells takes ${ms.toFixed(1)} ms`);
  // the engines over the cutting, both with a full load of grain: the strong one is faster
  const trip = (engine: 'hilma' | 'jyry') => {
    const s2 = createState(HARJU);
    s2.cash = 9999;
    build(s2, plan(s2, cell(s2, 'forest'), cell(s2, 'sawmill'))[0]);
    build(s2, plan(s2, cell(s2, 'sawmill'), cell(s2, 'hameenlinna'))[0]);
    const l = build(s2, plan(s2, cell(s2, 'hameenlinna'), cell(s2, 'farm')).find((o) => o.mode === 'short')!)!;
    const t = buyTrain(s2, l.id, 'hopper', engine)!;
    siteById(s2, 'farm').stock = 6;
    // there and back: the climb is on one side going out and on the other coming home
    let t0 = -1;
    let there = false;
    let cargo = 0;
    for (let k = 0; k < 60 * 240; k++) {
      step(s2);
      cargo = Math.max(cargo, t.cargo);
      if (t0 < 0 && t.state === 'run') t0 = s2.time;
      if (t0 >= 0 && t.state === 'stop' && t.at === l.path[l.path.length - 1]) there = true;
      if (there && t.state === 'stop' && t.at === l.path[0]) return { time: s2.time - t0, cargo };
    }
    return { time: Infinity, cargo: 0 };
  };
  const h = trip('hilma');
  const j = trip('jyry');
  check(h.cargo === 2 && j.cargo === 2 && j.time < h.time * 0.8, `Jyry takes a full load over the cutting and comes back faster than Hilma (${j.time.toFixed(1)} s against ${h.time.toFixed(1)} s)`);
  // demand falls with deliveries and recovers over months
  const p0 = price(s, 'boards', 'hameenlinna', 10);
  siteById(s, 'hameenlinna').taken.boards = 10;
  const p1 = price(s, 'boards', 'hameenlinna', 10);
  check(p1 <= p0 * 0.45, `a filled town pays the floor (${p0} -> ${p1})`);
  s.cash = 9999;
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

// on the flat line the light engine is faster
{
  const s = createState(HARJU);
  const flat = plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0];
  const th = routeTrips(s, flat, 'hilma');
  const tj = routeTrips(s, flat, 'jyry');
  check(th > tj, `on the flat Kuusikko to Koskensaha line Hilma makes more trips a year than Jyry (${th.toFixed(1)} against ${tj.toFixed(1)})`);
}

// a station reads like a station: every line runs its last cells straight along the station's
// row, and no route comes in through the yard side
{
  const s = createState(HARJU);
  s.cash = 9999;
  for (const [a, b] of [['forest', 'sawmill'], ['sawmill', 'hameenlinna'], ['sawmill', 'tampere'], ['tampere', 'mill'], ['mill', 'hameenlinna']] as const) {
    const o = plan(s, cell(s, a), cell(s, b));
    for (const r of o) build(s, r);
  }
  const straight = (l: { path: number[] }) => {
    const row = (c: number) => Math.floor(c / s.w);
    const ends = [l.path.slice(0, APPROACH + 1), l.path.slice(-APPROACH - 1)];
    return ends.every((e) => e.every((c) => row(c) === row(e[0])) && e.every((c, k) => k === 0 || Math.abs(c - e[k - 1]) === 1));
  };
  check(s.lines.length >= 5 && s.lines.every(straight), `every line runs its first and last ${APPROACH} cells straight along the station's row (${s.lines.length} lines)`);
  check(s.lines.every((l) => !l.path.some((c) => s.yardMask[c] === 1)), 'no line crosses a yard or the cells beside its platform');
}

// wagons fill one at a time, a load every LOAD_SECONDS, and the pile shrinks with them
{
  const s = createState(HARJU);
  s.cash = 9999;
  const line = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  const forest = siteById(s, 'forest');
  forest.stock = 6;
  forest.rate = 0;
  const t = buyTrain(s, line.id, 'flat', 'hilma', 4)!;
  const seen: { cargo: number; stock: number; time: number }[] = [];
  for (let k = 0; k < 60 * 4; k++) {
    step(s);
    const last = seen[seen.length - 1];
    if (!last || last.cargo !== t.cargo) seen.push({ cargo: t.cargo, stock: forest.stock, time: s.time });
  }
  const gaps = seen.slice(1).map((x, i) => x.time - seen[i].time);
  check(seen.map((x) => x.cargo).slice(0, 5).join() === '0,1,2,3,4' && gaps.slice(0, 4).every((g) => g >= 0.5), `four wagons fill one after another (${seen.map((x) => `${x.cargo}@${x.time.toFixed(1)}`).join(' ')})`);
  check(seen[4].stock === seen[0].stock - 4, `the yard pile shrinks by a load for each wagon filled (${seen[0].stock} to ${seen[4].stock})`);
}

// the loading crew shortens every wagon's dwell at its station by a third, once, for its price
{
  const s = createState(HARJU);
  const forest = s.stations[0];
  const before = dwellAt(s, forest.cell);
  const cash = s.cash;
  check(buyCrew(s, forest.id) && s.cash === cash - 30, 'the loading crew costs 30');
  check(Math.abs(dwellAt(s, forest.cell) - before * (2 / 3)) < 1e-9 && !buyCrew(s, forest.id), `the crew takes a third off the dwell (${before.toFixed(2)} s to ${dwellAt(s, forest.cell).toFixed(2)} s) and is bought once`);
}

// a train moved to another line serves it within a year
{
  const s = createState(HARJU);
  s.cash = 9999;
  const a = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  const b = build(s, plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'))[0])!;
  const t = buyTrain(s, a.id, 'box')!;
  check(!moveTrain(s, t.id, b.id), 'a train standing at a station the other line does not serve cannot be moved');
  for (let k = 0; k < 60 * 60 && !(t.state === 'stop' && t.at === cell(s, 'sawmill')); k++) step(s);
  check(t.state === 'stop' && t.at === cell(s, 'sawmill'), 'the train reaches Koskensaha');
  check(moveTrain(s, t.id, b.id) && t.lineId === b.id, 'at Koskensaha it can be moved to the line to Hämeenlinna');
  const t0 = s.time;
  let served = false;
  for (let k = 0; k < 60 * YEAR_SECONDS && !served; k++) {
    step(s);
    served = t.state === 'stop' && t.at === cell(s, 'hameenlinna');
  }
  check(served, `the moved train reaches Hämeenlinna within a year (${(s.time - t0).toFixed(0)} s)`);
  const tt = tripTimes(s, b, 'hilma', 4);
  check(tt.full[0] >= tt.empty[0] && tt.full[1] >= tt.empty[1] && lineTrips(s, b, 'jyry', 2) > 0, `a full train is no faster than an empty one (${tt.full[0].toFixed(1)} against ${tt.empty[0].toFixed(1)} s)`);
}

// the first choice on Harju is a real one: from the start, either forest's line to Koskensaha with
// one train pays for itself inside two years
{
  const back: string[] = [];
  const results = (['forest', 'korpela'] as const).map((from) => {
    const s = createState(HARJU);
    const start = s.cash;
    const r = plan(s, cell(s, from), cell(s, 'sawmill'))[0];
    const line = build(s, r)!;
    buyTrain(s, line.id, 'flat');
    for (let k = 0; k < 2 * YEAR_SECONDS * 60 + 120; k++) {
      step(s);
      if (s.yearEnd) closeYearEnd(s, 'wagon');
    }
    back.push(`${from} cost ${r.cost}, cash ${Math.round(s.cash)} of ${start}`);
    return s.cash >= start;
  });
  check(results.every(Boolean), `from the start two different first lines both pay back within two years (${back.join('; ')})`);
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
{
  const s0 = createState(HARJU);
  const saw = siteById(s0, 'sawmill');
  const b = buyers(s0, saw);
  check(b.length === 3 && b.every((x) => x.site.kind === 'town' && x.price > 0 && x.km > 0 && !x.linked), `on Harju the sawmill's buyers are the three towns and all pay (${b.map((x) => `${x.site.id} ${x.price} at ${x.km} km`).join(', ')})`);
  check(b[0].price >= b[1].price, 'buyers come highest price first');
  check(buyers(s0, siteById(s0, 'hameenlinna')).length === 0, 'a town has no buyers');
}
play(SAWMILL);
const h = play(HARJU);
check(h.sites.filter((x) => x.kind === 'town' && x.size >= 3).length >= 2, `harju: two towns reached size 3 (${h.sites.filter((x) => x.kind === 'town').map((x) => `${x.id} ${x.size}`).join(', ')})`);

console.log(failed ? 'sim-check failed' : 'sim-check ok');
if (failed) throw new Error('sim-check failed');
