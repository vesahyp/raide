/**
 * npm run sim-check: the rules asserted headless (ADR 0005, ADR 0006). The bot plays both scenarios
 * and must win them in the time the design asks; the first paid delivery lands inside 90 s; every
 * line owns its track; one more train adds loads until the pile is the limit; trains of a line keep
 * their gap and never stand on each other; growth never goes back; the pick holds the game; undo
 * and lifting give cash back.
 */
import { createState, siteById } from '../src/game/state';
import { SAWMILL, HARJU } from '../src/game/content/scenarios';
import { step, plan, build, undo, buyTrain, DT, drawnLength, lineYear, liftLine, takePick, lineGood, stopSite, growFrac, addWagon, expandSite } from '../src/game/sim';
import { idx, APPROACH, cx, cy } from '../src/game/grid';
import { Bot } from './bot';
import { FOLLOW_GAP, PICK_SECONDS, YEAR_SECONDS } from '../src/game/content/economy';
import type { SimState } from '../src/game/types';

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
const cell = (s: SimState, id: string) => idx(s, siteById(s, id).cx, siteById(s, id).cy);

// building and undo, on the sawmill map
{
  const s = createState(SAWMILL);
  const r1 = plan(s, cell(s, 'forest'), cell(s, 'sawmill'));
  check(r1.length >= 1, `forest to sawmill can be built (${r1[0]?.cells.length} cells, cost ${r1[0]?.cost})`);
  check(plan(s, cell(s, 'forest'), cell(s, 'town')).length === 0, 'a line between two sites that trade nothing is never offered');
  const line = build(s, r1[0])!;
  check(!!line && s.stations.length === 2 && s.lines.length === 1, 'the build places the station and the line');
  check(plan(s, cell(s, 'forest'), cell(s, 'sawmill')).length === 0, 'a second line between the same stations is never offered');
  const r2 = plan(s, cell(s, 'sawmill'), cell(s, 'town'));
  check(r2.length >= 1 && r2[0].bridge.length >= 1, `sawmill to town crosses the river on a bridge (${r2[0]?.bridge.length} bridge cells, cost ${r2[0]?.cost})`);
  const cash = s.cash;
  build(s, r2[0]);
  check(Math.abs(s.cash - (cash - r2[0].cost)) < 1e-6, 'the build is paid');
  check(undo(s), 'the build can be taken back inside its second');
  check(Math.abs(s.cash - cash) < 1e-6 && s.lines.length === 1 && s.stations.length === 2, 'undo refunds the cash and removes the track, the station and the line');
  check(s.track.reduce((a, m, i) => a + (m && !line.path.includes(i) ? 1 : 0), 0) === 0, 'undo leaves no track behind');
  s.cash = 9999;
  const t = buyTrain(s, line.id);
  check(!!t && s.trains.length === 1 && t.wagons.every((w) => w === 'flat'), 'a train is bought with the wagons of what the line carries');
  check(!liftLine(s, line.id), 'a line with a train cannot be lifted');
}

// every line owns its track: two lines share a cell only at a station's approach or in a level crossing
function ownTrack(s: SimState): { ok: boolean; why: string } {
  const approach = new Set<number>();
  for (const st of s.stations) for (let d = -APPROACH; d <= APPROACH; d++) approach.add(st.cell + d);
  for (const a of s.lines)
    for (const b of s.lines) {
      if (a.id >= b.id) continue;
      const mine = new Set(a.path);
      for (const c of b.path) {
        if (!mine.has(c) || approach.has(c)) continue;
        const k = a.path.indexOf(c);
        const j = b.path.indexOf(c);
        if (k <= 0 || j <= 0 || k >= a.path.length - 1 || j >= b.path.length - 1) return { ok: false, why: `lines ${a.id} and ${b.id} share an end cell ${c}` };
        const dir = (p: number[], i: number) => [cx(s, p[i + 1]) - cx(s, p[i - 1]), cy(s, p[i + 1]) - cy(s, p[i - 1])];
        const [ax, ay] = dir(a.path, k);
        const [bx, by] = dir(b.path, j);
        if (ax * by - ay * bx === 0) return { ok: false, why: `lines ${a.id} and ${b.id} run along each other at ${c}` };
      }
    }
  return { ok: true, why: '' };
}

