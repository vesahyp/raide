/**
 * The grid the player never sees: cells, eight directions, and the route a
 * drag becomes. A route is a path over cells found two ways: the cheapest
 * (flat land costs TRACK a cell, a grade adds to it, a hill steeper than
 * the grade limit costs its cut and fill, water a bridge, existing track
 * nothing) and the shortest (every cell the same, so it bridges and cuts
 * where that saves cells). When the two differ the player picks.
 * A site's yard is never passable, and its cell only as the route's end.
 *
 * The rail's height along a route is the land's, cut and filled so that no
 * step is steeper than GRADE_MAX: a hill is crossed in a cutting, a hollow
 * on an embankment, water on a bridge.
 */
import type { SimState } from './types';
import { CELL_M, GRADE_MAX } from './content/economy';

/** the eight directions as (dx, dy); bit i of a track mask means track leaves the cell in DIRS[i] */
export const DIRS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export const TRACK_COST = 1;
export const BRIDGE_COST = 4;
/** per percent of grade, on top of the track's price */
export const GRADE_COST = 0.25;
/** per metre of land cut away or filled in, per cell */
export const EARTH_COST = 0.25;
export const STATION_COST = 40;
/**
 * Cells of straight track every line runs into and out of a station, along the station's row,
 * east or west of it. The platform tracks of a station lie parallel to this stretch (one per
 * train that stands there at once), so the last cells must be a straight, level row. A route
 * never enters a station cell from the yard side (north) and never on a diagonal.
 */
export const APPROACH = 8;
/** the cost of a join to a station's straight stretch at more than 45 degrees, in the cost of the route */
const KINK_COST = 0.6;
/** the search counts a too steep step this many times: the cut spreads along the ramp the rail needs */
const RAMP = 6;
/** the rail's height over the water on a bridge, metres */
export const BRIDGE_CLEAR = 4;

export const idx = (s: { w: number }, cx: number, cy: number): number => cy * s.w + cx;
export const cx = (s: { w: number }, i: number): number => i % s.w;
export const cy = (s: { w: number }, i: number): number => Math.floor(i / s.w);
export const inside = (s: { w: number; h: number }, x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.h;

export function dirIndex(dx: number, dy: number): number {
  return DIRS.findIndex(([x, y]) => x === dx && y === dy);
}

/** the length of a step in cells: 1 straight, root two diagonal */
export function stepLen(dx: number, dy: number): number {
  return dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
}

export type RouteMode = 'cheap' | 'short';

export interface Route {
  mode: RouteMode;
  /** cells from the start cell to the end cell, both included */
  cells: number[];
  /** the rail's height in metres per cell of the route */
  rail: number[];
  /** what it costs to build: new cells at their price, the earthworks, the station if the end has none */
  cost: number;
  /** cells over water that are not track yet */
  bridge: number[];
  /** new cells where the land is cut down to the rail by more than a metre */
  cutting: number[];
  /** new cells where the rail stands on a fill more than a metre high */
  fill: number[];
  /** cells that are new track */
  added: number[];
  /** whether the end gets a new station */
  newStation: boolean;
  /** length in cells, for the distance factor and the trip time */
  length: number;
  /** the steepest step, in percent */
  worst: number;
  /** metres climbed over the route, both ways added */
  climb: number;
}

/** the grade of a step in percent, from a rise in metres over a step in cells */
export function gradeOf(rise: number, len: number): number {
  return (rise / (len * CELL_M)) * 100;
}

/**
 * The rail along a list of cells: the land at each cell, then clamped so that no step is
 * steeper than GRADE_MAX, forward and back. The ends stay on the land (a station stands there).
 * Water cells lift the rail to the bridge's clearance. Cells that carry track already keep
 * the rail they have, so a route that joins old track meets it at its height.
 */
export function profile(s: SimState, cells: number[]): number[] {
  const n = cells.length;
  const h = cells.map((i) => (s.water[i] ? BRIDGE_CLEAR : s.height[i]));
  const fixed = cells.map((i, k) => k === 0 || k === n - 1 || !!s.track[i]);
  for (let k = 0; k < n; k++) if (fixed[k]) h[k] = railAt(s, cells[k]) ?? h[k];
  const rail = h.slice();
  const limit = (k: number, from: number) => {
    const len = stepLen(cx(s, cells[k]) - cx(s, cells[from]), cy(s, cells[k]) - cy(s, cells[from]));
    const max = (GRADE_MAX / 100) * len * CELL_M;
    rail[k] = Math.max(rail[from] - max, Math.min(rail[from] + max, rail[k]));
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 1; k < n; k++) if (!fixed[k]) limit(k, k - 1);
    for (let k = n - 2; k >= 0; k--) if (!fixed[k]) limit(k, k + 1);
  }
  // a water cell never goes below its clearance: the clamp may have pulled it down on a bank
  for (let k = 0; k < n; k++) if (s.water[cells[k]] && !fixed[k]) rail[k] = Math.max(rail[k], BRIDGE_CLEAR);
  return rail;
}

