/**
 * The simulation: the one authority on money, goods, trains and growth.
 * Headless: nothing here touches the DOM. Sounds are names pushed onto
 * `state.sounds`; the game loop drains them. The step is fixed (DT) and the
 * sim holds while an upgrade pick waits for its choice or the scenario is
 * over. The player's moves are the exported functions below; the UI and
 * the bot call the same ones.
 *
 * Every line owns its double track (ADR 0005): trains of one line in one
 * direction keep a gap and wait behind each other at the platform, trains
 * in opposite directions pass, and lines never wait for each other. Every
 * load a town gets grows it, and every half minute the player picks one of
 * two upgrades (ADR 0006).
 */
import type { Cargo, EngineId, Good, Line, PerkId, Perks, SimState, Site, SiteKind, Train, WagonType, Float } from './types';
import { CARGOS, GOODS } from './types';
import { routeOptions, link, unlink, idx, cx, cy, stepLen, gradeOf, DIRS, STATION_COST, type Route } from './grid';
import { siteAt, stationAt, siteById, goodsOnMap, zeroCargo } from './state';
import {
  BANKRUPT_YEARS, BASE_PRICE, BRIDGE_UPKEEP, CELL_M, DEMAND_FILL, DEMAND_FLOOR, DIST_BONUS, DIST_CAP, ENGINES, ENGINE_LEN, GRADE_LOAD, GRADE_MAX, LIFT_BACK, LOAN_BASE, LOAN_RATE, LOAN_SHARE, MAKES, MILL_EATS, MONTHS,
  RAW_RATE, RESALE, SERVED_MEMORY, SERVED_RATE, STOP_SECONDS, TAKES, TOWN_EATS, EAT_GROWTH, TOWN_MAX, TOWN_STORE_CAP, TRACK_UPKEEP, UNDO_SECONDS, GROW_NEED, VARIETY_BONUS, VARIETY_SECONDS,
  WAGON_DWELL, WAGON_LEN, WAGON_PRICE, WAGON_RUN, WAGONS_DEFAULT, WAGONS_MAX, YEAR_SECONDS, STATION_LINES, WAIT_FULL, FOLLOW_GAP, wagonFor,
  PICK_SECONDS, PERK_MAX, PERK_SPEED, PERK_OUTPUT, PERK_LOADING, PERK_TRACK, PERK_FAIR, PERK_CASH, PERK_CASH_STEP,
} from './content/economy';

export const DT = 1 / 60;

/** the most platform tracks a station draws: one a line */
export const SLOTS_MAX = STATION_LINES;

// ------------------------------------------------------------------ geometry along a line

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

/** the length of a line in cells */
export function lineLength(line: Line): number {
  return line.dist[line.dist.length - 1];
}

function stopKind(s: SimState, line: Line, i: number): SiteKind {
  return stopSite(s, line, i).kind;
}

/** the site a stop of the line stands at */
export function stopSite(s: SimState, line: Line, i: number): Site {
  const st = s.stations.find((o) => o.id === line.stops[i])!;
  return siteById(s, st.siteId);
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

function pathDist(s: SimState, cells: number[]): number[] {
  const dist = [0];
  for (let k = 1; k < cells.length; k++) dist.push(dist[k - 1] + stepLen(cx(s, cells[k]) - cx(s, cells[k - 1]), cy(s, cells[k]) - cy(s, cells[k - 1])));
  return dist;
}

// ------------------------------------------------------------------ what a line carries

/**
 * The good a line carries and the stop it loads at: what one stop makes that the other takes. A line
 * carries one good one way; null when the two sites trade nothing.
 */
export function lineGood(s: SimState, line: Line): { good: Good; from: number; to: number } | null {
  return tradeOf(stopKind(s, line, 0), stopKind(s, line, 1));
}

/** what two kinds of site trade: the good, the stop (0 or 1) that makes it and the one that takes it */
export function tradeOf(a: SiteKind, b: SiteKind): { good: Good; from: number; to: number } | null {
  const ma = MAKES[a];
  if (ma && TAKES[b].includes(ma)) return { good: ma, from: 0, to: 1 };
  const mb = MAKES[b];
  if (mb && TAKES[a].includes(mb)) return { good: mb, from: 1, to: 0 };
  return null;
}

/** the good that moves at a stop of a line: what it loads there, or what it unloads there */
export function stopGood(s: SimState, line: Line, _i: number): Good | null {
  return lineGood(s, line)?.good ?? null;
}

/** the wagon type a line's trains run */
export function lineWagon(s: SimState, line: Line): WagonType {
  const g = lineGood(s, line);
  return g ? wagonFor(g.good) : 'box';
}

/** the consist a new train starts with: WAGONS_DEFAULT wagons of the line's type */
export function defaultConsist(s: SimState, line: Line): WagonType[] {
  return Array<WagonType>(WAGONS_DEFAULT).fill(lineWagon(s, line));
}

// ------------------------------------------------------------------ the upgrades

/** times an upgrade has been taken */
export function perk(s: SimState, id: PerkId): number {
  return s.perks.taken[id];
}

/** the engine's speed with the speed upgrades */
function speedOf(s: SimState, engine: EngineId): number {
  return ENGINES[engine].speed * (1 + PERK_SPEED * perk(s, 'speed'));
}

/** what track costs against its list price, after the track upgrades */
export function trackFactor(s: SimState): number {
  return Math.pow(1 - PERK_TRACK, perk(s, 'track'));
}

/** the most wagons a train can have */
export function wagonsMax(_s: SimState): number {
  return WAGONS_MAX;
}

export const PERKS: PerkId[] = ['wagon', 'speed', 'output', 'loading', 'track', 'train', 'cash', 'fair'];

/** whether an upgrade may be offered now: under its limit, and of some use */
export function perkOpen(s: SimState, id: PerkId): boolean {
  if (perk(s, id) >= PERK_MAX[id]) return false;
  if (id === 'wagon') return s.trains.some((t) => t.nWagons < wagonsMax(s));
  return true;
}

/** a small seeded generator, so a run offers the same picks every time */
function seeded(text: string): () => number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h ^ text.charCodeAt(i), 3432918353) << 13) | (h >>> 19);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** the two kinds of upgrade a pick pairs: more from what runs, or more to build with */
const CAPACITY: PerkId[] = ['wagon', 'speed', 'output', 'loading', 'fair'];
const BUILD: PerkId[] = ['track', 'train', 'cash'];

