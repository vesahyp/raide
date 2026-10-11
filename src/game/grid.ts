/**
 * The grid: tiles, eight directions, the track a drag becomes, and the way a
 * train finds over laid track.
 *
 * Track is free (ADR 0007): any tile to any tile, joining or crossing laid
 * track anywhere. A route never turns more than 45 degrees from one tile to
 * the next, so every piece of track is one a train can run. Where a route
 * starts or ends on laid track it must meet it at 45 degrees or less, so the
 * junction is one a train can take.
 *
 * The rail along a new route is the land, clamped so no step is steeper than
 * the route's grade limit: steeper land is cut or filled, and the earthworks
 * are paid for. Two kinds of route are offered: the cheapest (grades up to
 * GRADE_CHEAP), and the level one (GRADE_LEVEL, which detours round hills or
 * cuts through them). Laid track keeps its rail height.
 */
import type { SimState } from './types';
import { BRIDGE_CLEAR, BRIDGE_COST, CELL_M, CLEAR_COST, EARTH_COST, GRADE_CHEAP, GRADE_LEVEL, TRACK_COST } from './content/economy';

/** the eight directions as (dx, dy), clockwise from east; bit d of a track mask means track leaves the cell in DIRS[d] */
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

export const idx = (s: { w: number }, x: number, y: number): number => y * s.w + x;
export const cx = (s: { w: number }, i: number): number => i % s.w;
export const cy = (s: { w: number }, i: number): number => Math.floor(i / s.w);
export const inside = (s: { w: number; h: number }, x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.h;

export function dirIndex(dx: number, dy: number): number {
  return DIRS.findIndex(([x, y]) => x === dx && y === dy);
}
/** the step from cell a to its neighbour b as a direction index, -1 when they are not neighbours */
export function dirOf(s: { w: number }, a: number, b: number): number {
  const dx = cx(s, b) - cx(s, a);
  const dy = cy(s, b) - cy(s, a);
  return Math.abs(dx) > 1 || Math.abs(dy) > 1 ? -1 : dirIndex(dx, dy);
}
/** how far apart two directions are, in steps of 45 degrees, 0 to 4 */
export function turn(a: number, b: number): number {
  const d = Math.abs(a - b) % 8;
  return Math.min(d, 8 - d);
}
export function stepLen(d: number): number {
  return d % 2 ? Math.SQRT2 : 1;
}
export function gradeOf(rise: number, len: number): number {
  return (rise / (len * CELL_M)) * 100;
}

/** a binary heap on two number arrays, priority and key */
export class Heap {
  private p: number[] = [];
  private k: number[] = [];
  get size(): number {
    return this.p.length;
  }
  push(pri: number, key: number): void {
    let i = this.p.length;
    this.p.push(pri);
    this.k.push(key);
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (this.p[q] <= pri) break;
      this.p[i] = this.p[q];
      this.k[i] = this.k[q];
      i = q;
    }
    this.p[i] = pri;
    this.k[i] = key;
  }
  peek(): number {
    return this.p[0];
  }
  pop(): number {
    const top = this.k[0];
    const lp = this.p.pop()!;
    const lk = this.k.pop()!;
    const n = this.p.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.p[c + 1] < this.p[c]) c++;
        if (this.p[c] >= lp) break;
        this.p[i] = this.p[c];
        this.k[i] = this.k[c];
        i = c;
      }
      this.p[i] = lp;
      this.k[i] = lk;
    }
    return top;
  }
}

export type RouteMode = 'cheap' | 'level';

export interface Route {
  mode: RouteMode;
  /** cells from the start to the end, both included */
  cells: number[];
  /** the rail's height in metres per cell */
  rail: number[];
  cost: number;
  /** new cells over water */
  bridge: number[];
  /** new cells cut down more than a metre, and filled up more than a metre */
  cutting: number[];
  fill: number[];
  /** links the route adds, as cell pairs; a step along laid track adds none */
  links: [number, number][];
  /** cells with no track before */
  added: number[];
  /** length in tiles */
  length: number;
  /** the steepest step in percent */
  worst: number;
}

const isStation = (s: SimState, cell: number): boolean => s.stations.some((st) => st.cell === cell);

/** whether a cell may carry track: on the map, and no building or house on it */
function open(s: SimState, i: number): boolean {
  return !s.blocked[i];
}

/** the directions trains can leave a laid cell in when they arrive moving in direction `d`: within 45 degrees of it */
function canLeave(s: SimState, cell: number, arriving: number): boolean {
  const m = s.track[cell];
  for (let l = 0; l < 8; l++) if (m & (1 << l) && turn(arriving, l) <= 1) return true;
  return false;
}

