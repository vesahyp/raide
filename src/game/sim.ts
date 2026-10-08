/**
 * The simulation: the one authority on money, goods, trains and blocks.
 * Headless: nothing here touches the DOM. Sounds are names pushed onto
 * `state.sounds`; the game loop drains them. The step is fixed (DT) and the
 * sim holds while a year-end card waits for its choice or the scenario is
 * over. The player's moves are the exported functions below; the UI and
 * the bot call the same ones.
 */
import type { Cargo, Contract, EngineId, Fare, Good, LastBuild, Leg, Line, Load, SimState, Site, SiteKind, Train, WagonType, Float } from './types';
import { CARGOS, FARES, GOODS } from './types';
import { routeOptions, link, unlink, idx, cx, cy, stepLen, gradeOf, DIRS, STATION_COST, type Route } from './grid';
import { siteAt, stationAt, siteById, goodsOnMap, zeroCargo } from './state';
import {
  BANKRUPT_YEARS, BASE_FARE, BASE_PRICE, FARE_DECAY, FARE_FLOOR, FARE_SPEED, MAIL_CAP, MAIL_RATE, PAX_CAP, PAX_GROW_SIZE, PAX_MEMORY, PAX_RATE, WAGON_FARE, BRIDGE_UPKEEP, CELL_M, DEMAND_FILL, DEMAND_FLOOR, DIST_BONUS, DIST_CAP, ENGINES, ENGINE_LEN, GRADE_LOAD, GRADE_MAX, CREW_CUT, CREW_PRICE, GROW_LOSS, GROW_MONTHS, LIFT_BACK, LOAN_BASE, LOAN_RATE, LOAN_SHARE, MAKES, MILL_EATS, MONTHS,
  CONTRACT_MAX, CONTRACT_MIN, CONTRACT_MONTHS, CONTRACT_PACE, CONTRACT_SHARE, CRANE_CUT, CRANE_GOODS, CRANE_PRICE, CRANE_SITES, SIDING_FROM_STATION, GATE_RESERVE, SIDING_GAP, SIDING_LEN, SIDING_MEET, SIDING_PRICE, SIDING_WAIT, SIDING_OFFSET, PLATFORM_PRICE, PLATFORMS_START, QUEUE_GAP, RAW_CAP, RAW_RATE, RESALE, SERVED_MEMORY, SERVED_RATE, PATIENCE_SECONDS, STOP_SECONDS, TAKES, TOWN_EATS, EAT_GROWTH, TOWN_MAX, TOWN_STORE_CAP, TRACK_UPKEEP, UNDO_SECONDS,
  LINE_STOPS_MAX, WAGON_DWELL, WAGON_GOODS, WAGON_LEN, WAGON_PRICE, WAGON_RUN, WAGONS_DEFAULT, WAGONS_MAX, YEAR_SECONDS,
} from './content/economy';

export const DT = 1 / 60;

/** the world position of a cell's centre, in cells */
export function centre(s: { w: number }, i: number): { x: number; y: number } {
  return { x: cx(s, i) + 0.5, y: cy(s, i) + 0.5 };
}

/** a point a distance along a line's path, and the direction of the path there */
export function along(line: Line, d: number, w: number): { x: number; y: number; dx: number; dy: number } {
  const n = line.path.length;
  const end = line.dist[n - 1];
  d = Math.max(0, Math.min(end, d));
  let k = 1;
  while (k < n - 1 && line.dist[k] < d) k++;
  const a = centre({ w }, line.path[k - 1]);
  const b = centre({ w }, line.path[k]);
  const seg = line.dist[k] - line.dist[k - 1];
  const t = seg > 0 ? (d - line.dist[k - 1]) / seg : 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
}

/** the cell under a distance along the path */
export function cellAlong(line: Line, d: number): number {
  const n = line.path.length;
  let k = 0;
  while (k < n - 1 && line.dist[k + 1] <= d) k++;
  return line.path[k];
}

/** the distance along the path of a stop of the line */
export function stopS(line: Line, i: number): number {
  return line.dist[line.stopAt[i]];
}

/** the station cell of a stop of the line */
export function stopCell(line: Line, i: number): number {
  return line.path[line.stopAt[i]];
}

/** the kind of site a stop of the line stands at */
function stopKind(s: SimState, line: Line, i: number): SiteKind {
  const st = s.stations.find((o) => o.id === line.stops[i])!;
  return siteById(s, st.siteId).kind;
}

/** the site a stop of the line stands at */
export function stopSite(s: SimState, line: Line, i: number): Site {
  const st = s.stations.find((o) => o.id === line.stops[i])!;
  return siteById(s, st.siteId);
}

/** whether a stop other than `except` takes the good */
function takenElsewhere(s: SimState, line: Line, good: Good, except: number): boolean {
  return line.stops.some((_, j) => j !== except && TAKES[stopKind(s, line, j)].includes(good));
}

/** whether a stop of the line is a town */
function stopIsTown(s: SimState, line: Line, i: number): boolean {
  return stopKind(s, line, i) === 'town';
}

/** the indexes of the stops of a line that are towns: where travellers and mail get on and off */
export function townStops(s: SimState, line: Line): number[] {
  return line.stops.map((_, i) => i).filter((i) => stopIsTown(s, line, i));
}

/**
 * What a wagon of this type carries on this line: for each good it can hold that some stop makes
 * and another takes, the stop it loads at and the nearest stop that takes it. A coach or a mail van
 * carries between the first and the last town on the line. An empty list means the wagon is a waste
 * on this line.
 */
export function wagonRoutes(s: SimState, line: Line, type: WagonType): { good: Cargo; from: number; to: number }[] {
  const out: { good: Cargo; from: number; to: number }[] = [];
  const fare = WAGON_FARE[type];
  if (fare) {
    const towns = townStops(s, line);
    if (towns.length >= 2) out.push({ good: fare, from: towns[0], to: towns[towns.length - 1] });
    return out;
  }
  for (let i = 0; i < line.stops.length; i++) {
    const good = MAKES[stopKind(s, line, i)];
    if (!good || !WAGON_GOODS[type].includes(good)) continue;
    let to = -1;
    for (let j = 0; j < line.stops.length; j++) if (j !== i && TAKES[stopKind(s, line, j)].includes(good) && (to < 0 || Math.abs(j - i) < Math.abs(to - i))) to = j;
    if (to >= 0) out.push({ good, from: i, to });
  }
  return out;
}

/** whether a wagon of this type has nothing to carry anywhere on the line */
export function wagonWaste(s: SimState, line: Line, type: WagonType): boolean {
  return wagonRoutes(s, line, type).length === 0;
}

/** the wagons of a train that are a waste on its line, counted from the front */
export function wasteWagons(s: SimState, t: Train): number[] {
  const line = lineOf(s, t);
  return t.wagons.map((w, i) => (wagonWaste(s, line, w) ? i : -1)).filter((i) => i >= 0);
}

const WAGON_TYPES: WagonType[] = ['flat', 'box', 'hopper', 'coach', 'mailvan'];

/** the wagon types that carry something on the line, in the order of the stops they load at; coaches and mail vans last */
export function carryingTypes(s: SimState, line: Line): WagonType[] {
  const out: WagonType[] = [];
  for (let i = 0; i < line.stops.length; i++) {
    const good = MAKES[stopKind(s, line, i)];
    if (!good) continue;
    for (const w of WAGON_TYPES) if (WAGON_GOODS[w].includes(good) && !wagonWaste(s, line, w) && !out.includes(w)) out.push(w);
  }
  for (const w of WAGON_TYPES) if (WAGON_FARE[w] && !wagonWaste(s, line, w) && !out.includes(w)) out.push(w);
  return out;
}

/**
 * The consist a new train starts with: each type that carries something on the line, WAGONS_DEFAULT
 * of it (one mail van, the post is lighter than the people), kept within WAGONS_MAX, grouped by type.
 * Forest, sawmill, town gives two flat, two box; two towns two coaches and a mail van.
 */
export function defaultConsist(s: SimState, line: Line): WagonType[] {
  const types = carryingTypes(s, line);
  if (!types.length) return Array(WAGONS_DEFAULT).fill('box');
  const want = types.map((w) => (w === 'mailvan' ? 1 : WAGONS_DEFAULT));
  const total = Math.min(WAGONS_MAX, want.reduce((a, b) => a + b, 0));
  const count = types.map(() => 0);
  for (let n = 0, k = 0; n < total; k++) {
    const i = k % types.length;
    if (count[i] < want[i]) {
      count[i]++;
      n++;
    }
  }
  return types.flatMap((w, i) => Array<WagonType>(count[i]).fill(w));
}

/** a consist from a count of wagons: the line's first carrying type that many times */
function consistOf(s: SimState, line: Line, wagons: number | WagonType[]): WagonType[] {
  if (Array.isArray(wagons)) return wagons;
  return Array<WagonType>(wagons).fill(carryingTypes(s, line)[0] ?? 'box');
}

/** the rail's height in metres at a distance along the path */
export function railAlong(line: Line, d: number): number {
  const n = line.path.length;
  const end = line.dist[n - 1];
  d = Math.max(0, Math.min(end, d));
  let k = 1;
  while (k < n - 1 && line.dist[k] < d) k++;
  const seg = line.dist[k] - line.dist[k - 1];
  const t = seg > 0 ? (d - line.dist[k - 1]) / seg : 0;
  return line.rail[k - 1] + (line.rail[k] - line.rail[k - 1]) * t;
}

/** the grade under a distance along the path, in percent, positive uphill in the direction given */
export function gradeAlong(line: Line, d: number, dir: 1 | -1): number {
  const n = line.path.length;
  let k = 1;
  while (k < n - 1 && line.dist[k] < d) k++;
  const seg = line.dist[k] - line.dist[k - 1];
  return seg > 0 ? dir * gradeOf(line.rail[k] - line.rail[k - 1], seg) : 0;
}

/**
 * Seconds a train with this engine and load takes from one end of the line to the other, by
 * the grade of every step; `dir` 1 runs from stop 0 to stop 1. The stop at the end is not in it.
 */
export function tripTime(s: SimState, line: Line, engine: EngineId, cargo: number, dir: 1 | -1): number {
  return railTime(s, line.rail, line.dist, engine, cargo, dir);
}

/** the seconds over a rail profile: every step at the engine's speed on its grade, shared by built lines and planned routes */
function railTime(_s: SimState, rail: number[], dist: number[], engine: EngineId, cargo: number, dir: 1 | -1): number {
  const base = ENGINES[engine].speed;
  let t = 0;
  for (let k = 1; k < rail.length; k++) {
    const seg = dist[k] - dist[k - 1];
    const g = dir * gradeOf(rail[k] - rail[k - 1], seg);
    t += seg / (base * gradeFactor(engine, g, cargo));
  }
  return t;
}

/**
 * Round trips a year an engine would make on a planned route: loaded one way (the slower way,
 * so the number is a floor), empty back, and both stops. The same grades as tripTime.
 */
export function routeTrips(s: SimState, r: Route, engine: EngineId, wagons = WAGONS_DEFAULT): number {
  const dist = pathDist(s, r.cells);
  const back = railTime(s, r.rail, dist, engine, 0, -1);
  const out = railTime(s, r.rail, dist, engine, 0, 1);
  const loadedUp = railTime(s, r.rail, dist, engine, wagons, 1) + back;
  const loadedDown = railTime(s, r.rail, dist, engine, wagons, -1) + out;
  return YEAR_SECONDS / (Math.max(loadedUp, loadedDown) + 2 * STOP_SECONDS + 2 * wagons * WAGON_DWELL);
}

/** one round trip of a consist on a line, worked through stop by stop with every pile full */
export interface Cycle {
  /** per leg, the seconds running it forward and back, with the loads the train carries then */
  legs: { out: number; back: number }[];
  /** per stop, the seconds standing there in a round trip: the stop itself and every wagon unloaded or loaded */
  stands: number[];
  /** loads delivered in a round trip */
  loads: number;
  /** seconds for the whole round trip */
  total: number;
}

