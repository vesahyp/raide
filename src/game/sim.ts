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
import { routeOptions, link, unlink, idx, cx, cy, stepLen, gradeOf, DIRS, type Route } from './grid';
import { siteAt, stationAt, siteById, goodsOnMap, zeroGoods } from './state';
import {
  BASE_PRICE, CELL_M, DEMAND_FILL, DEMAND_FLOOR, DIST_BONUS, DIST_CAP, ENGINES, ENGINE_LEN, GRADE_LOAD, GRADE_MAX, CREW_CUT, CREW_PRICE, GROW_NEED, MAKES, MILL_EATS, MONTHS,
  PERK_FOREST, PERK_SPEED, RAW_CAP, RAW_RATE, RESALE, SERVED_MEMORY, SERVED_RATE, STOP_SECONDS, TAKES, TOWN_EATS, TOWN_MAX, UNDO_SECONDS,
  WAGON_DWELL, WAGON_GOODS, WAGON_LEN, WAGON_PRICE, WAGONS_DEFAULT, WAGONS_MAX, YEAR_SECONDS,
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

/** seconds one wagon takes to unload or to load at a station: a loading crew takes a third off */
export function dwellAt(s: SimState, cell: number): number {
  const st = s.stations.find((o) => o.cell === cell);
  return WAGON_DWELL * (st?.crew ? 1 - CREW_CUT : 1);
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

export function distanceFactor(cells: number): number {
  return 1 + (DIST_BONUS - 1) * Math.min(1, cells / DIST_CAP);
}

/** what one load of a good pays at a site right now, carried over a line of this length */
export function price(s: SimState, good: Good, siteId: string, lineLength: number): number {
  const site = siteById(s, siteId);
  return Math.round(BASE_PRICE[good] * demand(site.taken[good]) * distanceFactor(lineLength));
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
  for (let k = 1; k < r.cells.length; k++) link(s, r.cells[k - 1], r.cells[k]);
  const from = r.cells[0];
  const to = r.cells[r.cells.length - 1];
  let station = stationAt(s, to);
  let newStation: number | null = null;
  if (!station) {
    station = { id: s.nextId++, cell: to, siteId: siteAt(s, to)!.id, crew: false };
    s.stations.push(station);
    newStation = station.id;
  }
  const a = stationAt(s, from)!;
  let line = s.lines.find((l) => (l.stops[0] === a.id && l.stops[1] === station!.id) || (l.stops[0] === station!.id && l.stops[1] === a.id));
  let newLine: number | null = null;
  if (!line) {
    line = { id: s.nextId++, stops: [a.id, station.id], path: r.cells, dist: pathDist(s, r.cells), rail: r.rail, worst: r.worst, block: new Set(r.cells.slice(1, -1)) };
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

/** Buy a train on a line: it stands at the line's first stop and takes what the site has. `count` is the number of wagons. */
export function buyTrain(s: SimState, lineId: number, wagons: WagonType, engine: EngineId = 'hilma', count?: number): Train | null {
  if (s.trains.length >= s.scenario.trainsMax) return null;
  const line = s.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const nWagons = count === undefined ? defaultWagons(s) : Math.max(1, Math.min(WAGONS_MAX, Math.round(count)));
  const cost = trainPrice(engine, nWagons);
  if (cost > s.cash) return null;
  s.cash -= cost;
  s.lastBuild = null;
  const t: Train = {
    id: s.nextId++,
    lineId,
    engine,
    wagons,
    nWagons,
    fullLoad: false,
    dir: 1,
    s: 0,
    state: 'stop',
    stopLeft: STOP_SECONDS / 2,
    cargo: 0,
    good: null,
    at: line.path[0],
    slot: 0,
    slotFrom: 0,
    speed: 0,
    odometer: 0,
    earned: 0,
    earnedYear: 0,
    earnedLast: 0,
    dock: null,
    work: 0,
    unitPay: 0,
    paid: 0,
    unloaded: 0,
  };
  t.speed = engineSpeed(s, t);
  // a new train stands at its first stop, on the next free platform track
  t.slot = freeSlot(s, t, line.path[0]);
  t.slotFrom = t.slot;
  s.trains.push(t);
  const p = centre(s, line.path[0]);
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
  if (!t || !line || t.lineId === lineId || t.state !== 'stop' || t.at === null) return false;
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

/** most platform tracks a station has */
export const SLOTS_MAX = 3;

function freeSlot(s: SimState, t: Train, cell: number): number {
  const used = new Set(s.trains.filter((o) => o !== t && (o.at === cell || (o.state === 'run' && nextStopCell(s, o) === cell))).map((o) => o.slot));
  let k = 0;
  while (used.has(k)) k++;
  // a station draws three platform tracks at most: a fourth train shares the last
  return Math.min(k, SLOTS_MAX - 1);
}

function nextStopCell(s: SimState, t: Train): number {
  const line = lineOf(s, t);
  return t.dir === 1 ? line.path[line.path.length - 1] : line.path[0];
}

/** whether the line's block has a running train on any of its cells, other than this one */
function blockBusy(s: SimState, t: Train, line: Line): boolean {
  for (const o of s.trains) {
    if (o === t || o.state !== 'run') continue;
    const ol = lineOf(s, o);
    if (ol === line) return true;
    for (const c of ol.block) if (line.block.has(c)) return true;
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
  if (goal.kind === 'towns' && s.sites.filter((x) => x.kind === 'town' && x.size >= goal.size).length >= goal.count) finish(s, true);
  else if (s.year >= goal.beforeYear) finish(s, false);
}

function finish(s: SimState, won: boolean): void {
  const stars = won ? 1 + s.scenario.stars.filter((x) => s.cash >= x).length : 0;
  s.result = { won, year: s.year, cash: Math.round(s.cash), stars };
  s.sounds.push(won ? 'win' : 'lose');
}

/** months tick: upkeep, production, consumption, demand recovery */
function monthTick(s: SimState): void {
  // the engines' upkeep, a twelfth a month, so the cash never drops in one blow at the year end
  const upkeep = s.trains.reduce((a, t) => a + ENGINES[t.engine].upkeep, 0) / MONTHS;
  s.cash -= upkeep;
  s.upkeep += upkeep;
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
    const eats = site.kind === 'town' ? TOWN_EATS * site.size : MILL_EATS;
    for (const g of GOODS) site.taken[g] = Math.max(0, site.taken[g] - eats);
  }
}

function arrive(t: Train, cell: number): void {
  t.state = 'stop';
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
    t.paid += pay;
    site.taken[good] += 1;
    site.delivered += 1;
    site.fed[good] += 1;
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
      if (s.goalCount >= goal.count && !s.result) finish(s, true);
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
  const site = dockSite(s, t);
  return !!site && wantsLoad(t, site);
}

function depart(s: SimState, t: Train, line: Line, turn: boolean): boolean {
  if (blockBusy(s, t, line)) return false;
  const end = line.dist[line.dist.length - 1];
  // the train turns: the leading end is the old tail, the engine draws at the front again. The
  // engine starts at the station; the wagons stand behind it on the siding the renderer draws
  if (turn) t.dir = t.dir === 1 ? -1 : 1;
  t.s = t.dir === 1 ? 0 : end;
  t.state = 'run';
  t.at = null;
  t.dock = null;
  t.slotFrom = t.slot;
  t.slot = freeSlot(s, t, nextStopCell(s, t));
  if (t.odometer === 0) t.odometer = 0.001;
  s.sounds.push('whistle');
  return true;
}

function runTrain(s: SimState, t: Train): void {
  const line = lineOf(s, t);
  const end = line.dist[line.dist.length - 1];
  if (t.state === 'stop') {
    const busy = tickDock(s, t);
    // the stop's own second runs once the wagons are done
    if (!busy) t.stopLeft -= DT;
    if (t.stopLeft <= 0 && !busy) {
      if (waitingForLoad(s, t)) return;
      // a brand-new train has not turned yet: it stands at stop 0 facing stop 1
      const fresh = t.odometer === 0 && t.at === line.path[0];
      depart(s, t, line, !fresh);
    }
    return;
  }
  // the speed under the leading end: a climb cuts it, more with a load
  const base = engineSpeed(s, t);
  t.speed = base * gradeFactor(t.engine, gradeAlong(line, t.s, t.dir), t.cargo);
  const step = t.speed * DT;
  t.s += t.dir * step;
  t.odometer += step;
  if (t.dir === 1 && t.s >= end) {
    t.s = end;
    arrive(t, line.path[line.path.length - 1]);
  } else if (t.dir === -1 && t.s <= 0) {
    t.s = 0;
    arrive(t, line.path[0]);
  }
}

/** the year end: the towns grow or not, the ledger opens */
function yearEnd(s: SimState): void {
  const last = s.trains.reduce((a, t) => a + ENGINES[t.engine].upkeep, 0) / MONTHS;
  s.cash -= last;
  s.upkeep += last;
  s.cash = Math.round(s.cash);
  const upkeep = Math.round(s.upkeep);
  const income = { ...s.income };
  const grew: string[] = [];
  const goods = goodsOnMap(s).filter((g) => TAKES.town.includes(g));
  for (const site of s.sites) {
    if (site.kind === 'town' && site.size < TOWN_MAX && goods.every((g) => site.fed[g] >= GROW_NEED)) {
      site.size++;
      site.grewAt = s.year;
      grew.push(site.id);
    }
    site.fed = zeroGoods();
  }
  const total = GOODS.reduce((a, g) => a + income[g], 0);
  s.yearEnd = { year: s.year, income, upkeep, profit: total - upkeep, cash: s.cash, choice: null, grew };
  s.history.push({ year: s.year, cash: s.cash, profit: total - upkeep });
  for (const t of s.trains) {
    t.earnedLast = t.earnedYear;
    t.earnedYear = 0;
  }
  s.income = zeroGoods();
  s.upkeep = 0;
  s.year++;
  s.yearFrac = 0;
  s.month = 0;
  s.sounds.push(grew.length ? 'grow' : 'bell');
}

export function step(s: SimState): void {
  if (s.yearEnd || s.result) return;
  s.time += DT;
  if (s.lastBuild) {
    s.lastBuild.left -= DT;
    if (s.lastBuild.left <= 0) s.lastBuild = null;
  }
  for (const f of s.floats) f.age += DT;
  s.floats = s.floats.filter((f) => f.age < 1.6);
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