/** whether a new route may leave a laid cell in direction `d`: a train coming along some link of it can go on that way */
function canJoinFrom(s: SimState, cell: number, d: number): boolean {
  const m = s.track[cell];
  // a train reverses at a station, so track may leave a station any way
  if (!m || isStation(s, cell)) return true;
  for (let l = 0; l < 8; l++) if (m & (1 << l) && turn((l + 4) % 8, d) <= 1) return true;
  return false;
}

/** the land's height as the search reads it: water at the bridge's clearance */
function landAt(s: SimState, i: number): number {
  if (s.track[i]) return s.rail[i];
  return s.water[i] ? BRIDGE_CLEAR : s.height[i];
}

/** what a step costs the search: the build price of the new piece, and a grade penalty in level mode */
function stepCost(s: SimState, a: number, b: number, d: number, mode: RouteMode): number {
  const len = stepLen(d);
  // along laid track: almost free, so a route reuses it where it runs the same way
  if (s.track[a] & (1 << d)) return 0.05 * len;
  if (s.water[b] && !s.track[b]) return BRIDGE_COST * len + 0.05;
  const rise = Math.abs(landAt(s, b) - landAt(s, a));
  const limit = mode === 'level' ? GRADE_LEVEL : GRADE_CHEAP;
  const over = Math.max(0, rise - (limit / 100) * len * CELL_M);
  // a too steep step is not the whole cut: the rail climbs on, and the cut spreads along the ramp
  const earth = EARTH_COST * over * 3;
  const clear = s.cover[b] === 1 ? CLEAR_COST : 0;
  const base = s.track[b] ? TRACK_COST * 0.6 : TRACK_COST + clear;
  // level mode prices height as if every metre climbed were dug
  const climb = mode === 'level' ? rise * EARTH_COST * 0.6 : rise * 0.02;
  return (base + earth + climb) * len + 0.05;
}

const STATES = 8;
/** a reversal on the way, in tiles of running: the time it takes to stop and run back */
const REVERSE_COST = 4;

/**
 * The cheapest route from one cell to another through the given waypoints, each leg an A* over
 * (cell, heading) so no step turns more than 45 degrees, including through a waypoint. Null when
 * there is none.
 */
export function route(s: SimState, from: number, to: number, via: number[] = [], mode: RouteMode = 'cheap'): Route | null {
  const pts = [from, ...via, to];
  const cells: number[] = [from];
  let heading = -1;
  for (let k = 0; k + 1 < pts.length; k++) {
    const leg = searchLeg(s, pts[k], pts[k + 1], heading, mode, k + 2 === pts.length);
    if (!leg) return null;
    cells.push(...leg.slice(1));
    heading = dirOf(s, cells[cells.length - 2], cells[cells.length - 1]);
  }
  if (cells.length < 2) return null;
  return describe(s, cells, mode);
}

function searchLeg(s: SimState, from: number, to: number, heading: number, mode: RouteMode, last: boolean): number[] | null {
  if (from === to) return null;
  if (!open(s, to) || !open(s, from)) return null;
  const n = s.w * s.h * STATES;
  const g = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tx = cx(s, to);
  const ty = cy(s, to);
  const h = (i: number) => {
    const dx = Math.abs(cx(s, i) - tx);
    const dy = Math.abs(cy(s, i) - ty);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * TRACK_COST;
  };
  const heap = new Heap();
  const fx = cx(s, from);
  const fy = cy(s, from);
  for (let d = 0; d < 8; d++) {
    if (heading >= 0 && turn(heading, d) > 1) continue;
    if (heading < 0 && !canJoinFrom(s, from, d)) continue;
    const nx = fx + DIRS[d][0];
    const ny = fy + DIRS[d][1];
    if (!inside(s, nx, ny)) continue;
    const ni = idx(s, nx, ny);
    if (!open(s, ni) || cornerWater(s, from, d)) continue;
    const key = ni * STATES + d;
    const c = stepCost(s, from, ni, d, mode);
    if (c < g[key]) {
      g[key] = c;
      prev[key] = -2 - from;
      heap.push(c + h(ni), key);
    }
  }
  let found = -1;
  while (heap.size) {
    const key = heap.pop();
    if (closed[key]) continue;
    closed[key] = 1;
    const cur = (key / STATES) | 0;
    const d0 = key % STATES;
    if (cur === to) {
      // the end on laid track: a train arriving along the route can run on along some link of it
      if (!last || !s.track[cur] || isStation(s, cur) || canLeave(s, cur, d0) || canLeaveBack(s, cur, d0)) {
        found = key;
        break;
      }
      continue;
    }
    const x = cx(s, cur);
    const y = cy(s, cur);
    for (const d of [d0, (d0 + 1) % 8, (d0 + 7) % 8]) {
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      if (!inside(s, nx, ny)) continue;
      const ni = idx(s, nx, ny);
      const nk = ni * STATES + d;
      if (closed[nk] || !open(s, ni) || cornerWater(s, cur, d)) continue;
      const c = g[key] + stepCost(s, cur, ni, d, mode);
      if (c < g[nk]) {
        g[nk] = c;
        prev[nk] = key;
        heap.push(c + h(ni), nk);
      }
    }
  }
  if (found < 0) return null;
  const out: number[] = [];
  let k = found;
  for (;;) {
    out.push((k / STATES) | 0);
    const p = prev[k];
    if (p <= -2) {
      out.push(-2 - p);
      break;
    }
    k = p;
  }
  out.reverse();
  if (new Set(out).size !== out.length) return null;
  return out;
}

