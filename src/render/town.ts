/**
 * A town's buildings, laid out once for all five sizes. Each building is an item with the size at
 * which the town gets it: four houses for every size, the church at 2, a second street at 3, a
 * market square with stalls at 4 and a stone town hall at 5. The renderer shows the first items
 * for the town's size and lets the newest rise one by one when the town grows. Nothing here
 * overlaps another item, the station building, the platform or a street.
 */
import type { SimState, Site } from '../game/types';
import { yard } from '../game/content/economy';
import { building, church, hash, marketSquare, townHall, type View } from './draw2d';

export interface TownItem {
  minSize: number;
  kind: 'house' | 'church' | 'market' | 'hall' | 'street';
  /** the footprint in tiles */
  x: number;
  y: number;
  w: number;
  d: number;
  /** the sort row and the columns the drawing covers, as the chunk cache wants them */
  oy: number;
  ox0: number;
  ox1: number;
  draw: (v: View) => void;
}

/** houses a town gets for each size */
export const HOUSES_PER_SIZE = 4;

const WALLS = ['#a8352a', '#c98d3a', '#e6dcc4', '#9c3a2c', '#d7a84a'];
const ROOFS = ['#4a3a32', '#5d4a3c', '#7a3a2a', '#3d3a3a'];

/** the cells of a town's second street, a street running north to south four tiles east of the first, which the town builds at size 3 */
export function secondStreet(s: SimState, site: Site): number[] {
  const r = yard('town');
  const x = site.cx + 4;
  const out: number[] = [];
  const street = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < s.w && ty < s.h && s.cover[ty * s.w + tx] === 3;
  for (let y = site.cy + r.dy0; y <= site.cy + r.dy1; y++) if (street(x, y) && !street(x - 1, y) && !street(x + 1, y)) out.push(y * s.w + x);
  return out;
}

export function planTown(s: SimState, site: Site, lv: number): TownItem[] {
  const x = site.cx;
  const y = site.cy;
  const r = yard('town');
  const free = (px: number, py: number, w: number, d: number): boolean => {
    for (let ty = Math.floor(py); ty <= Math.floor(py + d - 0.001); ty++)
      for (let tx = Math.floor(px); tx <= Math.floor(px + w - 0.001); tx++) {
        if (tx < x + r.dx0 || tx > x + r.dx1 || ty < y + r.dy0 || ty > y + r.dy1) return false;
        if (s.cover[ty * s.w + tx] === 3) return false;
      }
    return true;
  };
  const hit = (a: number[], b: number[]): boolean => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  // the station building and the platform keep their ground
  const taken: number[][] = [[x + 1.1, y - 2.4, 3.0, 2.4], [x - 3.2, y - 1.4, 7.4, 1.4]];
  /** the free spot nearest a wanted centre, on a quarter-tile lattice */
  const spot = (w: number, d: number, wx: number, wy: number, gap: number, below = gap, above = 0): [number, number] | null => {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let py = y + r.dy0; py + d <= y + r.dy1 + 1; py += 0.25)
      for (let px = x + r.dx0; px + w <= x + r.dx1 + 1; px += 0.25) {
        const score = Math.hypot(px + w / 2 - wx, py + d / 2 - wy);
        if (score >= bd || !free(px, py, w, d)) continue;
        const box = [px - gap, py - gap - above, w + 2 * gap, d + gap + below + above];
        if (taken.some((q) => hit(box, q))) continue;
        best = [px, py];
        bd = score;
      }
    if (best) taken.push([best[0], best[1] - above, w, d + below + above]);
    return best;
  };
  const items: TownItem[] = [];
  // the big ones first, so their places are not taken by houses
  const cp = spot(4.2, 2, x - 3.5, y - 4.4, 0.12, 0.45, 1.0);
  // the tower stands higher than the nave: its column is kept clear too
  if (cp) taken.push([cp[0] + 3, cp[1] - 1.8, 1.2, 0.9]);
  if (cp) items.push({ minSize: 2, kind: 'church', x: cp[0], y: cp[1], w: 4.2, d: 2, oy: cp[1] + 2, ox0: cp[0], ox1: cp[0] + 4.2, draw: (v) => church(v, cp[0], cp[1], lv) });
  const mp = spot(3, 2.4, x + 2.5, y - 4.2, 0.1);
  if (mp) items.push({ minSize: 4, kind: 'market', x: mp[0], y: mp[1], w: 3, d: 2.4, oy: mp[1] + 2.4, ox0: mp[0], ox1: mp[0] + 3, draw: (v) => marketSquare(v, mp[0], mp[1], 3, 2.4, lv) });
  const hp = spot(1.8, 1.4, x + 5.6, y - 4.5, 0.06, 0.3, 1.2);
  if (hp) taken.push([hp[0] + 0.5, hp[1] - 2.3, 0.8, 1.1]);
  if (hp) items.push({ minSize: 5, kind: 'hall', x: hp[0], y: hp[1], w: 1.8, d: 1.4, oy: hp[1] + 1.4, ox0: hp[0], ox1: hp[0] + 1.8, draw: (v) => townHall(v, hp[0], hp[1], 1.8, 1.4, lv) });
  // the houses nearest the middle of the yard first
  for (let i = 0; i < HOUSES_PER_SIZE * 5; i++) {
    const w = 1.15 + hash(i, 3) * 0.35;
    const d = 0.7 + hash(i, 4) * 0.15;
    const p = spot(w, d, x + 0.5 + (hash(i, 8) - 0.5) * 2, y - 3.9, 0.08, 0.05, 0.52);
    if (!p) continue;
    const chim: [number, number] | undefined = hash(i, 6) > 0.5 ? [p[0] + w * 0.7, p[1] + d * 0.3] : undefined;
    items.push({
      minSize: 1,
      kind: 'house',
      x: p[0],
      y: p[1],
      w,
      d,
      oy: p[1] + d,
      ox0: p[0],
      ox1: p[0] + w,
      draw: (v) => building(v, p[0], p[1], w, d, { walls: WALLS[i % 5], roof: ROOFS[(i * 7) % 4], wall: 0.5, door: i % 2, chimney: chim, lv }),
    });
  }
  // four houses at size 1, the rest spread over the sizes 2 to 5 as the room allows
  const houses = items.filter((o) => o.kind === 'house');
  houses.forEach((o, i) => {
    o.minSize = i < HOUSES_PER_SIZE ? 1 : 2 + Math.min(3, Math.floor(((i - HOUSES_PER_SIZE) * 4) / Math.max(1, houses.length - HOUSES_PER_SIZE)));
  });
  if (secondStreet(s, site).length) items.push({ minSize: 3, kind: 'street', x: 0, y: 0, w: 0, d: 0, oy: 0, ox0: 0, ox1: 0, draw: () => {} });
  // the order the town grows in: by size, houses before the building that comes with the size
  const rank = (o: TownItem): number => o.minSize * 10 + (o.kind === 'house' ? 0 : 1);
  return items.map((o, k) => ({ o, k })).sort((a, b) => rank(a.o) - rank(b.o) || a.k - b.k).map((e) => e.o);
}