/**
 * A round trip of a consist, as the sim plays it: the train visits the stops 0, 1, ... last, ..., 1,
 * and at each visit every wagon unloads what the stop takes, then every empty wagon loads what the
 * stop makes if some other stop takes it. The cargo on each leg sets the speed on the grades. Run
 * twice so the second pass shows the steady state, with wagons loaded on the way back.
 */
export function consistCycle(s: SimState, line: Line, engine: EngineId, wagons: WagonType[]): Cycle {
  const n = line.stops.length;
  const seq: number[] = [];
  for (let i = 0; i < n; i++) seq.push(i);
  for (let i = n - 2; i >= 1; i--) seq.push(i);
  const loads: (Cargo | null)[] = wagons.map(() => null);
  // the stop a coach or a van boarded at, so it gets off at the next town
  const origin: number[] = wagons.map(() => -1);
  const legs = Array.from({ length: n - 1 }, () => ({ out: 0, back: 0 }));
  const stands: number[] = Array(n).fill(0);
  let moved = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let q = 0; q < seq.length; q++) {
      const i = seq[q];
      const kind = stopKind(s, line, i);
      const cell = stopCell(line, i);
      const j = seq[(q + 1) % seq.length];
      const dir = j > i ? 1 : -1;
      let work = 0;
      for (let w = 0; w < loads.length; w++) {
        const g = loads[w];
        if (!g) continue;
        const gets = FARES.includes(g as Fare) ? kind === 'town' && origin[w] !== i : TAKES[kind].includes(g as Good);
        if (!gets) continue;
        work += dwellAt(s, cell, g);
        loads[w] = null;
        if (pass === 1) moved++;
      }
      const make = MAKES[kind];
      if (make && takenElsewhere(s, line, make, i))
        for (let w = 0; w < loads.length; w++)
          if (!loads[w] && WAGON_GOODS[wagons[w]].includes(make)) {
            work += dwellAt(s, cell, make);
            loads[w] = make;
          }
      // a coach or a van takes on travellers or mail at a town when another town lies ahead on the way
      if (kind === 'town' && line.stops.some((_, k) => k !== i && stopIsTown(s, line, k) && (dir === 1 ? k > i : k < i)))
        for (let w = 0; w < loads.length; w++) {
          const fare = WAGON_FARE[wagons[w]];
          if (!loads[w] && fare) {
            work += dwellAt(s, cell, fare);
            loads[w] = fare;
            origin[w] = i;
          }
        }
      if (pass === 1) stands[i] += STOP_SECONDS + work;
      const leg = Math.min(i, j);
      const a = line.stopAt[leg];
      const b = line.stopAt[leg + 1];
      const t = railTime(s, line.rail.slice(a, b + 1), line.dist.slice(a, b + 1), engine, loads.filter(Boolean).length, dir);
      if (pass === 1) legs[leg][dir === 1 ? 'out' : 'back'] += t;
    }
  }
  const total = legs.reduce((a, l) => a + l.out + l.back, 0) + stands.reduce((a, x) => a + x, 0);
  return { legs, stands, loads: moved, total };
}

/**
 * Round trips a year an engine makes on a built line, by the cycle of its consist: the wagons
 * given, or a count of the line's first carrying type.
 */
export function lineTrips(s: SimState, line: Line, engine: EngineId, wagons: number | WagonType[] = WAGONS_DEFAULT): number {
  return YEAR_SECONDS / consistCycle(s, line, engine, consistOf(s, line, wagons)).total;
}

/**
 * Round trips a year that a line's trains make together, with one more train of this kind when
 * `extra` is given: each train's free-running trips, cut by the shared blocks (one train on a
 * leg's block at a time) and by the platforms at every stop (one train at a time on each). A train
 * the line has no platform for makes none. This is the number the buy card shows, so an extra train
 * that only queues shows as nothing added.
 */
export function lineYear(s: SimState, line: Line, extra?: { engine: EngineId; wagons: number | WagonType[] }, withSiding = false): { trips: number; each: number[]; limit: 'free' | 'block' | 'platform' | 'parked'; /** the station that holds the line back, for the platform and parked limits */ at: number } {
  const mine = s.trains.filter((o) => o.lineId === line.id).map((o) => ({ t: o as Train | null, engine: o.engine, wagons: o.wagons, parked: o.parked }));
  if (extra) mine.push({ t: null, engine: extra.engine, wagons: consistOf(s, line, extra.wagons), parked: mine.filter((m) => !m.parked).length >= lineCapacity(s, line) });
  // a passing siding: the block is two blocks, split where the loop lies, and two trains meet there, one waiting while the other passes
  const siding = !!line.siding || withSiding;
  const split = line.siding ? (line.siding.s0 + line.siding.s1) / 2 / line.dist[line.dist.length - 1] : 0.5;
  const meets = siding && mine.filter((m) => !m.parked).length > 1;
  const free = (l: Line, e: EngineId, w: WagonType[]) => {
    const c = consistCycle(s, l, e, w);
    // the meeting costs the train that waits for the other to pass the points
    const wait = meets && l === line ? SIDING_MEET : 0;
    return { c, f: YEAR_SECONDS / (c.total + wait) };
  };
  const active = mine.filter((m) => !m.parked).map((m) => ({ ...m, ...free(line, m.engine, m.wagons) }));
  // the other trains that use the same blocks, and the same stations, at their free pace
  const others = s.trains.filter((o) => o.lineId !== line.id && !o.parked).map((o) => ({ line: lineOf(s, o), ...free(lineOf(s, o), o.engine, o.wagons) }));
  const leg = (c: Cycle, k: number) => c.legs[k].out + c.legs[k].back;
  const legLoad = line.legs.map((lg, k) => {
    const own = active.reduce((a, m) => a + m.f * leg(m.c, k), 0);
    const shared = others.reduce((a, o) => a + o.line.legs.reduce((b, og, ko) => b + (legsShare(og, lg) ? o.f * leg(o.c, ko) : 0), 0), 0);
    return (siding ? Math.max(split, 1 - split) * own : own) + shared;
  });
  const blockLoad = Math.max(0, ...legLoad);
  const cells = line.stops.map((_, i) => stopCell(line, i));
  const berth = cells.map((cell, i) => {
    const load = active.reduce((a, m) => a + m.f * m.c.stands[i], 0) + others.reduce((a, o) => a + o.line.stops.reduce((b, _, j) => b + (stopCell(o.line, j) === cell ? o.f * o.c.stands[j] : 0), 0), 0);
    return load > 0 ? (platformsAt(s, cell) * YEAR_SECONDS) / load : Infinity;
  });
  const byBlock = blockLoad > 0 ? YEAR_SECONDS / blockLoad : Infinity;
  const byBerth = Math.min(...berth);
  const k = Math.min(1, byBlock, byBerth);
  const limit = k >= 1 ? 'free' : byBlock <= byBerth ? 'block' : 'platform';
  const each = mine.map((m) => (m.parked ? 0 : k * free(line, m.engine, m.wagons).f));
  const parked = mine.some((m) => m.parked);
  // the stop with the fewest platforms, or the one the trains crowd most
  const fewest = cells.reduce((best, c) => (platformsAt(s, c) < platformsAt(s, best) ? c : best), cells[0]);
  const tight = cells[berth.indexOf(byBerth)];
  const at = parked ? fewest : tight;
  return { trips: each.reduce((a, b) => a + b, 0), each, limit: parked && limit === 'free' ? 'parked' : limit, at };
}

/** what a train costs to run for a year at this many round trips on a line: the tiles it covers, and the engine's upkeep */
export function runningCostYear(line: Line, engine: EngineId, wagons: number, trips: number): number {
  return trips * 2 * line.dist[line.dist.length - 1] * runPerTile(engine, wagons) + ENGINES[engine].upkeep;
}

/** what one tile run costs a train of this engine and wagon count */
export function runPerTile(engine: EngineId, wagons: number): number {
  return ENGINES[engine].runCost + WAGON_RUN * wagons;
}

/**
 * Seconds one wagon takes to unload or to load at a station: a loading crew takes a third off, and
 * a crane halves what is left for timber, boards and grain. `good` is the good being moved; without
 * it only the crew counts.
 */
export function dwellAt(s: SimState, cell: number, good?: Cargo | null): number {
  const st = s.stations.find((o) => o.cell === cell);
  const crane = !!st?.crane && !!good && CRANE_GOODS.includes(good as Good);
  return WAGON_DWELL * (st?.crew ? 1 - CREW_CUT : 1) * (crane ? 1 - CRANE_CUT : 1);
}

/** the good that moves at a stop of a line: what the stop loads for another stop, or what it unloads from another */
export function stopGood(s: SimState, line: Line, i: number): Good | null {
  const kind = stopKind(s, line, i);
  const makes = MAKES[kind];
  if (makes && takenElsewhere(s, line, makes, i)) return makes;
  for (let j = 0; j < line.stops.length; j++) {
    const theirs = j === i ? null : MAKES[stopKind(s, line, j)];
    if (theirs && TAKES[kind].includes(theirs)) return theirs;
  }
  return null;
}

/** the good that moves at one end of a line */
export function endGood(s: SimState, line: Line, end: 0 | 1): Good | null {
  return stopGood(s, line, end === 0 ? 0 : line.stops.length - 1);
}

/** the stations that can have a crane: an industry's, with the loading crew bought */
export function craneSite(s: SimState, stationId: number): boolean {
  const st = s.stations.find((o) => o.id === stationId);
  return !!st && CRANE_SITES.includes(siteById(s, st.siteId).kind);
}

