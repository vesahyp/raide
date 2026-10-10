/**
 * What the player should look at next: data only, no words (the UI words it). `advice` ranks the
 * problems and chances on the map by what they mean for the goal and for money, and returns at
 * most three, the top one first. It reads the state and changes nothing, and the one costly part
 * (a route's price) is remembered while the stations and lines stay as they are.
 */
import type { Good, Line, SimState, Site, Train, WagonType } from './types';
import { MAKES, TAKES, WAGON_GOODS, WAGON_FARE, WAGONS_MAX, WAGONS_DEFAULT, wagonFor } from './content/economy';
import { siteById, siteAt, stationAt } from './state';
import { idx, type Route } from './grid';
import { plan, platformPrice, lineYear, trainPrice, wantedGoods, extendable, canExtend, freeSide, stopSite, townStops, wantsPeople, visited } from './sim';

export type AdviceKind = 'first' | 'stuck' | 'starved' | 'more' | 'people' | 'platform' | 'cash' | 'contract' | 'idle-line';

export interface Advice {
  kind: AdviceKind;
  /** the site the marker stands over: the one with the problem */
  site: string;
  /** the site that answers it, when there is one: the arc ends there */
  to?: string;
  good?: Good;
  /** stuck: loads waiting. cash: the cash in hand. contract: loads still to deliver */
  amount?: number;
  /** first and cash: what the suggested line costs */
  cost?: number;
  /** contract: the year it ends */
  deadline?: number;
  /** a tip that lays track: the id of the line the track would lengthen; absent when it starts a new line */
  lengthen?: number;
  /** idle-line: the line that has no train. people: the id of a line that already joins the two towns and has no coach, where a coach would go. more: the line the goods wait on */
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
  return s.sites
    .filter((x) => x.kind === 'town')
    .sort((a, b) => b.size - a.size || b.growth - a.growth || near(a) - near(b))
    .slice(0, goal.count);
}

/** the goods a town has none of in store right now, among those the map makes */
export function townLacks(s: SimState, site: Site): Good[] {
  return wantedGoods(s).filter((g) => site.store[g] <= 0.001);
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
    out.push({ kind: 'idle-line', site: stopSite(s, line, 0).id, to: stopSite(s, line, line.stops.length - 1).id, onLine: line.id, score: 200 });
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

  // goods piling up at a maker that a line already carries, while the town at the other end has none: the line needs a wagon or a train
  for (const site of s.sites) {
    const good = MAKES[site.kind];
    if (!good || !hasStation(s, site)) continue;
    const raw = TAKES[site.kind].length === 0;
    if (site.stock < (raw ? STUCK_RAW : STUCK_REFINERY)) continue;
    const mine = s.stations.find((st) => st.siteId === site.id)!;
    for (const line of s.lines) {
      if (!line.stops.includes(mine.id) || !s.trains.some((t) => t.lineId === line.id)) continue;
      // room for more: a train with a free place for this good's wagon, or a second train that would not only queue (when it would, the platform tip comes instead)
      const type = wagonFor(good);
      const room = s.trains.some((t) => t.lineId === line.id && t.nWagons < WAGONS_MAX && t.wagons.includes(type)) || lineYear(s, line, { engine: 'hilma', wagons: WAGONS_DEFAULT }).limit === 'free';
      if (!room) continue;
      const buyer = line.stops.map((_, i) => stopSite(s, line, i)).find((o) => o !== site && TAKES[o.kind].includes(good) && (o.kind !== 'town' || o.store[good] <= 0.001));
      if (buyer) out.push({ kind: 'more', site: site.id, to: buyer.id, good, amount: Math.floor(site.stock), onLine: line.id, score: 92 + site.stock * (raw ? 2 : 4) + (goal.includes(buyer) ? 15 : 0) });
    }
  }

  // a goal town with a station that has no line from anything that makes a good it wants
  for (const town of goal) {
    if (town.kind !== 'town' || !hasStation(s, town)) continue;
    for (const good of townLacks(s, town)) {
      const makers = s.sites.filter((o) => MAKES[o.kind] === good);
      if (joined(s, town, makers)) continue;
      const from = nearestMaker(s, town, good);
      if (from) out.push({ kind: 'starved', site: town.id, to: from.id, good, cost: linkCost(s, town, from) ?? undefined, score: 90 + 15 * town.size });
    }
  }

  // a goal town of size 2 or more that no traveller has reached lately: a coach from another town
  for (const town of goal) {
    if (town.kind !== 'town' || !hasStation(s, town) || !wantsPeople(s, town) || visited(s, town)) continue;
    const towns = s.sites.filter((o) => o !== town && o.kind === 'town');
    const mine = s.stations.find((st) => st.siteId === town.id)!;
    const joining = (o: Site) => s.lines.filter((l) => l.stops.includes(mine.id) && l.stops.some((id) => s.stations.find((st) => st.id === id)?.siteId === o.id));
    // a line to another town is there, and a coach is already on it: the travellers are on their way
    if (towns.some((o) => joining(o).some((l) => s.trains.some((t) => t.lineId === l.id && t.wagons.includes('coach'))))) continue;
    const bare = towns.map((o) => ({ o, line: joining(o)[0] })).find((x) => x.line && s.trains.some((t) => t.lineId === x.line.id));
    if (bare) {
      out.push({ kind: 'people', site: town.id, to: bare.o.id, onLine: bare.line.id, score: 88 + 3 * town.size });
      continue;
    }
    if (towns.some((o) => joining(o).length)) continue;
    // no line between them: the nearest other town, one with a station first
    const to = towns.slice().sort((a, b) => dist(town, a) - dist(town, b) - (hasStation(s, a) ? 12 : 0) + (hasStation(s, b) ? 12 : 0))[0];
    if (to) out.push({ kind: 'people', site: town.id, to: to.id, cost: linkCost(s, town, to) ?? undefined, score: 86 + 3 * town.size });
  }

  // a second train that would only queue for a platform
  for (const line of s.lines) {
    if (!s.trains.some((t) => t.lineId === line.id)) continue;
    const now = lineYear(s, line);
    if (now.limit !== 'free') continue;
    const next = lineYear(s, line, { engine: 'hilma', wagons: 2 });
    if (next.limit !== 'platform') continue;
    const st = stationAt(s, next.at);
    if (!st || platformPrice(s, st.id) === null) continue;
    out.push({ kind: 'platform', site: st.siteId, cost: platformPrice(s, st.id)!, score: 80 });
  }

  // a contract that is running out of the year
  for (const c of s.contracts) {
    if (c.got >= c.count || c.deadline !== s.year || s.yearFrac < 0.4) continue;
    const mk = s.sites.find((o) => MAKES[o.kind] === c.good);
    out.push({ kind: 'contract', site: c.site, to: mk?.id, good: c.good, amount: c.count - c.got, deadline: c.deadline, score: 70 + 20 * s.yearFrac });
  }

  // cash that sits idle while an unjoined maker and buyer could be joined
  const spare = s.cash - trainPrice();
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

  const top = out.sort((x, y) => y.score - x.score).slice(0, 3);
  for (const a of top) if (a.to && (a.kind === 'first' || a.kind === 'stuck' || a.kind === 'starved' || a.kind === 'cash' || (a.kind === 'people' && a.onLine === undefined))) a.lengthen = lengthenable(s, siteById(s, a.site), siteById(s, a.to));
  return top;
}

