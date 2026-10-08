/**
 * npm run sim-check: the rules asserted headless. The bot plays both scenarios and must win
 * them; the first paid delivery lands inside 90 s; the routes offer a real choice at the river
 * and the ridge; the strong engine beats the light one over the cutting with a load; a town
 * grows only when both goods reach it; demand falls and recovers; trains never share a block;
 * undo gives the cash back.
 */
import { createState, siteById } from '../src/game/state';
import { SAWMILL, HARJU } from '../src/game/content/scenarios';
import { step, closeYearEnd, bodyCells, plan, routeTrips, build, undo, buyTrain, DT, lineOf, along, trainLength, drawnLength, price, setFullLoad, buyers, moveTrain, lineTrips, tripTimes, buyCrew, dwellAt, borrow, repay, loanCeiling, netWorth, liftLine, lineYear, trainSpot, buyPlatform, platformPrice, runPerTile } from '../src/game/sim';
import { idx, route, APPROACH } from '../src/game/grid';
import { Bot, type YearRecord } from './bot';
import { YEAR_SECONDS, CREW_PRICE, LOAN_RATE, LIFT_BACK, QUEUE_GAP } from '../src/game/content/economy';
import { GOODS } from '../src/game/types';
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
  check(r1[0].cost <= 80, `the first line is affordable (${r1[0]?.cost} of ${SAWMILL.cash}), and the train on top needs the loan`);
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
  s.cash = 9999;
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
  siteById(s, 'hameenlinna').taken.boards = 4;
  const p1 = price(s, 'boards', 'hameenlinna', 10);
  check(p1 <= p0 * 0.45, `a filled town pays the floor (${p0} -> ${p1})`);
  s.cash = 9999;
  for (let k = 0; k < 60 * YEAR_SECONDS * 0.9; k++) step(s);
  const p2 = price(s, 'boards', 'hameenlinna', 10);
  check(p2 === p0, `the price recovers within the year (${p1} -> ${p2})`);
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
  check(buyCrew(s, forest.id) && s.cash === cash - CREW_PRICE, `the loading crew costs ${CREW_PRICE}`);
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