/** draw the next pick: one upgrade that makes the network carry more, one that helps build it */
function drawPick(s: SimState): void {
  s.picks++;
  const rnd = seeded(`${s.scenario.id}:${s.picks}`);
  const from = (list: PerkId[]) => {
    const open = list.filter((p) => perkOpen(s, p));
    return open.length ? open[Math.floor(rnd() * open.length)] : null;
  };
  const a = from(CAPACITY) ?? 'cash';
  let b = from(BUILD) ?? 'cash';
  if (b === a) b = 'train';
  s.pick = { n: s.picks, options: [a, b], cash: PERK_CASH + PERK_CASH_STEP * (s.picks - 1) };
  s.sounds.push('bell');
}

/** Take one of the two upgrades on the table; the game runs on. */
export function takePick(s: SimState, choice: 0 | 1): boolean {
  const p = s.pick;
  if (!p) return false;
  const id = p.options[choice];
  s.perks.taken[id]++;
  if (id === 'wagon') for (const t of s.trains) if (t.nWagons < wagonsMax(s)) {
    t.wagons.push(t.wagons[t.wagons.length - 1] ?? 'box');
    t.loads.push(null);
    tally(t);
  }
  if (id === 'train') s.perks.freeTrains++;
  if (id === 'cash') s.cash += p.cash;
  s.pick = null;
  s.nextPickAt = s.time + PICK_SECONDS;
  s.sounds.push('buy');
  return true;
}

export function emptyPerks(): Perks {
  return { taken: { wagon: 0, speed: 0, output: 0, loading: 0, track: 0, train: 0, cash: 0, fair: 0 }, freeTrains: 0 };
}

// ------------------------------------------------------------------ trips and money

/** the share of its speed an engine keeps on a grade with a load: 1 on the flat and downhill */
export function gradeFactor(engine: EngineId, grade: number, cargo: number): number {
  if (grade <= 0) return 1;
  const g = Math.min(1, grade / GRADE_MAX);
  return Math.max(0.2, 1 - g * (1 - ENGINES[engine].climb) - g * GRADE_LOAD * cargo);
}

/** the seconds over a rail profile: every step at the engine's speed on its grade */
function railTime(s: SimState, rail: number[], dist: number[], engine: EngineId, cargo: number, dir: 1 | -1): number {
  const base = speedOf(s, engine);
  let t = 0;
  for (let k = 1; k < rail.length; k++) {
    const seg = dist[k] - dist[k - 1];
    const g = dir * gradeOf(rail[k] - rail[k - 1], seg);
    t += seg / (base * gradeFactor(engine, g, cargo));
  }
  return t;
}

/** Seconds a train with this engine and load takes from one end of the line to the other; `dir` 1 runs from stop 0 to stop 1. */
export function tripTime(s: SimState, line: Line, engine: EngineId, cargo: number, dir: 1 | -1): number {
  return railTime(s, line.rail, line.dist, engine, cargo, dir);
}

/** the seconds from one end of a line to the other for a train of this engine, empty and with every wagon full, each way */
export function tripTimes(s: SimState, line: Line, engine: EngineId, wagons: number): { empty: [number, number]; full: [number, number] } {
  return {
    empty: [tripTime(s, line, engine, 0, 1), tripTime(s, line, engine, 0, -1)],
    full: [tripTime(s, line, engine, wagons, 1), tripTime(s, line, engine, wagons, -1)],
  };
}

/** seconds one wagon takes to unload or to load, with the loading upgrades */
export function dwellAt(s: SimState, _cell?: number, _good?: Cargo | null): number {
  return WAGON_DWELL * Math.pow(1 - PERK_LOADING, perk(s, 'loading'));
}

/** the seconds of one round trip on a line with every pile full: loaded one way, empty back, the stops and the wagons */
export function roundTrip(s: SimState, line: Line, engine: EngineId, wagons: number): number {
  const g = lineGood(s, line);
  const out = g ? (g.from === 0 ? 1 : -1) : 1;
  return tripTime(s, line, engine, wagons, out as 1 | -1) + tripTime(s, line, engine, 0, -out as 1 | -1) + 2 * STOP_SECONDS + 2 * wagons * dwellAt(s);
}

