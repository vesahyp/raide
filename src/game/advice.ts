/**
 * What the player should look at next: data only, no words (the UI words it). `advice` ranks the
 * problems and chances on the map by what they mean for the goal and for money, and returns at
 * most three, the top one first. It reads the state and changes nothing, and the one costly part
 * (a route's price) is remembered while the stations and lines stay as they are.
 */
import type { Good, SimState, Site } from './types';
import { MAKES, TAKES, WAGONS_DEFAULT, VARIETY_SECONDS } from './content/economy';
import { siteById, stationAt } from './state';
import { idx } from './grid';
import { plan, lineYear, trainPrice, wantedGoods, stopSite, lineGood, expandPrice } from './sim';

export type AdviceKind = 'first' | 'stuck' | 'starved' | 'more' | 'cash' | 'idle-line' | 'expand';

export interface Advice {
  kind: AdviceKind;
  /** the site the marker stands over: the one with the problem */
  site: string;
  /** the site that answers it, when there is one: the arc ends there */
  to?: string;
  good?: Good;
  /** stuck and more: loads waiting. cash: the cash in hand */
  amount?: number;
  /** first and cash: what the suggested line costs */
  cost?: number;
  /** idle-line: the line that has no train. more: the line the goods wait on */
  onLine?: number;
  /** how much it matters, higher first; not for the words */
  score: number;
}

/** loads a refinery holds before it counts as stuck, and the same for a raw site (a little under its cap) */
const STUCK_REFINERY = 3;
const STUCK_RAW = 5;

const dist = (a: Site, b: Site) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
const cellOf = (s: SimState, x: Site) => idx(s, x.cx, x.cy);
const hasStation = (s: SimState, x: Site) => !!stationAt(s, cellOf(s, x));

/**
 * The sites the goal rides on. For a towns goal, the `count` towns furthest along: biggest, then the
 * fullest growth meter, then the nearest to a station (so before any is chosen, the two closest).
 * For a deliver goal, the goal's site.
 */
export function goalTowns(s: SimState): Site[] {
  const goal = s.scenario.goal;
  if (goal.kind === 'deliver') return [siteById(s, goal.site)];
  const anchors = s.stations.length ? s.stations.map((st) => siteById(s, st.siteId)) : [siteById(s, s.scenario.startStation)];
  const near = (t: Site) => Math.min(...anchors.map((a) => dist(a, t)));
  // a town with a station counts first, so the strip does not swap towns as stations appear
  return s.sites
    .filter((x) => x.kind === 'town')
    .sort((a, b) => b.size + b.growth / 1000 + (hasStation(s, b) ? 0.5 : 0) - (a.size + a.growth / 1000 + (hasStation(s, a) ? 0.5 : 0)) || near(a) - near(b))
    .slice(0, goal.count);
}

/** the goods a town has not had lately (within the variety window), among those the map makes */
export function townLacks(s: SimState, site: Site): Good[] {
  return wantedGoods(s).filter((g) => s.time - site.lastDelivery[g] > VARIETY_SECONDS);
}

/** whether a line joins the station of a site to a station of any site in `others` */
function joined(s: SimState, site: Site, others: Site[]): boolean {
  const mine = s.stations.find((st) => st.siteId === site.id);
  if (!mine) return false;
  const ids = new Set(others.map((o) => o.id));
  return s.lines.some((l) => l.stops.includes(mine.id) && l.stops.some((id) => id !== mine.id && ids.has(s.stations.find((st) => st.id === id)!.siteId)));
}

const costs = new WeakMap<SimState, { key: string; at: Map<string, number | null> }>();

/** the price of the cheapest route that would join two sites, one of which has a station; null when none can be laid */
function linkCost(s: SimState, a: Site, b: Site): number | null {
  const key = `${s.stations.length}/${s.lines.length}`;
  let memo = costs.get(s);
  if (!memo || memo.key !== key) costs.set(s, (memo = { key, at: new Map() }));
  const k = `${a.id}>${b.id}`;
  if (memo.at.has(k)) return memo.at.get(k)!;
  const [from, to] = hasStation(s, a) ? [a, b] : hasStation(s, b) ? [b, a] : [null, null];
  const routes = from && to ? plan(s, cellOf(s, from), cellOf(s, to)) : [];
  const cost = routes.length ? Math.min(...routes.map((r) => r.cost)) : null;
  memo.at.set(k, cost);
  return cost;
}

/** the site that takes a good and is the best next buyer for a maker: a starved goal town first, then one with a station, then the nearest */
function bestBuyer(s: SimState, from: Site, good: Good, goal: Site[]): Site | null {
  let best: Site | null = null;
  let bestScore = Infinity;
  for (const o of s.sites) {
    if (o === from || !TAKES[o.kind].includes(good)) continue;
    const sc = dist(from, o) - (goal.includes(o) ? 8 : 0) - (goal.includes(o) && o.store[good] <= 0.001 ? 8 : 0) - (hasStation(s, o) ? 6 : 0);
    if (sc < bestScore) {
      bestScore = sc;
      best = o;
    }
  }
  return best;
}

/** the nearest site that makes a good, a maker with a station counting as nearer */
function nearestMaker(s: SimState, to: Site, good: Good): Site | null {
  let best: Site | null = null;
  let bestScore = Infinity;
  for (const o of s.sites) {
    if (MAKES[o.kind] !== good) continue;
    const sc = dist(to, o) - (hasStation(s, o) ? 6 : 0) - Math.min(8, o.stock);
    if (sc < bestScore) {
      bestScore = sc;
      best = o;
    }
  }
  return best;
}

