/**
 * The simulation: the one authority on money, goods, trains and blocks.
 * Headless: nothing here touches the DOM. Sounds are names pushed onto
 * `state.sounds`; the game loop drains them. The step is fixed (DT) and the
 * sim holds while a year-end card waits for its choice or the scenario is
 * over. The player's moves are the exported functions below; the UI and
 * the bot call the same ones.
 */
import type { EngineId, Good, Line, SimState, Train, WagonType, YearEndChoice, Float } from './types';
import { GOODS } from './types';
import { routeOptions, link, unlink, idx, cx, cy, stepLen, gradeOf, DIRS, type Route } from './grid';
import { siteAt, stationAt, siteById, goodsOnMap, zeroGoods } from './state';
import {
  BASE_PRICE, DEMAND_FILL, DEMAND_FLOOR, DIST_BONUS, DIST_CAP, ENGINES, ENGINE_LEN, GRADE_LOAD, GRADE_MAX, GROW_NEED, MAKES, MILL_EATS, MONTHS,
  PERK_FOREST, PERK_SPEED, RAW_CAP, RAW_RATE, RESALE, SERVED_MEMORY, SERVED_RATE, STOP_SECONDS, TAKES, TOWN_EATS, TOWN_MAX, UNDO_SECONDS,
  WAGON_GOODS, WAGON_LEN, WAGON_PRICE, WAGONS_DEFAULT, WAGONS_MAX, YEAR_SECONDS,
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
  const base = ENGINES[engine].speed * (s.perks.includes('speed') ? PERK_SPEED : 1);
  let t = 0;
  for (let k = 1; k < line.path.length; k++) {
    const seg = line.dist[k] - line.dist[k - 1];
    const g = dir * gradeOf(line.rail[k] - line.rail[k - 1], seg);
    t += seg / (base * gradeFactor(engine, g, cargo));
  }
  return t;
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
    station = { id: s.nextId++, cell: to, siteId: siteAt(s, to)!.id };
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

/** Buy a train on a line: it leaves at once from the line's first stop. */
export function buyTrain(s: SimState, lineId: number, wagons: WagonType, engine: EngineId = 'hilma'): Train | null {
  if (s.trains.length >= s.scenario.trainsMax) return null;
  const line = s.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const nWagons = Math.min(WAGONS_MAX, WAGONS_DEFAULT + (s.perks.includes('wagon') ? 1 : 0));
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
    speed: 0,
    odometer: 0,
    earned: 0,
  };
  t.speed = engineSpeed(s, t);
  // a new train stands at its first stop, on the next free platform, and takes what the site has
  t.slot = freeSlot(s, t, line.path[0]);
  s.trains.push(t);
  const st = stationAt(s, line.path[0]);
  if (st) load(s, t, siteById(s, st.siteId));
  const p = centre(s, line.path[0]);
  s.floats.push({ x: p.x, y: p.y, text: `-${cost}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return t;
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

function freeSlot(s: SimState, t: Train, cell: number): number {
  const used = new Set(s.trains.filter((o) => o !== t && (o.at === cell || (o.state === 'run' && nextStopCell(s, o) === cell))).map((o) => o.slot));
  let k = 0;
  while (used.has(k)) k++;
  return k;
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
  if (goal.kind === 'towns' && s.sites.filter((x) => x.kind === 'town').every((x) => x.size >= goal.size)) finish(s, true);
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

function arrive(s: SimState, t: Train, line: Line, cell: number): void {
  t.state = 'stop';
  t.stopLeft = STOP_SECONDS;
  t.at = cell;
  const st = stationAt(s, cell);
  const site = st && siteById(s, st.siteId);
  if (!site) return;
  const p = centre(s, cell);
  // unload what the site takes
  if (t.cargo > 0 && t.good && TAKES[site.kind].includes(t.good)) {
    const n = t.cargo;
    const good = t.good;
    const pay = price(s, good, site.id, line.dist[line.dist.length - 1]) * n;
    s.cash += pay;
    s.income[good] += pay;
    t.earned += pay;
    site.taken[good] += n;
    site.delivered += n;
    site.fed[good] += n;
    t.cargo = 0;
    t.good = null;
    if (s.firstPayAt === null) s.firstPayAt = s.time;
    // a refinery turns the input into its output at once
    if (MAKES[site.kind]) site.stock += n;
    const goal = s.scenario.goal;
    if (goal.kind === 'deliver' && site.id === goal.site && good === goal.good) {
      s.goalCount += n;
      if (s.goalCount >= goal.count && !s.result) finish(s, true);
    }
    s.floats.push({ x: p.x, y: p.y, text: `+${pay}`, age: 0, kind: 'pay' });
    s.sounds.push('pay');
  }
  load(s, t, site);
}

/** load what the site makes, if the wagons take it */
function load(s: SimState, t: Train, site: { kind: keyof typeof MAKES; stock: number; lastPickup: number }): void {
  const makes = MAKES[site.kind];
  if (!makes || !WAGON_GOODS[t.wagons].includes(makes) || site.stock < 1) return;
  if (t.cargo > 0 && t.good !== makes) return;
  const n = Math.min(Math.floor(site.stock), t.nWagons - t.cargo);
  if (n <= 0) return;
  site.stock -= n;
  t.cargo += n;
  t.good = makes;
  site.lastPickup = s.time;
  s.sounds.push('load');
}

/** whether the train is at a loading stop and set to wait for a full load it has not got */
function waitingForLoad(s: SimState, t: Train): boolean {
  if (!t.fullLoad || t.at === null || t.cargo >= t.nWagons) return false;
  const st = stationAt(s, t.at);
  const site = st && siteById(s, st.siteId);
  if (!site) return false;
  const makes = MAKES[site.kind];
  if (!makes || !WAGON_GOODS[t.wagons].includes(makes)) return false;
  load(s, t, site);
  return t.cargo < t.nWagons;
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
  t.slot = freeSlot(s, t, nextStopCell(s, t));
  if (t.odometer === 0) t.odometer = 0.001;
  s.sounds.push('whistle');
  return true;
}

function moveTrain(s: SimState, t: Train): void {
  const line = lineOf(s, t);
  const end = line.dist[line.dist.length - 1];
  if (t.state === 'stop') {
    t.stopLeft -= DT;
    if (t.stopLeft <= 0) {
      if (waitingForLoad(s, t)) {
        t.stopLeft = 1;
        return;
      }
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
    arrive(s, t, line, line.path[line.path.length - 1]);
  } else if (t.dir === -1 && t.s <= 0) {
    t.s = 0;
    arrive(s, t, line, line.path[0]);
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
  for (const t of s.trains) moveTrain(s, t);
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
  const towns = s.sites.filter((x) => x.kind === 'town');
  const need = towns.reduce((a, t) => a + (goal.size - (t.size <= goal.size ? (s.scenario.sites.find((d) => d.id === t.id)?.size ?? 1) : goal.size)), 0);
  const got = towns.reduce((a, t) => a + Math.min(goal.size, t.size) - (s.scenario.sites.find((d) => d.id === t.id)?.size ?? 1), 0);
  return need > 0 ? Math.min(1, got / need) : 1;
}