/**
 * The line the track between two sites would lengthen, when the tip may say so: one of the sites
 * has a station that ends a line, the route can leave on the line's free side, and a train of that
 * line carries something the new stop makes or takes. Otherwise the track is a new line.
 */
function lengthenable(s: SimState, a: Site, b: Site): number | undefined {
  const [from, to] = hasStation(s, a) ? [a, b] : hasStation(s, b) ? [b, a] : [null, null];
  if (!from || !to) return undefined;
  return lengthenOptions(s, cellOf(s, from), cellOf(s, to))[0]?.line.id;
}

/** a line the new stop could lengthen: the routes that do it, and the trains that would then run on to the new stop */
export interface Lengthen {
  line: Line;
  options: Route[];
  trains: Train[];
}

/**
 * The lines a track from a station to a site may lengthen. A line is on the list only when a train
 * on it carries something the new stop takes or makes (a lengthening that sends a train where its
 * wagons have nothing to do is never offered), and a route can leave its end station on the free
 * side without a bridge the new line would not need (the free side may point away from the target,
 * and the forced straight run then ends in a bridge and a hairpin). Everything else is
 * a new line. The drag and the pick mode both ask here.
 */
export function lengthenOptions(s: SimState, from: number, to: number): Lengthen[] {
  const site = siteAt(s, to);
  if (!site) return [];
  const fresh = plan(s, from, to);
  const dry = fresh.length ? Math.min(...fresh.map((r) => r.bridge.length)) : 0;
  const out: Lengthen[] = [];
  for (const line of extendable(s, from)) {
    const trains = s.trains.filter((t) => t.lineId === line.id && t.wagons.some((w) => carriesAt(s, line, w, site)));
    if (!trains.length) continue;
    const options = plan(s, from, to, freeSide(s, line, from)).filter((r) => canExtend(s, r, line.id) && r.bridge.length <= dry);
    if (options.length) out.push({ line, options, trains });
  }
  return out;
}

/** whether a wagon of this type would carry something to or from a new stop at this site on the line */
function carriesAt(s: SimState, line: Line, wagon: WagonType, site: Site): boolean {
  const fare = WAGON_FARE[wagon];
  if (fare) return site.kind === 'town' && townStops(s, line).length >= 1;
  const stops = line.stops.map((_, i) => stopSite(s, line, i));
  return WAGON_GOODS[wagon].some((g) => (MAKES[site.kind] === g && stops.some((o) => TAKES[o.kind].includes(g))) || (TAKES[site.kind].includes(g) && stops.some((o) => MAKES[o.kind] === g)));
}

/** a key that stays the same while the advice says the same thing, for holding a tip on screen */
export function adviceKey(a: Advice): string {
  return `${a.kind}:${a.site}:${a.to ?? ''}:${a.good ?? ''}:${a.lengthen ?? ''}:${a.onLine ?? ''}`;
}
