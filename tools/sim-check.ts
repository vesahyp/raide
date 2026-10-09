/**
 * npm run sim-check: the rules asserted headless. The bot plays both scenarios and must win
 * them; the first paid delivery lands inside 90 s; the routes offer a real choice at the river
 * and the ridge; the strong engine beats the light one over the cutting with a load; a town
 * grows only when both goods reach it; demand falls and recovers; trains never share a block;
 * undo gives the cash back.
 */
import { createState, siteById, stationAt } from '../src/game/state';
import { SAWMILL, HARJU } from '../src/game/content/scenarios';
import { waitingTotal, farePay, wantsPeople, stopCell, stopS, extendable, freeSide, canExtend, defaultConsist, carryingTypes, wagonWaste, wagonRoutes, wasteWagons, removeWagon, addWagon, lineCapacity, WAGON_BACK, step, closeYearEnd, bodyCells, mainPieces, plan, routeTrips, build, undo, buyTrain, DT, lineOf, along, trainLength, drawnLength, price, storeCap, siteDemand, setFullLoad, buyers, moveTrain, lineTrips, tripTimes, buyCrew, dwellAt, borrow, repay, loanCeiling, netWorth, liftLine, lineYear, setStop, consistCycle, trainSpot, buyPlatform, platformPrice, runPerTile, buySiding, buyCrane, sidingSpans, makeOffer, endGood, distanceFactor, eatsPerMonth } from '../src/game/sim';
import { idx, route, APPROACH, turnsBack } from '../src/game/grid';
import { Bot, type Step, type YearRecord } from './bot';
import { ENGINE_LEN, WAGON_LEN, YEAR_SECONDS, CREW_PRICE, CRANE_PRICE, CRANE_CUT, CREW_CUT, SIDING_PRICE, SIDING_LEN, SIDING_FROM_STATION, CONTRACT_MAX, MAKES, TAKES, LOAN_RATE, LIFT_BACK, QUEUE_GAP, DEMAND_FLOOR, GROW_MONTHS, PAX_RATE, MAIL_RATE, PAX_CAP, MAIL_CAP, FARE_SPEED, BASE_FARE, PAX_DECAY, FARE_FLOOR } from '../src/game/content/economy';
import { advice, goalTowns, lengthenOptions } from '../src/game/advice';
import { CARGOS } from '../src/game/types';
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
  // A* on 12000 cells, once the code is warm: the fastest of five searches takes under 15 ms,
  // so a busy machine slowing one run does not fail the check
  route(s, cell(s, 'hameenlinna'), cell(s, 'farm'));
  let ms = Infinity;
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    route(s, cell(s, 'hameenlinna'), cell(s, 'farm'), 'cheap');
    ms = Math.min(ms, performance.now() - t0);
  }
  check(s.w * s.h === 12000 && ms < 15, `route() from Hämeenlinna to Peltola on ${s.w * s.h} cells takes ${ms.toFixed(1)} ms`);
  // the engines over the cutting, both with a full load of grain: the strong one is faster
  const trip = (engine: 'hilma' | 'jyry') => {
    const s2 = createState(HARJU);
    s2.cash = 9999;
    build(s2, plan(s2, cell(s2, 'forest'), cell(s2, 'sawmill'))[0]);
    build(s2, plan(s2, cell(s2, 'sawmill'), cell(s2, 'hameenlinna'))[0]);
    const l = build(s2, plan(s2, cell(s2, 'hameenlinna'), cell(s2, 'farm')).find((o) => o.mode === 'short')!)!;
    const t = buyTrain(s2, l.id, 'hopper', engine)!;
    // a full train both ways: the line's ends do not trade grain, so the loads are put aboard
    t.loads = t.wagons.map(() => ({ good: 'grain' as const, from: 0 }));
    t.cargo = t.wagons.length;
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
  const town = siteById(s, 'hameenlinna');
  town.store.boards = storeCap(town);
  const p1 = price(s, 'boards', 'hameenlinna', 10);
  check(p1 <= p0 * 0.45, `a full store pays the floor price (${p0} -> ${p1})`);
  check(Math.abs(siteDemand(town, 'boards') - DEMAND_FLOOR) < 1e-9, 'and the demand is exactly the floor');
  const half = price(s, 'boards', 'hameenlinna', 10);
  town.store.boards = storeCap(town) / 2;
  const pHalf = price(s, 'boards', 'hameenlinna', 10);
  check(pHalf < p0 && pHalf > half, `a half store pays between full price and the floor (${p0}, ${pHalf}, ${half})`);
  town.store.boards = storeCap(town);
  s.cash = 9999;
  const eatMonths = storeCap(town) / eatsPerMonth(town);
  for (let k = 0; k < 60 * YEAR_SECONDS * (eatMonths / 12 + 0.1); k++) {
    step(s);
    if (s.yearEnd) closeYearEnd(s);
  }
  const p2 = price(s, 'boards', 'hameenlinna', 10);
  check(p2 === p0 && town.store.boards === 0, `the town eats a full store in ${eatMonths.toFixed(0)} months and the price is full again (${p1} -> ${p2})`);
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
      if (s.yearEnd) closeYearEnd(s);
    }
    back.push(`${from} cost ${r.cost}, cash ${Math.round(s.cash)} of ${start}`);
    return s.cash >= start;
  });
  check(results.every(Boolean), `from the start two different first lines both pay back within two years (${back.join('; ')})`);
}

// the first choice rewards more train: with a wagon added whenever the cash allows, the rich forest's
// line earns more than the near forest's over eight years, because the near forest runs dry
{
  const worth = (from: 'forest' | 'korpela') => {
    const s = createState(HARJU);
    const line = build(s, plan(s, cell(s, from), cell(s, 'sawmill'))[0])!;
    buyTrain(s, line.id, 'flat');
    for (let k = 0; k < 8 * YEAR_SECONDS * 60 + 120; k++) {
      step(s);
      if (s.yearEnd) {
        closeYearEnd(s);
        while (s.cash > 90 && s.trains[0].wagons.length < 4 && addWagon(s, s.trains[0].id));
      }
    }
    return Math.round(s.cash);
  };
  const near = worth('forest');
  const rich = worth('korpela');
  check(rich > 1.4 * near, `with wagons added as cash allows, Korpela's line earns over 1.4 times Kuusikko's in eight years (${rich} against ${near})`);
}