/** The problems and chances on the map, most important first, at most three. */
export function advice(s: SimState): Advice[] {
  if (s.result) return [];
  const out: Advice[] = [];
  const goal = goalTowns(s);

  // the first chain: before any line, the start station and the nearest buyer of what it makes
  if (s.lines.length === 0) {
    const start = siteById(s, s.scenario.startStation);
    const good = MAKES[start.kind];
    const to = good ? bestBuyer(s, start, good, goal) : null;
    if (to) out.push({ kind: 'first', site: start.id, to: to.id, good: good!, cost: linkCost(s, start, to) ?? undefined, score: 1000 });
    return out;
  }

  // a line with no train earns nothing: the first thing to do with it is buy one
  for (const line of s.lines) {
    if (s.trains.some((t) => t.lineId === line.id)) continue;
    const g = lineGood(s, line);
    out.push({ kind: 'idle-line', site: stopSite(s, line, g ? g.from : 0).id, to: stopSite(s, line, g ? g.to : 1).id, onLine: line.id, score: 400 });
  }

  // stock that no line takes away
  for (const site of s.sites) {
    const good = MAKES[site.kind];
    if (!good) continue;
    const raw = TAKES[site.kind].length === 0;
    if (site.stock < (raw ? STUCK_RAW : STUCK_REFINERY)) continue;
    const buyers = s.sites.filter((o) => o !== site && TAKES[o.kind].includes(good));
    if (joined(s, site, buyers)) continue;
    const to = bestBuyer(s, site, good, goal);
    if (!to) continue;
    out.push({ kind: 'stuck', site: site.id, to: to.id, good, amount: Math.floor(site.stock), cost: linkCost(s, site, to) ?? undefined, score: (raw ? 40 : 100) + site.stock * (raw ? 5 : 10) + (goal.includes(to) ? 30 : 0) });
  }

  // goods piling up at the loading end of a line with trains: one more train adds loads there, and the buy card says so too
  for (const line of s.lines) {
    if (!s.trains.some((t) => t.lineId === line.id)) continue;
    const g = lineGood(s, line);
    if (!g) continue;
    const site = stopSite(s, line, g.from);
    const raw = TAKES[site.kind].length === 0;
    if (site.stock < (raw ? STUCK_RAW : STUCK_REFINERY)) continue;
    const now = lineYear(s, line).loads;
    const more = lineYear(s, line, { engine: 'hilma', wagons: WAGONS_DEFAULT }).loads;
    if (more - now < 0.5) continue;
    const to = stopSite(s, line, g.to);
    out.push({ kind: 'more', site: site.id, to: to.id, good: g.good, amount: Math.floor(site.stock), onLine: line.id, score: 92 + site.stock * (raw ? 2 : 4) + (goal.includes(to) ? 15 : 0) });
  }

  // trains that stand waiting for loads at a forest or a farm: the site is the limit, expand it
  for (const line of s.lines) {
    const g = lineGood(s, line);
    if (!g) continue;
    if (!s.trains.some((t) => t.lineId === line.id && t.state === 'stop' && t.idx === g.from && t.waited > 3)) continue;
    // trains waiting at a sawmill or a mill wait for the forest or the farm that feeds it
    let site = stopSite(s, line, g.from);
    if (expandPrice(site) === null)
      for (const l of s.lines) {
        const lg = lineGood(s, l);
        if (lg && stopSite(s, l, lg.to) === site && expandPrice(stopSite(s, l, lg.from)) !== null) site = stopSite(s, l, lg.from);
      }
    const price = expandPrice(site);
    if (price === null || price > s.cash) continue;
    if (out.some((a) => a.kind === 'expand' && a.site === site.id)) continue;
    out.push({ kind: 'expand', site: site.id, good: g.good, cost: price, score: 96 });
  }

  // a goal town with a station that has no line from anything that makes a good it wants: the second good speeds its growth
  for (const town of goal) {
    if (town.kind !== 'town' || !hasStation(s, town)) continue;
    for (const good of wantedGoods(s)) {
      const makers = s.sites.filter((o) => MAKES[o.kind] === good);
      if (joined(s, town, makers)) continue;
      const from = nearestMaker(s, town, good);
      if (from) out.push({ kind: 'starved', site: town.id, to: from.id, good, cost: linkCost(s, town, from) ?? undefined, score: 90 + 15 * town.size });
    }
  }

  // cash that sits idle while an unjoined maker and buyer could be joined
  const spare = s.cash - (s.perks.freeTrains > 0 ? 0 : trainPrice());
  if (spare > 0) {
    let best: { a: Site; b: Site; good: Good; cost: number } | null = null;
    for (const a of s.sites) {
      const good = MAKES[a.kind];
      if (!good) continue;
      for (const b of s.sites) {
        if (b === a || !TAKES[b.kind].includes(good) || (!hasStation(s, a) && !hasStation(s, b)) || joined(s, a, [b])) continue;
        const cost = linkCost(s, a, b);
        if (cost === null || cost > spare) continue;
        const diff = best ? (goal.includes(b) ? 0 : 1) - (goal.includes(best.b) ? 0 : 1) || cost - best.cost : -1;
        if (diff < 0) best = { a, b, good, cost };
      }
    }
    if (best) out.push({ kind: 'cash', site: best.a.id, to: best.b.id, good: best.good, amount: Math.floor(s.cash), cost: best.cost, score: 50 + Math.min(20, spare / 100) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 3);
}

/** a key that stays the same while the advice says the same thing, for holding a tip on screen */
export function adviceKey(a: Advice): string {
  return `${a.kind}:${a.site}:${a.to ?? ''}:${a.good ?? ''}:${a.onLine ?? ''}:${a.kind === 'expand' ? a.cost : ''}`;
}