/** the bot plays a scenario to its end, with the invariants watched at every step */
function play(sc: typeof HARJU) {
  const s = createState(sc);
  const bot = Bot.for(s);
  const limit = (sc.goal.beforeYear - sc.startYear) * YEAR_SECONDS + 10;
  let overlap = '';
  let doubled = '';
  let shrank = '';
  let heldOk = true;
  let firstPick = -1;
  let firstTrain = -1;
  const last = new Map(s.sites.map((x) => [x.id, x.size + growFrac(x)]));
  for (let t = 0; t < limit && !s.result; t += DT) {
    if (s.pick && firstPick < 0) firstPick = s.time;
    if (s.pick) {
      // the pick holds the game: a step does nothing until it is taken
      const was = s.time;
      step(s);
      if (s.time !== was) heldOk = false;
    }
    bot.act(s);
    if (firstTrain < 0 && s.trains.length) firstTrain = s.time;
    step(s);
    for (const a of s.trains)
      for (const b of s.trains) {
        if (a.id >= b.id || a.lineId !== b.lineId) continue;
        if (a.state === 'stop' && b.state === 'stop' && a.idx === b.idx && !doubled) doubled = `trains ${a.id} and ${b.id} stand at one platform at ${s.time.toFixed(1)} s`;
        if (a.dir !== b.dir || a.state === 'stop' || b.state === 'stop') continue;
        const room = Math.abs(a.s - b.s) - (drawnLength(a) + drawnLength(b)) / 2;
        if (room < FOLLOW_GAP - 0.05 && !overlap) overlap = `trains ${a.id} and ${b.id} ${room.toFixed(2)} tiles apart at ${s.time.toFixed(1)} s`;
      }
    for (const x of s.sites) {
      const v = x.size + growFrac(x);
      if (v < last.get(x.id)! - 1e-9 && !shrank) shrank = `${x.id} went from ${last.get(x.id)!.toFixed(3)} to ${v.toFixed(3)}`;
      last.set(x.id, v);
    }
  }
  return { s, bot, overlap, doubled, shrank, heldOk, firstPick, firstTrain };
}

for (const sc of [SAWMILL, HARJU]) {
  const r = play(sc);
  const { s } = r;
  check(!!s.result?.won, `the bot wins ${sc.id} (${s.result ? `${s.result.won ? 'won' : 'lost'} ${s.result.year} at ${s.result.time.toFixed(0)} s` : 'no result'})`);
  check(s.firstPayAt !== null && s.firstPayAt < 90, `${sc.id}: the first paid delivery lands inside 90 s (${s.firstPayAt?.toFixed(0)} s)`);
  check(!r.overlap, `${sc.id}: running trains of a line in one direction keep their gap${r.overlap ? `: ${r.overlap}` : ''}`);
  check(!r.doubled, `${sc.id}: no two trains of a line stand at one platform${r.doubled ? `: ${r.doubled}` : ''}`);
  check(!r.shrank, `${sc.id}: no town loses growth${r.shrank ? `: ${r.shrank}` : ''}`);
  check(r.heldOk, `${sc.id}: the pick holds the game until it is taken`);
  check(r.firstPick >= 0 && Math.abs(r.firstPick - r.firstTrain - PICK_SECONDS) < 1, `${sc.id}: the first pick comes ${PICK_SECONDS} s after the first train (${(r.firstPick - r.firstTrain).toFixed(1)} s)`);
  const own = ownTrack(s);
  check(own.ok, `${sc.id}: every line owns its track, crossing others only at an angle${own.why ? `: ${own.why}` : ''}`);
  check(s.trains.every((t) => t.trips > 0), `${sc.id}: every train has made a trip (${s.trains.map((t) => t.trips).join(', ')})`);
  if (sc === HARJU) {
    const t = s.result?.time ?? Infinity;
    check(t >= 180 && t <= 840, `harju: the bot's win takes 3 to 14 minutes (the human-like run is the measure) (${(t / 60).toFixed(1)} min)`);
  }
}

