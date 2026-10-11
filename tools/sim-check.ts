/**
 * npm run sim-check: the rules of ADR 0007 asserted headless. Track, stations, catchment, trains,
 * pay, conversion, money, and the two bot plans: the careful one wins, the careless one loses.
 */
import { createState, siteById } from '../src/game/state';
import { SCENARIO_BY_ID } from '../src/game/content/scenarios';
import { idx, routeOptions, trackPath } from '../src/game/grid';
import {
  buildTrack, buildStation, buyTrain, step, stationBlock, removeTrack, pieceAt, issueBond, repayBond, canIssue, debt, accepts, acceptsAt,
  suppliesAt, setRoute, sellTrain, worth, quote, pay,
} from '../src/game/sim';
import { Bot, PLANS } from '../src/game/bot';
import { YEAR_SECONDS } from '../src/game/content/economy';
import type { SimState } from '../src/game/types';

declare const process: { exit: (n: number) => void };
let failed = 0;
function ok(cond: unknown, what: string): void {
  if (cond) console.log(`ok   ${what}`);
  else {
    failed++;
    console.log(`FAIL ${what}`);
  }
}
const run = (s: SimState, seconds: number) => {
  for (let t = 0; t < seconds * 60 && !s.result; t++) step(s);
};

// ---- track
{
  const s = createState(SCENARIO_BY_ID.harju);
  const a = idx(s, 5, 33);
  const b = idx(s, 27, 36);
  const t0 = performance.now();
  const opts = routeOptions(s, a, b);
  const ms = performance.now() - t0;
  ok(opts.length >= 1, 'a drag across Vanajavesi finds a route');
  ok(ms < 150, `the route search is quick (${ms.toFixed(0)} ms)`);
  const r = opts[0];
  ok(r.bridge.length > 0, 'the route bridges the lake');
  const cash = s.cash;
  ok(buildTrack(s, r), 'the route is built');
  ok(Math.abs(cash - s.cash - r.cost) < 1e-6, 'the build costs its price');
  ok(!!trackPath(s, a, b), 'a train finds its way over the new track');
  ok(stationBlock(s, a) === null && stationBlock(s, b) === null, 'a station fits at each end');
  const A = buildStation(s, a, 0)!;
  const B = buildStation(s, b, 0)!;
  ok(!buildStation(s, idx(s, 6, 33), 0), 'no station right beside another');
  ok(suppliesAt(s, A.cell, 0).logs! > 0, 'the forest station supplies logs');
  ok(accepts(s, B, 'logs') && !accepts(s, A, 'logs'), 'the sawmill station takes logs and the forest does not');
  ok(acceptsAt(s, idx(s, 13, 41), 1).includes('food'), 'a station by a town takes food');
  // a junction off the middle of the line, at 45 degrees, reaches open ground
  const mid = r.cells[Math.floor(r.cells.length / 2)];
  const spur = routeOptions(s, mid, idx(s, 20, 47));
  ok(spur.length >= 1, 'a spur leaves the middle of laid track');
  // a train runs, delivers and is paid
  const t = buyTrain(s, 'jyry', [{ station: A.id, cars: ['logs', 'logs', 'logs', 'logs'], waitFull: false }, { station: B.id, cars: [], waitFull: false }])!;
  ok(!!t, 'a train is bought');
  const before = s.book.revenue;
  run(s, 60);
  ok(s.book.revenue > before, `the train earns (${s.book.revenue.toFixed(0)}k in a minute)`);
  const saw = siteById(s, 'koskensaha');
  ok((saw.stock.lumber ?? 0) + (B.waiting.lumber ?? 0) + saw.madeMonth + saw.madeLast > 0, 'the sawmill turns delivered logs into lumber');
  // a piece of track removed: the train is lost until the track is back
  const piece = pieceAt(s, r.cells[5])!;
  ok(piece.cells.length > 5, 'a tap on track names the piece between its ends');
  removeTrack(s, r.cells[5]);
  run(s, 30);
  ok(t.state === 'lost' || t.state === 'stop', 'a train with no track waits');
  ok(setRoute(s, t.id, t.route), 'the route can be set again');
  ok(sellTrain(s, t.id) && s.trains.length === 0, 'a train is sold');
}

// ---- pay
{
  ok(pay('logs', 2, 10, 1) === 0, 'a haul shorter than the minimum pays nothing');
  ok(pay('pax', 30, 10, 1) > pay('pax', 30, 40, 1), 'a fast load pays more than a slow one');
  ok(pay('logs', 30, 20, 0.5) < pay('logs', 30, 20, 1), 'a glutted station pays less');
  const s = createState(SCENARIO_BY_ID.harju);
  const a = idx(s, 5, 33), b = idx(s, 27, 36);
  buildTrack(s, routeOptions(s, a, b)[0]);
  const A = buildStation(s, a, 0)!, B = buildStation(s, b, 0)!;
  ok(quote(s, 'logs', A, B) > 0, 'a quote is positive');
}

// ---- money
{
  const s = createState(SCENARIO_BY_ID.harju);
  const c0 = s.cash;
  ok(issueBond(s) && s.cash === c0 + 50, 'a bond adds its cash');
  ok(s.bonds[0].rate < 0.07, 'the first bond is cheap');
  issueBond(s);
  ok(s.bonds[1].rate > s.bonds[0].rate, 'each bond costs more interest');
  let n = 0;
  while (canIssue(s) && n < 50) (issueBond(s), n++);
  ok(!canIssue(s) && n < 50, 'the credit runs out');
  ok(repayBond(s), 'a bond is repaid');
  const d = debt(s);
  ok(d < 50 * (n + 2), 'repaying lowers the debt');
  ok(Math.abs(worth(s) - (s.cash - d)) < 1, 'with nothing built the worth is cash less debt');
}

// ---- the plans
for (const id of ['sawmill', 'harju']) {
  for (const which of ['careful', 'careless'] as const) {
    const sc = SCENARIO_BY_ID[id];
    const s = createState(sc);
    const bot = new Bot(PLANS[id][which]);
    const limit = (sc.goal.byYear - sc.startYear + 1.1) * YEAR_SECONDS;
    const t0 = performance.now();
    while (s.time < limit && !s.result) {
      bot.act(s);
      step(s);
    }
    const r = s.result;
    const wall = performance.now() - t0;
    if (which === 'careful') ok(r && r.won && r.tier >= 1, `${id}: the careful plan wins (tier ${r?.tier}, ${r?.reason} ${r?.year}, ${(wall / 1000).toFixed(1)} s)`);
    else ok(r && !r.won, `${id}: the careless plan loses (${r?.reason} ${r?.year}, worth ${r?.worth.toFixed(0)}k)`);
    if (which === 'careful') ok(!r || r.tier < 3 || r.year >= sc.goal.byYear - 1, `${id}: gold is not easy for the bot`);
  }
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all ok');