// money: running costs per tile, track upkeep, the loan, lifting a line, bankruptcy
{
  const s = createState(HARJU);
  s.cash = 5000;
  const line = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  const price0 = s.assets;
  check(Math.abs(netWorth(s) - (s.cash + price0 * LIFT_BACK)) < 1e-6, `net worth counts track and stations at half their build price (${netWorth(s).toFixed(0)})`);
  const t = buyTrain(s, line.id, 'flat')!;
  check(Math.abs(netWorth(s) - (5000 - price0 + price0 * LIFT_BACK - 140 + 70)) < 1.5, 'and a train at half its price');
  // a train pays for every tile it runs, full or empty, while it runs
  const c0 = s.cash;
  const o0 = t.odometer;
  siteById(s, 'forest').stock = 0;
  siteById(s, 'forest').rate = 0;
  for (let k = 0; k < 60 * 8; k++) step(s);
  const tiles = t.odometer - o0;
  check(tiles > 5 && s.running > 0 && Math.abs(s.running - tiles * runPerTile('hilma', 2)) < 0.01, `a train runs ${tiles.toFixed(0)} tiles empty and pays ${s.running.toFixed(1)} for them as it goes`);
  check(s.cash < c0, 'the cash ticks down while the train moves');
  // track upkeep and engine upkeep are charged monthly
  const before = s.cash;
  const trackBefore = s.trackUp;
  const month = s.month;
  while (s.month === month) step(s);
  check(s.trackUp > trackBefore && s.cash < before, `track upkeep is charged by the month (${s.trackUp.toFixed(1)} so far)`);
  // the loan
  s.cash = 100;
  const ceil = loanCeiling(s);
  check(borrow(s, 100) && s.loan === 100 && s.cash === 200, `a loan of 100 is taken (the ceiling is ${ceil})`);
  check(!borrow(s, 100000), 'a loan past the ceiling is refused');
  check(repay(s, 60) && s.loan === 40 && s.cash === 140, 'a part of it is paid back');
  check(!repay(s, 10) || s.loan === 30, 'and the rest later');
  // interest at the year end
  const s2 = createState(HARJU);
  s2.cash = 1000;
  borrow(s2, 100);
  const cash2 = s2.cash;
  for (let k = 0; k < 60 * YEAR_SECONDS + 2; k++) step(s2);
  check(!!s2.yearEnd && s2.yearEnd.interest === Math.round(100 * LOAN_RATE) && s2.yearEnd.loan === 100, `the year end charges 8 % of the loan (${s2.yearEnd?.interest})`);
  check(s2.yearEnd!.profit === -s2.yearEnd!.running - s2.yearEnd!.engine - s2.yearEnd!.track - s2.yearEnd!.interest && s2.cash <= cash2, 'and the ledger splits running, engine upkeep, track upkeep and interest');
  // lifting a line
  const s3 = createState(HARJU);
  s3.cash = 5000;
  const a = build(s3, plan(s3, cell(s3, 'forest'), cell(s3, 'sawmill'))[0])!;
  const b = build(s3, plan(s3, cell(s3, 'sawmill'), cell(s3, 'tampere'))[0])!;
  const tr = buyTrain(s3, a.id, 'flat')!;
  check(!liftLine(s3, a.id), 'a line with a train cannot be lifted');
  s3.trains = s3.trains.filter((o) => o !== tr);
  const cashB = s3.cash;
  const assetsB = s3.assets;
  const trackCells = s3.track.reduce((n, v) => n + (v ? 1 : 0), 0);
  const sharedCells = [...a.path].filter((c) => b.path.includes(c)).length;
  check(liftLine(s3, a.id) && !s3.lines.includes(a) && s3.lines.includes(b), 'a line with no trains is lifted');
  check(s3.cash > cashB && s3.cash - cashB <= assetsB * LIFT_BACK, `and half the build price of its tiles comes back (${(s3.cash - cashB).toFixed(1)})`);
  check(s3.track.reduce((n, v) => n + (v ? 1 : 0), 0) < trackCells && sharedCells >= 0 && b.path.every((c, k) => k === 0 || (s3.track[c] !== 0 && s3.track[b.path[k - 1]] !== 0)), `track that another line runs on stays (${sharedCells} cells shared)`);
  // bankruptcy: cash below zero at two year ends in a row with the loan at its ceiling
  const s4 = createState(HARJU);
  s4.cash = 0;
  s4.loan = loanCeiling(s4);
  s4.cash = -50;
  for (let n = 0; n < 2; n++) {
    for (let k = 0; k < 60 * YEAR_SECONDS + 2 && !s4.yearEnd; k++) step(s4);
    const cashAt = s4.yearEnd!.cash;
    closeYearEnd(s4, 'wagon');
    if (n === 0) check(!s4.result && cashAt < 0, 'one year end below zero with the loan full is a warning');
  }
  check(!!s4.result && !s4.result.won && s4.result.reason === 'bankrupt', 'the second one in a row ends the scenario');
  // cash below zero only through running costs: a build or a buy needs the cash
  const s5 = createState(SAWMILL);
  s5.cash = 10;
  check(build(s5, plan(s5, cell(s5, 'forest'), cell(s5, 'sawmill'))[0]) === null, 'a build needs the cash');
}