// one more train adds loads, until the pile is the limit
{
  const s = createState(HARJU);
  s.cash = 1e5;
  const line = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  buyTrain(s, line.id);
  const one = lineYear(s, line).loads;
  const two = lineYear(s, line, { engine: 'hilma', wagons: 2 }).loads;
  check(two > one + 0.3, `a second train adds loads on a line (${one.toFixed(1)} to ${two.toFixed(1)} a minute)`);
  for (let i = 0; i < 5; i++) buyTrain(s, line.id);
  const many = lineYear(s, line);
  check(many.limit === 'supply', `with six trains the forest is the limit, and the card can say so (${many.loads.toFixed(1)} a minute)`);
  // six trains on one line run for two minutes, and they deliver
  for (let t = 0; t < 120; t += DT) {
    step(s);
    if (s.pick) takePick(s, 0);
  }
  const g = lineGood(s, line)!;
  check(stopSite(s, line, g.to).delivered > 0, `the trains deliver with six on the line (${stopSite(s, line, g.to).delivered} loads)`);
  check(addWagon(s, s.trains[0].id) || s.trains[0].nWagons >= 3, 'a wagon can be added up to the limit');
}

// on Harju every link the goal needs can be built in any order: own track never walls a town off
{
  const all = ['sawmill-hameenlinna', 'sawmill-lahti', 'sawmill-tampere', 'mill-lahti', 'mill-hameenlinna', 'mill-tampere'];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let bad = '';
  for (let k = 0; k < 120 && !bad; k++) {
    const s = createState(HARJU);
    s.cash = 1e6;
    const mode = rnd() < 0.5 ? 'cheap' : 'short';
    for (const p of ['forest-sawmill', 'farm-mill', ...all.slice().sort(() => rnd() - 0.5)]) {
      const [a, b] = p.split('-');
      const o = plan(s, cell(s, a), cell(s, b));
      if (!o.length) {
        bad = `${p} after ${s.lines.length} lines (${mode})`;
        break;
      }
      build(s, o.find((x) => x.mode === mode) ?? o[0]);
    }
  }
  check(!bad, `harju: the eight links the goal needs build in any of 120 orders${bad ? `: ${bad} is walled off` : ''}`);
}

// expanding a forest makes the line carry more when the forest is the limit
{
  const s = createState(HARJU);
  s.cash = 1e5;
  const line = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  for (let i = 0; i < 4; i++) buyTrain(s, line.id);
  const before = lineYear(s, line);
  check(expandSite(s, 'forest') && siteById(s, 'forest').level === 1, 'a forest can be expanded from its card');
  const after = lineYear(s, line);
  check(before.limit === 'supply' && after.loads > before.loads + 1, `the expansion lifts what four trains carry (${before.loads.toFixed(1)} to ${after.loads.toFixed(1)} a minute)`);
  check(!expandSite(s, 'sawmill'), 'a sawmill is not expanded');
}

// lifting a line gives half its track back
{
  const s = createState(SAWMILL);
  const line = build(s, plan(s, cell(s, 'forest'), cell(s, 'sawmill'))[0])!;
  s.lastBuild = null;
  const cash = s.cash;
  check(liftLine(s, line.id) && s.cash > cash && s.lines.length === 0 && s.track.every((m) => m === 0), 'a line with no trains is lifted, its track goes and cash comes back');
}

if (failed) {
  console.log('sim-check FAILED');
  (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
}
console.log('sim-check passed');