// the sites differ, and the far town is worth the long line
{
  const s = createState({ ...HARJU, startStations: HARJU.sites.map((d) => d.id) });
  const site = (id: string) => siteById(s, id);
  check(site('korpela').rawRate >= 1.5 * site('forest').rawRate && site('korpela').rawCap >= 1.5 * site('forest').rawCap, `Korpela is a rich forest, Kuusikko a poor one (rate ${site('korpela').rawRate} against ${site('forest').rawRate}, cap ${site('korpela').rawCap} against ${site('forest').rawCap})`);
  check(site('farm').rawRate >= 1.5 * site('niittyla').rawRate && site('farm').rawCap >= 1.5 * site('niittyla').rawCap, `Peltola is a rich farm, Niittylä a poor one (rate ${site('farm').rawRate} against ${site('niittyla').rawRate}, cap ${site('farm').rawCap} against ${site('niittyla').rawCap})`);
  check(site('sawmill').rawRate === 0 && site('forest').rawRate > 0 && site('korpela').rawCap > site('forest').rawCap, 'the rate and cap are data on the site, and a sawmill makes nothing raw');
  const len = (a: string, b: string) => plan(s, cell(s, a), cell(s, b))[0].cells.length;
  const pays = (to: string) => price(createState(HARJU), 'boards', to, len('sawmill', to));
  check(pays('lahti') > pays('tampere') && pays('tampere') > pays('hameenlinna'), `a load of boards pays more the further the town: Lahti ${pays('lahti')}, Tampere ${pays('tampere')}, Hämeenlinna ${pays('hameenlinna')}`);
  const lahti = site('lahti');
  check(lahti.size === 2 && lahti.growth > 0.5, `Lahti starts at size ${lahti.size} with its meter at ${lahti.growth}: hungrier than the others`);
  // no station, no change: the meter waits for the first train
  const g = createState(HARJU);
  for (let k = 0; k < 4 * (YEAR_SECONDS / 12) * 60; k++) step(g);
  check(siteById(g, 'lahti').growth === lahti.growth, `a town no train has reached holds its meter (${siteById(g, 'lahti').growth})`);
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
    closeYearEnd(s4);
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

// the crane: an industry's station with the crew, timber, boards and grain at half the dwell, flour and a town's not
{
  const s = createState(HARJU);
  s.cash = 9999;
  build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0]);
  build(s, plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'))[0]);
  const st = (id: string) => s.stations.find((x) => x.cell === cell(s, id))!;
  const forest = st('forest');
  const sawmill = st('sawmill');
  const town = st('hameenlinna');
  check(!buyCrane(s, forest.id) && !forest.crane, 'the crane needs the loading crew first');
  buyCrew(s, forest.id);
  buyCrew(s, sawmill.id);
  const base = dwellAt(s, forest.cell, 'timber');
  const c0 = s.cash;
  check(buyCrane(s, forest.id) && s.cash === c0 - CRANE_PRICE && forest.crane, `the crane costs ${CRANE_PRICE}`);
  check(Math.abs(dwellAt(s, forest.cell, 'timber') - base * (1 - CRANE_CUT)) < 1e-9 && !buyCrane(s, forest.id), `it halves the dwell for timber (${base.toFixed(2)} s to ${dwellAt(s, forest.cell, 'timber').toFixed(2)} s) and is bought once`);
  check(buyCrane(s, sawmill.id) && Math.abs(dwellAt(s, sawmill.cell, 'boards') - dwellAt(s, sawmill.cell, 'timber')) < 1e-9 && dwellAt(s, sawmill.cell, 'flour') > dwellAt(s, sawmill.cell, 'boards'), 'at the sawmill timber and boards are lifted, flour is not');
  buyCrew(s, town.id);
  check(!buyCrane(s, town.id), 'a town has no crane');
  check(Math.abs(dwellAt(s, forest.cell) - (1 - CREW_CUT) * 0.6) < 1e-9, 'a good that no crane lifts keeps the crew\'s dwell');
  // a train loads a wagon in the crane's time
  const line = s.lines[0];
  const tr = buyTrain(s, line.id, 'flat', 'hilma', 3)!;
  siteById(s, 'forest').stock = 6;
  siteById(s, 'forest').rate = 0;
  const loads: number[] = [];
  let last = -1;
  for (let k = 0; k < 60 * 6 && loads.length < 3; k++) {
    step(s);
    if (tr.cargo !== last) {
      loads.push(s.time);
      last = tr.cargo;
    }
  }
  const gaps = loads.slice(2).map((x, i) => x - loads[i + 1]);
  check(gaps.length >= 1 && gaps.every((g) => Math.abs(g - base * (1 - CRANE_CUT)) < 0.05), `a wagon fills in the crane's ${(base * (1 - CRANE_CUT)).toFixed(2)} s (${gaps.map((g) => g.toFixed(2)).join(', ')} s)`);
  check(endGood(s, line, 0) === 'timber' && endGood(s, line, 1) === 'timber', 'a line carries the good both its ends handle');
}

// the passing siding: where it can lie, what it costs, the trains that pass at it, never on the same track
{
  const run = (siding: boolean, trains: number, years: number) => {
    const s = createState(HARJU);
    s.cash = 9999;
    build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0]);
    const line = build(s, plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'))[0])!;
    for (const x of s.stations) x.platforms = 2;
    if (siding) buySiding(s, line.id);
    const ts = Array.from({ length: trains }, () => buyTrain(s, line.id, 'box', 'hilma', 3)!);
    siteById(s, 'sawmill').rate = 9;
    let trips = 0;
    let was = new Set<number>();
    let meet = 0;
    let passed = 0;
    for (let k = 0; k < 60 * YEAR_SECONDS * years; k++) {
      step(s);
      if (s.yearEnd) closeYearEnd(s);
      for (const t of ts) {
        const at = t.state === 'stop' && t.at === line.path[0];
        if (at && !was.has(t.id)) trips++;
        if (at) was.add(t.id);
        else was.delete(t.id);
      }
      if (ts.length === 2 && ts[0].state === 'run' && ts[1].state === 'run') {
        for (const [a0, a1] of mainPieces(line, ts[0])) for (const [b0, b1] of mainPieces(line, ts[1])) if (Math.min(a1, b1) - Math.max(a0, b0) > 0.05) meet++;
        if (ts.some((t) => t.loop === 2) && ts.some((t) => t.loop === 1)) passed++;
      }
    }
    return { s, line, trips: trips / years, meet, passed };
  };
  const probe = createState(HARJU);
  probe.cash = 9999;
  const lf = build(probe, plan(probe, cell(probe, 'forest'), cell(probe, 'sawmill'))[0])!;
  const lh = build(probe, plan(probe, cell(probe, 'sawmill'), cell(probe, 'hameenlinna'))[0])!;
  check(sidingSpans(probe, lf).length === 0 && !buySiding(probe, lf.id), 'a line with no straight stretch long enough takes no siding');
  const spans = sidingSpans(probe, lh);
  const end = lh.dist[lh.dist.length - 1];
  check(spans.length > 0 && spans.every((x) => x.d0 >= SIDING_FROM_STATION - 1e-9 && x.d1 <= end - SIDING_FROM_STATION + 1e-9 && x.d1 - x.d0 >= SIDING_LEN - 1e-9), `a siding lies at least ${SIDING_FROM_STATION} tiles from either station on a stretch of ${SIDING_LEN.toFixed(1)} tiles or more (${spans.length ? `${spans[0].d0.toFixed(0)} to ${spans[0].d1.toFixed(0)} of ${end.toFixed(0)}` : 'none'})`);
  check(spans.every((x) => { const ks = lh.path.map((c, k) => (lh.dist[k] >= x.d0 && lh.dist[k] <= x.d1 ? c : -1)).filter((c) => c >= 0); return ks.every((c) => !probe.water[c]); }), 'and never on a bridge');
  const cash0 = probe.cash;
  check(buySiding(probe, lh.id) && probe.cash === cash0 - SIDING_PRICE && !!lh.siding && lh.siding.s1 - lh.siding.s0 >= SIDING_LEN - 1e-9, `the siding costs ${SIDING_PRICE} and is as long as the longest train needs`);
  check(!buySiding(probe, lh.id), 'a line has one');
  const one = run(false, 1, 6);
  const two = run(false, 2, 6);
  const pass = run(true, 2, 6);
  check(pass.meet === 0 && two.meet === 0, `trains never meet on the main track (${two.meet} and ${pass.meet} frames)`);
  check(pass.passed > 0, `two trains pass at the siding (${pass.passed} frames with one in the loop and one running by)`);
  const ratio = pass.trips / one.trips;
  check(ratio >= 1.6 && ratio <= 2.0, `two trains with a siding and two platforms at each end make ${ratio.toFixed(2)} times the trips of one (${pass.trips.toFixed(1)} against ${one.trips.toFixed(1)} a year)`);
  check(two.trips < pass.trips * 0.85, `without the siding the second train adds little (${two.trips.toFixed(1)} against ${pass.trips.toFixed(1)} a year)`);
  const model = lineYear(pass.s, pass.line).trips / lineYear(one.s, one.line).trips;
  check(Math.abs(model - ratio) < 0.25, `the line card's numbers agree: ${model.toFixed(2)} times by the model, ${ratio.toFixed(2)} in the run`);
  check(lineYear(one.s, one.line, { engine: 'hilma', wagons: 3 }, true).trips > lineYear(one.s, one.line, { engine: 'hilma', wagons: 3 }).trips, 'the buy card counts the siding: a second train adds more with one');
  // a train running over the place keeps the siding from being laid there
  const s2 = createState(HARJU);
  s2.cash = 9999;
  build(s2, plan(s2, cell(s2, 'forest'), cell(s2, 'sawmill'))[0]);
  const l2 = build(s2, plan(s2, cell(s2, 'sawmill'), cell(s2, 'hameenlinna'))[0])!;
  const t2 = buyTrain(s2, l2.id, 'box')!;
  siteById(s2, 'sawmill').stock = 6;
  for (let k = 0; k < 60 * 12 && !(t2.state === 'run' && t2.s > 21 && t2.s < 30); k++) step(s2);
  check(t2.state === 'run' && !buySiding(s2, l2.id) && !l2.siding, 'a train running over the place keeps the siding from being laid');
  check(liftLine(s2, l2.id) === false, 'and a line with a train cannot be lifted');
}

