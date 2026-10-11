/**
 * The simulation (ADR 0007): RT2's loop, headless, stepped at DT.
 *
 * Sites make cargo into their stock; the stations whose catchment covers a
 * site take it into their waiting cargo. A train runs its route stop to stop
 * over laid track. At each stop it unloads every car whose cargo the station
 * accepts (paid by straight distance, transit time and the station's glut),
 * changes its cars to the stop's list, loads the empty ones with cargo some
 * other stop of the route accepts, waits for a full load when told to, and
 * runs on. A delivery to a converter becomes its product; a delivery to a
 * town grows it. Every month the company pays upkeep and interest; a month
 * that ends in the red borrows if it can, and three that cannot end the game.
 *
 * The player's moves are functions here: buildTrack, removeTrack,
 * buildStation, removeStation, buyTrain, setRoute, replaceLoco, sellTrain,
 * issueBond, repayBond. The UI and the bot call the same ones.
 */
import type { Car, Cargo, LocoId, SimState, Site, Station, StationSize, Stop, Train, Text } from './types';
import { CARGOS } from './types';
import {
  AGE_WEAR, BANKRUPT_MONTHS, BASE_PAY, BOND, BOND_RATE, BOND_STEP, BOOK_SHARE, BREAK_COST, BREAK_SECONDS, BREAK_TILES, BRIDGE_UPKEEP,
  CAR_DWELL, CAR_EMPTY, CAR_FULL, CARS_MAX, CELL_M, CONVERT_RATE, CONVERTS, CREDIT_BASE, CREDIT_SHARE, DIST_FULL, DIST_MIN, EXPECT_SPEED,
  GLUT_DRAIN, GLUT_FLOOR, GLUT_STEP, GROW_BASE, GROW_IN, GROW_OUT, GROW_PER, HASTE, LOCO_LIFE, LOCOS, MAIL_RATE, MONTH_SECONDS, PAPER_HOUSES,
  PAX_RATE, POWER_K, RAW, REFUND, ROLL, SCRAP, SITE_CAP, STATION_GAP, STATIONS, STOP_SECONDS, TOWN_ACCEPT, TOWN_TAKES, TRACK_UPKEEP,
  UPKEEP_AGE, WAITING_CAP, WAITING_DECAY, YEAR_SECONDS, KIND_NAME,
} from './content/economy';
import { DIRS, crow, cx, cy, dirOf, distances, idx, inside, link, linksOf, stepLen, trackPath, unlink, type Route } from './grid';
import { addHome, emptyBook, nextPlot, stationAt, stationById } from './state';

export const DT = 1 / 60;

// ---------------------------------------------------------------- small helpers

