/**
 * The grid the player never sees: cells, eight directions, and the route a
 * drag becomes. A route is a path over cells found two ways: the cheapest
 * (flat land costs TRACK a cell, a grade adds to it, a hill steeper than
 * the grade limit costs its cut and fill, water a bridge, existing track
 * nothing) and the shortest (every cell the same, so it bridges and cuts
 * where that saves cells). When the two differ the player picks.
 * A site's cell is passable only as the route's end.
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
export const EARTH_COST = 0.14;
export const STATION_COST = 20;
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

/** whether a cell can carry track at all: a site's cell only as a station */
function passable(s: SimState, i: number, end: number): boolean {
  if (i === end) return true;
  return !s.sites.some((site) => idx(s, site.cx, site.cy) === i);
}

/** what a step from cell a to its neighbour b costs to build, an estimate for the search */
function stepCost(s: SimState, a: number, b: number, len: number): number {
  if (s.track[b]) return 0.05 * len;
  if (s.water[b]) return BRIDGE_COST * len;
  const ha = s.water[a] ? BRIDGE_CLEAR : s.height[a];
  const rise = Math.abs(s.height[b] - ha);
  const g = gradeOf(rise, len);
  const over = Math.max(0, rise - (GRADE_MAX / 100) * len * CELL_M);
  return (TRACK_COST * (1 + GRADE_COST * Math.min(g, GRADE_MAX)) + EARTH_COST * over + 0.05) * len;
}

/**
 * A* from a cell to a cell. In cheap mode the step cost is what the step would cost to build
 * plus a small constant so a free run over old track still prefers the short way; in short
 * mode every cell costs the same. Returns null when there is no path.
 */
export function route(s: SimState, from: number, to: number, mode: RouteMode = 'cheap'): Route | null {
  if (from === to) return null;
  const n = s.w * s.h;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tx = cx(s, to);
  const ty = cy(s, to);
  const h = (i: number) => {
    const dx = Math.abs(cx(s, i) - tx);
    const dy = Math.abs(cy(s, i) - ty);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * 0.05;
  };
  const open: number[] = [from];
  g[from] = 0;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (g[open[k]] + h(open[k]) < g[open[bi]] + h(open[bi])) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const x = cx(s, cur);
    const y = cy(s, cur);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(s, nx, ny)) continue;
      const ni = idx(s, nx, ny);
      if (closed[ni] || !passable(s, ni, to)) continue;
      // a diagonal step between two water cells would run over the water's corner on no bridge
      if (dx !== 0 && dy !== 0 && s.water[idx(s, x + dx, y)] && s.water[idx(s, x, y + dy)] && !s.water[ni] && !s.water[cur]) continue;
      const len = stepLen(dx, dy);
      const c = g[cur] + (mode === 'cheap' ? stepCost(s, cur, ni, len) : len);
      if (c < g[ni]) {
        g[ni] = c;
        prev[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (prev[to] < 0) return null;
  const cells: number[] = [];
  for (let i = to; i !== -1; i = prev[i]) cells.push(i);
  cells.reverse();
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

/** the routes a drag offers: the cheapest, and the shortest when it is a different path */
export function routeOptions(s: SimState, from: number, to: number): Route[] {
  const cheap = route(s, from, to, 'cheap');
  if (!cheap) return [];
  const short = route(s, from, to, 'short');
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