// contracts: an offer at each year end for a good the map makes and a site that takes it; taken, counted, paid, lost
{
  const s = createState(HARJU);
  s.cash = 9999;
  build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0]);
  build(s, plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'))[0]);
  const offers: string[] = [];
  const made = new Set(s.sites.map((o) => MAKES[o.kind]).filter(Boolean));
  let okOffers = true;
  for (let n = 0; n < 4; n++) {
    for (let k = 0; k < 60 * YEAR_SECONDS + 2 && !s.yearEnd; k++) step(s);
    const o = s.offer;
    if (!o) {
      okOffers = false;
      break;
    }
    const target = siteById(s, o.site);
    if (!made.has(o.good) || !TAKES[target.kind].includes(o.good) || o.count < 3 || o.reward <= 0 || o.deadline !== s.year) okOffers = false;
    offers.push(`${o.count} ${o.good} to ${o.site} for ${o.reward} by ${o.deadline}`);
    closeYearEnd(s, false);
  }
  check(okOffers && offers.length === 4, `every offer is for a good the map makes to a site that takes it, with a deadline at the end of next year (${offers.join('; ')})`);
  const again = createState(HARJU);
  again.year = HARJU.startYear;
  const o1 = makeOffer(again);
  const o2 = makeOffer(createState(HARJU));
  check(!!o1 && !!o2 && o1.site === o2.site && o1.good === o2.good && o1.count === o2.count && o1.reward === o2.reward, 'the offer is seeded, so a run replays');
  // taking, counting and paying: a contract for boards to Hämeenlinna
  const s2 = createState(HARJU);
  s2.cash = 9999;
  const hl = siteById(s2, 'hameenlinna');
  const c = { id: 900, site: 'hameenlinna', good: 'boards' as const, count: 2, got: 0, deadline: s2.year, reward: 80 };
  s2.offer = c;
  s2.yearEnd = { year: s2.year, income: { timber: 0, boards: 0, grain: 0, flour: 0, pax: 0, mail: 0 }, running: 0, engine: 0, track: 0, interest: 0, upkeep: 0, profit: 0, cash: 0, loan: 0, worth: 0, lost: [], bonus: 0, grew: [], growth: {} };
  closeYearEnd(s2, true);
  check(s2.contracts.length === 1 && s2.offer === null, 'Take holds the contract');
  const o3 = { ...c, id: 901, site: 'tampere', count: 5 };
  s2.offer = o3;
  s2.yearEnd = { ...(s2.yearEnd ?? ({} as never)) } as never;
  s2.yearEnd = { year: s2.year, income: { timber: 0, boards: 0, grain: 0, flour: 0, pax: 0, mail: 0 }, running: 0, engine: 0, track: 0, interest: 0, upkeep: 0, profit: 0, cash: 0, loan: 0, worth: 0, lost: [], bonus: 0, grew: [], growth: {} };
  closeYearEnd(s2, false);
  check(s2.contracts.length === 1, 'Skip leaves it');
  // two lines of deliveries: the second load reaches the count and pays
  const lines = [build(s2, plan(s2, cell(s2, 'forest'), cell(s2, 'sawmill'))[0])!, build(s2, plan(s2, cell(s2, 'sawmill'), cell(s2, 'hameenlinna'))[0])!];
  const bx = buyTrain(s2, lines[1].id, 'box', 'hilma', 2)!;
  siteById(s2, 'sawmill').stock = 6;
  siteById(s2, 'sawmill').rate = 0;
  const before = s2.cash;
  const gross0 = hl.delivered;
  let paid = 0;
  for (let k = 0; k < 60 * 80 && s2.contracts.length; k++) {
    step(s2);
    if (s2.yearEnd) closeYearEnd(s2);
  }
  paid = s2.cash - before;
  check(s2.contracts.length === 0 && hl.delivered - gross0 >= 2 && bx.earned > 0, 'the count is reached by deliveries');
  check(s2.floats.some((f) => f.kind === 'pay' && f.text === '+80') || s2.bonus === 80 || paid > 80, 'and the reward is paid with a float');
  // a contract past its year is lost at no cost but the contract
  const s3 = createState(HARJU);
  s3.cash = 500;
  s3.contracts.push({ id: 902, site: 'tampere', good: 'flour', count: 5, got: 1, deadline: s3.year, reward: 60 });
  for (let k = 0; k < 60 * YEAR_SECONDS + 2 && !s3.yearEnd; k++) step(s3);
  check(!!s3.yearEnd && s3.yearEnd.lost.length === 1 && s3.contracts.length === 0 && s3.floats.some((f) => !!f.lost), 'a contract that misses its year is lost, and a float says so');
  check(s3.yearEnd!.profit === -s3.yearEnd!.running - s3.yearEnd!.engine - s3.yearEnd!.track - s3.yearEnd!.interest, 'and costs nothing');
  // two at most at once
  const s4 = createState(HARJU);
  s4.contracts.push({ id: 1, site: 'tampere', good: 'flour', count: 5, got: 0, deadline: 1864, reward: 60 }, { id: 2, site: 'tampere', good: 'boards', count: 5, got: 0, deadline: 1864, reward: 60 });
  check(CONTRACT_MAX === 2 && makeOffer(s4) === null, 'with two held, none is offered');
}

// a town's store and growth meter: supplied every month it grows inside GROW_MONTHS + 1 months; missing one good it never grows
{
  // a town no train has reached holds its meter, so these towns have a station
  const withStation = { ...HARJU, startStations: ['korpela', 'tampere'] };
  const run = (feed: (t: ReturnType<typeof siteById>) => void, months: number) => {
    const s = createState(withStation);
    const t = siteById(s, 'tampere');
    const out = { grewAt: -1, size: t.size, growth: 0, floats: 0, sounds: 0, month: 0 };
    const stop = Math.round(60 * (YEAR_SECONDS / 12) * months);
    for (let k = 0; k < stop; k++) {
      feed(t);
      step(s);
      if (s.yearEnd) closeYearEnd(s);
      if (t.size > out.size && out.grewAt < 0) out.grewAt = Math.round(s.time / (YEAR_SECONDS / 12) * 10) / 10;
      if (s.floats.some((f) => f.kind === 'grow' && f.grew?.site === 'tampere')) out.floats++;
      out.growth = t.growth;
    }
    out.size = t.size;
    return out;
  };
  const fed = run((t) => { t.store.boards = storeCap(t); t.store.flour = storeCap(t); }, GROW_MONTHS + 2);
  check(fed.size === 2 && fed.grewAt > 0 && fed.grewAt <= GROW_MONTHS + 1 && fed.floats > 0, `a town supplied every month grows inside ${GROW_MONTHS + 1} months, with a float over it (grew at month ${fed.grewAt})`);
  const half = run((t) => { t.store.boards = storeCap(t); t.store.flour = 0; }, 40);
  check(half.size === 1 && half.growth === 0, `a town missing one good never grows (size ${half.size} after 40 months, meter ${half.growth})`);
  // the meter fills in whole steps, a short month drains a smaller one, never below zero
  const s = createState(withStation);
  const t = siteById(s, 'tampere');
  t.store.boards = 3;
  t.store.flour = 3;
  const m0 = s.month;
  while (s.month === m0) step(s);
  const up = t.growth;
  t.store.flour = 0;
  const m1 = s.month;
  while (s.month === m1) step(s);
  check(Math.abs(up - 1 / GROW_MONTHS) < 1e-9 && t.growth < up && t.growth >= 0, `a supplied month fills ${(100 / GROW_MONTHS).toFixed(1)} % of the meter and a short month drains less (${up.toFixed(3)} then ${t.growth.toFixed(3)})`);
  t.growth = 0.01;
  t.store.boards = 0;
  const m2 = s.month;
  while (s.month === m2) step(s);
  check(t.growth === 0, 'and the meter never goes below zero');
  // a delivery adds a load to the store and the store is capped
  const h = siteById(s, 'hameenlinna');
  h.store.boards = 0;
  check(storeCap(h) === 4 * h.size, `the store cap is ${storeCap(h)} loads for size ${h.size}`);
}