function rand(s: SimState): number {
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function centre(s: { w: number }, i: number): { x: number; y: number } {
  return { x: cx(s, i) + 0.5, y: cy(s, i) + 0.5 };
}

export function money(n: number): string {
  const a = Math.abs(n);
  const t = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 1 : 2)} M` : `${Math.round(a)}k`;
  return n < 0 ? `−${t}` : t;
}

export function note(s: SimState, cell: number, text: string, kind: 'pay' | 'cost' | 'note' | 'grow' = 'note'): void {
  const c = centre(s, cell);
  s.floats.push({ x: c.x, y: c.y - 0.6, text, age: 0, kind, life: kind === 'note' ? 2.4 : 1.8 });
}

function news(s: SimState, text: Text, cell?: number): void {
  s.news.push({ text, time: s.time, cell });
  if (s.news.length > 30) s.news.shift();
}

function spend(s: SimState, n: number, as: 'build' | 'fuel' | 'upkeep' | 'repairs' | 'interest'): void {
  s.cash -= n;
  s.book[as] += n;
}

// ---------------------------------------------------------------- catchment

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function catchment(s: SimState, cell: number, size: StationSize): Box {
  const r = STATIONS[size].radius;
  const x = cx(s, cell);
  const y = cy(s, cell);
  return { x0: Math.max(0, x - r), y0: Math.max(0, y - r), x1: Math.min(s.w - 1, x + r), y1: Math.min(s.h - 1, y + r) };
}

const inBox = (s: SimState, b: Box, i: number): boolean => {
  const x = cx(s, i);
  const y = cy(s, i);
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
};

/** what a catchment covers: the industries whose buildings it touches, and each town's houses inside it */
export function covered(s: SimState, cell: number, size: StationSize): { site: Site; homes: number }[] {
  const b = catchment(s, cell, size);
  const out: { site: Site; homes: number }[] = [];
  for (const site of s.sites) {
    if (site.kind === 'town') {
      const n = site.homes.filter((i) => inBox(s, b, i)).length + (inBox(s, b, idx(s, site.cx, site.cy)) ? 1 : 0);
      if (n) out.push({ site, homes: n });
    } else {
      const fx0 = site.cx - 1;
      const fx1 = site.cx + 1;
      const fy0 = site.cy - 1;
      const fy1 = site.cy + 1;
      if (fx1 >= b.x0 && fx0 <= b.x1 && fy1 >= b.y0 && fy0 <= b.y1) out.push({ site, homes: 0 });
    }
  }
  return out;
}

/** the cargo a station at a cell would take in: what a covered industry uses, what a covered town of enough houses wants */
export function acceptsAt(s: SimState, cell: number, size: StationSize): Cargo[] {
  const out = new Set<Cargo>();
  for (const { site, homes } of covered(s, cell, size)) {
    const conv = CONVERTS[site.kind];
    if (conv) out.add(conv.from);
    if (site.kind === 'town' && homes >= TOWN_ACCEPT) for (const c of TOWN_TAKES) if (c !== 'paper' || site.homes.length >= PAPER_HOUSES) out.add(c);
  }
  return CARGOS.filter((c) => out.has(c));
}

export function accepts(s: SimState, st: Station, c: Cargo): boolean {
  const cache = cacheOf(s);
  let v = cache.accepts.get(st.id);
  if (!v) cache.accepts.set(st.id, (v = acceptsAt(s, st.cell, st.size)));
  return v.includes(c);
}

/** the stations whose catchment covers a site, and how much of it */
function coverers(s: SimState, site: Site): { st: Station; homes: number }[] {
  const out: { st: Station; homes: number }[] = [];
  for (const st of s.stations) {
    const hit = covered(s, st.cell, st.size).find((o) => o.site === site);
    if (hit) out.push({ st, homes: hit.homes });
  }
  return out;
}

/** loads a month a station at a cell would get of each cargo: the raw sites' rate, a converter's last month, a town's houses */
export function suppliesAt(s: SimState, cell: number, size: StationSize): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  const add = (c: Cargo, n: number) => (out[c] = (out[c] ?? 0) + n);
  for (const { site, homes } of covered(s, cell, size)) {
    const raw = RAW[site.kind];
    if (raw) add(raw, site.rate);
    const conv = CONVERTS[site.kind];
    if (conv) add(conv.to, Math.max(site.madeLast, site.madeMonth));
    if (site.kind === 'town') {
      add('pax', homes * PAX_RATE);
      add('mail', homes * MAIL_RATE);
    }
  }
  return out;
}

// ---------------------------------------------------------------- prices

export function glutFactor(st: Station, c: Cargo): number {
  return 1 - (1 - GLUT_FLOOR) * Math.min(1, st.glut[c] ?? 0);
}

/** what one load pays: by straight distance, by transit time against the time expected, and by the glut where it lands */
export function pay(c: Cargo, dist: number, transit: number, glut: number): number {
  if (dist < DIST_MIN) return 0;
  const eff = Math.min(dist, DIST_FULL) + Math.max(0, dist - DIST_FULL) * 0.5;
  const base = (BASE_PAY[c] * eff) / 10;
  const expected = dist / EXPECT_SPEED + 4;
  const time = Math.max(0.3, Math.min(1.5, 1 + HASTE[c] * (1 - transit / expected) * 0.6));
  return base * time * glut;
}

/** what a load of a cargo from one station to another pays now, at the expected time */
export function quote(s: SimState, c: Cargo, from: Station, to: Station): number {
  const d = crow(s, from.cell, to.cell);
  return pay(c, d, d / EXPECT_SPEED + 4, glutFactor(to, c));
}

// ---------------------------------------------------------------- track

export function trackCount(s: SimState): { tiles: number; bridges: number } {
  let tiles = 0;
  let bridges = 0;
  for (let i = 0; i < s.track.length; i++)
    if (s.track[i]) {
      tiles++;
      if (s.water[i]) bridges++;
    }
  return { tiles, bridges };
}

export function trackPaid(s: SimState): number {
  let n = 0;
  for (let i = 0; i < s.paid.length; i++) n += s.paid[i];
  return n;
}

/** lay a route the player chose: pay for it, link it, give its new cells their rail */
export function buildTrack(s: SimState, r: Route): boolean {
  if (s.result || r.cost > s.cash || !r.links.length) return false;
  const share = r.cost / Math.max(1, r.added.length);
  r.cells.forEach((c, k) => {
    if (!s.track[c]) {
      s.rail[c] = r.rail[k];
      s.paid[c] += share;
    }
  });
  for (const [a, b] of r.links) link(s, a, b);
  spend(s, r.cost, 'build');
  s.netVersion++;
  s.sounds.push('build');
  note(s, r.cells[r.cells.length - 1], `−${money(r.cost)}`, 'cost');
  return true;
}

/**
 * The piece of track a tap names: the run of plain cells through it, out to the nearest junction,
 * track end or station on each side. Returns the cells, ends included, and the links that go.
 */
export function pieceAt(s: SimState, cell: number): { cells: number[]; links: [number, number][] } | null {
  if (!s.track[cell]) return null;
  const stop = (i: number) => linksOf(s, i).length !== 2 || !!stationAt(s, i);
  const cells = [cell];
  const links: [number, number][] = [];
  if (stop(cell) && linksOf(s, cell).length > 2) return null;
  for (const d of linksOf(s, cell)) {
    let prev = cell;
    let cur = idx(s, cx(s, cell) + DIRS[d][0], cy(s, cell) + DIRS[d][1]);
    links.push([prev, cur]);
    while (!stop(cur) && cells.length < 4000) {
      cells.push(cur);
      const nb = linksOf(s, cur)
        .map((e) => idx(s, cx(s, cur) + DIRS[e][0], cy(s, cur) + DIRS[e][1]))
        .find((n) => n !== prev)!;
      prev = cur;
      cur = nb;
      links.push([prev, cur]);
    }
    if (!cells.includes(cur)) cells.push(cur);
    if (stationAt(s, cell)) break;
  }
  return { cells, links };
}

/** what removing a piece gives back */
export function pieceRefund(s: SimState, piece: { cells: number[]; links: [number, number][] }): number {
  let n = 0;
  // the cells left with no track after the removal are refunded
  const left = new Map<number, number>();
  for (const [a, b] of piece.links) for (const c of [a, b]) left.set(c, (left.get(c) ?? linksOf(s, c).length) - 1);
  for (const [c, k] of left) if (k <= 0) n += s.paid[c];
  return Math.round(n * REFUND * 10) / 10;
}

export function removeTrack(s: SimState, cell: number): boolean {
  if (s.result) return false;
  const piece = pieceAt(s, cell);
  if (!piece) return false;
  const back = pieceRefund(s, piece);
  for (const [a, b] of piece.links) unlink(s, a, b);
  for (const c of piece.cells)
    if (!s.track[c] && !stationAt(s, c)) {
      s.paid[c] = 0;
      s.rail[c] = 0;
    }
  s.cash += back;
  s.book.build -= back;
  s.netVersion++;
  s.sounds.push('remove');
  return true;
}

// ---------------------------------------------------------------- stations

/** why a station cannot stand on a cell, or null when it can */
export function stationBlock(s: SimState, cell: number): 'notrack' | 'bend' | 'bridge' | 'near' | null {
  const m = s.track[cell];
  if (!m) return 'notrack';
  if (s.water[cell]) return 'bridge';
  const axis = stationAxis(m);
  if (axis < 0) return 'bend';
  for (const st of s.stations) if (Math.max(Math.abs(cx(s, st.cell) - cx(s, cell)), Math.abs(cy(s, st.cell) - cy(s, cell))) < STATION_GAP) return 'near';
  return null;
}

/** the axis of a straight piece (0 to 3), or -1 for a bend or a junction */
function stationAxis(m: number): number {
  for (let a = 0; a < 4; a++) if ((m & ~((1 << a) | (1 << (a + 4)))) === 0) return a;
  return -1;
}

function stationName(s: SimState, cell: number): string {
  let best: Site | null = null;
  let bd = Infinity;
  for (const site of s.sites) {
    const d = Math.hypot(site.cx - cx(s, cell), site.cy - cy(s, cell));
    if (d < bd) {
      bd = d;
      best = site;
    }
  }
  const base = best && bd < 12 ? best.name.fi : `Seisake ${cx(s, cell)}`;
  const same = s.stations.filter((st) => st.name === base || st.name.startsWith(`${base} `)).length;
  return same ? `${base} ${same + 1}` : base;
}

export function buildStation(s: SimState, cell: number, size: StationSize): Station | null {
  if (s.result || stationBlock(s, cell)) return null;
  const price = STATIONS[size].price;
  if (price > s.cash) return null;
  spend(s, price, 'build');
  const st: Station = { id: s.nextId++, name: stationName(s, cell), cell, size, axis: stationAxis(s.track[cell]), waiting: {}, glut: {}, builtCost: price };
  s.stations.push(st);
  s.coverVersion++;
  s.sounds.push('build');
  note(s, cell, `−${money(price)}`, 'cost');
  return st;
}

export function removeStation(s: SimState, id: number): boolean {
  const st = stationById(s, id);
  if (!st || s.result) return false;
  s.stations = s.stations.filter((o) => o !== st);
  s.coverVersion++;
  s.cash += st.builtCost * REFUND;
  s.book.build -= st.builtCost * REFUND;
  for (const t of s.trains) {
    t.route = t.route.filter((p) => p.station !== id);
    t.next = Math.min(t.next, Math.max(0, t.route.length - 1));
    if (t.route.length < 2) t.state = 'lost';
  }
  return true;
}

// ---------------------------------------------------------------- trains

export function ageOf(s: SimState, t: Train): number {
  return Math.max(0, s.year + s.yearFrac - t.built);
}

export function reliability(s: SimState, t: Train): number {
  return Math.max(0.3, LOCOS[t.loco].reliability - AGE_WEAR * ageOf(s, t));
}

export function locoValue(s: SimState, t: Train): number {
  return LOCOS[t.loco].price * Math.max(SCRAP, 1 - ageOf(s, t) / LOCO_LIFE);
}

export function locoUpkeep(s: SimState, t: Train): number {
  return LOCOS[t.loco].upkeep * (1 + UPKEEP_AGE * ageOf(s, t));
}

export function locosOnSale(s: SimState): LocoId[] {
  return (Object.keys(LOCOS) as LocoId[]).filter((id) => LOCOS[id].year <= s.year);
}

export function weightOf(t: Train): number {
  let w = LOCOS[t.loco].weight;
  for (const c of t.cars) w += c.load ? CAR_FULL[c.cargo] : CAR_EMPTY;
  return w;
}

/** the speed a locomotive holds on a grade in percent with a train of a weight */
export function speedOn(loco: LocoId, weight: number, grade: number): number {
  const L = LOCOS[loco];
  return Math.min(L.speed, (POWER_K * L.power) / (weight * (ROLL + Math.max(0, grade))));
}

/** seconds to run a list of cells with a locomotive and a train weight, from the rail */
export function runTime(s: SimState, cells: number[], rail: number[], loco: LocoId, weight: number): number {
  let t = 0;
  for (let k = 1; k < cells.length; k++) {
    const len = stepLen(dirOf(s, cells[k - 1], cells[k]));
    const g = ((rail[k] - rail[k - 1]) / (len * CELL_M)) * 100;
    t += len / speedOn(loco, weight, g);
  }
  return t;
}

/** the leg a train runs from one stop to the next over laid track, or null */
export function legPath(s: SimState, from: Station, to: Station): number[] | null {
  return trackPath(s, from.cell, to.cell);
}

export function buyTrain(s: SimState, loco: LocoId, stops: Stop[]): Train | null {
  const L = LOCOS[loco];
  if (s.result || L.price > s.cash || stops.length < 2 || L.year > s.year) return null;
  const first = stationById(s, stops[0].station);
  if (!first) return null;
  spend(s, L.price, 'build');
  const t: Train = {
    id: s.nextId++,
    name: `${s.trains.length + 1}`,
    loco,
    built: s.year + s.yearFrac,
    route: stops.map((p) => ({ ...p, cars: p.cars.slice(0, CARS_MAX) })),
    next: 0,
    cars: [],
    path: [first.cell],
    dist: [0],
    rail: [s.rail[first.cell]],
    pos: 0,
    state: 'stop',
    timer: 0,
    waiting: false,
    speed: 0,
    odometer: 0,
    earnedYear: 0,
    costYear: 0,
    earnedLast: 0,
    costLast: 0,
    profitAll: 0,
    breakdowns: 0,
  };
  s.trains.push(t);
  s.sounds.push('horn');
  arrive(s, t);
  return t;
}

export function setRoute(s: SimState, trainId: number, stops: Stop[]): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || stops.length < 2) return false;
  const at = t.state === 'stop' ? t.route[t.next]?.station : null;
  t.route = stops.map((p) => ({ ...p, cars: p.cars.slice(0, CARS_MAX) }));
  // a train standing at a station of the new route stays there; otherwise it runs on to the first stop
  const k = at !== null ? t.route.findIndex((p) => p.station === at) : -1;
  if (k >= 0) t.next = k;
  else {
    t.next = 0;
    if (t.state !== 'run') reroute(s, t);
  }
  if (t.state === 'lost') reroute(s, t);
  return true;
}

export function replaceLoco(s: SimState, trainId: number, loco: LocoId): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || s.result) return false;
  const cost = LOCOS[loco].price - locoValue(s, t);
  if (cost > s.cash || LOCOS[loco].year > s.year) return false;
  spend(s, cost, 'build');
  t.loco = loco;
  t.built = s.year + s.yearFrac;
  if (t.state === 'broken') t.state = 'run';
  return true;
}

export function sellTrain(s: SimState, trainId: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || s.result) return false;
  const back = locoValue(s, t);
  s.cash += back;
  s.book.build -= back;
  s.trains = s.trains.filter((o) => o !== t);
  return true;
}

/** the train's current leg from the station it last left (or stands at) towards its next stop */
function reroute(s: SimState, t: Train): void {
  const to = stationById(s, t.route[t.next]?.station ?? -1);
  const here = t.path[Math.min(t.path.length - 1, Math.max(0, cellIndexAt(t, t.pos)))];
  if (!to) {
    t.state = 'lost';
    return;
  }
  if (here === to.cell) {
    arrive(s, t);
    return;
  }
  const p = trackPath(s, here, to.cell);
  if (!p) {
    t.state = 'lost';
    t.timer = 1;
    return;
  }
  setLeg(s, t, p);
  t.state = 'run';
}

function setLeg(s: SimState, t: Train, cells: number[]): void {
  t.path = cells;
  t.dist = distances(s, cells);
  t.rail = cells.map((c) => s.rail[c]);
  t.pos = 0;
}

export function cellIndexAt(t: Train, pos: number): number {
  let lo = 0;
  let hi = t.dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.dist[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** a point along a train's leg: the position in tiles, the heading, the rail height */
export function along(s: SimState, t: Train, pos: number): { x: number; y: number; dx: number; dy: number; z: number } {
  const n = t.path.length;
  if (n < 2) {
    const c = centre(s, t.path[0]);
    const st = stationAt(s, t.path[0]);
    const a = st ? st.axis : 0;
    const back = -pos;
    return { x: c.x - DIRS[a][0] * back * (a % 2 ? Math.SQRT1_2 : 1), y: c.y - DIRS[a][1] * back * (a % 2 ? Math.SQRT1_2 : 1), dx: DIRS[a][0], dy: DIRS[a][1], z: s.rail[t.path[0]] };
  }
  const total = t.dist[n - 1];
  if (pos < 0) {
    // behind the start: the tail still on the station's platform, straight back along the first step
    const a = centre(s, t.path[0]);
    const b = centre(s, t.path[1]);
    const len = t.dist[1];
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    return { x: a.x + ux * pos, y: a.y + uy * pos, dx: ux, dy: uy, z: t.rail[0] };
  }
  if (pos >= total) {
    const a = centre(s, t.path[n - 2]);
    const b = centre(s, t.path[n - 1]);
    const len = total - t.dist[n - 2];
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    return { x: b.x + ux * (pos - total), y: b.y + uy * (pos - total), dx: ux, dy: uy, z: t.rail[n - 1] };
  }
  const k = cellIndexAt(t, pos);
  const a = centre(s, t.path[k]);
  const b = centre(s, t.path[k + 1]);
  const len = t.dist[k + 1] - t.dist[k];
  const u = (pos - t.dist[k]) / len;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len, z: t.rail[k] + (t.rail[k + 1] - t.rail[k]) * u };
}

/** the grade under the head of the train, in percent, uphill positive */
function gradeAt(t: Train): number {
  const k = Math.min(t.path.length - 2, cellIndexAt(t, t.pos));
  if (k < 0) return 0;
  const len = t.dist[k + 1] - t.dist[k];
  return ((t.rail[k + 1] - t.rail[k]) / (len * CELL_M)) * 100;
}

/** whether a cargo is accepted at any stop of the route other than the one at index `here` */
function wantedOnRoute(s: SimState, t: Train, here: number, c: Cargo): boolean {
  return t.route.some((p, k) => {
    if (k === here) return false;
    const st = stationById(s, p.station);
    return !!st && accepts(s, st, c);
  });
}

/** a train reaches its next stop: it unloads, changes its cars, and loads */
function arrive(s: SimState, t: Train): void {
  const stop = t.route[t.next];
  const st = stop ? stationById(s, stop.station) : undefined;
  t.state = 'stop';
  t.speed = 0;
  if (!st) {
    t.state = 'lost';
    return;
  }
  let moves = 0;
  let earned = 0;
  // unload what this station takes
  for (const car of t.cars) {
    if (!car.load || car.load.from === st.id || !accepts(s, st, car.cargo)) continue;
    const from = stationById(s, car.load.from);
    const d = from ? crow(s, from.cell, st.cell) : 0;
    const p = pay(car.cargo, d, s.time - car.load.at, glutFactor(st, car.cargo));
    earned += p;
    s.book.byCargo[car.cargo] = (s.book.byCargo[car.cargo] ?? 0) + p;
    deliver(s, st, car.cargo);
    car.load = null;
    moves++;
  }
  if (earned > 0) {
    s.cash += earned;
    s.book.revenue += earned;
    t.earnedYear += earned;
    t.profitAll += earned;
    note(s, st.cell, `+${money(earned)}`, 'pay');
    s.sounds.push('pay');
  }
  // the cars the stop asks for: matching cars are kept, loaded ones first; the rest stay here with their loads
  const keep: Car[] = [];
  const pool = t.cars.slice();
  for (const c of stop.cars) {
    let k = pool.findIndex((o) => o.cargo === c && o.load);
    if (k < 0) k = pool.findIndex((o) => o.cargo === c);
    if (k >= 0) keep.push(pool.splice(k, 1)[0]);
    else {
      keep.push({ cargo: c, load: null });
      moves++;
    }
  }
  for (const o of pool) {
    moves++;
    if (o.load) st.waiting[o.cargo] = Math.min(WAITING_CAP, (st.waiting[o.cargo] ?? 0) + 1);
  }
  t.cars = keep;
  moves += loadCars(s, t, st);
  t.timer = STOP_SECONDS + CAR_DWELL * moves;
  t.waiting = false;
}

/** fill the train's empty cars from what waits at the station, for cargo some other stop takes; the number loaded */
function loadCars(s: SimState, t: Train, st: Station): number {
  let n = 0;
  for (const car of t.cars) {
    if (car.load) continue;
    const w = st.waiting[car.cargo] ?? 0;
    if (w < 1 || !wantedOnRoute(s, t, t.next, car.cargo)) continue;
    st.waiting[car.cargo] = w - 1;
    car.load = { from: st.id, at: s.time };
    n++;
    if (car.cargo === 'pax' || car.cargo === 'mail') for (const { site } of coveredCached(s, st)) if (site.kind === 'town') site.growth += GROW_OUT / 2;
  }
  return n;
}

/** a load lands at a station: the glut rises, a converter takes it in, a town grows */
function deliver(s: SimState, st: Station, c: Cargo): void {
  st.glut[c] = Math.min(1.5, (st.glut[c] ?? 0) + GLUT_STEP[c]);
  s.hauled[c] = (s.hauled[c] ?? 0) + 1;
  const cov = coveredCached(s, st);
  const conv = cov.find((o) => CONVERTS[o.site.kind]?.from === c);
  if (conv) {
    conv.site.input[c] = (conv.site.input[c] ?? 0) + 1;
    conv.site.delivered++;
    return;
  }
  const town = cov.filter((o) => o.site.kind === 'town').sort((a, b) => b.homes - a.homes)[0];
  if (town) {
    town.site.growth += GROW_IN;
    town.site.delivered++;
  }
}

function depart(s: SimState, t: Train): void {
  const here = stationById(s, t.route[t.next]?.station ?? -1);
  t.next = (t.next + 1) % t.route.length;
  const to = stationById(s, t.route[t.next]?.station ?? -1);
  if (!here || !to) {
    t.state = 'lost';
    return;
  }
  for (const car of t.cars) if (car.load && car.load.from === here.id) car.load.at = s.time;
  const p = here.cell === to.cell ? null : trackPath(s, here.cell, to.cell);
  if (!p) {
    // no way there: the train waits here and tries again
    t.next = (t.next + t.route.length - 1) % t.route.length;
    t.state = 'lost';
    t.timer = 1;
    return;
  }
  setLeg(s, t, p);
  t.state = 'run';
  t.speed = 0;
}

function runTrain(s: SimState, t: Train): void {
  if (t.state === 'stop') {
    if (t.timer > 0) {
      t.timer -= DT;
      return;
    }
    const stop = t.route[t.next];
    const st = stop ? stationById(s, stop.station) : undefined;
    if (stop?.waitFull && st && t.cars.some((c) => !c.load)) {
      loadCars(s, t, st);
      if (t.cars.some((c) => !c.load && wantedOnRoute(s, t, t.next, c.cargo))) {
        t.waiting = true;
        return;
      }
    }
    t.waiting = false;
    depart(s, t);
    return;
  }
  if (t.state === 'broken') {
    t.timer -= DT;
    if (t.timer <= 0) t.state = 'run';
    return;
  }
  if (t.state === 'lost') {
    t.timer -= DT;
    if (t.timer > 0) return;
    t.timer = 1;
    if (t.route.length < 2) return;
    // stood at a stop: try the leg again; on the way: find the way from where it is
    const here = t.path[Math.min(t.path.length - 1, cellIndexAt(t, t.pos))];
    const stHere = stationAt(s, here);
    if (stHere && t.route[t.next]?.station === stHere.id) {
      t.state = 'stop';
      t.timer = 0;
      return;
    }
    reroute(s, t);
    return;
  }
  // running: the leg may have been cut since it began
  const total = t.dist[t.dist.length - 1];
  const W = weightOf(t);
  let target = speedOn(t.loco, W, gradeAt(t));
  // brake for the stop ahead
  const left = total - t.pos;
  target = Math.min(target, Math.sqrt(2 * 1.2 * Math.max(0, left)) + 0.25);
  t.speed += (target - t.speed) * Math.min(1, DT * (target > t.speed ? 1.2 : 4));
  const step = Math.min(left, Math.max(0.02, t.speed) * DT);
  const k0 = cellIndexAt(t, t.pos);
  t.pos += step;
  t.odometer += step;
  const k1 = cellIndexAt(t, t.pos);
  if (k1 !== k0 && !s.track[t.path[k1]]) {
    t.state = 'lost';
    t.timer = 1;
    return;
  }
  const L = LOCOS[t.loco];
  const fuel = L.fuel * (W / 10) * step;
  spend(s, fuel, 'fuel');
  t.costYear += fuel;
  t.profitAll -= fuel;
  if (rand(s) < ((1 - reliability(s, t)) / BREAK_TILES) * step) {
    t.state = 'broken';
    t.timer = BREAK_SECONDS;
    t.breakdowns++;
    spend(s, BREAK_COST, 'repairs');
    t.costYear += BREAK_COST;
    t.profitAll -= BREAK_COST;
    s.sounds.push('break');
    const c = t.path[k1];
    note(s, c, `−${money(BREAK_COST)}`, 'cost');
    news(s, { fi: `Juna ${t.name} hajosi`, en: `Train ${t.name} broke down` }, c);
    return;
  }
  if (t.pos >= total - 1e-6) {
    t.pos = total;
    t.next = t.next % t.route.length;
    arrive(s, t);
  }
}

// ---------------------------------------------------------------- production

function produce(s: SimState): void {
  const per = DT / MONTH_SECONDS;
  for (const site of s.sites) {
    const raw = RAW[site.kind];
    if (raw) site.stock[raw] = Math.min(SITE_CAP, (site.stock[raw] ?? 0) + site.rate * per);
    const conv = CONVERTS[site.kind];
    if (conv) {
      const work = Math.min(site.input[conv.from] ?? 0, CONVERT_RATE * per);
      if (work > 0) {
        site.input[conv.from]! -= work;
        site.stock[conv.to] = Math.min(SITE_CAP, (site.stock[conv.to] ?? 0) + work);
        site.madeMonth += work;
      }
    }
  }
  // stations take what the sites they cover hold
  for (const site of s.sites) {
    if (site.kind === 'town') continue;
    const by = coverersCached(s, site);
    if (!by.length) continue;
    for (const c of Object.keys(site.stock) as Cargo[]) {
      const have = site.stock[c] ?? 0;
      if (have <= 0) continue;
      const st = by.reduce((a, b) => ((a.waiting[c] ?? 0) <= (b.waiting[c] ?? 0) ? a : b));
      const room = WAITING_CAP - (st.waiting[c] ?? 0);
      const move = Math.min(have, Math.max(0, room));
      st.waiting[c] = (st.waiting[c] ?? 0) + move;
      site.stock[c] = have - move;
    }
  }
  // towns make passengers and mail at the stations that cover their houses
  for (const st of s.stations) {
    for (const { site, homes } of coveredCached(s, st)) {
      if (site.kind !== 'town') continue;
      const share = homes / Math.max(1, sharers(s, site, st));
      st.waiting.pax = Math.min(WAITING_CAP, (st.waiting.pax ?? 0) + share * PAX_RATE * per);
      st.waiting.mail = Math.min(WAITING_CAP, (st.waiting.mail ?? 0) + share * MAIL_RATE * per);
    }
  }
}

/** how many stations cover a town: its passengers are shared between them */
function sharers(s: SimState, site: Site, _st: Station): number {
  return coverersCached(s, site).length || 1;
}

// the catchment lists change only when a station or a house does: cached per state, dropped on a change
interface Caches {
  key: number;
  accepts: Map<number, Cargo[]>;
  cover: Map<number, { site: Site; homes: number }[]>;
  coverers: Map<string, Station[]>;
}
const caches = new WeakMap<SimState, Caches>();
function cacheOf(s: SimState): Caches {
  const key = s.coverVersion;
  let c = caches.get(s);
  if (!c || c.key !== key) caches.set(s, (c = { key, cover: new Map(), coverers: new Map(), accepts: new Map() }));
  return c;
}
function coveredCached(s: SimState, st: Station): { site: Site; homes: number }[] {
  const c = cacheOf(s);
  let v = c.cover.get(st.id);
  if (!v) c.cover.set(st.id, (v = covered(s, st.cell, st.size)));
  return v;
}
function coverersCached(s: SimState, site: Site): Station[] {
  const c = cacheOf(s);
  let v = c.coverers.get(site.id);
  if (!v) c.coverers.set(site.id, (v = coverers(s, site).map((o) => o.st)));
  return v;
}

// ---------------------------------------------------------------- money

export function debt(s: SimState): number {
  return s.bonds.reduce((n, b) => n + b.amount, 0);
}

export function trainsValue(s: SimState): number {
  return s.trains.reduce((n, t) => n + locoValue(s, t), 0);
}

export function bookValue(s: SimState): number {
  return BOOK_SHARE * (trackPaid(s) + s.stations.reduce((n, o) => n + o.builtCost, 0)) + trainsValue(s);
}

export function worth(s: SimState): number {
  return s.cash - debt(s) + bookValue(s);
}

export function creditLimit(s: SimState): number {
  return CREDIT_BASE + CREDIT_SHARE * bookValue(s);
}

export function nextBondRate(s: SimState): number {
  return BOND_RATE + BOND_STEP * s.bonds.length;
}

export function canIssue(s: SimState): boolean {
  return debt(s) + BOND <= creditLimit(s) + 1e-6;
}

export function issueBond(s: SimState): boolean {
  if (s.result || !canIssue(s)) return false;
  s.bonds.push({ amount: BOND, rate: nextBondRate(s) });
  s.cash += BOND;
  s.sounds.push('pay');
  return true;
}

/** pay back the dearest bond */
export function repayBond(s: SimState): boolean {
  if (s.result || !s.bonds.length || s.cash < BOND) return false;
  let k = 0;
  s.bonds.forEach((b, i) => b.rate > s.bonds[k].rate && (k = i));
  s.cash -= s.bonds[k].amount;
  s.bonds.splice(k, 1);
  return true;
}

export function interestYear(s: SimState): number {
  return s.bonds.reduce((n, b) => n + b.amount * b.rate, 0);
}

export function upkeepYear(s: SimState): { track: number; stations: number; locos: number } {
  const { tiles, bridges } = trackCount(s);
  return {
    track: (tiles - bridges) * TRACK_UPKEEP + bridges * BRIDGE_UPKEEP,
    stations: s.stations.reduce((n, o) => n + STATIONS[o.size].upkeep, 0),
    locos: s.trains.reduce((n, t) => n + locoUpkeep(s, t), 0),
  };
}

function monthEnd(s: SimState): void {
  const up = upkeepYear(s);
  spend(s, (up.track + up.stations) / 12, 'upkeep');
  for (const t of s.trains) {
    const u = locoUpkeep(s, t) / 12;
    spend(s, u, 'upkeep');
    t.costYear += u;
    t.profitAll -= u;
  }
  spend(s, interestYear(s) / 12, 'interest');
  for (const st of s.stations) {
    for (const c of Object.keys(st.glut) as Cargo[]) st.glut[c] = (st.glut[c] ?? 0) * (1 - GLUT_DRAIN);
    for (const c of Object.keys(st.waiting) as Cargo[]) st.waiting[c] = (st.waiting[c] ?? 0) * (1 - WAITING_DECAY);
  }
  s.sites.forEach((site, k) => {
    site.madeLast = site.madeMonth;
    site.madeMonth = 0;
    if (site.kind === 'town') {
      const need = GROW_BASE + GROW_PER * site.homes.length;
      if (site.growth >= need) {
        const p = nextPlot(s, site);
        if (p >= 0) {
          site.growth -= need;
          addHome(s, k, p);
          s.sounds.push('grow');
          note(s, p, site.name.fi, 'grow');
          news(s, { fi: `${site.name.fi} kasvoi`, en: `${site.name.fi} grew` }, p);
        }
      }
    }
  });
  // the red: borrow when there is credit, and count the months when there is none
  if (s.cash < 0) {
    if (issueBond(s)) news(s, { fi: 'Kassa miinuksella: pakkolaina', en: 'Cash below zero: a bond was issued' });
    else {
      s.red++;
      news(s, { fi: `Kassa miinuksella, ei luottoa (${s.red}/${BANKRUPT_MONTHS})`, en: `Cash below zero, no credit (${s.red}/${BANKRUPT_MONTHS})` });
      if (s.red >= BANKRUPT_MONTHS) finish(s, 'bankrupt');
    }
  } else s.red = 0;
  checkGoal(s);
}

function yearEnd(s: SimState): void {
  const b = s.book;
  const profit = b.revenue - b.fuel - b.upkeep - b.repairs - b.interest;
  const ye = { year: s.year, revenue: b.revenue, fuel: b.fuel, upkeep: b.upkeep, repairs: b.repairs, interest: b.interest, build: b.build, profit, cash: s.cash, debt: debt(s), worth: worth(s) };
  s.lastYear = ye;
  s.history.push(ye);
  s.book = emptyBook();
  for (const t of s.trains) {
    t.earnedLast = t.earnedYear;
    t.costLast = t.costYear;
    t.earnedYear = 0;
    t.costYear = 0;
  }
  if (s.year >= s.scenario.goal.byYear && !s.result) finish(s, 'deadline');
}

export function goalValue(s: SimState): number {
  const g = s.scenario.goal;
  return g.kind === 'worth' ? worth(s) : s.hauled[g.cargo] ?? 0;
}

function checkGoal(s: SimState): void {
  const g = s.scenario.goal;
  const v = goalValue(s);
  let tier = 0;
  g.tiers.forEach((n, k) => v >= n && (tier = k + 1));
  s.tier = Math.max(s.tier, tier);
  if (s.tier === 3 && !s.result) finish(s, 'gold');
}

function finish(s: SimState, reason: 'gold' | 'deadline' | 'bankrupt'): void {
  if (s.result) return;
  const won = reason !== 'bankrupt' && s.tier > 0;
  s.result = { won, tier: reason === 'bankrupt' ? 0 : s.tier, year: s.year, worth: worth(s), reason, time: s.time };
  s.sounds.push(won ? 'win' : 'lose');
}

// ---------------------------------------------------------------- the step

export function step(s: SimState): void {
  if (s.result) return;
  s.time += DT;
  produce(s);
  for (const t of s.trains) runTrain(s, t);
  const yf = s.yearFrac + DT / YEAR_SECONDS;
  const month = Math.floor(yf * 12);
  if (month !== s.month && month < 12) {
    s.month = month;
    monthEnd(s);
  }
  if (yf >= 1) {
    s.yearFrac = 0;
    s.month = 0;
    monthEnd(s);
    yearEnd(s);
    s.year++;
  } else s.yearFrac = yf;
  for (const f of s.floats) f.age += DT;
  s.floats = s.floats.filter((f) => f.age < (f.life ?? 1.8));
}

// ---------------------------------------------------------------- advice for the cards and the bot

/** a sensible consist for each stop: cargo the stop supplies that the next stop (or any other) takes, up to four cars */
export function autoCars(s: SimState, stations: Station[]): Cargo[][] {
  const n = stations.length;
  const takes = stations.map((o) => acceptsAt(s, o.cell, o.size));
  const picks = stations.map((st, i) => {
    const sup = suppliesAt(s, st.cell, st.size);
    // a converter here makes its product from what the route brings it, even before the first load
    for (const { site } of covered(s, st.cell, st.size)) {
      const conv = CONVERTS[site.kind];
      if (conv && stations.some((o, k) => k !== i && (suppliesAt(s, o.cell, o.size)[conv.from] ?? 0) > 0)) sup[conv.to] = Math.max(sup[conv.to] ?? 0, CONVERT_RATE / 2);
    }
    const others = new Set(stations.filter((_, k) => k !== i).flatMap((o) => acceptsAt(s, o.cell, o.size)));
    const list = (Object.keys(sup) as Cargo[]).filter((c) => (sup[c] ?? 0) > 0.05 && others.has(c));
    list.sort((a, b) => (sup[b] ?? 0) - (sup[a] ?? 0));
    const cars: Cargo[] = [];
    const total = list.reduce((m, c) => m + (sup[c] ?? 0), 0);
    for (const c of list) for (let k = 0; k < Math.max(1, Math.round((4 * (sup[c] ?? 0)) / total)); k++) if (cars.length < 4) cars.push(c);
    return cars;
  });
  // cars picked up at a stop ride on through the stops that do not take their cargo, to the first that does
  return stations.map((_, i) => {
    const cars: Cargo[] = [];
    for (let back = 1; back < n; back++) {
      const j = (i - back + n) % n;
      for (const c of picks[j]) {
        let landed = false;
        for (let k = 1; k <= back && !landed; k++) if (takes[(j + k) % n].includes(c)) landed = true;
        if (!landed) cars.push(c);
      }
    }
    return [...cars, ...picks[i]].slice(0, CARS_MAX);
  });
}

/** whether a cell is on the map and free of buildings: a place track can start or end */
export function buildable(s: SimState, x: number, y: number): boolean {
  return inside(s, x, y) && !s.blocked[idx(s, x, y)];
}

export function siteName(site: Site): Text {
  return site.kind === 'town' ? site.name : { fi: `${site.name.fi} (${KIND_NAME[site.kind].fi.toLowerCase()})`, en: `${site.name.en} (${KIND_NAME[site.kind].en.toLowerCase()})` };
}

export { idx, DIRS };