/** the same for a planned route, from its rail */
export function routeRoundTrip(s: SimState, r: Route, engine: EngineId, wagons = WAGONS_DEFAULT): number {
  const dist = pathDist(s, r.cells);
  const there = Math.max(railTime(s, r.rail, dist, engine, wagons, 1), railTime(s, r.rail, dist, engine, wagons, -1));
  const back = Math.min(railTime(s, r.rail, dist, engine, 0, 1), railTime(s, r.rail, dist, engine, 0, -1));
  return there + back + 2 * STOP_SECONDS + 2 * wagons * dwellAt(s);
}

/** round trips a minute a train makes on a planned route */
export function routeTrips(s: SimState, r: Route, engine: EngineId, wagons = WAGONS_DEFAULT): number {
  return 60 / routeRoundTrip(s, r, engine, wagons);
}

/** what a site makes a minute now, in loads: a raw site by its rate, a refinery by what comes in */
export function supplyPerMinute(s: SimState, site: Site): number {
  if (RAW_RATE[site.kind]) return site.rawRate * SERVED_RATE * (1 + PERK_OUTPUT * perk(s, 'output')) * (MONTHS * 60) / YEAR_SECONDS;
  const good = MAKES[site.kind];
  if (!good) return 0;
  // a refinery makes what its feeding lines bring
  let n = 0;
  for (const l of s.lines) {
    const g = lineGood(s, l);
    if (!g || stopSite(s, l, g.to) !== site) continue;
    n += lineYear(s, l).loads;
  }
  return n;
}

/**
 * What a line's trains move together, a minute, with one more train of this kind when `extra` is
 * given: each train's free-running loads, capped by what the loading stop makes (the lines that load
 * there share it). This is the number the buy card shows; the trains do not wait for each other.
 */
export function lineYear(s: SimState, line: Line, extra?: { engine: EngineId; wagons: number }): { trips: number; loads: number; limit: 'free' | 'supply'; each: number[] } {
  const mine = s.trains.filter((o) => o.lineId === line.id).map((o) => ({ engine: o.engine, wagons: o.nWagons }));
  if (extra) mine.push(extra);
  const each = mine.map((m) => 60 / roundTrip(s, line, m.engine, m.wagons));
  const free = mine.reduce((a, m, i) => a + each[i] * m.wagons, 0);
  const g = lineGood(s, line);
  let cap = Infinity;
  if (g) {
    const from = stopSite(s, line, g.from);
    if (RAW_RATE[from.kind]) {
      const sharers = s.lines.filter((l) => {
        const lg = lineGood(s, l);
        return lg && stopSite(s, l, lg.from) === from && s.trains.some((t) => t.lineId === l.id);
      }).length;
      cap = supplyPerMinute(s, from) / Math.max(1, sharers + (extra && !s.trains.some((t) => t.lineId === line.id) ? 1 : 0));
    }
  }
  const loads = Math.min(free, cap);
  const k = free > 0 ? loads / free : 0;
  return { trips: each.reduce((a, b) => a + b, 0) * k, loads, limit: free > cap ? 'supply' : 'free', each: each.map((e) => e * k) };
}

/** round trips a minute an engine makes on a built line with this many wagons */
export function lineTrips(s: SimState, line: Line, engine: EngineId, wagons = WAGONS_DEFAULT): number {
  return 60 / roundTrip(s, line, engine, wagons);
}

/** what one tile run costs a train of this engine and wagon count */
export function runPerTile(engine: EngineId, wagons: number): number {
  return ENGINES[engine].runCost + WAGON_RUN * wagons;
}

/** what a train costs to run for a minute at this many round trips a minute on a line: the tiles it covers, and the engine's upkeep */
export function runningCostMinute(line: Line, engine: EngineId, wagons: number, trips: number): number {
  return trips * 2 * lineLength(line) * runPerTile(engine, wagons) + (ENGINES[engine].upkeep * 60) / YEAR_SECONDS;
}

export function trainLength(t: Train): number {
  return ENGINE_LEN + t.nWagons * WAGON_LEN;
}

/** the drawn length of a train in tiles: its parts and the gaps between the wagons */
export function drawnLength(t: Train): number {
  return trainLength(t) + t.nWagons * 0.08;
}

export function lineOf(s: SimState, t: Train): Line {
  return s.lines.find((l) => l.id === t.lineId)!;
}

/** the wagon a standing train is working on, counted from the front, and how far its load has come, 0 to 1; null when none is */
export function workingWagon(s: SimState, t: Train): { wagon: number; progress: number } | null {
  if (!t.dock || t.at === null || t.job < 0) return null;
  const progress = 1 - Math.max(0, Math.min(1, t.work / dwellAt(s)));
  return { wagon: t.job, progress };
}

// ------------------------------------------------------------------ demand, prices and growth

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

/** the goods a town wants that the map makes */
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

/** the points a town needs to grow from its size to the next */
export function growNeed(site: Site): number {
  return GROW_NEED[Math.min(GROW_NEED.length - 1, Math.max(1, site.size))];
}

