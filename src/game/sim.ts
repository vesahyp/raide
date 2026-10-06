/**
 * The simulation: the one authority on money, goods, trains and blocks.
 * Headless: nothing here touches the DOM. Sounds are names pushed onto
 * `state.sounds`; the game loop drains them. The step is fixed (DT) and the
 * sim holds while a year-end card waits for its choice or the scenario is
 * over.
 */
import type { Good, Line, SimState, Train, WagonType, YearEndChoice, Float } from './types';
import { route, link, unlink, idx, cx, cy, stepLen, type Route } from './grid';
import { siteAt, stationAt } from './state';
import {
  BASE_PRICE, DEMAND_FILL, DEMAND_FLOOR, DIST_BONUS, DIST_CAP, ENGINE, ENGINE_LEN, FOREST_CAP, FOREST_RATE, GOOD_WAGON, MAKES, MONTHS,
  PERK_FOREST, PERK_SPEED, SERVED_MEMORY, SERVED_RATE, STARS, STOP_SECONDS, TAKES, TOWN_EATS, TRAINS_MAX, UNDO_SECONDS, WAGON_GOOD, WAGON_LEN,
  WAGON_PRICE, WAGONS_DEFAULT, WAGONS_MAX, YEAR_SECONDS,
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
  const site = s.sites.find((x) => x.id === siteId)!;
  return Math.round(BASE_PRICE[good] * demand(site.taken) * distanceFactor(lineLength));
}

export function trainPrice(nWagons = WAGONS_DEFAULT): number {
  return ENGINE.price + nWagons * WAGON_PRICE;
}

/** the route a drag from a station cell to a site or station cell would build, or null */
export function plan(s: SimState, from: number, to: number): Route | null {
  if (!stationAt(s, from)) return null;
  if (!siteAt(s, to) && !stationAt(s, to)) return null;
  return route(s, from, to);
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
    line = { id: s.nextId++, stops: [a.id, station.id], path: r.cells, dist: pathDist(s, r.cells), block: new Set(r.cells.slice(1, -1)) };
    s.lines.push(line);
    newLine = line.id;
  }
  s.lastBuild = { cost: r.cost, cells: r.added, station: newStation, line: newLine, left: UNDO_SECONDS, cell: to };
  const p = centre(s, to);
  s.floats.push({ x: p.x, y: p.y, text: `-${r.cost}`, age: 0, kind: 'cost' });
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
      const [dx, dy] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][d];
      unlink(s, i, idx(s, cx(s, i) + dx, cy(s, i) + dy));
    }
  }
  // a line that used a removed cell is gone too
  s.lines = s.lines.filter((l) => !l.path.some((c) => gone.has(c)));
  s.lastBuild = null;
  s.sounds.push('undo');
  return true;
}