/** the rail height a built cell has, from the first line that runs over it */
export function railAt(s: SimState, cell: number): number | null {
  for (const l of s.lines) {
    const k = l.path.indexOf(cell);
    if (k >= 0) return l.rail[k];
  }
  return null;
}

/** whether a cell can carry track at all: a yard never, a site's cell only as the route's end */
function passable(s: SimState, i: number, end: number): boolean {
  if (i === end) return true;
  return s.yardMask[i] === 0;
}

/** what a step from cell a to its neighbour b costs to build, an estimate for the search */
function stepCost(s: SimState, a: number, b: number, len: number): number {
  if (s.track[b]) return 0.05 * len;
  if (s.water[b]) return BRIDGE_COST * len;
  const ha = s.water[a] ? BRIDGE_CLEAR : s.height[a];
  const rise = Math.abs(s.height[b] - ha);
  const g = gradeOf(rise, len);
  const over = Math.max(0, rise - (GRADE_MAX / 100) * len * CELL_M);
  // a step that is too steep is not the whole cut: the rail climbs on, and the cut grows along the ramp
  return (TRACK_COST * (1 + GRADE_COST * Math.min(g, GRADE_MAX)) + EARTH_COST * RAMP * over + 0.05) * len;
}

/** one way into a station: the straight cells from the station cell outward, and what they cost */
interface Approach {
  /** the station cell first, the outer cell of the straight stretch last */
  cells: number[];
  cost: number;
  /** which way the stretch runs from the station: -1 west, 1 east; 0 for a bare cell */
  dir: number;
}

/** the straight stretches a route may use at a station cell: west and east along its row, where free */
function approaches(s: SimState, station: number, mode: RouteMode, only?: number): Approach[] {
  const out: Approach[] = [];
  const x = cx(s, station);
  const y = cy(s, station);
  for (const dir of [-1, 1]) {
    if (only !== undefined && dir !== only) continue;
    const cells = [station];
    let cost = 0;
    let ok = true;
    for (let j = 1; j <= APPROACH; j++) {
      if (!inside(s, x + dir * j, y)) {
        ok = false;
        break;
      }
      const i = idx(s, x + dir * j, y);
      if (s.yardMask[i] !== 0) {
        ok = false;
        break;
      }
      cost += mode === 'cheap' ? stepCost(s, cells[cells.length - 1], i, 1) : 1;
      cells.push(i);
    }
    if (ok) out.push({ cells, cost, dir });
  }
  return out;
}

/**
 * A* from a cell to a cell. In cheap mode the step cost is what the step would cost to build
 * plus a small constant so a free run over old track still prefers the short way; in short
 * mode every cell costs the same. Returns null when there is no path. A route that starts at a
 * station, or ends at a site, runs the last APPROACH cells straight along the station's row
 * (west or east, whichever the search finds cheaper). Elsewhere it is free. `startSide` fixes the
 * side the route leaves its first station on (-1 west, 1 east): a line that is lengthened leaves the
 * station it ran into on the other side, so a train runs straight through.
 */