/** how far a town is to its next size, 0 to 1 */
export function growFrac(site: Site): number {
  return site.size >= TOWN_MAX ? 1 : Math.min(1, site.growth / growNeed(site));
}

/** whether every other good the town takes arrived within VARIETY_SECONDS, so a load of `good` counts the bonus */
export function varietyOn(s: SimState, site: Site, good?: Good): boolean {
  const others = wantedGoods(s).filter((g) => g !== good);
  return others.every((g) => s.time - site.lastDelivery[g] <= VARIETY_SECONDS);
}

/** the growth points one load of a good gives a town now */
export function loadPoints(s: SimState, site: Site, good: Good): number {
  return (1 + (varietyOn(s, site, good) ? VARIETY_BONUS : 0)) * (1 + PERK_FAIR * perk(s, 'fair'));
}

/** the months a delivery counts as recent in a want chip */
export const SUPPLY_MONTHS = 3;

/** how a site's want stands: a train brings it (ok), a line reaches the site but it is not arriving (short), or no line brings it (none) */
export type Supply = 'ok' | 'short' | 'none';

/** the goods a site wants that the map makes */
export function wantsOf(s: SimState, site: Site): Good[] {
  return TAKES[site.kind].filter((g) => s.sites.some((o) => MAKES[o.kind] === g));
}

/** whether a line stops at this site and at another site that `from` accepts */
function lineJoins(s: SimState, site: Site, from: (o: Site) => boolean): boolean {
  return s.lines.some((l) => {
    const stops = l.stops.map((_, i) => stopSite(s, l, i));
    return stops.includes(site) && stops.some((o) => o !== site && from(o));
  });
}

/** The state of one want of a site, for its chip: no line from a maker is `none`; with a line it is `ok` when a load arrived in the last SUPPLY_MONTHS months, `short` otherwise. */
export function supplyState(s: SimState, site: Site, want: Good): Supply {
  if (!lineJoins(s, site, (o) => MAKES[o.kind] === want)) return 'none';
  return s.time - site.lastDelivery[want] <= SUPPLY_MONTHS * (YEAR_SECONDS / MONTHS) ? 'ok' : 'short';
}

/**
 * A town's growth as it stands: the points still needed, the loads that would take at the present
 * bonus, the good that is missing for the bonus, and the loads a minute its lines bring.
 */