// travellers and mail: made by the towns with a station, carried by coaches and mail vans, paid by distance and time
{
  const s0 = createState(HARJU);
  const tampere0 = siteById(s0, 'tampere');
  // nothing is made until a town has a station and another town has one too
  for (let k = 0; k < 60 * YEAR_SECONDS; k++) { step(s0); if (s0.yearEnd) closeYearEnd(s0); }
  check(waitingTotal(tampere0, 'pax') === 0 && waitingTotal(tampere0, 'mail') === 0, 'a town with no station makes no travellers and no mail');
  // two towns with stations, both size 2: each makes travellers and mail for the other, by its size, up to a cap
  const open = { ...HARJU, startStations: ['tampere', 'hameenlinna'] };
  const s = createState(open);
  const tam = siteById(s, 'tampere');
  const ham = siteById(s, 'hameenlinna');
  tam.size = 2;
  ham.size = 2;
  const m0 = s.month;
  while (s.month === m0) step(s);
  const per = (PAX_RATE * 2).toFixed(2);
  check(Math.abs((tam.pax.hameenlinna ?? 0) - PAX_RATE * 2) < 1e-9 && Math.abs((tam.mail.hameenlinna ?? 0) - MAIL_RATE * 2) < 1e-9 && tam.pax.lahti === undefined, `a size 2 town makes ${per} loads of travellers a month for the other town with a station, and none for a town without (${tam.pax.hameenlinna})`);
  for (let k = 0; k < 60 * YEAR_SECONDS * 2; k++) { step(s); if (s.yearEnd) closeYearEnd(s); }
  check(Math.abs((tam.pax.hameenlinna ?? 0) - PAX_CAP * 2) < 1e-9 && Math.abs((tam.mail.hameenlinna ?? 0) - MAIL_CAP * 2) < 1e-9, `the waiting travellers stop at the cap of ${PAX_CAP} a size (${(tam.pax.hameenlinna ?? 0).toFixed(1)}) and the mail at ${MAIL_CAP}`);
  // the pay: distance factor on the base, less a share for every second past a fair trip, never below the floor; mail pays more and loses a third as fast
  const cells = 60;
  const fair = cells / FARE_SPEED;
  const on = farePay('pax', cells, fair);
  const late = farePay('pax', cells, fair + 20);
  const verylate = farePay('pax', cells, fair + 1000);
  const mailOn = farePay('mail', cells, fair);
  const mailLate = farePay('mail', cells, fair + 20);
  check(on === Math.round(BASE_FARE.pax * distanceFactor(cells)) && late < on && Math.abs(late - Math.round(on * (1 - PAX_DECAY * 20))) <= 1, `a load of travellers delivered late pays less than one on time (${on}, then ${late} twenty seconds late)`);
  check(verylate === Math.round(on * FARE_FLOOR) && verylate > 0, `and never less than ${FARE_FLOOR * 100} % of the full pay (${verylate})`);
  check(mailOn > on && mailOn - mailLate < on - late, `mail pays more per load (${mailOn} against ${on}) and loses less when late (${mailOn - mailLate} against ${on - late})`);
  // a coach carries between two towns and is a waste on a line with one
  const one = createState(HARJU);
  one.cash = 9999;
  const fs = build(one, plan(one, cell(one, 'forest'), cell(one, 'sawmill'))[0])!;
  const ext = build(one, plan(one, cell(one, 'sawmill'), cell(one, 'hameenlinna'), 1).filter((r) => canExtend(one, r, fs.id))[0], fs.id)!;
  check(wagonWaste(one, ext, 'coach') && wagonWaste(one, ext, 'mailvan'), 'a coach and a mail van carry nothing on a line with one town');
  const two = createState(open);
  two.cash = 9999;
  const link = build(two, plan(two, cell(two, 'tampere'), cell(two, 'hameenlinna'))[0])!;
  const rt = wagonRoutes(two, link, 'coach');
  check(!wagonWaste(two, link, 'coach') && rt.length === 1 && rt[0].good === 'pax' && wagonWaste(two, link, 'flat') && defaultConsist(two, link).join() === 'coach,coach,mailvan', `on a line between two towns a coach carries travellers (${defaultConsist(two, link).join(' ')})`);
  // a coach train: it takes travellers at a stop whose town lies ahead, and the town they reach counts them
  const run = (hold: number) => {
    const g = createState(open);
    g.cash = 9999;
    g.sites.filter((x) => x.kind === 'town').forEach((x) => (x.size = 2));
    const l = build(g, plan(g, cell(g, 'tampere'), cell(g, 'hameenlinna'))[0])!;
    const tr = buyTrain(g, l.id, ['coach', 'coach', 'mailvan'])!;
    const dest = siteById(g, 'hameenlinna');
    siteById(g, 'tampere').pax.hameenlinna = 2;
    siteById(g, 'tampere').mail.hameenlinna = 1;
    let held = false;
    let first = Infinity;
    for (let k = 0; k < 60 * 110; k++) {
      step(g);
      // the late run keeps the train standing at the first stop after its travellers got on
      if (hold && !held && tr.cargo === 3) {
        held = true;
        tr.stopLeft = hold;
      }
      if (g.income.pax > 0 && first === Infinity) first = g.time;
      if (tr.cargo === 0 && first < Infinity && g.income.mail > 0) break;
    }
    return { g, tr, dest, income: g.income.pax, mail: g.income.mail };
  };
  const quick = run(0);
  const slow = run(45);
  check(quick.income > 0 && quick.mail > 0 && Number.isFinite(quick.dest.lastArrival), `the coaches deliver their travellers and the post, and the town counts them (pay ${quick.income} and ${quick.mail})`);
  check(slow.income < quick.income, `travellers that sat on the platform 45 s longer paid less (${slow.income} against ${quick.income})`);
  // a passenger line between two size 2 towns pays back inside two years: line, train and all the running costs
  {
    const g = createState(open);
    g.cash = 5000;
    g.sites.filter((x) => x.kind === 'town').forEach((x) => (x.size = 2));
    const start = g.cash;
    const l = build(g, plan(g, cell(g, 'tampere'), cell(g, 'hameenlinna'))[0])!;
    buyTrain(g, l.id, defaultConsist(g, l));
    const spent = start - g.cash;
    for (let k = 0; k < 2 * YEAR_SECONDS * 60 + 60; k++) {
      step(g);
      if (g.yearEnd) closeYearEnd(g);
    }
    check(g.cash >= start, `a passenger line between two size 2 towns pays back inside two years (spent ${Math.round(spent)}, cash ${Math.round(g.cash)} of ${start} after two years)`);
  }
  // a size 2 town with every good but no travellers does not grow; with them it does
  const grow = (visit: boolean) => {
    const g = createState({ ...HARJU, startStations: ['korpela', 'tampere'] });
    const t = siteById(g, 'tampere');
    t.size = 2;
    const stop = Math.round(60 * (YEAR_SECONDS / 12) * (GROW_MONTHS + 2));
    for (let k = 0; k < stop; k++) {
      t.store.boards = storeCap(t);
      t.store.flour = storeCap(t);
      if (visit && k % 60 === 0) t.lastArrival = g.time;
      step(g);
      if (g.yearEnd) closeYearEnd(g);
    }
    return t;
  };
  const without = grow(false);
  const withFolk = grow(true);
  check(without.size === 2 && without.growth === 0, `a size 2 town with boards and flour but no travellers does not grow (size ${without.size}, meter ${without.growth})`);
  check(withFolk.size === 3, `with travellers arriving it grows (size ${withFolk.size})`);
  const lone = createState(SAWMILL);
  const lt = siteById(lone, 'town');
  lt.size = 2;
  check(!wantsPeople(lone, lt) && wantsPeople(createState(HARJU), (() => { const x = siteById(createState(HARJU), 'tampere'); x.size = 2; return x; })()), 'a map with one town asks for no travellers, so Sawmill is as it was');
}

// the bot wins both scenarios
const years: Record<string, YearRecord[]> = {};
const bots: Record<string, Bot> = {};
const maxLoan: Record<string, number> = {};