export function route(s: SimState, from: number, to: number, mode: RouteMode = 'cheap', startSide?: number): Route | null {
  if (from === to) return null;
  const n = s.w * s.h;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const isSite = s.sites.some((o) => idx(s, o.cx, o.cy) === to);
  // a site's own cell is reached only along its straight stretch, never through the search
  const free = isSite ? -1 : to;
  const starts = approaches(s, from, mode, startSide);
  const ends: Approach[] = isSite ? approaches(s, to, mode) : [{ cells: [to], cost: 0, dir: 0 }];
  if (!starts.length || !ends.length) return null;
  const goals = ends.map((e) => ({ cell: e.cells[e.cells.length - 1], ...e }));
  const h = (i: number) => {
    let best = Infinity;
    for (const o of goals) {
      const dx = Math.abs(cx(s, i) - cx(s, o.cell));
      const dy = Math.abs(cy(s, i) - cy(s, o.cell));
      best = Math.min(best, (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * 0.05);
    }
    return best;
  };
  // a binary heap on two number arrays, priority and cell: 12000 cells search in a few milliseconds
  const hp: number[] = [];
  const hc: number[] = [];
  const push = (pri: number, cell: number) => {
    let k = hp.length;
    hp.push(pri);
    hc.push(cell);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hp[p] <= pri) break;
      hp[k] = hp[p];
      hc[k] = hc[p];
      k = p;
    }
    hp[k] = pri;
    hc[k] = cell;
  };
  const pop = (): number => {
    const top = hc[0];
    const lp = hp.pop()!;
    const lc = hc.pop()!;
    const n = hp.length;
    if (n) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hp[c + 1] < hp[c]) c++;
        if (hp[c] >= lp) break;
        hp[k] = hp[c];
        hc[k] = hc[c];
        k = c;
      }
      hp[k] = lp;
      hc[k] = lc;
    }
    return top;
  };
  // the stretches themselves are not searched: the path starts or ends at their outer cell, never along them
  for (const a of [...starts, ...ends]) for (const c of a.cells.slice(0, -1)) closed[c] = 1;
  for (const a of starts) {
    const o = a.cells[a.cells.length - 1];
    g[o] = a.cost;
    push(a.cost + h(o), o);
  }
  // the path meets a straight stretch at no more than a 45 degree turn when it can: an engine cuts a sharper corner off the rails
  const startDir = new Map(starts.map((a) => [a.cells[a.cells.length - 1], a.dir]));
  const goalDir = new Map(ends.map((a) => [a.cells[a.cells.length - 1], a.dir]));
  let best = Infinity;
  let bestGoal: (typeof goals)[number] | null = null;
  while (hp.length) {
    if (hp[0] >= best) break;
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const goal = goals.find((o) => o.cell === cur);
    if (goal) {
      if (g[cur] + goal.cost < best) {
        best = g[cur] + goal.cost;
        bestGoal = goal;
      }
      continue;
    }
    const x = cx(s, cur);
    const y = cy(s, cur);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(s, nx, ny)) continue;
      const ni = idx(s, nx, ny);
      if (closed[ni] || !passable(s, ni, free)) continue;
      // a join to a straight stretch at more than 45 degrees costs a few tiles of track, so it is the last resort
      const leave = startDir.get(cur);
      const enter = goalDir.get(ni);
      const kink = (leave && dx * leave <= 0) || (enter && dx * -enter <= 0) ? KINK_COST : 0;
      // a diagonal step between two water cells would run over the water's corner on no bridge
      if (dx !== 0 && dy !== 0 && s.water[idx(s, x + dx, y)] && s.water[idx(s, x, y + dy)] && !s.water[ni] && !s.water[cur]) continue;
      // a diagonal step may not cross laid track's other diagonal of the same square: two lines that cross in an X share no cell, so no block, and their trains would meet at the point
      if (dx !== 0 && dy !== 0 && crossesTrack(s, x, y, dx, dy)) continue;
      const len = stepLen(dx, dy);
      const c = g[cur] + (mode === 'cheap' ? stepCost(s, cur, ni, len) : len) + kink;
      if (c < g[ni]) {
        g[ni] = c;
        prev[ni] = cur;
        push(c + h(ni), ni);
      }
    }
  }
  if (!bestGoal) return null;
  // the search's own cells run from a start's outer cell to a goal's outer cell
  const mid: number[] = [];
  for (let i = bestGoal.cell; i !== -1; i = prev[i]) mid.push(i);
  mid.reverse();
  const head = starts.find((a) => a.cells[a.cells.length - 1] === mid[0]);
  if (!head) return null;
  const cells = [...head.cells.slice(0, -1), ...mid, ...bestGoal.cells.slice(0, -1).reverse()];
  if (new Set(cells).size !== cells.length) return null;
  return describe(s, cells, mode);
}