export function growthOutlook(s: SimState, site: Site): { left: number; loads: number; missing: Good | null; perMinute: number } {
  const left = Math.max(0, growNeed(site) - site.growth);
  const wanted = wantedGoods(s);
  const missing = wanted.find((g) => s.time - site.lastDelivery[g] > VARIETY_SECONDS) ?? null;
  const per = (1 + (missing ? 0 : VARIETY_BONUS)) * (1 + PERK_FAIR * perk(s, 'fair'));
  let perMinute = 0;
  for (const l of s.lines) {
    const g = lineGood(s, l);
    if (g && stopSite(s, l, g.to) === site) perMinute += lineYear(s, l).loads;
  }
  return { left, loads: Math.ceil(left / per - 1e-9), missing, perMinute };
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

/** what the next train costs the player: nothing while a free train from the pick is left */
export function nextTrainPrice(s: SimState, engine: EngineId = 'hilma', nWagons = WAGONS_DEFAULT): number {
  return s.perks.freeTrains > 0 ? 0 : trainPrice(engine, nWagons);
}

// ------------------------------------------------------------------ building

/** the lines that stop at a station */
export function linesAt(s: SimState, stationId: number): Line[] {
  return s.lines.filter((l) => l.stops.includes(stationId));
}

/** why a line between two sites cannot be built, or null when it can: they trade nothing, one station is full, or the line is there */
export function lineBlock(s: SimState, from: number, to: number): 'nothing' | 'full' | 'exists' | null {
  const a = siteAt(s, from) ?? (stationAt(s, from) && siteById(s, stationAt(s, from)!.siteId));
  const b = siteAt(s, to) ?? (stationAt(s, to) && siteById(s, stationAt(s, to)!.siteId));
  if (!a || !b || a === b) return 'nothing';
  if (!tradeOf(a.kind, b.kind)) return 'nothing';
  const sa = stationAt(s, from);
  const sb = stationAt(s, to);
  if (sa && sb && s.lines.some((l) => l.stops.includes(sa.id) && l.stops.includes(sb.id))) return 'exists';
  if ((sa && linesAt(s, sa.id).length >= STATION_LINES) || (sb && linesAt(s, sb.id).length >= STATION_LINES)) return 'full';
  return null;
}

/**
 * The routes a drag from a station cell to a site or station cell would build: one, or a cheap and a
 * short one when the short one is dearer and faster for Little Hilma. None when the two sites trade
 * nothing, a station has no platform left, or the line is there already.
 */
export function plan(s: SimState, from: number, to: number, _startSide?: number): Route[] {
  if (!stationAt(s, from)) return [];
  if (!siteAt(s, to) && !stationAt(s, to)) return [];
  if (lineBlock(s, from, to)) return [];
  const opts = routeOptions(s, from, to).map((r) => ({ ...r, cost: Math.round((r.cost - (r.newStation ? STATION_COST : 0)) * trackFactor(s) + (r.newStation ? STATION_COST : 0)) }));
  if (opts.length < 2) return opts;
  const [cheap, short] = opts;
  const t = (r: Route) => routeRoundTrip(s, r, 'hilma');
  if (short.cost <= cheap.cost) return [short];
  if (t(short) >= t(cheap) - 0.5) return [cheap];
  return opts;
}

/** the lowest platform track a station has free */
function freeSlot(s: SimState, stationId: number): number {
  const used = new Set<number>();
  for (const l of s.lines) l.stops.forEach((id, i) => id === stationId && used.add(l.slots[i]));
  let k = 0;
  while (used.has(k)) k++;
  return k;
}

/**
 * Build a planned route: pay, lay the track, place the station at the end when there is none, and
 * make the line between the two stations. Returns the line, or null when the cash is short or the
 * line cannot be built.
 */
export function build(s: SimState, r: Route, _extend?: number): Line | null {
  if (r.cost > s.cash) return null;
  const from = r.cells[0];
  const to = r.cells[r.cells.length - 1];
  if (lineBlock(s, from, to)) return null;
  s.cash -= r.cost;
  // what each new cell cost, for the refund when the line is lifted; the station is not in it
  const per = (r.cost - (r.newStation ? STATION_COST : 0)) / Math.max(1, r.added.length);
  for (const c of r.added) s.paid[c] = per;
  s.assets += r.cost;
  for (let k = 1; k < r.cells.length; k++) link(s, r.cells[k - 1], r.cells[k]);
  let station = stationAt(s, to);
  let newStation: number | null = null;
  if (!station) {
    station = { id: s.nextId++, cell: to, siteId: siteAt(s, to)!.id };
    s.stations.push(station);
    newStation = station.id;
  }
  const a = stationAt(s, from)!;
  const line: Line = { id: s.nextId++, stops: [a.id, station.id], path: r.cells, dist: pathDist(s, r.cells), rail: r.rail, stopAt: [0, r.cells.length - 1], slots: [freeSlot(s, a.id), freeSlot(s, station.id)], worst: r.worst, earnedYear: 0, runYear: 0 };
  s.lines.push(line);
  s.lastBuild = { cost: r.cost, cells: r.added, station: newStation, line: line.id, left: UNDO_SECONDS, cell: to };
  const p = centre(s, to);
  if (r.cost > 0) s.floats.push({ x: p.x, y: p.y, text: `-${r.cost}`, age: 0, kind: 'cost' });
  s.sounds.push('build');
  return line;
}

/** Take the last build back, within its second: the cash returns, the track goes. */
export function undo(s: SimState): boolean {
  const b = s.lastBuild;
  if (!b || b.left <= 0) return false;
  if (b.line !== null && s.trains.some((t) => t.lineId === b.line)) return false;
  s.cash += b.cost;
  s.assets -= b.cost;
  const line = s.lines.find((l) => l.id === b.line);
  if (line) unlay(s, line);
  for (const c of b.cells) s.paid[c] = 0;
  if (b.line !== null) s.lines = s.lines.filter((l) => l.id !== b.line);
  if (b.station !== null) s.stations = s.stations.filter((st) => st.id !== b.station);
  s.lastBuild = null;
  s.sounds.push('undo');
  return true;
}

/** take a line's links out of the track mask, all but those another line runs over too */
function unlay(s: SimState, line: Line): void {
  const shared = sharedLinks(s, line);
  for (let k = 1; k < line.path.length; k++) if (!shared.has(linkKey(line.path[k - 1], line.path[k]))) unlink(s, line.path[k - 1], line.path[k]);
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
  const keeps = new Set<number>();
  for (const o of s.lines) if (o !== line) for (const c of o.path) keeps.add(c);
  let back = 0;
  for (const c of line.path) if (!keeps.has(c)) back += s.paid[c] * LIFT_BACK;
  return back;
}

/** Lift a line that has no trains: its track goes and half its build price comes back. The stations stay. */
export function liftLine(s: SimState, lineId: number): boolean {
  const line = s.lines.find((l) => l.id === lineId);
  if (!line || s.trains.some((t) => t.lineId === lineId)) return false;
  unlay(s, line);
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

// ------------------------------------------------------------------ trains: buying

/** keep the train's counts true to its wagons and loads: call after any change to either */
function tally(t: Train): void {
  t.nWagons = t.wagons.length;
  t.cargo = t.loads.filter(Boolean).length;
}

/** whether a train of the line stands at its stop i, or runs to it and is past `s` already the way it runs */
function platformTaken(s: SimState, line: Line, i: number, except?: Train): boolean {
  return s.trains.some((o) => o !== except && o.lineId === line.id && o.state === 'stop' && o.idx === i);
}

/**
 * Buy a train on a line, with `wagons` wagons of the line's type: it stands at the stop that loads, or
 * waits on the line just outside it behind the trains there. Free while a free train from the pick is left.
 */
export function buyTrain(s: SimState, lineId: number, engine: EngineId = 'hilma', wagons = WAGONS_DEFAULT): Train | null {
  const line = s.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const n = Math.max(1, Math.min(wagonsMax(s), Math.round(wagons)));
  const free = s.perks.freeTrains > 0;
  const cost = free ? 0 : trainPrice(engine, n);
  if (cost > s.cash) return null;
  s.cash -= cost;
  if (free) s.perks.freeTrains--;
  s.lastBuild = null;
  const g = lineGood(s, line);
  // the train starts at the stop that loads, so its first run carries something
  const at = g ? g.from : 0;
  // a standing train keeps the way it came in: into stop 0 running back, into the last stop running on
  const dir: 1 | -1 = at === 0 ? -1 : 1;
  const type = lineWagon(s, line);
  const t: Train = {
    id: s.nextId++,
    lineId,
    engine,
    wagons: Array<WagonType>(n).fill(type),
    nWagons: n,
    loads: Array(n).fill(null),
    dir,
    idx: at,
    to: at,
    s: stopS(line, at),
    state: 'stop',
    stopLeft: STOP_SECONDS / 2,
    cargo: 0,
    at: stopCell(line, at),
    queued: false,
    waited: 0,
    slot: line.slots[at],
    slotFrom: line.slots[at],
    speed: 0,
    odometer: 0,
    earned: 0,
    earnedYear: 0,
    earnedLast: 0,
    runYear: 0,
    runLast: 0,
    trips: 0,
    dock: null,
    work: 0,
    job: -1,
    quote: {},
    paid: 0,
  };
  if (platformTaken(s, line, at)) {
    // the platform is taken: the new train runs in to it from just outside, behind any train already waiting there
    t.state = 'run';
    t.at = null;
    t.idx = 1 - at;
    let pos = stopS(line, at) - dir * (drawnLength(t) / 2 + 3 + FOLLOW_GAP);
    for (const o of s.trains) {
      if (o.lineId !== line.id || o.dir !== dir) continue;
      const room = (drawnLength(o) + drawnLength(t)) / 2 + FOLLOW_GAP;
      if (Math.abs(o.s - pos) < room) pos = o.s - dir * room;
    }
    t.s = Math.max(0, Math.min(lineLength(line), pos));
    t.slotFrom = line.slots[1 - at];
  }
  t.speed = speedOf(s, engine);
  s.trains.push(t);
  if (s.nextPickAt === Infinity) s.nextPickAt = s.time + PICK_SECONDS;
  const p = centre(s, stopCell(line, at));
  s.floats.push({ x: p.x, y: p.y, text: free ? '0' : `-${cost}`, age: 0, kind: 'cost' });
  s.sounds.push('buy');
  return t;
}

/** One more wagon on a train, up to the limit, of the line's type. */
export function addWagon(s: SimState, trainId: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t || t.nWagons >= wagonsMax(s) || s.cash < WAGON_PRICE) return false;
  s.cash -= WAGON_PRICE;
  t.wagons.push(lineWagon(s, lineOf(s, t)));
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
  s.sounds.push('buy');
  return true;
}

/** Sell a train: half of what it cost comes back. */
export function sellTrain(s: SimState, trainId: number): boolean {
  const t = s.trains.find((o) => o.id === trainId);
  if (!t) return false;
  s.cash += Math.round(trainValue(t) * RESALE);
  s.trains = s.trains.filter((o) => o !== t);
  s.sounds.push('undo');
  return true;
}

/** a train's price new: the engine and its wagons */
export function trainValue(t: Train): number {
  return ENGINES[t.engine].price + t.nWagons * WAGON_PRICE;
}

// ------------------------------------------------------------------ trains: running

/** the site a standing train is at */
function dockSite(s: SimState, t: Train): Site | null {
  const st = t.at === null ? undefined : stationAt(s, t.at);
  return st ? siteById(s, st.siteId) : null;
}

/**
 * The work at the platform, one wagon's load at a time: first every load the stop takes comes off,
 * each paid as it leaves, then every empty wagon takes a load from the pile when the line carries what
 * the site makes. Returns whether a load is in hand.
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
  const g = lineGood(s, line);
  let job = t.loads.findIndex((l) => !!l && TAKES[site.kind].includes(l.good));
  let kind: 'load' | 'unload' | null = job >= 0 ? 'unload' : null;
  if (job < 0 && g && g.from === t.idx && site.stock >= 1) {
    job = t.loads.findIndex((l) => !l);
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
  const dwell = dwellAt(s);
  if (was !== kind || wasJob !== job) t.work = dwell;
  t.work -= DT;
  if (t.work > 0) return true;
  t.work = dwell;
  if (kind === 'unload') {
    const load = t.loads[job]!;
    const good = load.good;
    // the first load of a good at this stop fixes the demand its loads pay at
    if (t.quote[good] === undefined) t.quote[good] = siteDemand(site, good);
    const pay = Math.round(BASE_PRICE[good] * t.quote[good]! * distanceFactor(Math.abs(stopS(line, t.idx) - load.from)));
    s.cash += pay;
    s.income[good] += pay;
    t.earned += pay;
    t.earnedYear += pay;
    line.earnedYear += pay;
    t.paid += pay;
    t.loads[job] = null;
    tally(t);
    deliver(s, site, good);
    if (s.firstPayAt === null) s.firstPayAt = s.time;
    s.sounds.push('pay');
  } else {
    site.stock -= 1;
    t.loads[job] = { good: MAKES[site.kind]!, from: stopS(line, t.idx) };
    tally(t);
    site.lastPickup = s.time;
    s.sounds.push('load');
  }
  return true;
}

/** a load arrives at a site: a town grows by it, a refinery turns it into its own good */
function deliver(s: SimState, site: Site, good: Good): void {
  site.delivered += 1;
  if (site.kind === 'town') {
    const pts = loadPoints(s, site, good);
    site.lastDelivery[good] = s.time;
    site.store[good] = Math.min(storeCap(site), site.store[good] + 1);
    grow(s, site, pts);
  } else {
    site.lastDelivery[good] = s.time;
    site.taken[good] += 1;
    if (MAKES[site.kind]) site.stock += 1;
  }
  const goal = s.scenario.goal;
  if (goal.kind === 'deliver' && site.id === goal.site && good === goal.good) {
    s.goalCount += 1;
    if (s.goalCount >= goal.count && !s.result) finish(s, true, 'goal');
  }
}

/** a town takes growth points; a full count takes it to the next size, with a float and a sound */
function grow(s: SimState, site: Site, pts: number): void {
  if (site.size >= TOWN_MAX) return;
  site.growth += pts;
  s.floats.push({ x: site.cx + 0.5, y: site.cy - 4, text: `+${+pts.toFixed(1)}`, age: 0, kind: 'house', life: 1.4 });
  if (site.growth < growNeed(site) - 1e-9) return;
  site.growth -= growNeed(site);
  site.size++;
  if (site.size >= TOWN_MAX) site.growth = 0;
  site.grewAt = s.time;
  s.grewYear.push(site.id);
  s.floats.push({ x: site.cx + 0.5, y: site.cy - 3.5, text: '', age: 0, kind: 'grow', life: 3.4, grew: { site: site.id, size: site.size } });
  s.sounds.push('grow');
  const goal = s.scenario.goal;
  if (goal.kind === 'towns' && !s.result && s.sites.filter((x) => x.kind === 'town' && x.size >= goal.size).length >= goal.count) finish(s, true, 'goal');
}

/** the train of the line ahead of this one in its direction, and the room left to it; null when none is */
function leader(s: SimState, t: Train): { o: Train; room: number } | null {
  let best: { o: Train; room: number } | null = null;
  for (const o of s.trains) {
    if (o === t || o.lineId !== t.lineId || o.dir !== t.dir) continue;
    const ahead = (o.s - t.s) * t.dir;
    if (ahead <= 0 && !(ahead === 0 && o.id < t.id)) continue;
    const room = ahead - (drawnLength(o) + drawnLength(t)) / 2 - FOLLOW_GAP;
    if (!best || room < best.room) best = { o, room };
  }
  return best;
}

/** whether the train has stood long enough at its loading stop: full, or WAIT_FULL seconds with a load on */
function loaded(s: SimState, t: Train): boolean {
  const g = lineGood(s, lineOf(s, t));
  if (!g || g.from !== t.idx) return true;
  if (t.cargo >= t.nWagons) return true;
  return t.cargo > 0 && t.waited >= WAIT_FULL;
}

function depart(s: SimState, t: Train, line: Line): void {
  const to = 1 - t.idx;
  t.dir = to > t.idx ? 1 : -1;
  // a train of the line that left just before in the same direction must be clear
  const lead = leader(s, t);
  if (lead && lead.room < 0) {
    t.dir = t.dir === 1 ? -1 : 1;
    return;
  }
  t.to = to;
  t.state = 'run';
  t.at = null;
  t.dock = null;
  t.job = -1;
  t.waited = 0;
  t.slotFrom = line.slots[t.idx];
  t.slot = line.slots[to];
  if (t.odometer === 0) t.odometer = 0.001;
  s.sounds.push('whistle');
}

function arrive(s: SimState, t: Train, line: Line): void {
  t.state = 'stop';
  t.queued = false;
  t.stopLeft = STOP_SECONDS;
  t.idx = t.to;
  t.at = stopCell(line, t.to);
  t.slot = line.slots[t.to];
  t.dock = null;
  t.work = 0;
  t.job = -1;
  t.quote = {};
  t.paid = 0;
  t.waited = 0;
  const g = lineGood(s, line);
  if (g && t.idx === g.from) t.trips++;
}

function runTrain(s: SimState, t: Train): void {
  const line = lineOf(s, t);
  if (t.state === 'stop') {
    const busy = tickDock(s, t);
    if (busy) return;
    if (t.stopLeft > 0) {
      t.stopLeft -= DT;
      return;
    }
    if (!loaded(s, t)) {
      t.waited += DT;
      return;
    }
    depart(s, t, line);
    return;
  }
  // the speed under the train: a climb cuts it, more with a load
  t.speed = speedOf(s, t.engine) * gradeFactor(t.engine, gradeAlong(line, t.s, t.dir), t.cargo);
  let step = t.speed * DT;
  const lead = leader(s, t);
  t.queued = false;
  if (lead && lead.room < step) {
    step = Math.max(0, lead.room);
    t.queued = true;
  }
  const goal = stopS(line, t.to);
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
    arrive(s, t, line);
  }
}