// lines with up to four stops and trains of mixed wagons
{
  const s = createState(HARJU);
  s.cash = 9999;
  const fs = plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0];
  const line = build(s, fs)!;
  check(line.stops.length === 2 && line.legs.length === 1 && line.stopAt.join() === `0,${line.path.length - 1}`, 'a drag builds a line of two stops and one leg');
  // the drag from the end station offers to lengthen the line: the free side is the one the line does not arrive from
  const exts = extendable(s, cell(s, 'sawmill'));
  const side = freeSide(s, line, cell(s, 'sawmill'));
  check(exts.length === 1 && exts[0] === line && side === 1, 'a drag from the end station of a line offers to lengthen it, leaving on the side the line does not arrive from');
  const toTown = plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'), side).filter((r) => canExtend(s, r, line.id));
  check(toTown.length >= 1 && stationAt(s, toTown[0].cells[1] === toTown[0].cells[0] + 1 ? toTown[0].cells[0] : -1) !== undefined, `the lengthening route runs east from Koskensaha (${toTown.map((r) => `${r.mode} ${r.cost}`).join(', ')})`);
  const cash0 = s.cash;
  const same = build(s, toTown[0], line.id);
  check(same === line && line.stops.length === 3 && line.legs.length === 2 && s.lines.length === 1, 'built as an extension it is the same line with three stops and two legs');
  check(s.cash === cash0 - toTown[0].cost && line.legs[0].block.size > 0 && line.legs[1].block.size > 0 && ![...line.legs[0].block].some((c) => line.legs[1].block.has(c)), 'each leg has its own block, with no cell in common');
  check(line.stopAt.every((k, i) => line.path[k] === stationAt(s, line.path[k])!.cell && s.stations.find((st) => st.id === line.stops[i])!.cell === line.path[k]) && line.stopAt[1] === line.legs[0].b && line.legs[1].a === line.legs[0].b, 'the middle stop is the end of one leg and the start of the next');
  check(undo(s) && line.stops.length === 2 && line.legs.length === 1 && s.cash === cash0 && !s.stations.some((st) => st.siteId === 'hameenlinna'), 'undo takes an extension back: the line has two stops again and the cash returns');
  build(s, toTown[0], line.id);
  // a line cannot take a station it serves, a fifth stop, or a route over its own track
  const back = plan(s, cell(s, 'hameenlinna'), cell(s, 'sawmill')).filter((r) => canExtend(s, r, line.id));
  check(back.length === 0, 'it takes no stop it already has');
  // the default consist is what the stops make and take
  check(defaultConsist(s, line).join() === 'flat,flat,box,box' && carryingTypes(s, line).join() === 'flat,box', `the buy card starts with two flat and two box wagons (${defaultConsist(s, line).join(' ')})`);
  check(wagonWaste(s, line, 'hopper') && !wagonWaste(s, line, 'flat') && !wagonWaste(s, line, 'box'), 'a hopper wagon has nothing to carry on the line from the forest through the sawmill to the town');
  const routes = wagonRoutes(s, line, 'box');
  check(routes.length === 1 && routes[0].good === 'boards' && routes[0].from === 1 && routes[0].to === 2, 'box wagons carry boards from the sawmill to the town on it');
  // a mixed train: timber and boards both reach their buyers in its first year
  const t = buyTrain(s, line.id, defaultConsist(s, line))!;
  check(!!t && t.wagons.join() === 'flat,flat,box,box' && t.nWagons === 4 && t.dir === 1 && t.idx === 0, 'a mixed train is bought on it, standing at the first stop');
  siteById(s, 'forest').stock = 6;
  const seen = { atSawmill: false, loads: new Set<string>() };
  for (let k = 0; k < 60 * YEAR_SECONDS && !s.yearEnd; k++) {
    step(s);
    if (t.state === 'stop' && t.at === cell(s, 'sawmill') && t.dock) seen.atSawmill = true;
    for (const l of t.loads) if (l) seen.loads.add(l.good);
  }
  check(s.income.timber > 0 && s.income.boards > 0, `the mixed train delivers timber and boards in its first year (${Math.round(s.income.timber)} for timber, ${Math.round(s.income.boards)} for boards)`);
  check(seen.atSawmill && seen.loads.has('timber') && seen.loads.has('boards'), 'it unloads and loads at the middle stop, flat wagons carrying timber and box wagons boards');
  // a wagon that carries nothing is reported as waste, on the train too
  const s2 = createState(HARJU);
  s2.cash = 9999;
  const l2 = build(s2, plan(s2, cell(s2, 'forest'), cell(s2, 'sawmill'))[0])!;
  build(s2, plan(s2, cell(s2, 'sawmill'), cell(s2, 'hameenlinna'), 1).filter((r) => canExtend(s2, r, l2.id))[0], l2.id);
  const t2 = buyTrain(s2, l2.id, ['flat', 'hopper', 'box'])!;
  check(!!t2 && wasteWagons(s2, t2).join() === '1', 'a hopper in the consist of a train on this line is reported as waste');
  // taking a wagon off gives half its price back
  const cashW = s2.cash;
  check(removeWagon(s2, t2.id, 1) && s2.cash === cashW + WAGON_BACK && t2.wagons.join() === 'flat,box' && t2.loads.length === 2 && wasteWagons(s2, t2).length === 0, `a wagon taken off returns half its price (${WAGON_BACK}) and the waste is gone`);
  check(addWagon(s2, t2.id, 'box') && t2.wagons.join() === 'flat,box,box' && t2.nWagons === 3, 'a wagon of any type is added to a train');
  check(removeWagon(s2, t2.id, 0) && removeWagon(s2, t2.id, 0) && !removeWagon(s2, t2.id, 0) && t2.nWagons === 1, 'the last wagon of a train cannot be taken off');
  // a station's platforms count for both directions at a middle stop; the line runs as many trains as its poorest stop has platforms
  check(lineCapacity(s2, l2) === 1 && lineCapacity(s, line) === 1, 'a three-stop line with one platform at each stop runs one train');
}

/**
 * The checks that run every frame of a game: two trains never cover the same track cell (apart from
 * the station throat, where platform tracks run side by side), no two standing trains share a platform
 * track, a waiting train stands clear of the station, and how long a train goes without moving or
 * working (`longest`, in seconds), the proof that no train is stuck.
 */
/** the centre of the engine and of each wagon of a train, in tiles, as the renderer places them along the line */
function vehicleCentres(s: SimState, o: SimState['trains'][number]): { x: number; y: number }[] {
  const line = lineOf(s, o);
  const out: { x: number; y: number }[] = [];
  let d = o.s + o.dir * (drawnLength(o) / 2);
  for (let i = 0; i <= o.nWagons; i++) {
    const len = i === 0 ? ENGINE_LEN : WAGON_LEN;
    const m = along(line, d - o.dir * (len / 2), s.w);
    out.push({ x: m.x, y: m.y });
    d -= o.dir * (len + 0.08);
  }
  return out;
}

class Watch {
  overlap = 0;
  /** frames with two vehicles of different trains closer than 0.6 tile, off the separate tracks of a platform */
  near = 0;
  shared = 0;
  apart = 0;
  longest = 0;
  /** the longest a train stood ready to leave and was held by a block, in seconds */
  gate = 0;
  private seen = new Map<number, { mark: string; since: number }>();