/** Buy a train on a line: it leaves at once from the line's first stop. */
export function buyTrain(s: SimState, lineId: number, wagons: WagonType): Train | null {
  if (s.trains.length >= TRAINS_MAX) return null;
  const line = s.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const nWagons = Math.min(WAGONS_MAX, WAGONS_DEFAULT + (s.perks.includes('wagon') ? 1 : 0));
  const cost = trainPrice(nWagons);
  if (cost > s.cash) return null;
  s.cash -= cost;
  s.lastBuild = null;
  const t: Train = {
    id: s.nextId++,
    lineId,
    wagons,
    nWagons,
    dir: 1,
    s: 0,
    state: 'stop',
    stopLeft: STOP_SECONDS / 2,
    cargo: 0,
    at: line.path[0],
    slot: 0,
    speed: ENGINE.speed * (s.perks.includes('speed') ? PERK_SPEED : 1),
    odometer: 0,
  };
  // a new train stands at its first stop, on the next free platform
  t.slot = freeSlot(s, t, line.path[0]);
  s.trains.push(t);
  const p = centre(s, line.path[0]);
  s.floats.push({ x: p.x, y: p.y, text: `-${cost}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return t;
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

/** The year-end choice, applied once, and the sim runs again. */
export function closeYearEnd(s: SimState, choice: YearEndChoice): void {
  if (!s.yearEnd) return;
  s.yearEnd.choice = choice;
  if (!s.perks.includes(choice)) {
    s.perks.push(choice);
    if (choice === 'wagon') for (const t of s.trains) t.nWagons = Math.min(WAGONS_MAX, t.nWagons + 1);
    if (choice === 'speed') for (const t of s.trains) t.speed = ENGINE.speed * PERK_SPEED;
    if (choice === 'forest') for (const site of s.sites) if (site.kind === 'forest') site.rate *= PERK_FOREST;
  }
  s.yearEnd = null;
  if (s.year >= s.scenario.goal.beforeYear && !s.result) finish(s, false);
}

function finish(s: SimState, won: boolean): void {
  const stars = won ? 1 + STARS.filter((x) => s.cash >= x).length : 0;
  s.result = { won, year: s.year, cash: s.cash, stars };
  s.sounds.push(won ? 'win' : 'lose');
}

/** months tick: production, consumption, demand recovery */
function monthTick(s: SimState): void {
  for (const site of s.sites) {
    if (site.kind === 'forest') {
      // a served forest cuts more: the rate climbs while pickups keep coming and falls back after
      const base = FOREST_RATE * (s.perks.includes('forest') ? PERK_FOREST : 1);
      const recent = s.time - site.lastPickup < SERVED_MEMORY * (YEAR_SECONDS / MONTHS);
      const target = recent ? base * SERVED_RATE : base;
      site.rate += (target - site.rate) * 0.5;
      site.stock = Math.min(FOREST_CAP, site.stock + site.rate);
    }
    if (site.kind === 'town') {
      site.taken = Math.max(0, site.taken - TOWN_EATS);
    }
    if (site.kind === 'sawmill') {
      site.taken = Math.max(0, site.taken - TOWN_EATS);
    }
  }
}

function arrive(s: SimState, t: Train, line: Line, cell: number): void {
  t.state = 'stop';
  t.stopLeft = STOP_SECONDS;
  t.at = cell;
  const st = stationAt(s, cell);
  const site = st && s.sites.find((x) => x.id === st.siteId);
  if (!site) return;
  const good = WAGON_GOOD[t.wagons];
  const p = centre(s, cell);
  // unload what the site takes
  if (t.cargo > 0 && TAKES[site.kind] === good) {
    const n = t.cargo;
    const pay = price(s, good, site.id, line.dist[line.dist.length - 1]) * n;
    s.cash += pay;
    s.income[good] += pay;
    site.taken += n;
    site.delivered += n;
    t.cargo = 0;
    if (s.firstPayAt === null) s.firstPayAt = s.time;
    // a refinery turns the input into its output at once
    const makes = MAKES[site.kind];
    if (makes) site.stock += n;
    if (site.id === s.scenario.goal.site && good === s.scenario.goal.good) s.goalCount += n;
    s.floats.push({ x: p.x, y: p.y, text: `+${pay}`, age: 0, kind: 'pay' });
    s.sounds.push('pay');
    if (s.goalCount >= s.scenario.goal.count && !s.result) finish(s, true);
  }
  // load what the site makes, if the wagons take it
  if (MAKES[site.kind] === good && site.stock > 0) {
    const n = Math.min(Math.floor(site.stock), t.nWagons - t.cargo);
    if (n > 0) {
      site.stock -= n;
      t.cargo += n;
      site.lastPickup = s.time;
      s.sounds.push('load');
    }
  }
}

function depart(s: SimState, t: Train, line: Line): boolean {
  if (blockBusy(s, t, line)) return false;
  const end = line.dist[line.dist.length - 1];
  const L = Math.min(trainLength(t), end * 0.45);
  // the train turns: the leading end is the old tail, the engine draws at the front again
  t.dir = t.dir === 1 ? -1 : 1;
  t.s = t.dir === 1 ? L : end - L;
  t.state = 'run';
  t.at = null;
  t.slot = freeSlot(s, t, nextStopCell(s, t));
  s.sounds.push('whistle');
  return true;
}

function moveTrain(s: SimState, t: Train): void {
  const line = lineOf(s, t);
  const end = line.dist[line.dist.length - 1];
  if (t.state === 'stop') {
    t.stopLeft -= DT;
    if (t.stopLeft <= 0) {
      // a brand-new train has not turned yet: it stands at stop 0 facing stop 1
      if (t.odometer === 0 && t.at === line.path[0]) {
        if (!blockBusy(s, t, line)) {
          t.dir = 1;
          t.s = Math.min(trainLength(t), end * 0.45);
          t.state = 'run';
          t.at = null;
          t.slot = freeSlot(s, t, nextStopCell(s, t));
          t.odometer = 0.001;
          s.sounds.push('whistle');
        }
      } else depart(s, t, line);
    }
    return;
  }
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
  if (month > s.month) {
    s.month = month;
    monthTick(s);
  }
  s.yearFrac = frac;
  for (const t of s.trains) moveTrain(s, t);
  if (s.yearFrac >= 1) {
    const upkeep = s.trains.length * ENGINE.upkeep;
    s.cash -= upkeep;
    const income = { ...s.income };
    s.yearEnd = { year: s.year, income, upkeep, profit: income.timber + income.boards - upkeep, cash: s.cash, choice: null };
    s.income = { timber: 0, boards: 0 };
    s.year++;
    s.yearFrac = 0;
    s.month = 0;
    s.sounds.push('bell');
  }
}

/** the goal good's wagon, for the train card's default */
export function wagonFor(good: Good): WagonType {
  return GOOD_WAGON[good];
}

/** a note that floats off a point, for the UI */
export function note(s: SimState, cell: number, text: string): void {
  const p = centre(s, cell);
  const f: Float = { x: p.x, y: p.y, text, age: 0, kind: 'note' };
  s.floats.push(f);
}