// stations: one platform, a second train waits on its line, never on a taken platform
{
  const s = createState(HARJU);
  s.cash = 9999;
  const lf = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  const lh = build(s, plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'))[0])!;
  check(s.stations.every((st) => st.platforms === 1), 'a station starts with one platform');
  const forestTrain = buyTrain(s, lf.id, 'flat')!;
  const boxTrain = buyTrain(s, lh.id, 'box')!;
  check(boxTrain.state === 'stop' && boxTrain.at === cell(s, 'sawmill') && !boxTrain.parked, 'the box train stands on the sawmill platform');
  // it keeps the platform: the forest train must wait on its own line
  boxTrain.stopLeft = 1e9;
  boxTrain.fullLoad = true;
  siteById(s, 'sawmill').stock = 0;
  let queuedAt = -1;
  let ok = true;
  for (let k = 0; k < 60 * 90 && queuedAt < 0; k++) {
    step(s);
    if (forestTrain.queued) queuedAt = k;
  }
  check(queuedAt >= 0, 'a train that finds the platform taken stops on its line before the station');
  for (let k = 0; k < 60 * 3; k++) {
    step(s);
    const end = lf.dist[lf.dist.length - 1];
    const front = (forestTrain.dir === 1 ? end - forestTrain.s : forestTrain.s) - drawnLength(forestTrain) / 2;
    if (!(front >= drawnLength(boxTrain) / 2 + QUEUE_GAP - 0.01) || forestTrain.at !== null) ok = false;
  }
  check(ok && forestTrain.state === 'run' && forestTrain.speed === 0, 'it stands clear of the train on the platform, fully on its track');
  // the platform frees: the waiting train takes it
  boxTrain.fullLoad = false;
  boxTrain.stopLeft = 0;
  let took = false;
  for (let k = 0; k < 60 * 30 && !took; k++) {
    step(s);
    took = forestTrain.state === 'stop' && forestTrain.at === cell(s, 'sawmill');
  }
  check(took && forestTrain.slot === 0 && !forestTrain.queued, 'and it takes the platform when the other has gone');
  // a second train for a line the platforms cannot carry is parked beside the station and adds nothing
  const second = buyTrain(s, lf.id, 'flat')!;
  check(second.parked && second.slot >= 1, 'a second train on a one-platform line is parked on a siding');
  const one = lineYear(s, lf);
  const two = lineYear(s, lf, { engine: 'hilma', wagons: 2 });
  check(one.trips > 2 && Math.abs(two.trips - one.trips) < 1e-9, `the buy card shows it: a train more adds ${(two.trips - one.trips).toFixed(1)} trips (${one.trips.toFixed(1)} a year now)`);
  check(trainSpot(s, lf, 2) !== null, 'and there is still a siding for one more');
  // platforms are bought, and with a platform at each end the parked train runs and the line carries two
  const stF = s.stations.find((x) => x.cell === cell(s, 'forest'))!;
  const stS = s.stations.find((x) => x.cell === cell(s, 'sawmill'))!;
  const c0 = s.cash;
  check(platformPrice(s, stS.id) === 80 && buyPlatform(s, stS.id) && stS.platforms === 2 && s.cash === c0 - 80, 'the second platform costs 80');
  check(two.at === stF.cell || two.at === stS.cell, 'the buy card names the station that holds the line back');
  check(buyPlatform(s, stF.id) && platformPrice(s, stF.id) === 160, 'the third costs 160');
  for (let k = 0; k < 60 * 20 && second.parked; k++) step(s);
  check(!second.parked, 'with two platforms at each end the parked train goes into service');
  check(lineYear(s, lf).trips > one.trips, `and the line makes more trips (${one.trips.toFixed(1)} to ${lineYear(s, lf).trips.toFixed(1)})`);
}

// the bot wins both scenarios
const years: Record<string, YearRecord[]> = {};
const maxLoan: Record<string, number> = {};
/** the whole game of one bot: the state it ends in, with the checks that run every frame */
function play(sc: typeof SAWMILL, greedy = false, upToYear = Infinity) {
  const s = createState(sc);
  const bot = Bot.for(s, greedy);
  let overlap = 0;
  let shared = 0;
  let apart = 0;
  const limit = (Math.min(sc.goal.beforeYear, upToYear + 1) - sc.startYear) * YEAR_SECONDS + 10;
  for (let t = 0; t < limit && !s.result; t += DT) {
    bot.act(s);
    step(s);
    // two trains never cover the same track cell, except at a station where they stand on their own platform tracks
    const bodies = s.trains.map((o) => ({ o, cells: bodyCells(s, o, 0) }));
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.o.state === 'stop' && b.o.state === 'stop') continue;
        // within a station's throat the platform and siding tracks run side by side, so trains on different ones may share a cell
        const dist = (x: number, y: number) => Math.hypot((x % s.w) - (y % s.w), Math.floor(x / s.w) - Math.floor(y / s.w));
        const trackAt = (o: (typeof s.trains)[number], c: number) => {
          if (o.state === 'stop') return o.slot;
          const l = lineOf(s, o);
          const nearFirst = dist(c, l.path[0]) <= dist(c, l.path[l.path.length - 1]);
          return nearFirst === (o.dir === -1) ? o.slot : o.slotFrom;
        };
        const throat = (c: number) => trackAt(a.o, c) !== trackAt(b.o, c) && s.stations.some((st) => dist(st.cell, c) <= 8);
        for (const c of a.cells) if (b.cells.has(c) && !s.stations.some((st) => st.cell === c) && !throat(c)) {
          overlap++;
          if (overlap === 1) console.log(`  overlap at t=${s.time.toFixed(1)} cell ${c}: train ${a.o.id} ${a.o.state}${a.o.queued ? ' queued' : ''} s=${a.o.s.toFixed(1)} dir ${a.o.dir} line ${a.o.lineId} slot ${a.o.slot} at ${a.o.at}; train ${b.o.id} ${b.o.state}${b.o.queued ? ' queued' : ''} s=${b.o.s.toFixed(1)} dir ${b.o.dir} line ${b.o.lineId} slot ${b.o.slot} at ${b.o.at}`);
        }
      }
    // and the old rule: one running train at a time on a block
    const running = s.trains.filter((o) => o.state === 'run' && !o.queued);
    for (let i = 0; i < running.length; i++)
      for (let j = i + 1; j < running.length; j++) {
        const a = lineOf(s, running[i]);
        const b = lineOf(s, running[j]);
        if (a === b) overlap++;
      }
    // no two trains stand on one platform track of a station
    const seen = new Set<string>();
    for (const o of s.trains)
      if (o.state === 'stop' && o.at !== null) {
        const key = `${o.at}:${o.slot}`;
        if (seen.has(key)) shared++;
        seen.add(key);
      }
    // a waiting train stands clear of the station's centre by the longest train it could be waiting for
    for (const o of s.trains) {
      if (!o.queued) continue;
      const line = lineOf(s, o);
      const end = line.dist[line.dist.length - 1];
      const front = (o.dir === 1 ? end - o.s : o.s) - drawnLength(o) / 2;
      if (front < QUEUE_GAP) apart++;
    }
  }
  if (!greedy) for (const l of bot.log.filter((x) => !x.includes('borrow'))) console.log(`  ${l}`);
  years[`${sc.id}${greedy ? '-greedy' : ''}`] = bot.years;
  maxLoan[`${sc.id}${greedy ? '-greedy' : ''}`] = bot.maxLoan;
  const r = s.result;
  if (greedy) return s;
  check(!!r && r.won, `the bot wins ${sc.id} (${r ? `${r.won ? 'won' : r.reason} in ${r.year}, cash ${r.cash}, net worth ${r.worth}, ${r.stars} stars` : 'not over'})`);
  check(s.firstPayAt !== null && s.firstPayAt < 90, `${sc.id}: the first paid delivery lands inside 90 s (${s.firstPayAt?.toFixed(0)} s)`);
  check(overlap === 0, `${sc.id}: no two trains are ever on the same track cell (${overlap} frames)`);
  check(shared === 0, `${sc.id}: no two standing trains share a platform track (${shared} frames)`);
  check(apart === 0, `${sc.id}: a waiting train never stands over the station (${apart} frames)`);
  check(bot.done >= 6, `${sc.id}: the bot made ${bot.done} of the ${bot.plan.steps.length} buys of its plan`);
  const lateWin: Record<string, [number, number]> = { sawmill: [1864, 1865], harju: [1869, 1871] };
  check(!!r && r.year >= lateWin[sc.id][0] && r.year <= lateWin[sc.id][1], `${sc.id}: the goal falls late, in ${lateWin[sc.id][0]} to ${lateWin[sc.id][1]} (${r?.year})`);
  check(!!r && r.stars >= 2, `${sc.id}: the bot's net worth earns two stars or more (${r?.worth}, ${r?.stars} stars)`);
  for (const t of s.trains) {
    const p = along(lineOf(s, t), t.s, s.w);
    check(p.x >= 0 && p.x <= s.w && p.y >= 0 && p.y <= s.h, `${sc.id}: train ${t.id} is on the map (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), length ${trainLength(t).toFixed(1)}`);
  }
  // the money checks, from the bot's year ends
  const ys = bot.years;
  const lastYear = sc.goal.kind === 'deliver' ? r!.year : r!.year - 1;
  const early = ys.filter((y) => y.year <= lastYear - 2);
  check(early.length > 0 && early.every((y) => y.next > 0 && y.cash <= 1.5 * y.next), `${sc.id}: before the last two years the cash is never more than the next buy plus half (${early.map((y) => `${y.year}: ${y.cash} of ${y.next}`).join(', ')})`);
  const share = (y: YearRecord) => (100 * y.upkeep) / Math.max(1, GOODS.reduce((a, g) => a + y.income[g], 0));
  const whole = (100 * ys.reduce((a, y) => a + y.upkeep, 0)) / Math.max(1, ys.reduce((a, y) => a + GOODS.reduce((b, g) => b + y.income[g], 0), 0));
  check(whole >= 33 && whole <= 46, `${sc.id}: running costs are ${whole.toFixed(0)} % of gross over the game, and ${ys.map((y) => `${y.year} ${share(y).toFixed(0)}`).join(', ')} year by year`);
  check(ys.every((y) => share(y) >= 25 && share(y) <= 60), `${sc.id}: no year's running costs stray outside 25 to 60 % of gross`);
  check(bot.maxLoan > 0, `${sc.id}: the bot borrows when a buy needs it (most owed ${bot.maxLoan}, ceiling at the start ${loanCeiling(createState(sc))})`);
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
// a greedy plan, every coin into trains on the first line, ends 1868 with less net worth than the planned network
{
  play(HARJU, true, 1868);
  const planned = years.harju.find((y) => y.year === 1868);
  const greedy = years['harju-greedy'].find((y) => y.year === 1868);
  check(!!planned && !!greedy && greedy.worth < planned.worth, `the greedy bot ends 1868 with less net worth than the planned one (${greedy?.worth} against ${planned?.worth})`);
}

console.log(failed ? 'sim-check failed' : 'sim-check ok');
if (failed) throw new Error('sim-check failed');