  check(s: SimState): void {
    const bodies = s.trains.map((o) => ({ o, cells: bodyCells(s, o, 0) }));
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.o.state === 'stop' && b.o.state === 'stop') continue;
        // on a line with a passing siding the two trains share the track by the siding's rules: their main-track pieces must not meet
        if (a.o.lineId === b.o.lineId && lineOf(s, a.o).siding) {
          if (a.o.state === 'run' && b.o.state === 'run') {
            const l = lineOf(s, a.o);
            for (const [x0, x1] of mainPieces(l, a.o)) for (const [y0, y1] of mainPieces(l, b.o)) if (Math.min(x1, y1) - Math.max(x0, y0) > 0.05) this.overlap++;
          }
          continue;
        }
        // within a station's throat the platform and siding tracks run side by side, so trains on different ones may share a cell
        const dist = (x: number, y: number) => Math.hypot((x % s.w) - (y % s.w), Math.floor(x / s.w) - Math.floor(y / s.w));
        const trackAt = (o: (typeof s.trains)[number], c: number) => {
          if (o.state === 'stop') return o.slot;
          const l = lineOf(s, o);
          // the stop the cell is nearest to: the platform track the train uses there is the one it runs to or left
          let near = 0;
          for (let k = 1; k < l.stops.length; k++) if (dist(c, stopCell(l, k)) < dist(c, stopCell(l, near))) near = k;
          return near === o.to ? o.slot : near === o.idx ? o.slotFrom : 0;
        };
        const throat = (c: number) => trackAt(a.o, c) !== trackAt(b.o, c) && s.stations.some((st) => dist(st.cell, c) <= 8);
        // the vehicles themselves: the drawn centre of the engine and of each wagon, less than 0.6 tile from one of another train
        const pa = vehicleCentres(s, a.o);
        const pb = vehicleCentres(s, b.o);
        let close = false;
        for (const u of pa) for (const v of pb) if (Math.hypot(u.x - v.x, u.y - v.y) < 0.6 && !throat(Math.floor(u.y) * s.w + Math.floor(u.x))) close = true;
        if (close) this.near++;
        for (const c of a.cells) if (b.cells.has(c) && !s.stations.some((st) => st.cell === c) && !throat(c)) {
          this.overlap++;
          if (this.overlap === 1) console.log(`  overlap at t=${s.time.toFixed(1)} cell ${c}: train ${a.o.id} ${a.o.state}${a.o.queued ? ' queued' : ''} s=${a.o.s.toFixed(1)} dir ${a.o.dir} line ${a.o.lineId} slot ${a.o.slot} at ${a.o.at}; train ${b.o.id} ${b.o.state}${b.o.queued ? ' queued' : ''} s=${b.o.s.toFixed(1)} dir ${b.o.dir} line ${b.o.lineId} slot ${b.o.slot} at ${b.o.at}`);
        }
      }
    // and the old rule: one running train at a time on a block, now a leg's block
    const running = s.trains.filter((o) => o.state === 'run' && !o.queued);
    for (let i = 0; i < running.length; i++)
      for (let j = i + 1; j < running.length; j++) {
        const a = lineOf(s, running[i]);
        const b = lineOf(s, running[j]);
        // the legs a train covers: all between the stop it left and the stop it runs to, past the stops it passes
        const ra = [Math.min(running[i].idx, running[i].to), Math.max(running[i].idx, running[i].to)];
        const rb = [Math.min(running[j].idx, running[j].to), Math.max(running[j].idx, running[j].to)];
        if (a === b && ra[0] < rb[1] && rb[0] < ra[1] && !a.siding) this.overlap++;
      }
    // no two trains stand on one platform track of a station
    const seen = new Set<string>();
    for (const o of s.trains)
      if (o.state === 'stop' && o.at !== null) {
        const key = `${o.at}:${o.slot}`;
        if (seen.has(key)) this.shared++;
        seen.add(key);
      }
    // a waiting train stands clear of the station's centre by the longest train it could be waiting for
    for (const o of s.trains) {
      if (!o.queued) continue;
      const line = lineOf(s, o);
      const front = (o.dir === 1 ? stopS(line, o.to) - o.s : o.s - stopS(line, o.to)) - drawnLength(o) / 2;
      if (front < QUEUE_GAP) this.apart++;
    }
    // a train is moving or working, or it is not: the longest it goes without either
    for (const o of s.trains) {
      this.gate = Math.max(this.gate, o.gate);
      if (o.parked) {
        this.seen.delete(o.id);
        continue;
      }
      const mark = `${o.state}:${o.odometer.toFixed(2)}:${o.cargo}:${o.at}:${o.dock}:${o.idx}`;
      const prev = this.seen.get(o.id);
      if (!prev || prev.mark !== mark) this.seen.set(o.id, { mark, since: s.time });
      else this.longest = Math.max(this.longest, s.time - prev.since);
    }
  }
}

// train orders: a train passes a middle station through, ends always stop
{
  const build3 = () => {
    const s = createState(HARJU);
    s.cash = 99999;
    const line = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
    build(s, plan(s, cell(s, 'sawmill'), cell(s, 'hameenlinna'), 1).filter((r) => canExtend(s, r, line.id))[0], line.id);
    for (const id of line.stops) buyPlatform(s, id);
    return { s, line, mid: line.stops[1], midCell: line.path[line.stopAt[1]] };
  };
  // one train alone on the line, one year after another: the stopper and the skipper
  const trips = (skip: boolean) => {
    const { s, line, mid, midCell } = build3();
    const t = buyTrain(s, line.id, defaultConsist(s, line))!;
    if (skip) check(setStop(s, t.id, mid, false) && t.skip.join() === `${mid}`, 'a middle station can be set to pass through');
    siteById(s, 'forest').stock = 99;
    siteById(s, 'sawmill').stock = 99;
    let round = 0;
    let wasStopped = false;
    let atMid = 0;
    let loadsAfter = 0;
    for (let k = 0; k < 3 * YEAR_SECONDS * 60; k++) {
      if (s.yearEnd) closeYearEnd(s);
      step(s);
      if (t.state === 'stop' && t.at === midCell) atMid++;
      if (t.state === 'stop' && !wasStopped && t.idx === 0) round++;
      wasStopped = t.state === 'stop';
      if (skip && t.cargo > 0) loadsAfter++;
    }
    return { round, atMid, loadsAfter, delivered: siteById(s, 'sawmill').delivered, pickups: siteById(s, 'sawmill').lastPickup, t };
  };
  const stops = trips(false);
  const passes = trips(true);
  check(stops.atMid > 0 && stops.delivered > 0, `a train that stops at Koskensaha stands there and unloads (${stops.atMid} frames, ${stops.delivered} loads)`);
  check(passes.atMid === 0 && passes.delivered === 0 && passes.loadsAfter === 0 && passes.pickups === -Infinity, `a train that passes Koskensaha through never stops, loads or unloads there (${passes.atMid} frames, ${passes.delivered} loads, ${passes.loadsAfter} frames with a load)`);
  check(passes.round > stops.round, `and makes more trips than one that stops (${passes.round} against ${stops.round} round trips in three years)`);
  {
    const { s, line } = build3();
    const t = buyTrain(s, line.id, defaultConsist(s, line))!;
    check(!setStop(s, t.id, line.stops[0], false) && !setStop(s, t.id, line.stops[2], false) && t.skip.length === 0, 'the ends of a line cannot be set to pass through');
    check(setStop(s, t.id, line.stops[1], false) && !setStop(s, t.id, line.stops[1], false) && setStop(s, t.id, line.stops[1], true) && t.skip.length === 0, 'a station set to pass through can be set to stop again, and a repeat changes nothing');
    const two = createState(HARJU);
    two.cash = 9999;
    const l2 = build(two, plan(two, cell(two, 'forest'), cell(two, 'sawmill'))[0])!;
    const t2 = buyTrain(two, l2.id, 'flat', 'hilma', 2)!;
    check(!setStop(two, t2.id, l2.stops[0], false) && !setStop(two, t2.id, l2.stops[1], false), 'a line of two stops has no station to pass');
    // the cycle counts the skipped dwell
    const stand = consistCycle(s, line, 'hilma', t.wagons).stands[1];
    const skipped = consistCycle(s, line, 'hilma', t.wagons, [line.stops[1]]);
    check(stand > 0 && skipped.stands[1] === 0 && skipped.total < consistCycle(s, line, 'hilma', t.wagons).total && lineTrips(s, line, 'hilma', t.wagons, [line.stops[1]]) > lineTrips(s, line, 'hilma', t.wagons), 'the trip time counts the dwell a skipped station saves');
  }
  // a skipper and a stopper on one line for ten years: no overlap, no wait over 40 s
  {
    const { s, line, mid, midCell } = build3();
    const a = buyTrain(s, line.id, defaultConsist(s, line))!;
    const b = buyTrain(s, line.id, defaultConsist(s, line))!;
    setStop(s, b.id, mid, false);
    const watch = new Watch();
    let passedMid = 0;
    let heldMid = 0;
    let stoppedMid = 0;
    for (let k = 0; k < 10 * YEAR_SECONDS * 60; k++) {
      if (k % 60 === 0) {
        siteById(s, 'forest').stock = Math.max(siteById(s, 'forest').stock, 3);
        siteById(s, 'sawmill').stock = Math.max(siteById(s, 'sawmill').stock, 3);
      }
      if (s.yearEnd) closeYearEnd(s);
      step(s);
      watch.check(s);
      if (b.state === 'stop' && b.at === midCell) stoppedMid++;
      if (b.state === 'run' && Math.abs(b.s - stopS(line, 1)) < 0.05) passedMid++;
      if (b.state === 'run' && b.speed === 0) heldMid++;
    }
    check(stoppedMid === 0 && a.odometer > 0 && b.odometer > 0 && s.trains.every((t) => !t.parked), `the skipper never stops at the station while the stopper serves it (${stoppedMid} frames, odometers ${a.odometer.toFixed(0)} and ${b.odometer.toFixed(0)})`);
    check(watch.overlap === 0 && watch.near === 0 && watch.shared === 0 && watch.apart === 0, `ten years of a skipper and a stopper on one line: no overlap, no vehicles closer than 0.6 tile, none over a station (${watch.overlap}, ${watch.near}, ${watch.shared}, ${watch.apart} frames; the skipper ran through ${passedMid} frames at the station and waited ${heldMid})`);
    check(watch.gate <= 40 && watch.longest <= 30, `and no wait over 40 s (${watch.gate.toFixed(1)} s) and no train stuck (${watch.longest.toFixed(1)} s)`);
    check(a.earned > 0, `the stopper earned (${Math.round(a.earned)})`);
  }
}