// ------------------------------------------------------------------ money over time

function finish(s: SimState, won: boolean, reason: 'goal' | 'time' | 'bankrupt'): void {
  const worth = Math.round(netWorth(s));
  // a win is one star, and a win in the year of the second or the third star's limit, or before it, is a star each
  const stars = won ? 1 + s.scenario.stars.filter((limit) => s.year <= limit).length : 0;
  s.result = { won, year: s.year, cash: Math.round(s.cash), worth, stars, reason, time: s.time };
  s.sounds.push(won ? 'win' : 'lose');
}

/** Net worth: cash, trains at their resale, track and stations at half their build price, less the loan. */
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

/** a year of upkeep for the track of one line */
export function lineTrackUpkeep(s: SimState, line: Line): number {
  let n = 0;
  for (const c of line.path) n += s.water[c] ? BRIDGE_UPKEEP : 1;
  return n * TRACK_UPKEEP;
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

/** months tick: upkeep, production, demand recovery */
function monthTick(s: SimState): void {
  chargeMonth(s);
  const boost = 1 + PERK_OUTPUT * perk(s, 'output');
  for (const site of s.sites) {
    if (RAW_RATE[site.kind]) {
      // a served site makes more: the rate climbs while pickups keep coming and falls back after
      const base = site.rawRate;
      const recent = s.time - site.lastPickup < SERVED_MEMORY * (YEAR_SECONDS / MONTHS);
      const target = recent ? base * SERVED_RATE : base;
      site.rate += (target - site.rate) * 0.5;
      site.stock = Math.min(site.rawCap * boost, site.stock + site.rate * boost);
    }
    if (site.kind !== 'town') for (const g of GOODS) site.taken[g] = Math.max(0, site.taken[g] - MILL_EATS);
  }
}

/** the towns eat from their stores a little every tick, so their price recovers */
function eatStores(s: SimState): void {
  const per = DT / (YEAR_SECONDS / MONTHS);
  for (const site of s.sites) {
    if (site.kind !== 'town') continue;
    const eat = eatsPerMonth(site) * per;
    for (const g of GOODS) if (site.store[g] > 0) site.store[g] = Math.max(0, site.store[g] - eat);
  }
}

/** the year end: the last month's costs, the interest, the record for the ledger; the game runs on */
function yearEnd(s: SimState): void {
  chargeMonth(s);
  const interest = s.loan * LOAN_RATE;
  s.cash -= interest;
  const income = { ...s.income };
  const grew = s.grewYear;
  s.grewYear = [];
  const growth: Record<string, number> = {};
  for (const site of s.sites) if (site.kind === 'town') growth[site.id] = growFrac(site);
  const total = CARGOS.reduce((a, g) => a + income[g], 0);
  const running = Math.round(s.running);
  const engine = Math.round(s.engineUp);
  const track = Math.round(s.trackUp);
  const owed = Math.round(interest);
  const profit = total - running - engine - track - owed;
  // broke: cash below zero with the loan at its ceiling; two year ends in a row end the scenario
  s.broke = s.cash < 0 && s.loan >= loanCeiling(s) - 0.5 ? s.broke + 1 : 0;
  const worth = Math.round(netWorth(s));
  s.lastYear = { year: s.year, income, running, engine, track, interest: owed, upkeep: running + engine, profit, cash: Math.round(s.cash), loan: s.loan, worth, grew, growth };
  s.history.push({ year: s.year, cash: Math.round(s.cash), profit, worth, loan: s.loan });
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
  s.income = zeroCargo();
  s.upkeep = 0;
  s.running = 0;
  s.engineUp = 0;
  s.trackUp = 0;
  s.year++;
  s.yearFrac = 0;
  s.month = 0;
  if (s.result) return;
  if (s.broke >= BANKRUPT_YEARS) finish(s, false, 'bankrupt');
  else if (s.year >= s.scenario.goal.beforeYear) finish(s, false, 'time');
}

/** whether the sim is held: a pick waits for its choice, or the scenario is over */
export function held(s: SimState): boolean {
  return !!s.pick || !!s.result;
}

export function step(s: SimState): void {
  if (held(s)) return;
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
  if (!s.result && s.time >= s.nextPickAt) drawPick(s);
}

/** a note that floats off a point, for the UI */
export function note(s: SimState, cell: number, text: string): void {
  const p = centre(s, cell);
  const f: Float = { x: p.x, y: p.y, text, age: 0, kind: 'note' };
  s.floats.push(f);
}

/** the goal's progress, 0..1, for the HUD bar: for a towns goal, the best towns' climb with their growth so far */
export function goalProgress(s: SimState): number {
  const goal = s.scenario.goal;
  if (goal.kind === 'deliver') return Math.min(1, s.goalCount / goal.count);
  const start = (t: Site): number => s.scenario.sites.find((d) => d.id === t.id)?.size ?? 1;
  const towns = s.sites.filter((x) => x.kind === 'town');
  const gain = towns.map((t) => Math.min(goal.size, t.size + (t.size < goal.size ? growFrac(t) : 0)) - start(t)).sort((a, b) => b - a);
  const need = towns.map((t) => goal.size - start(t)).sort((a, b) => a - b).slice(0, goal.count).reduce((a, b) => a + b, 0);
  const got = gain.slice(0, goal.count).reduce((a, b) => a + b, 0);
  return need > 0 ? Math.min(1, got / need) : 1;
}

// keep the cell helpers reachable for the UI that worked with them before
export { idx, DIRS };
