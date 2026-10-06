/**
 * The grid the player never sees: cells, eight directions, and the route a
 * drag becomes. A route is a path over cells found two ways: the cheapest
 * (plain land costs TRACK a cell, water BRIDGE, a ridge CUTTING, existing
 * track nothing) and the shortest (every cell the same, so it bridges and
 * cuts where that saves cells). When the two differ the player picks.
 * A site's cell is passable only as the route's end.
 */
import type { SimState } from './types';

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
export const CUTTING_COST = 3;
export const STATION_COST = 20;

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
  /** what it costs to build: new cells at their price, the station if the end has none */
  cost: number;
  /** cells over water that are not track yet */
  bridge: number[];
  /** cells through a ridge that are not track yet */
  cutting: number[];
  /** cells that are new track */
  added: number[];
  /** whether the end gets a new station */
  newStation: boolean;
  /** length in cells, for the distance factor and the trip time */
  length: number;
}

/** the price of laying track across cell i; 0 when track is there already */
export function cellCost(s: SimState, i: number): number {
  if (s.track[i]) return 0;
  return s.water[i] ? BRIDGE_COST : s.ridge[i] ? CUTTING_COST : TRACK_COST;
}

/** whether a cell can carry track at all: a site's cell only as a station */
function passable(s: SimState, i: number, end: number): boolean {
  if (i === end) return true;
  return !s.sites.some((site) => idx(s, site.cx, site.cy) === i);
}

/**
 * A* from a cell to a cell. In cheap mode the step cost is the cell's price times the step's
 * length plus a small constant so a free run over old track still prefers the short way; in
 * short mode every cell costs the same. Returns null when there is no path.
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
      const c = g[cur] + (mode === 'cheap' ? cellCost(s, ni) + 0.05 : 1) * len;
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

function describe(s: SimState, cells: number[], mode: RouteMode): Route {
  const to = cells[cells.length - 1];
  const added = cells.filter((i) => !s.track[i]);
  const bridge = added.filter((i) => s.water[i] === 1);
  const cutting = added.filter((i) => s.ridge[i] === 1 && !s.water[i]);
  const newStation = !s.stations.some((st) => st.cell === to);
  let cost = 0;
  for (const i of added) cost += cellCost(s, i);
  if (newStation) cost += STATION_COST;
  let length = 0;
  for (let k = 1; k < cells.length; k++) length += stepLen(cx(s, cells[k]) - cx(s, cells[k - 1]), cy(s, cells[k]) - cy(s, cells[k - 1]));
  return { mode, cells, cost, bridge, cutting, added, newStation, length };
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