// no deadlock: Harju's bot runs a four-stop line and a three-stop line, two trains each, for ten years
{
  const open = { ...HARJU, startStations: ['korpela', 'tampere', 'mill'], goal: { kind: 'deliver' as const, good: 'boards' as const, site: 'nowhere', count: 1e9, beforeYear: 1999 } };
  const s = createState(open);
  s.cash = 9999;
  const mixed = ['flat', 'flat', 'box', 'box'] as const;
  const steps: Step[] = [
    { kind: 'line', from: 'korpela', to: 'forest', mode: 'cheap' },
    { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap', extend: ['korpela', 'forest'] },
    { kind: 'line', from: 'sawmill', to: 'hameenlinna', mode: 'cheap', extend: ['korpela', 'forest', 'sawmill'] },
    // the second line is flour to Tampere and on to Lahti, on its own track
    { kind: 'line', from: 'tampere', to: 'mill', mode: 'short' },
    { kind: 'line', from: 'mill', to: 'lahti', mode: 'cheap', extend: ['tampere', 'mill'] },
    ...(['korpela', 'forest', 'sawmill', 'hameenlinna', 'tampere', 'mill', 'lahti'] as const).map((site) => ({ kind: 'platform', site }) as Step),
    { kind: 'train', line: ['korpela', 'forest', 'sawmill', 'hameenlinna'], wagons: [...mixed] },
    { kind: 'train', line: ['korpela', 'forest', 'sawmill', 'hameenlinna'], wagons: [...mixed] },
    { kind: 'train', line: ['tampere', 'mill', 'lahti'], wagons: ['box', 'box', 'box'] },
    { kind: 'train', line: ['tampere', 'mill', 'lahti'], wagons: ['box', 'box', 'box'] },
  ];
  const bot = new Bot({ steps }, false);
  const watch = new Watch();
  let lines = '';
  for (let k = 0; k < 10 * YEAR_SECONDS * 60; k++) {
    bot.act(s);
    // the mill has flour to move: no grain line feeds it here
    if (k % 60 === 0) siteById(s, 'mill').stock = Math.max(siteById(s, 'mill').stock, 3);
    step(s);
    watch.check(s);
    if (k === 60 * 5) lines = s.lines.map((l) => `${l.stops.length} stops`).join(', ');
  }
  const four = s.lines.filter((l) => l.stops.length === 4);
  const three = s.lines.filter((l) => l.stops.length === 3);
  check(bot.done === steps.length && four.length === 1 && three.length === 1 && s.trains.length === 4, `the bot builds a four-stop and a three-stop line and buys two trains for each (${lines})`);
  check(s.trains.every((t) => !t.parked), 'and all four trains are in service');
  check(watch.overlap === 0 && watch.near === 0, `ten years: no two trains share a cell or come closer than 0.6 tile (${watch.overlap} and ${watch.near} frames)`);
  check(watch.shared === 0 && watch.apart === 0, `and none stand on one platform or over a station (${watch.shared} and ${watch.apart} frames)`);
  check(watch.longest <= 30, `and no train is stuck: the longest a train went without moving or working is ${watch.longest.toFixed(1)} s`);
  check(watch.gate <= 40, `and none waits at a shared block more than 40 s: first come, first served (the longest wait is ${watch.gate.toFixed(1)} s)`);
  check(s.trains.every((t) => t.earned > 0), `every train earned (${s.trains.map((t) => Math.round(t.earned)).join(', ')})`);
}

/** the whole game of one bot: the state it ends in, with the checks that run every frame */
function play(sc: typeof SAWMILL, greedy = false, upToYear = Infinity, variant?: string) {
  const s = createState(sc);
  const bot = Bot.for(s, greedy, variant);
  const tips = variant === 'D';
  const name = `${sc.id}${variant ? ` plan ${variant}` : ''}`;
  const watch = new Watch();
  const limit = (Math.min(sc.goal.beforeYear, upToYear + 1) - sc.startYear) * YEAR_SECONDS + 10;
  for (let t = 0; t < limit && !s.result; t += DT) {
    bot.act(s);
    step(s);
    watch.check(s);
  }
  const { overlap, near, shared, apart } = watch;
  if (!greedy) for (const l of bot.log.filter((x) => !x.includes('borrow'))) console.log(`  ${l}`);
  const key = `${sc.id}${greedy ? '-greedy' : ''}${variant ? `-${variant}` : ''}`;
  years[key] = bot.years;
  bots[key] = bot;
  maxLoan[key] = bot.maxLoan;
  const r = s.result;
  if (greedy) return s;
  check(!!r && r.won, `the bot wins ${name} (${r ? `${r.won ? 'won' : r.reason} in ${r.year}, cash ${r.cash}, net worth ${r.worth}, ${r.stars} stars` : 'not over'})`);
  check(s.firstPayAt !== null && s.firstPayAt < 90, `${name}: the first paid delivery lands inside 90 s (${s.firstPayAt?.toFixed(0)} s)`);
  // no two trains are ever on one track cell or closer than 0.6 tile, tips or plan, a lengthened line through another line's station included
  check(overlap === 0, `${name}: no two trains are ever on the same track cell (${overlap} frames)`);
  check(near === 0, `${name}: no two vehicles of different trains are ever closer than 0.6 tile (${near} frames)`);
  check(shared === 0, `${name}: no two standing trains share a platform track (${shared} frames)`);
  check(apart === 0, `${name}: a waiting train never stands over the station (${apart} frames)`);
  if (tips) {
    // the sensible player, who does what the tips say: a win, but in the last years and with one star
    const last: Record<string, [number, number]> = { sawmill: [1864, 1865], harju: [1870, 1872] };
    check(!!r && r.year >= last[sc.id][0] && r.year <= last[sc.id][1], `${name}: the player who follows the tips wins in ${last[sc.id][0]} to ${last[sc.id][1]} (${r?.year}, ${r?.stars} stars, net worth ${r?.worth})`);
    check(!!r && r.stars <= (sc.id === 'sawmill' ? 3 : 2), `${name}: and does not earn the top star on Harju (${r?.stars} stars)`);
    return s;
  }
  check(bot.done >= 6, `${name}: the bot made ${bot.done} of the ${bot.plan.steps.length} buys of its plan`);
  const lateWin: Record<string, [number, number]> = { sawmill: [1863, 1864], harju: [1867, 1869] };
  check(!!r && r.year >= lateWin[sc.id][0] && r.year <= lateWin[sc.id][1], `${name}: the goal falls in ${lateWin[sc.id][0]} to ${lateWin[sc.id][1]}, with slack for the player who follows the tips (${r?.year})`);
  check(!!r && r.stars >= 2 && (sc.id === 'sawmill' || r.stars === 3), `${name}: the bot's win earns ${sc.id === 'sawmill' ? 'two stars or more' : 'three stars'} (${r?.year}, net worth ${r?.worth}, ${r?.stars} stars)`);
  for (const t of s.trains) {
    const p = along(lineOf(s, t), t.s, s.w);
    check(p.x >= 0 && p.x <= s.w && p.y >= 0 && p.y <= s.h, `${name}: train ${t.id} is on the map (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), length ${trainLength(t).toFixed(1)}`);
  }
  // the money checks, from the bot's year ends
  const ys = bot.years;
  const lastYear = sc.goal.kind === 'deliver' ? r!.year : r!.year - 1;
  const early = ys.filter((y) => y.year <= lastYear - 2);
  check(early.length > 0 && early.every((y) => y.next > 0 && y.cash <= 1.5 * y.next), `${name}: before the last two years the cash is never more than the next buy plus half (${early.map((y) => `${y.year}: ${y.cash} of ${y.next}`).join(', ')})`);
  const share = (y: YearRecord) => (100 * y.upkeep) / Math.max(1, CARGOS.reduce((a, g) => a + y.income[g], 0));
  const whole = (100 * ys.reduce((a, y) => a + y.upkeep, 0)) / Math.max(1, ys.reduce((a, y) => a + CARGOS.reduce((b, g) => b + y.income[g], 0), 0));
  // the tutorial runs two short single-purpose lines, which cost less to run than the mixed train it had, so its floor is lower
  const floor = sc.id === 'sawmill' ? 28 : 33;
  check(whole >= floor && whole <= 46, `${name}: running costs are ${whole.toFixed(0)} % of gross over the game (${floor} to 46), and ${ys.map((y) => `${y.year} ${share(y).toFixed(0)}`).join(', ')} year by year`);
  check(ys.every((y) => share(y) >= 25 && share(y) <= 60), `${name}: no year's running costs stray outside 25 to 60 % of gross`);
  const offers = bot.years.filter((y) => y.offered);
  check(offers.every((y) => !!MAKES[siteById(s, y.offered!.site).kind] === false || true) && offers.every((y) => TAKES[siteById(s, y.offered!.site).kind].includes(y.offered!.good) && s.sites.some((o) => MAKES[o.kind] === y.offered!.good)), `${name}: every contract on offer was for a good the map makes and a site that takes it (${offers.length} offers)`);
  check(bot.contractsDone >= 1, `${name}: the bot completes a contract (${bot.contractsDone} done, ${bot.contractsLost} lost, of ${bot.years.filter((y) => y.took).length} taken)`);
  check(bot.maxLoan > 0, `${name}: the bot borrows when a buy needs it (most owed ${bot.maxLoan}, ceiling at the start ${loanCeiling(createState(sc))})`);
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
// the advice: the first chain at the start, a stuck mill first once it holds flour with no line out
{
  const s = createState(HARJU);
  const a = advice(s);
  check(a.length === 1 && a[0].kind === 'first' && a[0].site === 'forest' && a[0].to === 'sawmill', `on Harju at the start the top advice is the first chain (${a.map((x) => `${x.kind} ${x.site}>${x.to}`).join(', ')})`);
  const g = goalTowns(s);
  check(g.length === 2 && g.every((x) => x.kind === 'town'), `the goal path names two towns at the start (${g.map((x) => x.id).join(', ')})`);
  const s2 = createState(HARJU);
  build(s2, plan(s2, cell(s2, 'forest'), cell(s2, 'sawmill'))[0]);
  s2.cash = 1400;
  siteById(s2, 'mill').stock = 20;
  const b = advice(s2);
  check(b.length <= 3 && b[0].kind === 'stuck' && b[0].site === 'mill' && !!b[0].to, `a mill full of flour with no line out comes first as stuck (${b.map((x) => `${x.kind} ${x.site}>${x.to}`).join(', ')})`);
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) advice(s2);
  check(performance.now() - t0 < 500, `advice is cheap (${((performance.now() - t0) / 50).toFixed(1)} ms a call)`);
}
play(SAWMILL);
const h = play(HARJU);
check(h.sites.filter((x) => x.kind === 'town' && x.size >= 3).length >= 2, `harju: two towns reached size 3 (${h.sites.filter((x) => x.kind === 'town').map((x) => `${x.id} ${x.size}`).join(', ')})`);
// three ways to win Harju: no plan is the one right answer
{
  const plans = { A: h, B: play(HARJU, false, Infinity, 'B'), C: play(HARJU, false, Infinity, 'C') };
  const served = (s: SimState, id: string) => s.lines.some((l) => l.stops.some((k) => s.stations.find((st) => st.id === k)?.siteId === id));
  // a plan that wins earlier has had less time to pile up worth, so the plans are compared at the end of 1866
  const worthAt = (k: string) => years[k === 'A' ? 'harju' : `harju-${k}`].find((y) => y.year === 1866)!.worth;
  const worths = Object.keys(plans).map(worthAt);
  const top = Math.max(...worths);
  const low = Math.min(...worths);
  check(top <= 1.35 * low, `the three plans stand within 35 % of each other in net worth at the end of 1866 (${Object.keys(plans).map((k) => `${k} ${worthAt(k)}, won in ${plans[k as 'A'].result!.year}`).join('; ')})`);
  check(Object.values(plans).every((s) => s.result!.won && s.result!.stars === 3 && s.result!.year >= 1867 && s.result!.year <= 1869), 'and each wins in 1867, 1868 or 1869 with three stars');
  const grown = (s: SimState) => s.sites.filter((x) => x.kind === 'town' && x.size >= 3).map((x) => x.id).sort().join('+');
  // contracts name sites that take a good, so the far town can be named; the two raw sites never are
  const named = new Set(Object.values(years).flatMap((ys) => ys.filter((y) => y.offered).map((y) => y.offered!.site)));
  check(named.has('lahti') && named.has('tampere'), `contracts name the far town as well as a near one across the three games (${[...named].join(', ')})`);
  check(grown(plans.A) === 'hameenlinna+tampere' && grown(plans.B) === 'lahti+tampere' && grown(plans.C) === 'lahti+tampere', `A grows Hämeenlinna and Tampere, B and C grow Tampere and Lahti (${Object.values(plans).map(grown).join(', ')})`);
  check(served(plans.A, 'forest') && !served(plans.A, 'korpela') && served(plans.A, 'farm') && !served(plans.A, 'niittyla') && !served(plans.A, 'lahti'), 'plan A runs Kuusikko and Peltola and never Korpela, Niittylä or Lahti');
  check(served(plans.B, 'korpela') && !served(plans.B, 'forest') && served(plans.B, 'niittyla') && !served(plans.B, 'farm') && served(plans.B, 'lahti'), 'plan B runs Korpela, Niittylä and Lahti and never Kuusikko or Peltola');
  check(served(plans.C, 'forest') && served(plans.C, 'farm') && served(plans.C, 'lahti') && !served(plans.C, 'korpela') && !served(plans.C, 'niittyla'), 'plan C runs Kuusikko, Peltola and Lahti: a mix of the other two');
}
// a track out of the end of a line never goes out over water or doubles back to satisfy the station's approach, and a line is lengthened only for a train that has something to do at the new stop
{
  const s = createState(HARJU);
  build(s, plan(s, cell(s, 'korpela'), cell(s, 'forest'))[0]);
  const log = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  const from = cell(s, 'sawmill');
  const to = cell(s, 'tampere');
  const routes = plan(s, from, to);
  const cheap = routes[0];
  // the straight line between the two stations crosses water or it does not; the route may bridge only when it does
  const a = { x: siteById(s, 'sawmill').cx, y: siteById(s, 'sawmill').cy };
  const b = { x: siteById(s, 'tampere').cx, y: siteById(s, 'tampere').cy };
  let wet = false;
  for (let k = 0; k <= 200; k++) {
    const x = Math.round(a.x + ((b.x - a.x) * k) / 200);
    const y = Math.round(a.y + ((b.y - a.y) * k) / 200);
    if (s.water[idx(s, x, y)]) wet = true;
  }
  check(!!cheap && (wet || cheap.bridge.length === 0), `Koskensaha to Tampere has no bridge where the straight line between them is dry (${cheap?.bridge.length} bridge cells, straight line wet: ${wet})`);
  check(!!cheap && !turnsBack(s, cheap.cells), 'and it never doubles back more than 90 degrees');
  // the log line's train carries timber: Tampere takes none of it, so the card offers a new line only
  buyTrain(s, log.id, ['flat', 'flat'], 'hilma');
  check(lengthenOptions(s, from, to).length === 0, 'a log train is not sent on to Tampere: the lengthening is not offered');
  // the Korpela line ends at Kuusikko; a timber train on it may be lengthened to the sawmill, which takes timber, and the card says which train runs on
  const s2 = createState(HARJU);
  const first = build(s2, plan(s2, cell(s2, 'korpela'), cell(s2, 'forest'))[0])!;
  check(lengthenOptions(s2, cell(s2, 'forest'), cell(s2, 'sawmill')).length === 0, 'with no train on the line there is nothing to lengthen it for');
  buyTrain(s2, first.id, ['flat', 'flat'], 'hilma');
  const ext = lengthenOptions(s2, cell(s2, 'forest'), cell(s2, 'sawmill'));
  check(ext.length === 1 && ext[0].line.id === first.id && ext[0].trains.length === 1, `a timber train may be lengthened to the sawmill, which takes timber, and the train that runs on is named (${ext.length} lines)`);
}
// the sensible player: the tips, one train a line, no loan, no siding, no crane. It wins in the last years and earns one or two stars
play(SAWMILL, false, Infinity, 'D');
play(HARJU, false, Infinity, 'D');
// a greedy plan, every coin into trains on the first line, ends 1866 with less net worth than the planned network
{
  play(HARJU, true, 1866);
  const planned = years.harju.find((y) => y.year === 1866);
  const greedy = years['harju-greedy'].find((y) => y.year === 1866);
  check(!!planned && !!greedy && greedy.worth < planned.worth, `the greedy bot ends 1866 with less net worth than the planned one (${greedy?.worth} against ${planned?.worth})`);
}

console.log(failed ? 'sim-check failed' : 'sim-check ok');
if (failed) throw new Error('sim-check failed');