/** Buy the crane at an industry's station that has the crew: timber, boards and grain take half the time there. */
export function buyCrane(s: SimState, stationId: number): boolean {
  const st = s.stations.find((o) => o.id === stationId);
  if (!st || st.crane || !st.crew || !craneSite(s, stationId) || s.cash < CRANE_PRICE) return false;
  s.cash -= CRANE_PRICE;
  s.assets += CRANE_PRICE;
  st.crane = true;
  const p = centre(s, st.cell);
  s.floats.push({ x: p.x, y: p.y, text: `-${CRANE_PRICE}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return true;
}

/**
 * The stretches of a line where a passing siding can lie: straight, dry, not a junction, with room
 * for the loop beside the track, and SIDING_FROM_STATION tiles from either station. Each is a span of
 * distances along the path that the whole loop must lie inside, and the side of the track it lies on.
 */
export function sidingSpans(s: SimState, line: Line): { d0: number; d1: number; nx: number; ny: number }[] {
  // a siding lies on a two-stop line only: with a middle stop the points would meet its platforms
  if (line.stops.length > 2) return [];
  const n = line.path.length;
  const end = line.dist[n - 1];
  const out: { d0: number; d1: number; nx: number; ny: number }[] = [];
  const step = (k: number): [number, number] => [cx(s, line.path[k + 1]) - cx(s, line.path[k]), cy(s, line.path[k + 1]) - cy(s, line.path[k])];
  const links = (c: number): number => {
    let m = s.track[c];
    let k = 0;
    while (m) {
      k += m & 1;
      m >>= 1;
    }
    return k;
  };
  let k = 0;
  while (k < n - 1) {
    const [dx, dy] = step(k);
    let j = k;
    while (j + 1 < n - 1 && step(j + 1)[0] === dx && step(j + 1)[1] === dy) j++;
    // the cells k..j+1 run in one direction
    const len = Math.hypot(dx, dy);
    const base: [number, number] = [-dy / len, dx / len];
    const sides: [number, number][] = base[1] > 1e-9 || (Math.abs(base[1]) < 1e-9 && base[0] > 0) ? [base, [-base[0], -base[1]]] : [[-base[0], -base[1]], base];
    for (const [nx, ny] of sides) {
      let from = -1;
      for (let m = k; m <= j + 2; m++) {
        let ok = m <= j + 1;
        if (ok) {
          const c = line.path[m];
          const sx = Math.floor(cx(s, c) + 0.5 + nx * SIDING_OFFSET);
          const sy = Math.floor(cy(s, c) + 0.5 + ny * SIDING_OFFSET);
          ok = !s.water[c] && s.yardMask[c] === 0 && links(c) <= 2 && !stationAt(s, c) && sx >= 0 && sy >= 0 && sx < s.w && sy < s.h && !s.water[idx(s, sx, sy)] && s.track[idx(s, sx, sy)] === 0 && s.yardMask[idx(s, sx, sy)] === 0;
        }
        if (ok && from < 0) from = m;
        if (!ok && from >= 0) {
          const d0 = Math.max(line.dist[from], SIDING_FROM_STATION);
          const d1 = Math.min(line.dist[m - 1], end - SIDING_FROM_STATION);
          if (d1 - d0 >= SIDING_LEN) out.push({ d0, d1, nx, ny });
          from = -1;
        }
      }
    }
    k = j + 1;
  }
  return out;
}

/** the span a tap at a cell of the line falls in, or the longest span without one: where the loop goes, as its two points and the side */
export function sidingAt(s: SimState, line: Line, cell?: number): { s0: number; s1: number; nx: number; ny: number } | null {
  const spans = sidingSpans(s, line);
  if (!spans.length) return null;
  let span = spans.reduce((a, b) => (b.d1 - b.d0 > a.d1 - a.d0 ? b : a));
  let c = (span.d0 + span.d1) / 2;
  if (cell !== undefined) {
    const k = line.path.indexOf(cell);
    if (k >= 0) {
      // the span nearest the tap, and the loop centred on it as far as the span allows
      const d = line.dist[k];
      span = spans.reduce((a, b) => (Math.abs(Math.max(b.d0, Math.min(b.d1, d)) - d) < Math.abs(Math.max(a.d0, Math.min(a.d1, d)) - d) ? b : a));
      c = d;
    }
  }
  const s0 = Math.max(span.d0, Math.min(span.d1 - SIDING_LEN, c - SIDING_LEN / 2));
  return { s0, s1: s0 + SIDING_LEN, nx: span.nx, ny: span.ny };
}

/** Buy the passing siding for a line, one a line: the loop lies at the tapped cell or, without one, in the middle of the longest straight. False when none fits, cash is short, or a train is running over the place. */
export function buySiding(s: SimState, lineId: number, cell?: number): boolean {
  const line = s.lines.find((l) => l.id === lineId);
  if (!line || line.siding || s.cash < SIDING_PRICE) return false;
  const at = sidingAt(s, line, cell);
  if (!at) return false;
  // a running train over the place would be caught half way through the points
  const clear = !s.trains.some((o) => o.lineId === line.id && o.state === 'run' && o.s + drawnLength(o) / 2 > at.s0 - 1 && o.s - drawnLength(o) / 2 < at.s1 + 1);
  if (!clear) {
    const p = centre(s, cell ?? line.path[Math.floor(line.path.length / 2)]);
    s.floats.push({ x: p.x, y: p.y, text: '', age: 0, kind: 'note', busy: true });
    return false;
  }
  s.cash -= SIDING_PRICE;
  s.assets += SIDING_PRICE;
  s.lastBuild = null;
  line.siding = at;
  const p = along(line, (at.s0 + at.s1) / 2, s.w);
  s.floats.push({ x: p.x, y: p.y, text: `-${SIDING_PRICE}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return true;
}

/** what the next platform at a station costs, or null when it has the most it can have */
export function platformPrice(s: SimState, stationId: number): number | null {
  const st = s.stations.find((o) => o.id === stationId);
  return st && st.platforms < SLOTS_MAX ? PLATFORM_PRICE[st.platforms - PLATFORMS_START] ?? null : null;
}

/** Buy one more platform at a station: two trains can stand there, and the track is drawn. */
export function buyPlatform(s: SimState, stationId: number): boolean {
  const price = platformPrice(s, stationId);
  const st = s.stations.find((o) => o.id === stationId);
  if (!st || price === null || s.cash < price) return false;
  s.cash -= price;
  s.assets += price;
  st.platforms++;
  const p = centre(s, st.cell);
  s.floats.push({ x: p.x, y: p.y, text: `-${price}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return true;
}

/** Buy the loading crew at a station: every wagon takes a third less time there. */
export function buyCrew(s: SimState, stationId: number): boolean {
  const st = s.stations.find((o) => o.id === stationId);
  if (!st || st.crew || s.cash < CREW_PRICE) return false;
  s.cash -= CREW_PRICE;
  st.crew = true;
  const p = centre(s, st.cell);
  s.floats.push({ x: p.x, y: p.y, text: `-${CREW_PRICE}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return true;
}

/** the wagon a standing train is working on, counted from the front, and how far its load has come, 0 to 1; null when none is */
export function workingWagon(s: SimState, t: Train): { wagon: number; progress: number } | null {
  if (!t.dock || t.at === null || t.job < 0) return null;
  const site = dockSite(s, t);
  const dwell = dwellAt(s, t.at, t.dock === 'unload' ? t.loads[t.job]?.good : site ? MAKES[site.kind] : null);
  const progress = 1 - Math.max(0, Math.min(1, t.work / dwell));
  return { wagon: t.job, progress };
}

/** the seconds from one end of a line to the other for a train of this engine, empty and with every wagon full, each way */
export function tripTimes(s: SimState, line: Line, engine: EngineId, wagons: number): { empty: [number, number]; full: [number, number] } {
  return {
    empty: [tripTime(s, line, engine, 0, 1), tripTime(s, line, engine, 0, -1)],
    full: [tripTime(s, line, engine, wagons, 1), tripTime(s, line, engine, wagons, -1)],
  };
}

/** the share of its speed an engine keeps on a grade with a load: 1 on the flat and downhill */
export function gradeFactor(engine: EngineId, grade: number, cargo: number): number {
  if (grade <= 0) return 1;
  const g = Math.min(1, grade / GRADE_MAX);
  return Math.max(0.2, 1 - g * (1 - ENGINES[engine].climb) - g * GRADE_LOAD * cargo);
}

export function trainLength(t: Train): number {
  return ENGINE_LEN + t.nWagons * WAGON_LEN;
}

export function lineOf(s: SimState, t: Train): Line {
  return s.lines.find((l) => l.id === t.lineId)!;
}

/** the demand a site pays at now, 1 down to the floor as recent deliveries fill it */
export function demand(taken: number): number {
  return 1 - (1 - DEMAND_FLOOR) * Math.min(1, taken / DEMAND_FILL);
}

/** a town's cap for a good, in loads: it grows with the town */
export function storeCap(site: Site): number {
  return TOWN_STORE_CAP * Math.max(1, site.size);
}

/** how full a town's store of a good is, 0 empty to 1 full */
export function storeFill(site: Site, good: Good): number {
  return Math.min(1, site.store[good] / storeCap(site));
}

/** how full a site is of a good it takes, 0 to 1: a town by its store, a refinery by what it took in lately */
export function fillOf(site: Site, good: Good): number {
  return site.kind === 'town' ? storeFill(site, good) : Math.min(1, site.taken[good] / DEMAND_FILL);
}

/** the demand a site pays at for a good now: 1 when it is empty of it, down to the floor when full */
export function siteDemand(site: Site, good: Good): number {
  return 1 - (1 - DEMAND_FLOOR) * fillOf(site, good);
}

/** the goods a town wants that the map makes: what a town needs in store to grow */
export function wantedGoods(s: SimState): Good[] {
  return goodsOnMap(s).filter((g) => TAKES.town.includes(g));
}

/** loads of each good a town of this size eats a month: a bigger town grows some of its own food, so it eats less than its size times the first */
export function townEats(size: number): number {
  return TOWN_EATS * (1 + EAT_GROWTH * (Math.max(1, size) - 1));
}

/** loads of each good a town eats a month */
export function eatsPerMonth(site: Site): number {
  return townEats(site.size);
}

/** whether a site is a town with a station */
function hasStation(s: SimState, site: Site): boolean {
  return site.kind === 'town' && s.stations.some((st) => st.siteId === site.id);
}

/** the other towns with a station: where a town's travellers and mail want to go */
export function fareTargets(s: SimState, site: Site): Site[] {
  return s.sites.filter((o) => o !== site && hasStation(s, o));
}

/**
 * Whether a town wants travellers to arrive before it grows: from size PAX_GROW_SIZE on, and only
 * when there is another town on the map for them to come from (Sawmill has one town and is spared).
 */
export function wantsPeople(s: SimState, site: Site): boolean {
  return site.kind === 'town' && site.size >= PAX_GROW_SIZE && s.sites.some((o) => o !== site && o.kind === 'town');
}

/** whether travellers arrived at the town within the last PAX_MEMORY months */
export function visited(s: SimState, site: Site): boolean {
  return s.time - site.lastArrival <= PAX_MEMORY * (YEAR_SECONDS / MONTHS);
}

/** the travellers or mail waiting at a town's station, all destinations together, whole loads */
export function waitingTotal(site: Site, fare: Fare): number {
  return Object.values(site[fare]).reduce((a, n) => a + Math.floor(n + 1e-9), 0);
}

/** the loads a town makes in a month for each fare */
export function fareRate(site: Site, fare: Fare): number {
  return (fare === 'pax' ? PAX_RATE : MAIL_RATE) * site.size;
}

/** the most a town holds waiting for one destination */
export function fareCap(site: Site, fare: Fare): number {
  return (fare === 'pax' ? PAX_CAP : MAIL_CAP) * site.size;
}

/**
 * What one load of travellers or mail pays for a trip of this many cells that took this many seconds
 * on board: the distance factor on the base, less FARE_DECAY of it for each second past a fair trip,
 * never below FARE_FLOOR. Mail loses a third as fast.
 */
export function farePay(fare: Fare, cells: number, seconds: number): number {
  const late = Math.max(0, seconds - cells / FARE_SPEED);
  const keep = Math.max(FARE_FLOOR, 1 - FARE_DECAY[fare] * late);
  return Math.round(BASE_FARE[fare] * distanceFactor(cells) * keep);
}

/**
 * A town's growth at its present stock: the months until it grows if every month stays supplied,
 * the good that is missing now, whether travellers are what is missing, and the good whose store runs
 * out before that (with the months it lasts).
 */
export function growthOutlook(s: SimState, site: Site): { months: number; missing: Good | null; lacksPeople: boolean; runsOut: { good: Good; months: number } | null } {
  const wanted = wantedGoods(s);
  const missing = wanted.find((g) => site.store[g] <= 0.001) ?? null;
  const lacksPeople = wantsPeople(s, site) && !visited(s, site);
  const months = Math.ceil((1 - site.growth) * GROW_MONTHS - 1e-9);
  let runsOut: { good: Good; months: number } | null = null;
  for (const g of wanted) {
    const last = site.store[g] / eatsPerMonth(site);
    if (last < months && (!runsOut || last < runsOut.months)) runsOut = { good: g, months: last };
  }
  return { months, missing, lacksPeople, runsOut };
}

export function distanceFactor(cells: number): number {
  return 1 + (DIST_BONUS - 1) * Math.min(1, cells / DIST_CAP);
}

/** what one load of a good pays at a site right now, carried over a line of this length */
export function price(s: SimState, good: Good, siteId: string, lineLength: number): number {
  const site = siteById(s, siteId);
  return Math.round(BASE_PRICE[good] * siteDemand(site, good) * distanceFactor(lineLength));
}

/**
 * Every site that takes what this site makes: the price it pays now for one load from here (the
 * straight distance in tiles feeds the distance factor), the straight distance in km, and whether
 * a line already joins the two stations. The highest price first.
 */
export function buyers(s: SimState, site: Site): { site: Site; good: Good; price: number; km: number; linked: boolean }[] {
  const good = MAKES[site.kind];
  if (!good) return [];
  const mine = s.stations.find((st) => st.siteId === site.id);
  const out: { site: Site; good: Good; price: number; km: number; linked: boolean }[] = [];
  for (const o of s.sites) {
    if (o === site || !TAKES[o.kind].includes(good)) continue;
    const tiles = Math.hypot(o.cx - site.cx, o.cy - site.cy);
    const theirs = s.stations.find((st) => st.siteId === o.id);
    const linked = !!mine && !!theirs && s.lines.some((l) => l.stops.includes(mine.id) && l.stops.includes(theirs.id));
    out.push({ site: o, good, price: price(s, good, o.id, tiles), km: Math.round((tiles * CELL_M) / 100) / 10, linked });
  }
  return out.sort((a, b) => b.price - a.price);
}

export function trainPrice(engine: EngineId = 'hilma', nWagons = WAGONS_DEFAULT): number {
  return ENGINES[engine].price + nWagons * WAGON_PRICE;
}

/** the routes a drag from a station cell to a site or station cell would build: one, or a cheap and a short one */
export function plan(s: SimState, from: number, to: number, startSide?: number): Route[] {
  if (!stationAt(s, from)) return [];
  if (!siteAt(s, to) && !stationAt(s, to)) return [];
  return routeOptions(s, from, to, startSide);
}

/**
 * The lines a drag from a station could lengthen: those that have this station as their first or
 * last stop and fewer than LINE_STOPS_MAX stops, with no passing siding (a siding stays on a
 * two-stop line). Oldest first.
 */
export function extendable(s: SimState, from: number): Line[] {
  const st = stationAt(s, from);
  if (!st) return [];
  return s.lines.filter((l) => !l.siding && l.stops.length < LINE_STOPS_MAX && (l.stops[0] === st.id || l.stops[l.stops.length - 1] === st.id));
}

/**
 * Whether the line would take a stop at the end of this route: the route starts at its first or last
 * stop, ends at a station the line does not serve already, leaves on the side of the station the
 * line does not arrive from (a train runs straight through a middle stop), and does not run over the
 * line's own track on the way.
 */
export function canExtend(s: SimState, r: Route, lineId: number): boolean {
  const line = s.lines.find((l) => l.id === lineId);
  if (!line || line.siding || line.stops.length >= LINE_STOPS_MAX) return false;
  const from = stationAt(s, r.cells[0]);
  if (!from) return false;
  const front = line.stops[0] === from.id;
  const back = line.stops[line.stops.length - 1] === from.id;
  if (!front && !back) return false;
  const to = stationAt(s, r.cells[r.cells.length - 1]);
  if (to && line.stops.includes(to.id)) return false;
  const k = back ? line.path.length - 1 : 0;
  const arrives = Math.sign(cx(s, line.path[back ? k - 1 : k + 1]) - cx(s, r.cells[0]));
  const leaves = Math.sign(cx(s, r.cells[1]) - cx(s, r.cells[0]));
  if (arrives === leaves) return false;
  const own = new Set(line.path);
  return !r.cells.slice(1).some((c) => own.has(c));
}

/** the side of its station (-1 west, 1 east) the line does not arrive from, for the first or last stop; the side a lengthening leaves on */
export function freeSide(s: SimState, line: Line, from: number): number | undefined {
  const back = line.stops[line.stops.length - 1] === stationAt(s, from)?.id;
  const front = line.stops[0] === stationAt(s, from)?.id;
  if (!back && !front) return undefined;
  const k = back ? line.path.length - 1 : 0;
  const nb = line.path[back ? k - 1 : k + 1];
  return -Math.sign(cx(s, nb) - cx(s, from)) || undefined;
}

function pathDist(s: SimState, cells: number[]): number[] {
  const dist = [0];
  for (let k = 1; k < cells.length; k++) dist.push(dist[k - 1] + stepLen(cx(s, cells[k]) - cx(s, cells[k - 1]), cy(s, cells[k]) - cy(s, cells[k - 1])));
  return dist;
}

/** the legs, the stop marks and the steepest grade of a line made of one route */
function legOf(path: number[], a: number, b: number, worst: number): Leg {
  return { a, b, block: new Set(path.slice(a + 1, b)), worst };
}

/**
 * Build a planned route: pay, lay the track, place the station at the end when there is none,
 * and make the line between the two stations when there is none. With `extend` (a line's id) the
 * route lengthens that line instead: the new station becomes its last stop, or its first when the
 * route starts at the line's first stop. Returns the line, or null when the cash is short or the
 * line cannot take the route.
 */
export function build(s: SimState, r: Route, extend?: number): Line | null {
  if (r.cost > s.cash) return null;
  if (extend !== undefined && !canExtend(s, r, extend)) return null;
  s.cash -= r.cost;
  // what each new cell cost, for the refund when the line is lifted; the station is not in it
  const per = (r.cost - (r.newStation ? STATION_COST : 0)) / Math.max(1, r.added.length);
  for (const c of r.added) s.paid[c] = per;
  s.assets += r.cost;
  for (let k = 1; k < r.cells.length; k++) link(s, r.cells[k - 1], r.cells[k]);
  const from = r.cells[0];
  const to = r.cells[r.cells.length - 1];
  let station = stationAt(s, to);
  let newStation: number | null = null;
  if (!station) {
    station = { id: s.nextId++, cell: to, siteId: siteAt(s, to)!.id, crew: false, platforms: PLATFORMS_START, crane: false };
    s.stations.push(station);
    newStation = station.id;
  }
  const a = stationAt(s, from)!;
  let line: Line | undefined;
  let newLine: number | null = null;
  let extended: LastBuild['extend'] = null;
  if (extend !== undefined) {
    line = s.lines.find((l) => l.id === extend)!;
    extended = { lineId: line.id, before: { stops: line.stops, path: line.path, dist: line.dist, rail: line.rail, stopAt: line.stopAt, legs: line.legs, worst: line.worst }, shift: 0 };
    lengthen(s, line, r, a.id, station.id, extended);
  } else {
    line = s.lines.find((l) => l.stops.length === 2 && ((l.stops[0] === a.id && l.stops[1] === station!.id) || (l.stops[0] === station!.id && l.stops[1] === a.id)));
    if (!line) {
      line = { id: s.nextId++, stops: [a.id, station.id], path: r.cells, dist: pathDist(s, r.cells), rail: r.rail, stopAt: [0, r.cells.length - 1], legs: [legOf(r.cells, 0, r.cells.length - 1, r.worst)], worst: r.worst, siding: null, earnedYear: 0, runYear: 0 };
      s.lines.push(line);
      newLine = line.id;
    }
  }
  s.lastBuild = { cost: r.cost, cells: r.added, station: newStation, line: newLine, extend: extended, left: UNDO_SECONDS, cell: to };
  const p = centre(s, to);
  if (r.cost > 0) s.floats.push({ x: p.x, y: p.y, text: `-${r.cost}`, age: 0, kind: 'cost' });
  s.sounds.push('build');
  return line;
}

/**
 * Add the route's leg to a line at the end the route starts from. At the front the whole path moves
 * along by the new leg, so the trains' distances and stop numbers move with it.
 */
function lengthen(s: SimState, line: Line, r: Route, fromStation: number, newStation: number, undo: NonNullable<LastBuild['extend']>): void {
  const back = line.stops[line.stops.length - 1] === fromStation;
  if (back) {
    const base = line.path.length - 1;
    const path = line.path.concat(r.cells.slice(1));
    line.path = path;
    line.rail = line.rail.concat(r.rail.slice(1));
    line.dist = pathDist(s, path);
    line.stops = [...line.stops, newStation];
    line.stopAt = [...line.stopAt, path.length - 1];
    line.legs = [...line.legs, legOf(path, base, path.length - 1, r.worst)];
  } else {
    const fresh = r.cells.slice().reverse();
    const grown = fresh.length - 1;
    const path = fresh.slice(0, -1).concat(line.path);
    const shift = pathDist(s, r.cells)[r.cells.length - 1];
    line.path = path;
    line.rail = r.rail.slice().reverse().slice(0, -1).concat(line.rail);
    line.dist = pathDist(s, path);
    line.stops = [newStation, ...line.stops];
    line.stopAt = [0, ...line.stopAt.map((k) => k + grown)];
    line.legs = [legOf(path, 0, grown, r.worst), ...line.legs.map((lg) => legOf(path, lg.a + grown, lg.b + grown, lg.worst))];
    for (const t of s.trains) if (t.lineId === line.id) {
      t.s += shift;
      t.idx += 1;
    }
    undo.shift = shift;
  }
  line.worst = Math.max(...line.legs.map((lg) => lg.worst));
}

/** Take the last build back, within its second: the cash returns, the track goes. */
export function undo(s: SimState): boolean {
  const b = s.lastBuild;
  if (!b || b.left <= 0) return false;
  s.cash += b.cost;
  s.assets -= b.cost;
  for (const c of b.cells) s.paid[c] = 0;
  if (b.extend) {
    const line = s.lines.find((l) => l.id === b.extend!.lineId);
    if (line) {
      Object.assign(line, b.extend.before);
      if (b.extend.shift > 0)
        for (const t of s.trains) if (t.lineId === line.id) {
          t.s -= b.extend.shift;
          t.idx -= 1;
        }
    }
  }
  if (b.line !== null) s.lines = s.lines.filter((l) => l.id !== b.line);
  if (b.station !== null) s.stations = s.stations.filter((st) => st.id !== b.station);
  // the new cells lose every link; the cells that stay keep the links among themselves
  const gone = new Set(b.cells);
  for (const i of b.cells) {
    for (let d = 0; d < 8; d++) {
      if (!(s.track[i] & (1 << d))) continue;
      unlink(s, i, idx(s, cx(s, i) + DIRS[d][0], cy(s, i) + DIRS[d][1]));
    }
  }
  // a line that used a removed cell is gone too
  s.lines = s.lines.filter((l) => !l.path.some((c) => gone.has(c)));
  s.lastBuild = null;
  s.sounds.push('undo');
  return true;
}

function engineSpeed(t: Train): number {
  return ENGINES[t.engine].speed;
}

/** how many wagons a new train gets when the player does not say */
export function defaultWagons(): number {
  return WAGONS_DEFAULT;
}

/**
 * Where a train bought for a line would stand: on a free platform at the first stop or, when that
 * one is taken, at the last, or parked on a siding track beside the first stop when no platform is
 * free, the line already runs as many trains as its platforms allow, or a train runs in the block.
 * Null when there is no room at all. A parked train runs when it can.
 */
export function trainSpot(s: SimState, line: Line, nWagons: number): { cell: number; slot: number; parked: boolean } | null {
  const len = ENGINE_LEN + nWagons * (WAGON_LEN + 0.08);
  const cell = line.path[0];
  if (activeOn(s, line) < lineCapacity(s, line)) {
    // on a line with a passing siding the trains do best at opposite ends, so a new one goes to the end with fewer of the line's trains
    const ends = [cell, line.path[line.path.length - 1]];
    const here = (c: number) => s.trains.filter((o) => o.lineId === line.id && !o.parked && o.state === 'stop' && o.at === c).length;
    if (line.siding && here(ends[1]) < here(ends[0])) ends.reverse();
    for (const c of ends) {
      // a train set down on a platform that another runs in to over the same track would be in that one's way: it parks until that one has arrived
      if (arriving(s, null, c, line)) continue;
      const taken = takenSlots(s, c, null, len);
      for (let k = 0; k < platformsAt(s, c); k++) if (!taken.has(k)) return { cell: c, slot: k, parked: false };
    }
  }
  const used = new Set(s.trains.filter((o) => o.state === 'stop' && o.at === cell).map((o) => o.slot));
  for (let k = platformsAt(s, cell); k < SLOTS_MAX; k++) if (!used.has(k)) return { cell, slot: k, parked: true };
  return null;
}

/** keep the train's counts true to its wagons and loads: call after any change to either */
function tally(t: Train): void {
  t.nWagons = t.wagons.length;
  t.cargo = t.loads.filter(Boolean).length;
}

/**
 * Buy a train on a line: it stands at the line's first stop and takes what the site has.
 * `wagons` is the consist, front to back, or one type with `count` of it.
 */
export function buyTrain(s: SimState, lineId: number, wagons: WagonType | WagonType[], engine: EngineId = 'hilma', count?: number): Train | null {
  const line = s.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const list: WagonType[] = Array.isArray(wagons) ? wagons.slice(0, WAGONS_MAX) : Array<WagonType>(count === undefined ? defaultWagons() : Math.max(1, Math.min(WAGONS_MAX, Math.round(count)))).fill(wagons);
  if (!list.length) return null;
  const cost = trainPrice(engine, list.length);
  if (cost > s.cash) return null;
  const spot = trainSpot(s, line, list.length);
  if (!spot) return null;
  s.cash -= cost;
  s.lastBuild = null;
  const first = spot.cell === line.path[0];
  const idx = first ? 0 : line.stops.length - 1;
  const t: Train = {
    id: s.nextId++,
    lineId,
    engine,
    wagons: list,
    nWagons: list.length,
    loads: list.map(() => null),
    fullLoad: false,
    dir: first ? 1 : -1,
    idx,
    s: stopS(line, idx),
    state: 'stop',
    stopLeft: STOP_SECONDS / 2,
    cargo: 0,
    at: spot.cell,
    queued: false,
    siding: false,
    waited: 0,
    claimed: false,
    parked: spot.parked,
    slot: spot.slot,
    slotFrom: spot.slot,
    speed: 0,
    odometer: 0,
    earned: 0,
    earnedYear: 0,
    earnedLast: 0,
    runYear: 0,
    runLast: 0,
    dock: null,
    work: 0,
    job: -1,
    quote: {},
    paid: 0,
    loop: 0,
    gate: 0,
  };
  t.speed = engineSpeed(t);
  s.trains.push(t);
  const p = centre(s, spot.cell);
  s.floats.push({ x: p.x, y: p.y, text: `-${cost}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return t;
}

/** the index of the line's stop the train stands at, or -1 when the cell is no stop of it */
function stopIndexAt(line: Line, cell: number): number {
  return line.stopAt.findIndex((k) => line.path[k] === cell);
}

/**
 * The station cell a train stands at is a stop of this line, so the train can take it up from
 * there. The cargo it carries stays only when another stop of the line takes it; otherwise it goes
 * back to the yard it stands in (when that site makes it) or is lost.
 */
export function canMove(s: SimState, trainId: number, lineId: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  const line = s.lines.find((l) => l.id === lineId);
  if (!t || !line || t.lineId === lineId || t.state !== 'stop' || t.at === null || t.parked) return false;
  if (activeOn(s, line) >= lineCapacity(s, line) || arriving(s, t, t.at!, line)) return false;
  return stopIndexAt(line, t.at) >= 0;
}

/** Move a train to another line, while it stands at a station both lines serve. */
export function moveTrain(s: SimState, trainId: number, lineId: number): boolean {
  if (!canMove(s, trainId, lineId)) return false;
  const t = s.trains.find((o) => o.id === trainId)!;
  const line = s.lines.find((l) => l.id === lineId)!;
  const at = t.at!;
  const k = stopIndexAt(line, at);
  const here = stationAt(s, at);
  const site = here && siteById(s, here.siteId);
  for (let w = 0; w < t.loads.length; w++) {
    const l = t.loads[w];
    if (!l) continue;
    // travellers and mail stay aboard when the town they want is another stop of the new line
    if (FARES.includes(l.good as Fare) ? line.stops.some((_, j) => j !== k && stopSite(s, line, j).id === l.to) : takenElsewhere(s, line, l.good as Good, k)) continue;
    if (site && MAKES[site.kind] === l.good) site.stock += 1;
    t.loads[w] = null;
  }
  tally(t);
  t.lineId = lineId;
  t.idx = k;
  t.dir = k === line.stops.length - 1 ? -1 : 1;
  t.s = stopS(line, k);
  t.odometer = Math.max(t.odometer, 0.001);
  t.dock = null;
  t.work = 0;
  t.job = -1;
  t.quote = {};
  t.loop = 0;
  t.stopLeft = Math.max(t.stopLeft, STOP_SECONDS / 2);
  s.sounds.push('buy');
  return true;
}

/** One more wagon on a train, up to the limit: of the given type, or of the type the last wagon is. */
export function addWagon(s: SimState, trainId: number, type?: WagonType): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || t.nWagons >= WAGONS_MAX || s.cash < WAGON_PRICE) return false;
  s.cash -= WAGON_PRICE;
  t.wagons.push(type ?? t.wagons[t.wagons.length - 1] ?? 'box');
  t.loads.push(null);
  tally(t);
  s.sounds.push('buy');
  return true;
}

/** the price a removed wagon returns */
export const WAGON_BACK = Math.round(WAGON_PRICE * RESALE);

/** Take a wagon off a train (counted from the front), half its price back. A train keeps at least one wagon. */
export function removeWagon(s: SimState, trainId: number, index: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || t.nWagons <= 1 || index < 0 || index >= t.nWagons) return false;
  // a load on it goes back to the yard it stands in when that site makes it, otherwise it is lost
  const load = t.loads[index];
  if (load && t.at !== null) {
    const here = stationAt(s, t.at);
    const site = here && siteById(s, here.siteId);
    if (site && MAKES[site.kind] === load.good) site.stock += 1;
  }
  t.wagons.splice(index, 1);
  t.loads.splice(index, 1);
  tally(t);
  t.dock = null;
  t.work = 0;
  t.job = -1;
  s.cash += WAGON_BACK;
  s.sounds.push('undo');
  return true;
}

/** Swap the engine: pay the new one, half of the old one comes back. */
export function setEngine(s: SimState, trainId: number, engine: EngineId): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || t.engine === engine) return false;
  const cost = ENGINES[engine].price - Math.round(ENGINES[t.engine].price * RESALE);
  if (cost > s.cash) return false;
  s.cash -= cost;
  t.engine = engine;
  t.speed = engineSpeed(t);
  s.sounds.push('buy');
  return true;
}

export function setFullLoad(s: SimState, trainId: number, on: boolean): void {
  const t = s.trains.find((o) => o.id === trainId);
  if (t) t.fullLoad = on;
}

/** Sell a train: half of what it cost comes back. */
export function sellTrain(s: SimState, trainId: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t) return false;
  s.cash += Math.round((ENGINES[t.engine].price + t.nWagons * WAGON_PRICE) * RESALE);
  s.trains = s.trains.filter((o) => o !== t);
  s.sounds.push('undo');
  return true;
}

/** most platform tracks a station draws: the platforms, and sidings beside them for parked trains */
export const SLOTS_MAX = 3;

/** the drawn length of a train in tiles: its parts and the gaps between the wagons */
export function drawnLength(t: Train): number {
  return trainLength(t) + t.nWagons * 0.08;
}

/** how far from a station's centre the front of a waiting train stands at most: the longest train, half of it, and the gap */
const QUEUE_NEAR = (ENGINE_LEN + WAGONS_MAX * (WAGON_LEN + 0.08)) / 2 + QUEUE_GAP;

export function platformsAt(s: SimState, cell: number): number {
  return s.stations.find((st) => st.cell === cell)?.platforms ?? PLATFORMS_START;
}

/** how many trains of a line may run at once: a train needs a platform at every stop, so the poorest stop sets it; a middle stop's platforms serve both directions */
export function lineCapacity(s: SimState, line: Line): number {
  return Math.min(...line.stopAt.map((k) => platformsAt(s, line.path[k])));
}

/** the trains of a line that are not parked */
export function activeOn(s: SimState, line: Line, except?: Train): number {
  return s.trains.filter((o) => o.lineId === line.id && !o.parked && o !== except).length;
}

/** the stop a running train heads for, as an index into its line's stops */
function nextStop(t: Train): number {
  return t.idx + t.dir;
}

function nextStopCell(s: SimState, t: Train): number {
  return stopCell(lineOf(s, t), nextStop(t));
}

/** the leg a running train is on: the stretch between the stop it left and the stop it heads for */
function legOfTrain(t: Train): number {
  return t.dir === 1 ? t.idx : t.idx - 1;
}

/** whether two legs share a block: cells in common between their stations */
function legsShare(a: Leg, b: Leg): boolean {
  if (a === b) return true;
  for (const c of a.block) if (b.block.has(c)) return true;
  return false;
}

/** whether two lines share a block on any leg: their trains cannot run at once, and one cannot wait on the other's way out */
function sharesBlock(a: Line, b: Line): boolean {
  if (a === b) return true;
  return a.legs.some((x) => b.legs.some((y) => legsShare(x, y)));
}

/**
 * The platform tracks of the station at `cell` that other trains hold, by track: a train that stands
 * there, one that has been given its platform and runs in, and one that has left and is not yet clear
 * of it. `len` is the drawn length of the train that asks.
 */
function takenSlots(s: SimState, cell: number, self: Train | null, len: number): Map<number, Train> {
  const out = new Map<number, Train>();
  for (const o of s.trains) {
    if (o === self) continue;
    if (o.state === 'stop') {
      if (o.at === cell) out.set(o.slot, o);
      continue;
    }
    const line = lineOf(s, o);
    const to = stopCell(line, nextStop(o));
    const from = stopCell(line, o.idx);
    if (to === cell && o.claimed) out.set(o.slot, o);
    else if (from === cell) {
      if (Math.abs(o.s - stopS(line, o.idx)) < (drawnLength(o) + len) / 2 + QUEUE_GAP) out.set(o.slotFrom, o);
    }
  }
  return out;
}

/**
 * A free platform at the station, the lowest, or -1 when every one is taken. A train the dispatcher
 * has let onto a siding may take a siding track when no platform is free.
 */
function claimSlot(s: SimState, t: Train, cell: number): number {
  const taken = takenSlots(s, cell, t, drawnLength(t));
  for (let k = 0; k < platformsAt(s, cell); k++) if (!taken.has(k)) return k;
  if (t.siding) for (let k = platformsAt(s, cell); k < SLOTS_MAX; k++) if (!taken.has(k)) return k;
  return -1;
}

/** how far from the station's centre a waiting train's front stands: clear of the longest train on a platform */
function holdFront(s: SimState, t: Train, cell: number): number {
  let half = 0;
  for (const o of takenSlots(s, cell, t, drawnLength(t)).values()) half = Math.max(half, drawnLength(o) / 2);
  return half + QUEUE_GAP;
}

/** whether a train on a line that shares a block with this one runs or waits to run in to the station */
function arriving(s: SimState, self: Train | null, cell: number, line: Line): boolean {
  return s.trains.some((o) => o !== self && o.state === 'run' && nextStopCell(s, o) === cell && sharesBlock(lineOf(s, o), line));
}

/** whether a train is waiting on its line for a platform at this station */
function queuedFor(s: SimState, cell: number): boolean {
  return s.trains.some((o) => o.queued && nextStopCell(s, o) === cell);
}

/**
 * Whether the platforms of the station a train would run to are all taken by a train that needs
 * the track where the newcomer would have to wait. The newcomer would stand on the very cells the
 * other must leave over, and neither could move, so it waits at its own station instead.
 */
function destBlocked(s: SimState, t: Train, line: Line, dir: 1 | -1): boolean {
  const target = t.idx + dir;
  const cell = stopCell(line, target);
  const taken = takenSlots(s, cell, t, drawnLength(t));
  if (taken.size < platformsAt(s, cell)) return false;
  // the cells the waiting train would cover: from the hold point back along its line
  const at = stopS(line, target);
  const hold = holdFront(s, t, cell);
  const len = drawnLength(t);
  const mine = new Set<number>();
  for (let k = 0; k < line.path.length; k++) {
    const d = dir === 1 ? at - line.dist[k] : line.dist[k] - at;
    // not the station's own cell: every line of the station has that
    if (d >= 1.5 && d <= hold + len + 1.5) mine.add(line.path[k]);
  }
  for (const o of taken.values()) if (o.state === 'stop' && lineOf(s, o).path.some((c) => mine.has(c))) return true;
  return false;
}

/** the cells a waiting train's body lies over, from its front to its tail */
export function bodyCells(s: SimState, o: Train, margin = 0.5): Set<number> {
  const line = lineOf(s, o);
  const half = drawnLength(o) / 2;
  const lo = Math.min(o.s - half, o.s + half);
  const hi = Math.max(o.s - half, o.s + half);
  const out = new Set<number>();
  for (let k = 0; k < line.path.length; k++) if (line.dist[k] >= lo - margin && line.dist[k] <= hi + margin) out.add(line.path[k]);
  return out;
}

/**
 * The pieces of the main track a running train covers, as distances along the path: its body, less
 * the part that lies in the loop of the passing siding. A train that passes straight through the
 * points keeps the track through them for itself until its tail is clear.
 */
export function mainPieces(line: Line, o: Train): [number, number][] {
  const half = drawnLength(o) / 2;
  let lo = o.s - half;
  let hi = o.s + half;
  const sd = line.siding;
  if (!sd) return [[lo, hi]];
  if (o.loop === 1) {
    if (o.dir === 1) hi = Math.max(hi, sd.s1);
    else lo = Math.min(lo, sd.s0);
  }
  if (o.loop !== 2) return [[lo, hi]];
  const out: [number, number][] = [];
  if (lo < sd.s0) out.push([lo, Math.min(hi, sd.s0)]);
  if (hi > sd.s1) out.push([Math.max(lo, sd.s1), hi]);
  return out;
}

/** whether a train of the line other than this one covers any of the main track between two distances */
function mainBusy(s: SimState, line: Line, self: Train | null, lo: number, hi: number): boolean {
  for (const o of s.trains) {
    if (o === self || o.lineId !== line.id || o.state !== 'run') continue;
    for (const [a, b] of mainPieces(line, o)) if (a < hi - 1e-6 && b > lo + 1e-6) return true;
  }
  return false;
}

/**
 * Where a train of a line with a passing siding may go, as the length it may move this tick. At the
 * near points it passes straight when no other train covers the track from there to the far station;
 * otherwise it takes the loop, when no other train is in it, and waits there at the far points until
 * the track beyond them is clear. When the loop is taken it waits before the points.
 */
function sidingStep(s: SimState, t: Train, line: Line, step: number): number {
  const sd = line.siding!;
  const end = line.dist[line.dist.length - 1];
  const half = drawnLength(t) / 2;
  const fwd = t.dir === 1;
  // the front of the train, and the two points, along its way
  const u = (fwd ? t.s : end - t.s) + half;
  const ue = fwd ? sd.s0 : end - sd.s1;
  const ux = fwd ? sd.s1 : end - sd.s0;
  const ahead: [number, number] = fwd ? [sd.s0, end] : [0, sd.s1];
  const beyond: [number, number] = fwd ? [sd.s1, end] : [0, sd.s0];
  if (t.loop === 2 && u - 2 * half >= ux) t.loop = 3;
  if (t.loop === 0) {
    if (u >= ue) {
      t.loop = u >= ux ? 3 : 1;
      return step;
    }
    if (u + step < ue - SIDING_WAIT) return step;
    if (!mainBusy(s, line, t, ahead[0], ahead[1])) t.loop = 1;
    else if (!s.trains.some((o) => o !== t && o.lineId === line.id && o.loop === 2)) t.loop = 2;
    else return Math.max(0, Math.min(step, ue - SIDING_WAIT - u));
    return step;
  }
  if (t.loop === 2) {
    const hold = ux - SIDING_GAP;
    if (u + step <= hold) return step;
    if (mainBusy(s, line, t, beyond[0], beyond[1])) return Math.max(0, Math.min(step, hold - u));
  }
  return step;
}

/** whether a train may not set out on a line with a passing siding: it needs the track from its station to the far points, and at most one other train runs */
function sidingBusy(s: SimState, t: Train, line: Line, dir: 1 | -1): boolean {
  const sd = line.siding!;
  const end = line.dist[line.dist.length - 1];
  if (s.trains.filter((o) => o !== t && o.lineId === line.id && o.state === 'run').length >= 2) return true;
  return dir === 1 ? mainBusy(s, line, t, 0, sd.s1) : mainBusy(s, line, t, sd.s0, end);
}

/**
 * Whether a train that stands ready may not leave on this leg now. First come, first served: a train
 * that has stood ready longer, for a leg that shares cells with this one, has its turn first, so a
 * waiting train is passed over by one other train at most, never starved. Otherwise the block is
 * taken when another train runs on a leg that shares a cell, or waits on its line over the cells.
 */
function blockBusy(s: SimState, t: Train | null, line: Line, leg: number): boolean {
  if (t)
    for (const o of s.trains) {
      if (o === t || o.state !== 'stop' || o.parked || o.gate <= t.gate) continue;
      const ol = lineOf(s, o);
      const od = departDir(o, ol);
      const oleg = od === 1 ? o.idx : o.idx - 1;
      if (!legsShare(ol.legs[oleg], line.legs[leg])) continue;
      if (!departHeld(s, o, ol, od, oleg, o.gate <= GATE_RESERVE)) return true;
    }
  return blockTaken(s, t, line, leg);
}

/**
 * Whether a train that stands ready is held back, as the trains behind it see it. For its first
 * GATE_RESERVE seconds a train in its way, running or waiting, holds it, so the others may use the
 * block while it cannot go. After that only what will not clear by itself does: a train waiting on
 * the line over its cells. A running train in the way (or the passing siding's rule that keeps two
 * trains of a line apart) does not count then, it will be gone soon, and the trains behind this one
 * stop starting on its legs so that it gets the block the moment it is free.
 */
function departHeld(s: SimState, t: Train, line: Line, dir: 1 | -1, leg: number, running: boolean): boolean {
  return blockTaken(s, t, line, leg, running) || (running && !!line.siding && sidingBusy(s, t, line, dir));
}

/** whether the block of a leg has a running train on it (when `moving`), or a waiting one over its cells, other than this train */
function blockTaken(s: SimState, t: Train | null, line: Line, leg: number, moving = true): boolean {
  const mine = line.legs[leg];
  for (const o of s.trains) {
    if (o === t || o.state !== 'run') continue;
    // the trains of a line with a passing siding share its track by the rules of the siding
    if (line.siding && o.lineId === line.id) continue;
    const ol = lineOf(s, o);
    if (!o.queued) {
      if (moving && legsShare(ol.legs[legOfTrain(o)], mine)) return true;
      continue;
    }
    if (ol === line && legOfTrain(o) === leg) return true;
    const body = bodyCells(s, o);
    for (let k = line.legs[leg].a; k <= line.legs[leg].b; k++) if (body.has(line.path[k])) return true;
  }
  return false;
}

/** a small seeded generator, so a run offers the same contracts every time */
function seeded(text: string): () => number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 3432918353) << 13 | h >>> 19;
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** loads of this good that a site is short of: a town's store under a quarter full, a refinery that took next to nothing lately */
function servedPoorly(site: Site, good: Good): boolean {
  return site.kind === 'town' ? site.store[good] < 0.25 * storeCap(site) : site.taken[good] < 1;
}

/**
 * The contract for the coming year: a site the player serves poorly, a good it takes that the map
 * makes, about what one train on a sensible line carries in CONTRACT_MONTHS, and a reward of
 * CONTRACT_SHARE of what those loads pay. The site is picked by a seeded draw from the year and the
 * scenario. Null when no site qualifies or the player already holds as many as allowed.
 */
export function makeOffer(s: SimState): Contract | null {
  if (s.contracts.length >= CONTRACT_MAX) return null;
  const made = new Set(goodsOnMap(s));
  const all: { site: Site; good: Good }[] = [];
  for (const site of s.sites)
    for (const good of TAKES[site.kind])
      if (made.has(good) && !s.contracts.some((c) => c.site === site.id && c.good === good)) all.push({ site, good });
  if (!all.length) return null;
  const poor = all.filter((c) => servedPoorly(c.site, c.good));
  const pool = poor.length ? poor : all;
  const rnd = seeded(`${s.scenario.id}:${s.year}`);
  const pick = pool[Math.floor(rnd() * pool.length)];
  // the nearest site that makes the good sets the trip
  const makers = s.sites.filter((o) => MAKES[o.kind] === pick.good);
  const tiles = Math.min(...makers.map((o) => Math.hypot(o.cx - pick.site.cx, o.cy - pick.site.cy)));
  const wagons = WAGONS_DEFAULT + 1;
  const cycle = (2 * tiles * 1.25) / ENGINES.hilma.speed + 2 * (STOP_SECONDS + wagons * WAGON_DWELL);
  // a train on a busy map makes about three trips in four of the free-running ones
  const loads = ((YEAR_SECONDS / cycle) * wagons) * CONTRACT_PACE;
  const count = Math.max(CONTRACT_MIN, Math.min(12, Math.round((loads * CONTRACT_MONTHS) / MONTHS)));
  const each = BASE_PRICE[pick.good] * distanceFactor(tiles);
  const reward = Math.round((CONTRACT_SHARE * count * each) / 5) * 5;
  return { id: s.nextId++, site: pick.site.id, good: pick.good, count, got: 0, deadline: s.year, reward };
}

/** a delivered load counts towards the contracts for that site and good; the one that reaches its count pays its reward */
function contractLoad(s: SimState, site: Site, good: Good): void {
  for (const c of s.contracts) {
    if (c.site !== site.id || c.good !== good) continue;
    c.got += 1;
    if (c.got < c.count) continue;
    s.cash += c.reward;
    s.bonus += c.reward;
    s.contracts = s.contracts.filter((o) => o !== c);
    s.floats.push({ x: site.cx + 0.5, y: site.cy - 1.5, text: `+${c.reward}`, age: 0, kind: 'pay', life: 2.6 });
    s.sounds.push('bell');
  }
}

/** The year end card closes: the contract on offer is taken or skipped, and the sim runs again; then the goal is judged. */
export function closeYearEnd(s: SimState, take = false): void {
  if (!s.yearEnd) return;
  if (take && s.offer && s.contracts.length < CONTRACT_MAX) s.contracts.push(s.offer);
  s.offer = null;
  s.yearEnd = null;
  if (s.result) return;
  const goal = s.scenario.goal;
  if (goal.kind === 'towns' && s.sites.filter((x) => x.kind === 'town' && x.size >= goal.size).length >= goal.count) finish(s, true, 'goal');
  else if (s.broke >= BANKRUPT_YEARS) finish(s, false, 'bankrupt');
  else if (s.year >= goal.beforeYear) finish(s, false, 'time');
}

function finish(s: SimState, won: boolean, reason: 'goal' | 'time' | 'bankrupt'): void {
  const worth = Math.round(netWorth(s));
  const stars = won ? 1 + s.scenario.stars.filter((x) => worth >= x).length : 0;
  s.result = { won, year: s.year, cash: Math.round(s.cash), worth, stars, reason };
  s.sounds.push(won ? 'win' : 'lose');
}

/** a train's price new: the engine and its wagons */
export function trainValue(t: Train): number {
  return ENGINES[t.engine].price + t.nWagons * WAGON_PRICE;
}

/**
 * Net worth: cash, trains at their resale, track and stations at half their build price, less
 * the loan. Stars are judged on it, and the loan ceiling rises with it.
 */
export function netWorth(s: SimState): number {
  return s.cash + s.trains.reduce((a, t) => a + trainValue(t) * RESALE, 0) + s.assets * LIFT_BACK - s.loan;
}

/** the most the bank lends: a base and a share of net worth */
export function loanCeiling(s: SimState): number {
  return Math.round(LOAN_BASE + LOAN_SHARE * Math.max(0, netWorth(s)));
}

/** Take a loan: cash now, interest at the year end. False when it would pass the ceiling. */
export function borrow(s: SimState, amount: number): boolean {
  if (amount <= 0 || s.loan + amount > loanCeiling(s)) return false;
  s.loan += amount;
  s.cash += amount;
  s.sounds.push('buy');
  return true;
}

/** Pay the loan back, up to what is owed and what the cash covers. False when nothing could be paid. */
export function repay(s: SimState, amount: number): boolean {
  const pay = Math.min(amount, s.loan, Math.floor(s.cash));
  if (pay <= 0) return false;
  s.loan -= pay;
  s.cash -= pay;
  s.sounds.push('buy');
  return true;
}

/** a year of upkeep for all the track standing, a bridge tile at BRIDGE_UPKEEP times a plain one */
export function trackUpkeep(s: SimState): number {
  let n = 0;
  for (let i = 0; i < s.track.length; i++) if (s.track[i]) n += s.water[i] ? BRIDGE_UPKEEP : 1;
  return n * TRACK_UPKEEP;
}

/** a year of upkeep for the track of one line; a tile that other lines use too is shared among them */
export function lineTrackUpkeep(s: SimState, line: Line): number {
  let n = 0;
  for (const c of line.path) {
    const users = s.lines.filter((l) => l.path.includes(c)).length || 1;
    n += (s.water[c] ? BRIDGE_UPKEEP : 1) / users;
  }
  return n * TRACK_UPKEEP;
}

/** the pairs of neighbouring cells that some line other than this one runs over */
function sharedLinks(s: SimState, line: Line): Set<string> {
  const shared = new Set<string>();
  for (const o of s.lines) if (o !== line) for (let k = 1; k < o.path.length; k++) shared.add(linkKey(o.path[k - 1], o.path[k]));
  return shared;
}
const linkKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

/** what lifting a line would give back: half the build price of the cells that would lose their track */
export function liftValue(s: SimState, line: Line): number {
  const shared = sharedLinks(s, line);
  // a cell keeps its track when a link that stays touches it
  const keeps = new Set<number>();
  for (const o of s.lines) if (o !== line) for (const c of o.path) keeps.add(c);
  let back = 0;
  for (let k = 0; k < line.path.length; k++) {
    const c = line.path[k];
    const stays = keeps.has(c) || (k > 0 && shared.has(linkKey(line.path[k - 1], c))) || (k < line.path.length - 1 && shared.has(linkKey(c, line.path[k + 1])));
    if (!stays) back += s.paid[c] * LIFT_BACK;
  }
  return back;
}

/**
 * Lift a line that has no trains: its track goes and half its build price comes back. Track that
 * another line runs on stays, and so do the stations. False when a train still runs on it.
 */
export function liftLine(s: SimState, lineId: number): boolean {
  const line = s.lines.find((l) => l.id === lineId);
  if (!line || s.trains.some((t) => t.lineId === lineId)) return false;
  const shared = sharedLinks(s, line);
  for (let k = 1; k < line.path.length; k++) if (!shared.has(linkKey(line.path[k - 1], line.path[k]))) unlink(s, line.path[k - 1], line.path[k]);
  let back = 0;
  for (const c of line.path)
    if (!s.track[c] && s.paid[c] > 0) {
      back += s.paid[c] * LIFT_BACK;
      s.assets -= s.paid[c];
      s.paid[c] = 0;
    }
  // the passing siding goes with the line and half its price comes back
  if (line.siding) {
    back += SIDING_PRICE * LIFT_BACK;
    s.assets -= SIDING_PRICE;
  }
  s.cash += back;
  s.lines = s.lines.filter((l) => l !== line);
  if (s.lastBuild && s.lastBuild.line === lineId) s.lastBuild = null;
  const p = centre(s, line.path[line.path.length - 1]);
  if (back > 0) s.floats.push({ x: p.x, y: p.y, text: `+${Math.round(back)}`, age: 0, kind: 'pay' });
  s.sounds.push('undo');
  return true;
}

/** the month's fixed costs: each engine's upkeep and the track's, a twelfth of the year's */
function chargeMonth(s: SimState): void {
  const engines = s.trains.reduce((a, t) => a + ENGINES[t.engine].upkeep, 0) / MONTHS;
  const track = trackUpkeep(s) / MONTHS;
  s.cash -= engines + track;
  s.upkeep += engines;
  s.engineUp += engines;
  s.trackUp += track;
}

/** months tick: upkeep, production, consumption, demand recovery */
function monthTick(s: SimState): void {
  chargeMonth(s);
  for (const site of s.sites) {
    const raw = RAW_RATE[site.kind];
    if (raw) {
      // a served site makes more: the rate climbs while pickups keep coming and falls back after
      const base = raw;
      const recent = s.time - site.lastPickup < SERVED_MEMORY * (YEAR_SECONDS / MONTHS);
      const target = recent ? base * SERVED_RATE : base;
      site.rate += (target - site.rate) * 0.5;
      site.stock = Math.min(RAW_CAP, site.stock + site.rate);
    }
    if (site.kind === 'town') {
      growMonth(s, site);
      site.arrived = 0;
      makeFares(s, site);
    } else for (const g of GOODS) site.taken[g] = Math.max(0, site.taken[g] - MILL_EATS);
  }
}

/**
 * A town with a station makes travellers and mail: its size times the rate, shared among the other
 * towns with a station by their size, up to the cap for each of them.
 */
function makeFares(s: SimState, site: Site): void {
  if (!hasStation(s, site)) return;
  const targets = fareTargets(s, site);
  const total = targets.reduce((a, o) => a + o.size, 0);
  if (!total) return;
  for (const fare of FARES)
    for (const o of targets) site[fare][o.id] = Math.min(fareCap(site, fare), (site[fare][o.id] ?? 0) + (fareRate(site, fare) * o.size) / total);
}

/**
 * A town's month. If every good it wants had stock in its store at the month's start, and from size 2
 * on some travellers arrived in the month, the growth meter fills by 1 / GROW_MONTHS; a short month
 * drains a smaller step, never below zero. A full meter grows the town then, with a float over it and a sound.
 */
function growMonth(s: SimState, site: Site): void {
  if (site.size >= TOWN_MAX) return;
  const wanted = wantedGoods(s);
  const supplied = wanted.length > 0 && wanted.every((g) => site.store[g] > 0.001) && (!wantsPeople(s, site) || visited(s, site));
  site.growth = supplied ? site.growth + 1 / GROW_MONTHS : Math.max(0, site.growth - GROW_LOSS);
  if (site.growth < 1 - 1e-9) return;
  site.growth = 0;
  site.size++;
  site.grewAt = s.year;
  s.grewYear.push(site.id);
  s.floats.push({ x: site.cx + 0.5, y: site.cy - 3.5, text: '', age: 0, kind: 'grow', life: 3.4, grew: { site: site.id, size: site.size } });
  s.sounds.push('grow');
}

/** the towns eat from their stores a little every tick */
function eatStores(s: SimState): void {
  const per = DT / (YEAR_SECONDS / MONTHS);
  for (const site of s.sites) {
    if (site.kind !== 'town') continue;
    const eat = eatsPerMonth(site) * per;
    for (const g of GOODS) if (site.store[g] > 0) site.store[g] = Math.max(0, site.store[g] - eat);
  }
}

function arrive(t: Train, stop: number, cell: number): void {
  t.loop = 0;
  t.gate = 0;
  t.state = 'stop';
  t.queued = false;
  t.siding = false;
  t.waited = 0;
  t.claimed = false;
  t.stopLeft = STOP_SECONDS;
  t.at = cell;
  t.idx = stop;
  t.dock = null;
  t.work = 0;
  t.job = -1;
  t.quote = {};
  t.paid = 0;
}

/** the site a standing train is at */
function dockSite(s: SimState, t: Train): Site | null {
  const st = t.at === null ? undefined : stationAt(s, t.at);
  return st ? siteById(s, st.siteId) : null;
}

/** the way a train at its stop goes when it leaves: it turns at the ends and runs on through a middle stop */
function departDir(t: Train, line: Line): 1 | -1 {
  const last = line.stops.length - 1;
  return t.idx === 0 ? 1 : t.idx === last ? -1 : t.dir;
}

/**
 * The town an empty coach or van at this stop takes its load to: a stop ahead on the train's way
 * where the town has a station, with the most waiting for it (the nearer one on a tie). Null when
 * none has a whole load waiting.
 */
function fareTarget(s: SimState, t: Train, site: Site, fare: Fare): string | null {
  const line = lineOf(s, t);
  const dir = departDir(t, line);
  let best: string | null = null;
  let most = 0.999;
  for (let j = t.idx + dir; j >= 0 && j < line.stops.length; j += dir) {
    const o = stopSite(s, line, j);
    const n = site[fare][o.id] ?? 0;
    if (o.kind === 'town' && n > most) {
      best = o.id;
      most = n;
    }
  }
  return best;
}

/**
 * Whether an empty wagon can take what the site makes: the site makes it, the wagon's type carries
 * it, and a later stop on the train's way, forward or back, takes it. A coach or a van could take a
 * load at a town when another town lies ahead on its way.
 */
function wagonLoads(s: SimState, t: Train, w: number, site: Site): boolean {
  if (t.loads[w]) return false;
  const fare = WAGON_FARE[t.wagons[w]];
  if (fare) {
    const line = lineOf(s, t);
    const dir = departDir(t, line);
    return site.kind === 'town' && line.stops.some((_, j) => (dir === 1 ? j > t.idx : j < t.idx) && stopIsTown(s, line, j));
  }
  const makes = MAKES[site.kind];
  return !!makes && WAGON_GOODS[t.wagons[w]].includes(makes) && takenElsewhere(s, lineOf(s, t), makes, t.idx);
}

/** whether the wagon is empty, could take a load here, and the site has one ready now */
function loadReady(s: SimState, t: Train, w: number, site: Site): boolean {
  if (!wagonLoads(s, t, w, site)) return false;
  const fare = WAGON_FARE[t.wagons[w]];
  return fare ? fareTarget(s, t, site, fare) !== null : site.stock >= 1;
}

/** whether any wagon is empty and could take what the site makes */
function wantsLoad(s: SimState, t: Train, site: Site): boolean {
  return t.wagons.some((_, w) => wagonLoads(s, t, w, site));
}

/** whether the load comes off at this site: a good the site takes, or travellers and mail bound for this town */
function comesOff(site: Site, l: Load): boolean {
  return FARES.includes(l.good as Fare) ? l.to === site.id : TAKES[site.kind].includes(l.good as Good);
}

/**
 * The work at the platform, one wagon's load at a time: first every wagon whose load the stop
 * takes comes off, each load paid as it leaves, then every empty wagon that carries what the site
 * makes takes a load from its pile, from the front. Returns whether a load is in hand.
 */
function tickDock(s: SimState, t: Train): boolean {
  const site = dockSite(s, t);
  const was = t.dock;
  const wasJob = t.job;
  if (!site) {
    t.dock = null;
    t.job = -1;
    return false;
  }
  const line = lineOf(s, t);
  let job = t.loads.findIndex((l) => !!l && comesOff(site, l));
  let kind: 'load' | 'unload' | null = job >= 0 ? 'unload' : null;
  if (job < 0) {
    job = t.wagons.findIndex((_, w) => loadReady(s, t, w, site));
    if (job >= 0) kind = 'load';
  }
  t.dock = kind;
  t.job = kind ? job : -1;
  if (!kind) {
    if (t.paid > 0) {
      const p = centre(s, t.at!);
      s.floats.push({ x: p.x, y: p.y, text: `+${t.paid}`, age: 0, kind: 'pay' });
      t.paid = 0;
    }
    t.quote = {};
    return false;
  }
  const fare = kind === 'load' ? WAGON_FARE[t.wagons[job]] : null;
  const cargo: Cargo = kind === 'unload' ? t.loads[job]!.good : fare ?? MAKES[site.kind]!;
  const dwell = dwellAt(s, t.at!, cargo);
  if (was !== kind || wasJob !== job) t.work = dwell;
  t.work -= DT;
  if (t.work > 0) return true;
  t.work = dwell;
  if (kind === 'unload') {
    const load = t.loads[job]!;
    const isFare = FARES.includes(cargo as Fare);
    let pay: number;
    if (isFare) pay = farePay(cargo as Fare, Math.abs(stopS(line, t.idx) - load.from), s.time - (load.at ?? s.time));
    else {
      const good = cargo as Good;
      // the first load of a good at this stop fixes the demand its loads pay at; the distance is each load's own
      if (t.quote[good] === undefined) t.quote[good] = siteDemand(site, good);
      pay = Math.round(BASE_PRICE[good] * t.quote[good]! * distanceFactor(Math.abs(stopS(line, t.idx) - load.from)));
    }
    s.cash += pay;
    s.income[cargo] += pay;
    t.earned += pay;
    t.earnedYear += pay;
    line.earnedYear += pay;
    t.paid += pay;
    t.loads[job] = null;
    tally(t);
    if (isFare) {
      if (cargo === 'pax') {
        site.arrived += 1;
        site.lastArrival = s.time;
      }
    } else {
      const good = cargo as Good;
      if (site.kind === 'town') site.store[good] = Math.min(storeCap(site), site.store[good] + 1);
      else site.taken[good] += 1;
      site.delivered += 1;
      contractLoad(s, site, good);
      // a refinery turns the input into its output at once
      if (MAKES[site.kind]) site.stock += 1;
      const goal = s.scenario.goal;
      if (goal.kind === 'deliver' && site.id === goal.site && good === goal.good) {
        s.goalCount += 1;
        if (s.goalCount >= goal.count && !s.result) finish(s, true, 'goal');
      }
    }
    if (s.firstPayAt === null) s.firstPayAt = s.time;
    s.sounds.push('pay');
  } else if (fare) {
    const to = fareTarget(s, t, site, fare)!;
    site[fare][to] -= 1;
    t.loads[job] = { good: fare, from: stopS(line, t.idx), at: s.time, to };
    tally(t);
    s.sounds.push('load');
  } else {
    site.stock -= 1;
    t.loads[job] = { good: cargo, from: stopS(line, t.idx) };
    tally(t);
    site.lastPickup = s.time;
    s.sounds.push('load');
  }
  return true;
}

/** whether the train is at a stop and set to wait for a full load it has not got */
function waitingForLoad(s: SimState, t: Train): boolean {
  if (!t.fullLoad || t.at === null) return false;
  // a train waiting on the line for this platform goes first: the load it brings may be what this one waits for
  if (queuedFor(s, t.at)) return false;
  const site = dockSite(s, t);
  return !!site && wantsLoad(s, t, site);
}

function depart(s: SimState, t: Train, line: Line): boolean {
  // a train turns at the ends and runs on through a middle stop
  const dir = departDir(t, line);
  const leg = dir === 1 ? t.idx : t.idx - 1;
  if (blockBusy(s, t, line, leg) || (line.siding && sidingBusy(s, t, line, dir))) {
    t.gate += DT;
    return false;
  }
  t.gate = 0;
  // a train does not set out for a station whose platforms a train holds that needs this track to leave
  if (!t.siding && destBlocked(s, t, line, dir)) {
    // a train that has waited this long for the platforms ahead sets out and takes a siding there: waiting longer could freeze a ring of stations
    t.waited += DT;
    if (t.waited < PATIENCE_SECONDS) return false;
    t.siding = true;
  }
  t.waited = 0;
  t.loop = 0;
  // the leading end is the stop's own point; the engine starts at the station, the wagons stand behind it on the siding the renderer draws
  t.dir = dir;
  t.s = stopS(line, t.idx);
  t.state = 'run';
  t.at = null;
  t.dock = null;
  t.job = -1;
  t.slotFrom = t.slot;
  // on its line's own track until it is given a platform
  t.slot = 0;
  t.claimed = false;
  t.queued = false;
  if (t.odometer === 0) t.odometer = 0.001;
  s.sounds.push('whistle');
  return true;
}

function runTrain(s: SimState, t: Train): void {
  const line = lineOf(s, t);
  if (t.state === 'stop') {
    // a parked train waits on its siding until the line has room for it and a platform is free
    if (t.parked) {
      if (activeOn(s, line, t) < lineCapacity(s, line) && !arriving(s, t, t.at!, line)) {
        const k = claimSlot(s, t, t.at!);
        if (k >= 0) {
          t.slot = k;
          t.parked = false;
        }
      }
      return;
    }
    const busy = tickDock(s, t);
    // the stop's own second runs once the wagons are done
    if (!busy) t.stopLeft -= DT;
    if (t.stopLeft <= 0 && !busy) {
      if (waitingForLoad(s, t)) {
        t.gate = 0;
        return;
      }
      depart(s, t, line);
    } else t.gate = 0;
    return;
  }
  // the speed under the leading end: a climb cuts it, more with a load
  const base = engineSpeed(t);
  t.speed = base * gradeFactor(t.engine, gradeAlong(line, t.s, t.dir), t.cargo);
  let step = t.speed * DT;
  const target = nextStop(t);
  const goal = stopS(line, target);
  if (!t.claimed) {
    // near the station the train asks for a platform; with none free it stops on its line, clear of the train that holds it
    const cell = stopCell(line, target);
    const half = drawnLength(t) / 2;
    const front = (t.dir === 1 ? goal - t.s : t.s - goal) - half;
    if (front <= QUEUE_NEAR) {
      const k = claimSlot(s, t, cell);
      if (k >= 0) {
        t.claimed = true;
        t.queued = false;
        t.slot = k;
      } else {
        const hold = holdFront(s, t, cell);
        if (front - step <= hold) {
          step = Math.max(0, front - hold);
          t.queued = true;
          // after waiting this long the train takes a siding track beside the station instead
          t.waited += DT;
          if (t.waited >= PATIENCE_SECONDS) t.siding = true;
        }
      }
    }
  }
  if (line.siding) step = sidingStep(s, t, line, step);
  if (step <= 0) t.speed = 0;
  t.s += t.dir * step;
  t.odometer += step;
  // a train pays for every tile it runs, full or empty
  const fare = runPerTile(t.engine, t.nWagons) * step;
  s.cash -= fare;
  s.running += fare;
  s.upkeep += fare;
  t.runYear += fare;
  line.runYear += fare;
  if ((t.dir === 1 && t.s >= goal) || (t.dir === -1 && t.s <= goal)) {
    t.s = goal;
    arrive(t, target, stopCell(line, target));
  }
}

/** the year end: the last month's costs, the interest, the towns grow or not, the ledger opens */
function yearEnd(s: SimState): void {
  chargeMonth(s);
  const interest = s.loan * LOAN_RATE;
  s.cash -= interest;
  s.cash = Math.round(s.cash);
  const income = { ...s.income };
  const grew = s.grewYear;
  s.grewYear = [];
  const growth: Record<string, number> = {};
  for (const site of s.sites) if (site.kind === 'town') growth[site.id] = site.growth;
  const total = CARGOS.reduce((a, g) => a + income[g], 0);
  const running = Math.round(s.running);
  const engine = Math.round(s.engineUp);
  const track = Math.round(s.trackUp);
  const owed = Math.round(interest);
  const bonus = Math.round(s.bonus);
  const profit = total + bonus - running - engine - track - owed;
  // broke: cash below zero with the loan at its ceiling; two year ends in a row end the scenario
  s.broke = s.cash < 0 && s.loan >= loanCeiling(s) - 0.5 ? s.broke + 1 : 0;
  const worth = Math.round(netWorth(s));
  s.yearEnd = { year: s.year, income, running, engine, track, interest: owed, upkeep: running + engine, profit, cash: s.cash, loan: s.loan, worth, lost: [], bonus, grew, growth };
  s.history.push({ year: s.year, cash: s.cash, profit, worth, loan: s.loan });
  for (const t of s.trains) {
    t.earnedLast = t.earnedYear;
    t.earnedYear = 0;
    t.runLast = t.runYear;
    t.runYear = 0;
  }
  for (const l of s.lines) {
    l.earnedYear = 0;
    l.runYear = 0;
  }
  s.bonus = 0;
  s.income = zeroCargo();
  s.upkeep = 0;
  s.running = 0;
  s.engineUp = 0;
  s.trackUp = 0;
  // a contract past its year is lost, at no cost but the contract
  const lost = s.contracts.filter((c) => c.deadline <= s.year);
  s.contracts = s.contracts.filter((c) => !lost.includes(c));
  s.yearEnd.lost = lost;
  for (const c of lost) {
    const site = siteById(s, c.site);
    s.floats.push({ x: site.cx + 0.5, y: site.cy - 1.5, text: '', age: 0, kind: 'note', life: 2.6, lost: { site: c.site, good: c.good } });
  }
  s.year++;
  s.yearFrac = 0;
  s.month = 0;
  s.offer = s.year < s.scenario.goal.beforeYear ? makeOffer(s) : null;
  s.sounds.push('bell');
}

export function step(s: SimState): void {
  if (s.yearEnd || s.result) return;
  s.time += DT;
  if (s.lastBuild) {
    s.lastBuild.left -= DT;
    if (s.lastBuild.left <= 0) s.lastBuild = null;
  }
  for (const f of s.floats) f.age += DT;
  eatStores(s);
  s.floats = s.floats.filter((f) => f.age < (f.life ?? 1.6));
  const frac = s.yearFrac + DT / YEAR_SECONDS;
  const month = Math.floor(frac * MONTHS);
  if (month > s.month && month < MONTHS) {
    s.month = month;
    monthTick(s);
  }
  s.yearFrac = frac;
  for (const t of s.trains) runTrain(s, t);
  if (s.yearFrac >= 1) yearEnd(s);
}

/** a note that floats off a point, for the UI */
export function note(s: SimState, cell: number, text: string): void {
  const p = centre(s, cell);
  const f: Float = { x: p.x, y: p.y, text, age: 0, kind: 'note' };
  s.floats.push(f);
}

/** the goal's progress, 0..1, for the HUD bar */
export function goalProgress(s: SimState): number {
  const goal = s.scenario.goal;
  if (goal.kind === 'deliver') return Math.min(1, s.goalCount / goal.count);
  // each town's climb counts up to the size; the best `count` towns are the ones that matter
  const towns = s.sites.filter((x) => x.kind === 'town');
  const start = (t: Site): number => s.scenario.sites.find((d) => d.id === t.id)?.size ?? 1;
  const gain = towns.map((t) => Math.min(goal.size, t.size) - start(t)).sort((a, b) => b - a);
  const need = towns.map((t) => goal.size - start(t)).sort((a, b) => a - b).slice(0, goal.count).reduce((a, b) => a + b, 0);
  const got = gain.slice(0, goal.count).reduce((a, b) => a + b, 0);
  return need > 0 ? Math.min(1, got / need) : 1;
}