/** the route's rail, its earthworks and its price */
export function describe(s: SimState, cells: number[], mode: RouteMode): Route {
  const to = cells[cells.length - 1];
  const rail = profile(s, cells);
  const added: number[] = [];
  const bridge: number[] = [];
  const cutting: number[] = [];
  const fill: number[] = [];
  const newStation = !s.stations.some((st) => st.cell === to);
  let cost = newStation ? STATION_COST : 0;
  let length = 0;
  let worst = 0;
  let climb = 0;
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k];
    const len = k > 0 ? stepLen(cx(s, i) - cx(s, cells[k - 1]), cy(s, i) - cy(s, cells[k - 1])) : 1;
    if (k > 0) {
      length += len;
      const g = Math.abs(gradeOf(rail[k] - rail[k - 1], len));
      worst = Math.max(worst, g);
      climb += Math.abs(rail[k] - rail[k - 1]);
    }
    if (s.track[i] || k === 0) continue;
    added.push(i);
    if (s.water[i]) {
      bridge.push(i);
      cost += BRIDGE_COST * len;
      continue;
    }
    const earth = rail[k] - s.height[i];
    if (earth < -1) cutting.push(i);
    if (earth > 1) fill.push(i);
    const g = k > 0 ? Math.abs(gradeOf(rail[k] - rail[k - 1], len)) : 0;
    cost += (TRACK_COST * (1 + GRADE_COST * g) + EARTH_COST * Math.abs(earth)) * len;
  }
  return { mode, cells, rail, cost: Math.round(cost), bridge, cutting, fill, added, newStation, length, worst, climb };
}

/** the track bit of the other diagonal, seen from the cell beside the step: (dx, dy) = (+, +), (-, +), (+, -), (-, -) */
const CROSS_BIT = [dirIndex(-1, 1), dirIndex(1, 1), dirIndex(-1, -1), dirIndex(1, -1)].map((d) => 1 << d);

/** whether laid track already runs along the other diagonal of the square that a diagonal step from (x, y) by (dx, dy) cuts across */
function crossesTrack(s: SimState, x: number, y: number, dx: number, dy: number): boolean {
  return (s.track[y * s.w + x + dx] & CROSS_BIT[dy > 0 ? (dx > 0 ? 0 : 1) : dx > 0 ? 2 : 3]) !== 0;
}

/**
 * Whether a route doubles back: over any three cells it heads one way, and over the next three it
 * heads more than 90 degrees away from that. A hairpin is never a sensible way to a site.
 */
export function turnsBack(s: { w: number }, cells: number[], span = 3): boolean {
  for (let k = span; k + span < cells.length; k++) {
    const ax = cx(s, cells[k]) - cx(s, cells[k - span]);
    const ay = cy(s, cells[k]) - cy(s, cells[k - span]);
    const bx = cx(s, cells[k + span]) - cx(s, cells[k]);
    const by = cy(s, cells[k + span]) - cy(s, cells[k]);
    if (ax * bx + ay * by < 0) return true;
  }
  return false;
}

/** the routes a drag offers: the cheapest, and the shortest when it is a different path */
export function routeOptions(s: SimState, from: number, to: number, startSide?: number): Route[] {
  const cheap = route(s, from, to, 'cheap', startSide);
  if (!cheap) return [];
  const short = route(s, from, to, 'short', startSide);
  if (!short || short.length >= cheap.length - 0.5 || short.cells.join() === cheap.cells.join()) return [cheap];
  return [cheap, short];
}

/** link two neighbouring cells with track, both ways */
export function link(s: SimState, a: number, b: number): void {
  const dx = cx(s, b) - cx(s, a);
  const dy = cy(s, b) - cy(s, a);
  const d = dirIndex(dx, dy);
  if (d < 0) throw new Error(`cells ${a} and ${b} are not neighbours`);
  s.track[a] |= 1 << d;
  s.track[b] |= 1 << ((d + 4) % 8);
}

export function unlink(s: SimState, a: number, b: number): void {
  const d = dirIndex(cx(s, b) - cx(s, a), cy(s, b) - cy(s, a));
  if (d < 0) return;
  s.track[a] &= ~(1 << d);
  s.track[b] &= ~(1 << ((d + 4) % 8));
}

/** the track neighbours of a cell */
export function linked(s: SimState, i: number): number[] {
  const out: number[] = [];
  const m = s.track[i];
  for (let d = 0; d < 8; d++) if (m & (1 << d)) out.push(idx(s, cx(s, i) + DIRS[d][0], cy(s, i) + DIRS[d][1]));
  return out;
}
