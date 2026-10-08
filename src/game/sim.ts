/**
 * The simulation: the one authority on money, goods, trains and blocks.
 * Headless: nothing here touches the DOM. Sounds are names pushed onto
 * `state.sounds`; the game loop drains them. The step is fixed (DT) and the
 * sim holds while a year-end card waits for its choice or the scenario is
 * over. The player's moves are the exported functions below; the UI and
 * the bot call the same ones.
 */
import type { EngineId, Good, Line, SimState, Site, Train, WagonType, YearEndChoice, Float } from './types';
import { GOODS } from './types';
import { routeOptions, link, unlink, idx, cx, cy, stepLen, gradeOf, DIRS, STATION_COST, type Route } from './grid';
import { siteAt, stationAt, siteById, goodsOnMap, zeroGoods } from './state';
import {
  BANKRUPT_YEARS, BASE_PRICE, BRIDGE_UPKEEP, CELL_M, DEMAND_FILL, DEMAND_FLOOR, DIST_BONUS, DIST_CAP, ENGINES, ENGINE_LEN, GRADE_LOAD, GRADE_MAX, CREW_CUT, CREW_PRICE, GROW_LOSS, GROW_MONTHS, LIFT_BACK, LOAN_BASE, LOAN_RATE, LOAN_SHARE, MAKES, MILL_EATS, MONTHS,
  PERK_FOREST, PERK_SPEED, PLATFORM_PRICE, PLATFORMS_START, QUEUE_GAP, RAW_CAP, RAW_RATE, RESALE, SERVED_MEMORY, SERVED_RATE, PATIENCE_SECONDS, STOP_SECONDS, TAKES, TOWN_EATS, TOWN_MAX, TOWN_STORE_CAP, TRACK_UPKEEP, UNDO_SECONDS,
  WAGON_DWELL, WAGON_GOODS, WAGON_LEN, WAGON_PRICE, WAGON_RUN, WAGONS_DEFAULT, WAGONS_MAX, YEAR_SECONDS,
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
function railTime(s: SimState, rail: number[], dist: number[], engine: EngineId, cargo: number, dir: 1 | -1): number {
  const base = ENGINES[engine].speed * (s.perks.includes('speed') ? PERK_SPEED : 1);
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

/**
 * Round trips a year an engine makes on a built line, the same sum as routeTrips: loaded one way
 * (the slower way), empty back, and both stops.
 */
export function lineTrips(s: SimState, line: Line, engine: EngineId, wagons = WAGONS_DEFAULT): number {
  const t = (cargo: number, dir: 1 | -1) => tripTime(s, line, engine, cargo, dir);
  const loaded = Math.max(t(wagons, 1) + t(0, -1), t(wagons, -1) + t(0, 1));
  // at one end the wagons come off, at the other they go on, each at its station's pace
  const stands = line.stops.map((id) => dwellAt(s, s.stations.find((st) => st.id === id)?.cell ?? -1));
  return YEAR_SECONDS / (loaded + 2 * STOP_SECONDS + wagons * (stands[0] + stands[1]));
}

/** what one train of this engine and wagon count does on a line, in seconds a round trip: running, and standing at each end */
function roundTrip(s: SimState, line: Line, engine: EngineId, wagons: number): { run: number; stand: [number, number] } {
  const t = (cargo: number, dir: 1 | -1) => tripTime(s, line, engine, cargo, dir);
  const run = Math.max(t(wagons, 1) + t(0, -1), t(wagons, -1) + t(0, 1));
  const at = (cell: number) => STOP_SECONDS + wagons * dwellAt(s, cell);
  return { run, stand: [at(line.path[0]), at(line.path[line.path.length - 1])] };
}

/**
 * Round trips a year that a line's trains make together, with one more train of this kind when
 * `extra` is given: each train's free-running trips, cut by the shared block (one train on it at a
 * time) and by the platforms at both ends (one train at a time on each). A train the line has no
 * platform for makes none. This is the number the buy card shows, so an extra train that only
 * queues shows as nothing added.
 */
export function lineYear(s: SimState, line: Line, extra?: { engine: EngineId; wagons: number }): { trips: number; each: number[]; limit: 'free' | 'block' | 'platform' | 'parked'; /** the station that holds the line back, for the platform and parked limits */ at: number } {
  const mine = s.trains.filter((o) => o.lineId === line.id).map((o) => ({ t: o as Train | null, engine: o.engine, wagons: o.nWagons, parked: o.parked }));
  if (extra) mine.push({ t: null, engine: extra.engine, wagons: extra.wagons, parked: mine.filter((m) => !m.parked).length >= lineCapacity(s, line) });
  const free = (l: Line, e: EngineId, w: number) => {
    const r = roundTrip(s, l, e, w);
    return { ...r, f: YEAR_SECONDS / (r.run + r.stand[0] + r.stand[1]) };
  };
  const active = mine.filter((m) => !m.parked).map((m) => ({ ...m, ...free(line, m.engine, m.wagons) }));
  // the other trains that use the same block, and the same stations, at their free pace
  const others = s.trains.filter((o) => o.lineId !== line.id && !o.parked).map((o) => ({ line: lineOf(s, o), ...free(lineOf(s, o), o.engine, o.nWagons) }));
  const ends = [line.path[0], line.path[line.path.length - 1]];
  const blockLoad = active.reduce((a, m) => a + m.f * m.run, 0) + others.filter((o) => sharesBlock(o.line, line)).reduce((a, o) => a + o.f * o.run, 0);
  const berth = ends.map((cell, e) => {
    const load = active.reduce((a, m) => a + m.f * m.stand[e], 0) + others.reduce((a, o) => a + (o.line.path[0] === cell ? o.f * o.stand[0] : o.line.path[o.line.path.length - 1] === cell ? o.f * o.stand[1] : 0), 0);
    return load > 0 ? (platformsAt(s, cell) * YEAR_SECONDS) / load : Infinity;
  });
  const byBlock = blockLoad > 0 ? YEAR_SECONDS / blockLoad : Infinity;
  const byBerth = Math.min(...berth);
  const k = Math.min(1, byBlock, byBerth);
  const limit = k >= 1 ? 'free' : byBlock <= byBerth ? 'block' : 'platform';
  const each = mine.map((m) => (m.parked ? 0 : k * free(line, m.engine, m.wagons).f));
  const parked = mine.some((m) => m.parked);
  // the end with the fewer platforms, or the one the trains crowd more
  const pa = platformsAt(s, ends[0]);
  const pb = platformsAt(s, ends[1]);
  const at = parked ? (pa <= pb ? ends[0] : ends[1]) : berth[0] <= berth[1] ? ends[0] : ends[1];
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

/** seconds one wagon takes to unload or to load at a station: a loading crew takes a third off */
export function dwellAt(s: SimState, cell: number): number {
  const st = s.stations.find((o) => o.cell === cell);
  return WAGON_DWELL * (st?.crew ? 1 - CREW_CUT : 1);
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
  if (!t.dock || t.at === null) return null;
  const dwell = dwellAt(s, t.at);
  const progress = 1 - Math.max(0, Math.min(1, t.work / dwell));
  return { wagon: t.dock === 'unload' ? t.unloaded : t.cargo, progress };
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

/** loads of each good a town eats a month */
export function eatsPerMonth(site: Site): number {
  return TOWN_EATS * site.size;
}

/**
 * A town's growth at its present stock: the months until it grows if every month stays supplied,
 * the good that is missing now, and the good whose store runs out before that (with the months it lasts).
 */
export function growthOutlook(s: SimState, site: Site): { months: number; missing: Good | null; runsOut: { good: Good; months: number } | null } {
  const wanted = wantedGoods(s);
  const missing = wanted.find((g) => site.store[g] <= 0.001) ?? null;
  const months = Math.ceil((1 - site.growth) * GROW_MONTHS - 1e-9);
  let runsOut: { good: Good; months: number } | null = null;
  for (const g of wanted) {
    const last = site.store[g] / eatsPerMonth(site);
    if (last < months && (!runsOut || last < runsOut.months)) runsOut = { good: g, months: last };
  }
  return { months, missing, runsOut };
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
export function plan(s: SimState, from: number, to: number): Route[] {
  if (!stationAt(s, from)) return [];
  if (!siteAt(s, to) && !stationAt(s, to)) return [];
  return routeOptions(s, from, to);
}

function pathDist(s: SimState, cells: number[]): number[] {
  const dist = [0];
  for (let k = 1; k < cells.length; k++) dist.push(dist[k - 1] + stepLen(cx(s, cells[k]) - cx(s, cells[k - 1]), cy(s, cells[k]) - cy(s, cells[k - 1])));
  return dist;
}

/**
 * Build a planned route: pay, lay the track, place the station at the end when there is none,
 * and make the line between the two stations when there is none. Returns the line, or null
 * when the cash is short.
 */
export function build(s: SimState, r: Route): Line | null {
  if (r.cost > s.cash) return null;
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
    station = { id: s.nextId++, cell: to, siteId: siteAt(s, to)!.id, crew: false, platforms: PLATFORMS_START };
    s.stations.push(station);
    newStation = station.id;
  }
  const a = stationAt(s, from)!;
  let line = s.lines.find((l) => (l.stops[0] === a.id && l.stops[1] === station!.id) || (l.stops[0] === station!.id && l.stops[1] === a.id));
  let newLine: number | null = null;
  if (!line) {
    line = { id: s.nextId++, stops: [a.id, station.id], path: r.cells, dist: pathDist(s, r.cells), rail: r.rail, worst: r.worst, block: new Set(r.cells.slice(1, -1)), earnedYear: 0, runYear: 0 };
    s.lines.push(line);
    newLine = line.id;
  }
  s.lastBuild = { cost: r.cost, cells: r.added, station: newStation, line: newLine, left: UNDO_SECONDS, cell: to };
  const p = centre(s, to);
  if (r.cost > 0) s.floats.push({ x: p.x, y: p.y, text: `-${r.cost}`, age: 0, kind: 'cost' });
  s.sounds.push('build');
  return line;
}

/** Take the last build back, within its second: the cash returns, the track goes. */
export function undo(s: SimState): boolean {
  const b = s.lastBuild;
  if (!b || b.left <= 0) return false;
  s.cash += b.cost;
  s.assets -= b.cost;
  for (const c of b.cells) s.paid[c] = 0;
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

function engineSpeed(s: SimState, t: Train): number {
  return ENGINES[t.engine].speed * (s.perks.includes('speed') ? PERK_SPEED : 1);
}

/** how many wagons a new train gets when the player does not say: the default, and the year-end wagon */
export function defaultWagons(s: SimState): number {
  return Math.min(WAGONS_MAX, WAGONS_DEFAULT + (s.perks.includes('wagon') ? 1 : 0));
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
  if (activeOn(s, line) < lineCapacity(s, line))
    for (const c of [cell, line.path[line.path.length - 1]]) {
      // a train set down on a platform that another runs in to over the same track would be in that one's way: it parks until that one has arrived
      if (arriving(s, null, c, line)) continue;
      const taken = takenSlots(s, c, null, len);
      for (let k = 0; k < platformsAt(s, c); k++) if (!taken.has(k)) return { cell: c, slot: k, parked: false };
    }
  const used = new Set(s.trains.filter((o) => o.state === 'stop' && o.at === cell).map((o) => o.slot));
  for (let k = platformsAt(s, cell); k < SLOTS_MAX; k++) if (!used.has(k)) return { cell, slot: k, parked: true };
  return null;
}

/** Buy a train on a line: it stands at the line's first stop and takes what the site has. `count` is the number of wagons. */
export function buyTrain(s: SimState, lineId: number, wagons: WagonType, engine: EngineId = 'hilma', count?: number): Train | null {
  const line = s.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const nWagons = count === undefined ? defaultWagons(s) : Math.max(1, Math.min(WAGONS_MAX, Math.round(count)));
  const cost = trainPrice(engine, nWagons);
  if (cost > s.cash) return null;
  const spot = trainSpot(s, line, nWagons);
  if (!spot) return null;
  s.cash -= cost;
  s.lastBuild = null;
  const t: Train = {
    id: s.nextId++,
    lineId,
    engine,
    wagons,
    nWagons,
    fullLoad: false,
    dir: spot.cell === line.path[0] ? 1 : -1,
    s: spot.cell === line.path[0] ? 0 : line.dist[line.dist.length - 1],
    state: 'stop',
    stopLeft: STOP_SECONDS / 2,
    cargo: 0,
    good: null,
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
    unitPay: 0,
    paid: 0,
    unloaded: 0,
  };
  t.speed = engineSpeed(s, t);
  s.trains.push(t);
  const p = centre(s, spot.cell);
  s.floats.push({ x: p.x, y: p.y, text: `-${cost}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return t;
}

/**
 * The station cell a train stands at is a stop of this line, so the train can take it up from
 * there. The cargo it carries stays only when the line's other end takes it; otherwise it goes
 * back to the yard it stands in (when that site makes it) or is lost.
 */
export function canMove(s: SimState, trainId: number, lineId: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  const line = s.lines.find((l) => l.id === lineId);
  if (!t || !line || t.lineId === lineId || t.state !== 'stop' || t.at === null || t.parked) return false;
  if (activeOn(s, line) >= lineCapacity(s, line) || arriving(s, t, t.at!, line)) return false;
  return line.path[0] === t.at || line.path[line.path.length - 1] === t.at;
}

/** Move a train to another line, while it stands at a station both lines serve. */
export function moveTrain(s: SimState, trainId: number, lineId: number): boolean {
  if (!canMove(s, trainId, lineId)) return false;
  const t = s.trains.find((o) => o.id === trainId)!;
  const line = s.lines.find((l) => l.id === lineId)!;
  const at = t.at!;
  const startEnd = line.path[0] === at;
  if (t.cargo > 0 && t.good) {
    const otherCell = startEnd ? line.path[line.path.length - 1] : line.path[0];
    const other = stationAt(s, otherCell);
    const takes = !!other && TAKES[siteById(s, other.siteId).kind].includes(t.good);
    const here = stationAt(s, at);
    const site = here && siteById(s, here.siteId);
    if (!takes) {
      if (site && MAKES[site.kind] === t.good) site.stock += t.cargo;
      t.cargo = 0;
      t.good = null;
    }
  }
  t.lineId = lineId;
  t.dir = startEnd ? -1 : 1;
  t.s = startEnd ? 0 : line.dist[line.dist.length - 1];
  t.odometer = Math.max(t.odometer, 0.001);
  t.dock = null;
  t.work = 0;
  t.unloaded = 0;
  t.unitPay = 0;
  t.stopLeft = Math.max(t.stopLeft, STOP_SECONDS / 2);
  s.sounds.push('buy');
  return true;
}

/** One more wagon on a train, up to the limit. */
export function addWagon(s: SimState, trainId: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || t.nWagons >= WAGONS_MAX || s.cash < WAGON_PRICE) return false;
  s.cash -= WAGON_PRICE;
  t.nWagons++;
  s.sounds.push('buy');
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
  t.speed = engineSpeed(s, t);
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

/** how many trains of a line may run at once: a train needs a platform at each end, so the poorer end sets it */
export function lineCapacity(s: SimState, line: Line): number {
  return Math.min(platformsAt(s, line.path[0]), platformsAt(s, line.path[line.path.length - 1]));
}

/** the trains of a line that are not parked */
export function activeOn(s: SimState, line: Line, except?: Train): number {
  return s.trains.filter((o) => o.lineId === line.id && !o.parked && o !== except).length;
}

function nextStopCell(s: SimState, t: Train): number {
  const line = lineOf(s, t);
  return t.dir === 1 ? line.path[line.path.length - 1] : line.path[0];
}

/** whether two lines share a block: their trains cannot run at once, and one cannot wait on the other's way out */
function sharesBlock(a: Line, b: Line): boolean {
  if (a === b) return true;
  for (const c of a.block) if (b.block.has(c)) return true;
  return false;
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
    const first = line.path[0];
    const last = line.path[line.path.length - 1];
    const to = o.dir === 1 ? last : first;
    const from = o.dir === 1 ? first : last;
    if (to === cell && o.claimed) out.set(o.slot, o);
    else if (from === cell) {
      const originS = o.dir === 1 ? 0 : line.dist[line.dist.length - 1];
      if (Math.abs(o.s - originS) < (drawnLength(o) + len) / 2 + QUEUE_GAP) out.set(o.slotFrom, o);
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
  const cell = dir === 1 ? line.path[line.path.length - 1] : line.path[0];
  const taken = takenSlots(s, cell, t, drawnLength(t));
  if (taken.size < platformsAt(s, cell)) return false;
  // the cells the waiting train would cover: from the hold point back along its line
  const end = line.dist[line.dist.length - 1];
  const hold = holdFront(s, t, cell);
  const len = drawnLength(t);
  const mine = new Set<number>();
  for (let k = 0; k < line.path.length; k++) {
    const d = dir === 1 ? end - line.dist[k] : line.dist[k];
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
 * Whether the line's block has a running train on any of its cells, other than this one. A train
 * waiting on its line for a platform stands still, so it is in the way of the lines that run over
 * the cells it covers and of no others.
 */
function blockBusy(s: SimState, t: Train | null, line: Line): boolean {
  for (const o of s.trains) {
    if (o === t || o.state !== 'run') continue;
    if (!o.queued) {
      if (sharesBlock(lineOf(s, o), line)) return true;
      continue;
    }
    if (lineOf(s, o) === line) return true;
    const body = bodyCells(s, o);
    if (line.path.some((c) => body.has(c))) return true;
  }
  return false;
}

/** The year-end choice, applied once, and the sim runs again; then the goal is judged. */
export function closeYearEnd(s: SimState, choice: YearEndChoice): void {
  if (!s.yearEnd) return;
  s.yearEnd.choice = choice;
  if (!s.perks.includes(choice)) {
    s.perks.push(choice);
    if (choice === 'wagon') for (const t of s.trains) t.nWagons = Math.min(WAGONS_MAX, t.nWagons + 1);
    if (choice === 'speed') for (const t of s.trains) t.speed = engineSpeed(s, t);
    if (choice === 'forest') for (const site of s.sites) if (RAW_RATE[site.kind]) site.rate *= PERK_FOREST;
  }
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
      const base = raw * (s.perks.includes('forest') ? PERK_FOREST : 1);
      const recent = s.time - site.lastPickup < SERVED_MEMORY * (YEAR_SECONDS / MONTHS);
      const target = recent ? base * SERVED_RATE : base;
      site.rate += (target - site.rate) * 0.5;
      site.stock = Math.min(RAW_CAP, site.stock + site.rate);
    }
    if (site.kind === 'town') growMonth(s, site);
    else for (const g of GOODS) site.taken[g] = Math.max(0, site.taken[g] - MILL_EATS);
  }
}

/**
 * A town's month. If every good it wants had stock in its store at the month's start, the growth
 * meter fills by 1 / GROW_MONTHS; a short month drains a smaller step, never below zero. A full
 * meter grows the town then, with a float over it and a sound.
 */
function growMonth(s: SimState, site: Site): void {
  if (site.size >= TOWN_MAX) return;
  const wanted = wantedGoods(s);
  const supplied = wanted.length > 0 && wanted.every((g) => site.store[g] > 0.001);
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

function arrive(t: Train, cell: number): void {
  t.state = 'stop';
  t.queued = false;
  t.siding = false;
  t.waited = 0;
  t.claimed = false;
  t.stopLeft = STOP_SECONDS;
  t.at = cell;
  t.dock = null;
  t.work = 0;
  t.unloaded = 0;
  t.unitPay = 0;
  t.paid = 0;
}

/** the site a standing train is at */
function dockSite(s: SimState, t: Train): Site | null {
  const st = t.at === null ? undefined : stationAt(s, t.at);
  return st ? siteById(s, st.siteId) : null;
}

/** whether the wagons can take what the site makes: the site makes it, the wagons carry it, nothing else is aboard */
function wantsLoad(t: Train, site: Site): boolean {
  const makes = MAKES[site.kind];
  return !!makes && WAGON_GOODS[t.wagons].includes(makes) && (t.cargo === 0 || t.good === makes) && t.cargo < t.nWagons;
}

/**
 * The work at the platform, one wagon's load at a time: first what the site takes comes off,
 * each load paid as it leaves, then what the site makes goes on, each load taken from its pile.
 * Returns whether a load is in hand or waiting to be moved.
 */
function tickDock(s: SimState, t: Train): boolean {
  const site = dockSite(s, t);
  const was = t.dock;
  if (!site) {
    t.dock = null;
    return false;
  }
  const unloading = t.cargo > 0 && t.good !== null && TAKES[site.kind].includes(t.good);
  const loading = !unloading && wantsLoad(t, site) && site.stock >= 1;
  t.dock = unloading ? 'unload' : loading ? 'load' : null;
  if (!t.dock) {
    if (t.paid > 0) {
      const p = centre(s, t.at!);
      s.floats.push({ x: p.x, y: p.y, text: `+${t.paid}`, age: 0, kind: 'pay' });
      t.paid = 0;
    }
    t.unitPay = 0;
    t.unloaded = 0;
    return false;
  }
  const dwell = dwellAt(s, t.at!);
  if (was !== t.dock) t.work = dwell;
  t.work -= DT;
  if (t.work > 0) return true;
  t.work = dwell;
  if (unloading) {
    const good = t.good!;
    if (t.unitPay === 0) t.unitPay = price(s, good, site.id, lineOf(s, t).dist[lineOf(s, t).dist.length - 1]);
    const pay = t.unitPay;
    s.cash += pay;
    s.income[good] += pay;
    t.earned += pay;
    t.earnedYear += pay;
    lineOf(s, t).earnedYear += pay;
    t.paid += pay;
    if (site.kind === 'town') site.store[good] = Math.min(storeCap(site), site.store[good] + 1);
    else site.taken[good] += 1;
    site.delivered += 1;
    t.cargo -= 1;
    t.unloaded += 1;
    if (t.cargo === 0) {
      t.good = null;
      t.unloaded = 0;
    }
    if (s.firstPayAt === null) s.firstPayAt = s.time;
    // a refinery turns the input into its output at once
    if (MAKES[site.kind]) site.stock += 1;
    const goal = s.scenario.goal;
    if (goal.kind === 'deliver' && site.id === goal.site && good === goal.good) {
      s.goalCount += 1;
      if (s.goalCount >= goal.count && !s.result) finish(s, true, 'goal');
    }
    s.sounds.push('pay');
  } else {
    const makes = MAKES[site.kind]!;
    site.stock -= 1;
    t.cargo += 1;
    t.good = makes;
    site.lastPickup = s.time;
    s.sounds.push('load');
  }
  return true;
}

/** whether the train is at a loading stop and set to wait for a full load it has not got */
function waitingForLoad(s: SimState, t: Train): boolean {
  if (!t.fullLoad || t.at === null) return false;
  // a train waiting on the line for this platform goes first: the load it brings may be what this one waits for
  if (queuedFor(s, t.at)) return false;
  const site = dockSite(s, t);
  return !!site && wantsLoad(t, site);
}

function depart(s: SimState, t: Train, line: Line, turn: boolean): boolean {
  if (blockBusy(s, t, line)) return false;
  const end = line.dist[line.dist.length - 1];
  const dir = turn ? (t.dir === 1 ? -1 : 1) : t.dir;
  // a train does not set out for a station whose platforms a train holds that needs this track to leave
  if (!t.siding && destBlocked(s, t, line, dir)) {
    // a train that has waited this long for the platforms ahead sets out and takes a siding there: waiting longer could freeze a ring of stations
    t.waited += DT;
    if (t.waited < PATIENCE_SECONDS) return false;
    t.siding = true;
  }
  t.waited = 0;
  // the train turns: the leading end is the old tail, the engine draws at the front again. The
  // engine starts at the station; the wagons stand behind it on the siding the renderer draws
  t.dir = dir;
  t.s = t.dir === 1 ? 0 : end;
  t.state = 'run';
  t.at = null;
  t.dock = null;
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
  const end = line.dist[line.dist.length - 1];
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
      if (waitingForLoad(s, t)) return;
      // a brand-new train has not turned yet: it stands at a stop facing the other
      const fresh = t.odometer === 0;
      depart(s, t, line, !fresh);
    }
    return;
  }
  // the speed under the leading end: a climb cuts it, more with a load
  const base = engineSpeed(s, t);
  t.speed = base * gradeFactor(t.engine, gradeAlong(line, t.s, t.dir), t.cargo);
  let step = t.speed * DT;
  if (!t.claimed) {
    // near the station the train asks for a platform; with none free it stops on its line, clear of the train that holds it
    const cell = t.dir === 1 ? line.path[line.path.length - 1] : line.path[0];
    const half = drawnLength(t) / 2;
    const front = (t.dir === 1 ? end - t.s : t.s) - half;
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
  if (t.dir === 1 && t.s >= end) {
    t.s = end;
    arrive(t, line.path[line.path.length - 1]);
  } else if (t.dir === -1 && t.s <= 0) {
    t.s = 0;
    arrive(t, line.path[0]);
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
  const total = GOODS.reduce((a, g) => a + income[g], 0);
  const running = Math.round(s.running);
  const engine = Math.round(s.engineUp);
  const track = Math.round(s.trackUp);
  const owed = Math.round(interest);
  const profit = total - running - engine - track - owed;
  // broke: cash below zero with the loan at its ceiling; two year ends in a row end the scenario
  s.broke = s.cash < 0 && s.loan >= loanCeiling(s) - 0.5 ? s.broke + 1 : 0;
  const worth = Math.round(netWorth(s));
  s.yearEnd = { year: s.year, income, running, engine, track, interest: owed, upkeep: running + engine, profit, cash: s.cash, loan: s.loan, worth, choice: null, grew, growth };
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
  s.income = zeroGoods();
  s.upkeep = 0;
  s.running = 0;
  s.engineUp = 0;
  s.trackUp = 0;
  s.year++;
  s.yearFrac = 0;
  s.month = 0;
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