/** a laid end cell can also be the end of a spur that meets it head on: a train reverses there */
function canLeaveBack(s: SimState, cell: number, arriving: number): boolean {
  const m = s.track[cell];
  // a cell with one link that points back at the route: the two tracks meet end to end
  let n = 0;
  let only = -1;
  for (let l = 0; l < 8; l++) if (m & (1 << l)) (n++, (only = l));
  return n === 1 && turn(arriving, only) <= 1;
}

/** a diagonal step between two water cells would cross the water's corner on no bridge */
function cornerWater(s: SimState, cur: number, d: number): boolean {
  const [dx, dy] = DIRS[d];
  if (!dx || !dy) return false;
  const x = cx(s, cur);
  const y = cy(s, cur);
  return !!(s.water[idx(s, x + dx, y)] && s.water[idx(s, x, y + dy)] && !s.water[cur] && !s.water[idx(s, x + dx, y + dy)]);
}

/**
 * The rail along a list of cells: the land, clamped so no step is steeper than the limit, forward
 * and back. Laid cells keep their rail. Water lifts the rail to the bridge's clearance.
 */
export function profile(s: SimState, cells: number[], limit: number): number[] {
  const n = cells.length;
  const fixed = cells.map((i) => !!s.track[i]);
  const rail = cells.map((i) => landAt(s, i));
  const clamp = (k: number, from: number) => {
    const len = stepLen(dirOf(s, cells[from], cells[k]));
    const max = (limit / 100) * len * CELL_M;
    rail[k] = Math.max(rail[from] - max, Math.min(rail[from] + max, rail[k]));
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 1; k < n; k++) if (!fixed[k]) clamp(k, k - 1);
    for (let k = n - 2; k >= 0; k--) if (!fixed[k]) clamp(k, k + 1);
  }
  for (let k = 0; k < n; k++) if (s.water[cells[k]] && !fixed[k]) rail[k] = Math.max(rail[k], BRIDGE_CLEAR);
  return rail;
}

/** a route's rail, its earthworks, its new links and its price */
export function describe(s: SimState, cells: number[], mode: RouteMode): Route {
  const limit = mode === 'level' ? GRADE_LEVEL : GRADE_CHEAP;
  const rail = profile(s, cells, limit);
  const added: number[] = [];
  const bridge: number[] = [];
  const cutting: number[] = [];
  const fill: number[] = [];
  const links: [number, number][] = [];
  let cost = 0;
  let length = 0;
  let worst = 0;
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1];
    const b = cells[k];
    const d = dirOf(s, a, b);
    const len = stepLen(d);
    length += len;
    worst = Math.max(worst, Math.abs(gradeOf(rail[k] - rail[k - 1], len)));
    if (s.track[a] & (1 << d)) continue;
    links.push([a, b]);
    if (s.track[b] || added.includes(b)) {
      cost += TRACK_COST * 0.6 * len;
      continue;
    }
    added.push(b);
    if (s.water[b]) {
      bridge.push(b);
      cost += BRIDGE_COST * len;
      continue;
    }
    const earth = rail[k] - s.height[b];
    if (earth < -1) cutting.push(b);
    if (earth > 1) fill.push(b);
    cost += (TRACK_COST + (s.cover[b] === 1 ? CLEAR_COST : 0) + EARTH_COST * Math.abs(earth)) * len;
  }
  // the first cell is new track too when nothing was laid there
  if (!s.track[cells[0]] && !added.includes(cells[0])) {
    added.unshift(cells[0]);
    cost += TRACK_COST * 0.5;
  }
  return { mode, cells, rail, cost: Math.round(cost * 10) / 10, bridge, cutting, fill, links, added, length, worst: Math.round(worst * 10) / 10 };
}

