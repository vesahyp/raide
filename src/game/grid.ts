/**
 * The grid the player never sees: cells, eight directions, and the route a
 * drag becomes. A route is the cheapest path over cells: plain land costs
 * TRACK a cell, water costs BRIDGE a cell, an existing track cell costs
 * nothing, and a site's cell is passable only as the route's end.
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

export interface Route {
  /** cells from the start cell to the end cell, both included */
  cells: number[];
  /** what it costs to build: new cells at their price, the station if the end has none */
  cost: number;
  /** cells over water that are not track yet */
  bridge: number[];
  /** cells that are new track */
  added: number[];
  /** whether the end gets a new station */
  newStation: boolean;
  /** length in cells, for the distance factor */
  length: number;
}

/** the cell cost of laying track across cell i, in money; 0 when track is there already */
export function cellCost(s: SimState, i: number): number {
  if (s.track[i]) return 0;
  return s.water[i] ? BRIDGE_COST : TRACK_COST;
}

/** whether a cell can carry track at all: a site's cell only as a station */
function passable(s: SimState, i: number, end: number): boolean {
  if (i === end) return true;
  return !s.sites.some((site) => idx(s, site.cx, site.cy) === i);
}

/**
 * A* from a cell to a cell. The step cost is the cell's price times the step's length, plus a
 * small constant so a free run over old track still prefers the short way. Returns null when
 * there is no path.
 */
export function route(s: SimState, from: number, to: number): Route | null {
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
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  // a small open list: the maps are a few hundred cells
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
      const c = g[cur] + (cellCost(s, ni) + 0.05) * len;
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
  const added = cells.filter((i) => !s.track[i]);
  const bridge = added.filter((i) => s.water[i] === 1);
  const newStation = !s.stations.some((st) => st.cell === to);
  let cost = 0;
  for (const i of added) cost += s.water[i] ? BRIDGE_COST : TRACK_COST;
  if (newStation) cost += STATION_COST;
  let length = 0;
  for (let k = 1; k < cells.length; k++) length += stepLen(cx(s, cells[k]) - cx(s, cells[k - 1]), cy(s, cells[k]) - cy(s, cells[k - 1]));
  return { cells, cost, bridge, added, newStation, length };
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

/** the shortest way over existing track from a cell to a cell, or null */
export function trackPath(s: SimState, from: number, to: number): number[] | null {
  const n = s.w * s.h;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const open: number[] = [from];
  g[from] = 0;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (g[open[k]] < g[open[bi]]) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    for (const ni of linked(s, cur)) {
      const c = g[cur] + stepLen(cx(s, ni) - cx(s, cur), cy(s, ni) - cy(s, cur));
      if (c < g[ni]) {
        g[ni] = c;
        prev[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (from !== to && prev[to] < 0) return null;
  const cells: number[] = [];
  for (let i = to; i !== -1; i = prev[i]) cells.push(i);
  return cells.reverse();
}