/** the routes a drag offers: the cheapest, and the level one when it differs */
export function routeOptions(s: SimState, from: number, to: number, via: number[] = []): Route[] {
  const cheap = route(s, from, to, via, 'cheap');
  const level = route(s, from, to, via, 'level');
  if (!cheap) return level ? [level] : [];
  if (!level || level.cells.join() === cheap.cells.join() || level.worst >= cheap.worst - 0.3) return [cheap];
  return [cheap, level];
}

export function link(s: SimState, a: number, b: number): void {
  const d = dirOf(s, a, b);
  if (d < 0) throw new Error(`cells ${a} and ${b} are not neighbours`);
  s.track[a] |= 1 << d;
  s.track[b] |= 1 << ((d + 4) % 8);
}

export function unlink(s: SimState, a: number, b: number): void {
  const d = dirOf(s, a, b);
  if (d < 0) return;
  s.track[a] &= ~(1 << d);
  s.track[b] &= ~(1 << ((d + 4) % 8));
}

export function linksOf(s: SimState, i: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 8; d++) if (s.track[i] & (1 << d)) out.push(d);
  return out;
}

/**
 * The way a train runs from one cell to another over laid track: A* over (cell, heading), no turn
 * sharper than 45 degrees. The train may leave its start either way (it reverses at a station).
 * It may turn round at a station or a track end on the way, as RT2's trains do. Null when the
 * track does not join them.
 */
export function trackPath(s: SimState, from: number, to: number): number[] | null {
  if (from === to || !s.track[from] || !s.track[to]) return null;
  const n = s.w * s.h * STATES;
  const g = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tx = cx(s, to);
  const ty = cy(s, to);
  const h = (i: number) => {
    const dx = Math.abs(cx(s, i) - tx);
    const dy = Math.abs(cy(s, i) - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new Heap();
  const fx = cx(s, from);
  const fy = cy(s, from);
  for (const d of linksOf(s, from)) {
    const ni = idx(s, fx + DIRS[d][0], fy + DIRS[d][1]);
    const key = ni * STATES + d;
    g[key] = stepLen(d);
    prev[key] = -2 - from;
    heap.push(g[key] + h(ni), key);
  }
  let found = -1;
  while (heap.size) {
    const key = heap.pop();
    if (closed[key]) continue;
    closed[key] = 1;
    const cur = (key / STATES) | 0;
    const d0 = key % STATES;
    if (cur === to) {
      found = key;
      break;
    }
    const x = cx(s, cur);
    const y = cy(s, cur);
    const m = s.track[cur];
    // a train turns round at a station it passes and at the end of the track, never at a junction
    const turnable = isStation(s, cur) || linksOf(s, cur).length === 1;
    for (let d = 0; d < 8; d++) {
      if (!(m & (1 << d))) continue;
      const bend = turn(d0, d);
      if (bend > 1 && !turnable) continue;
      const ni = idx(s, x + DIRS[d][0], y + DIRS[d][1]);
      const nk = ni * STATES + d;
      if (closed[nk]) continue;
      const c = g[key] + stepLen(d) + (bend > 1 ? REVERSE_COST : 0);
      if (c < g[nk]) {
        g[nk] = c;
        prev[nk] = key;
        heap.push(c + h(ni), nk);
      }
    }
  }
  if (found < 0) return null;
  const out: number[] = [];
  let k = found;
  for (;;) {
    out.push((k / STATES) | 0);
    const p = prev[k];
    if (p <= -2) {
      out.push(-2 - p);
      break;
    }
    k = p;
  }
  return out.reverse();
}

/** cumulative length along a list of cells */
export function distances(s: SimState, cells: number[]): number[] {
  const out = [0];
  for (let k = 1; k < cells.length; k++) out.push(out[k - 1] + stepLen(dirOf(s, cells[k - 1], cells[k])));
  return out;
}

/** straight distance between two cells in tiles: what pay is reckoned on, as in RT2 */
export function crow(s: SimState, a: number, b: number): number {
  return Math.hypot(cx(s, a) - cx(s, b), cy(s, a) - cy(s, b));
}
