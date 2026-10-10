/**
 * The hand-made maps. A scenario is data: a size in tiles (a tile is 100 m), the land as a
 * height function in metres, what covers it, the sites, the start and the goal.
 *
 * The land is drawn as a valley: a river, a lake, a ridge, hills and a little value noise. The
 * sim cuts the heights into whole terraces of 10 m, so a hill is a stack of one-tile steps and
 * the grade comes from the cut and the fill. Below zero is water: a bridge to cross. Each site is
 * one tile with a yard of tiles to the north, and the land is flat around both.
 *
 * Both maps fit one portrait phone screen (ADR 0006): 30 to 34 tiles across.
 *
 * Sawmill: a forest, a sawmill and a town across a river, one chain, deliver 15 boards before
 * 1865. The tutorial.
 *
 * Harju: a forest and a sawmill west of a river, a farm and a mill east of it, a lake in the
 * middle, a ridge in the south east, three towns. Grow all three towns to size 3 before 1872:
 * it takes both chains to every town, so a network that keeps growing to the end.
 */
import type { ScenarioDef } from '../types';

import { TERRACE_M, TERRACE_MAX, yard } from './economy';
import type { Cover, SiteDef } from '../types';

// ---------- helpers ----------

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** value noise, 0 to 1, smooth between whole numbers */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** distance from a point to a line segment */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** distance from a point to a polyline */
function polyDist(px: number, py: number, pts: number[][]): number {
  let m = 1e9;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return m;
}
/** a hill: a round bump of this many levels (terraces) at the top */
const bump = (x: number, y: number, hx: number, hy: number, level: number, spread: number): number => level * Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / spread);

/** whether a point is on the flat ground of a site: near its cell, or inside its yard with a margin */
function onSite(sites: SiteDef[], x: number, y: number): boolean {
  for (const d of sites) {
    if (Math.abs(y - d.cy - 0.5) < 1.6 && Math.abs(x - d.cx - 0.5) < 6.5) return true;
    const r = yard(d.kind);
    if (x >= d.cx + r.dx0 - 1 && x <= d.cx + r.dx1 + 2 && y >= d.cy + r.dy0 - 1 && y <= d.cy + 1) return true;
  }
  return false;
}
const near = (sites: SiteDef[], x: number, y: number, r: number): boolean => sites.some((d) => Math.hypot(x - d.cx - 0.5, y - d.cy - 0.5) < r);

/** a land function in metres from a water test and a height in levels; sites are flat, water is below zero */
function landOf(sites: SiteDef[], isWater: (x: number, y: number) => boolean, level: (x: number, y: number) => number) {
  return (x: number, y: number): number => {
    if (isWater(x, y)) return -4;
    if (onSite(sites, x, y)) return 0;
    return Math.max(0, level(x, y)) * TERRACE_M;
  };
}
/** the terrace a point stands on, for the cover rules */
const terraceOf = (land: (x: number, y: number) => number, x: number, y: number): number => Math.min(TERRACE_MAX, Math.floor(land(x, y) / TERRACE_M));

// ---------- Sawmill: 30 by 36 tiles ----------

const SAW_W = 30;
const SAW_H = 36;
const SAW_SITES: SiteDef[] = [
  { id: 'forest', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 6, cy: 9, rawRate: 1.0, rawCap: 6 },
  { id: 'sawmill', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 22, cy: 11 },
  { id: 'town', kind: 'town', name: { fi: 'H\u00e4meenlinna', en: 'H\u00e4meenlinna' }, cx: 14, cy: 31, size: 1 },
];
const SAW_RIVER = [[-2, 19], [8, 17.5], [16, 19.5], [24, 17.5], [32, 19]];
const sawWater = (x: number, y: number): boolean => polyDist(x, y, SAW_RIVER) < 1.1 + vnoise(x * 0.3, y * 0.3) * 0.7;
// a low rise under the forest, a hill east of the town, noise on top
const sawLevel = (x: number, y: number): number => Math.max(bump(x, y, 3, 2, 1.8, 20), bump(x, y, 27, 28, 1.6, 18)) + (vnoise(x * 0.12, y * 0.12) - 0.5) * 0.9;
const sawLand = landOf(SAW_SITES, sawWater, sawLevel);

function sawCover(x: number, y: number): Cover {
  const L = terraceOf(sawLand, x, y);
  const d = SAW_SITES[2];
  if (Math.abs(y - (d.cy - 5.5)) < 0.6 && x > d.cx - 5 && x < d.cx + 6) return 'street';
  if (Math.abs(x - (d.cx + 0.5)) < 0.6 && y > d.cy - 6 && y < d.cy - 0.5) return 'street';
  if (Math.hypot((x - 25) / 1.3, y - 33) < 4 && L === 0) return 'field';
  const f = vnoise(x * 0.15 + 40, y * 0.15) + (x < 12 && y < 20 ? 0.3 : 0) + (L >= 1 ? 0.1 : 0);
  return f > 0.6 && !near(SAW_SITES, x, y, 4.5) ? 'forest' : 'none';
}

export const SAWMILL: ScenarioDef = {
  id: 'sawmill',
  name: { fi: 'Saha', en: 'Sawmill' },
  blurb: { fi: '1862. 15 lautakuormaa ennen vuotta 1865', en: '1862. 15 loads of boards before 1865' },
  w: SAW_W,
  h: SAW_H,
  terrain: sawLand,
  cover: sawCover,
  sites: SAW_SITES,
  startStation: 'forest',
  cash: 260,
  startYear: 1862,
  goal: { kind: 'deliver', good: 'boards', site: 'town', count: 15, beforeYear: 1865 },
  stars: [1863, 1862],
  engines: ['hilma'],
};

// ---------- Harju: 30 by 50 tiles ----------

const HARJU_W = 34;
const HARJU_H = 42;
const HARJU_SITES: SiteDef[] = [
  { id: 'forest', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 5, cy: 5, rawRate: 1.7, rawCap: 10 },
  { id: 'sawmill', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 7, cy: 16 },
  { id: 'farm', kind: 'farm', name: { fi: 'Peltola', en: 'Peltola' }, cx: 28, cy: 5, rawRate: 1.7, rawCap: 10 },
  { id: 'mill', kind: 'mill', name: { fi: 'Myllykyl\u00e4', en: 'Myllykyl\u00e4' }, cx: 27, cy: 16 },
  { id: 'hameenlinna', kind: 'town', name: { fi: 'H\u00e4meenlinna', en: 'H\u00e4meenlinna' }, cx: 7, cy: 30, size: 1 },
  { id: 'lahti', kind: 'town', name: { fi: 'Lahti', en: 'Lahti' }, cx: 26, cy: 31, size: 2 },
  { id: 'tampere', kind: 'town', name: { fi: 'Tampere', en: 'Tampere' }, cx: 17, cy: 40, size: 1 },
];
const RIVER = [[17, -2], [16.5, 5], [17.5, 11], [17, 17]];
const LAKE = { x: 17, y: 20.5, rx: 4.2, ry: 2.4 };
const RIDGE = [[23, 23.5], [35, 24.5]];

/** the land in levels (one level is a terrace): the ridge in the south east, the hills, the noise */
function rawHeight(x: number, y: number): number {
  let h = 0;
  const dr = segDist(x, y, RIDGE[0][0], RIDGE[0][1], RIDGE[1][0], RIDGE[1][1]);
  h = Math.max(h, 3.4 * Math.max(0, Math.min(1, (2.6 - dr) / 1.6)));
  // the hill between the forest and the sawmill, the farm's rise
  h = Math.max(h, 2.4 * Math.exp(-(((x - 2) ** 2 + (y - 10.5) ** 2) / 6)));
  h = Math.max(h, 1.8 * Math.exp(-(((x - 32) ** 2 + (y - 10.5) ** 2) / 8)));
  h += (vnoise(x * 0.14, y * 0.14) - 0.5) * 1.0;
  return h;
}
const harjuWater = (x: number, y: number): boolean =>
  polyDist(x, y, RIVER) < 1.0 + vnoise(x * 0.3, y * 0.3) * 0.6 ||
  ((x - LAKE.x) / LAKE.rx) ** 2 + ((y - LAKE.y) / LAKE.ry) ** 2 + (vnoise(x * 0.25, y * 0.25) - 0.5) * 0.4 < 1;
const harjuLand = landOf(HARJU_SITES, harjuWater, rawHeight);

function harjuCover(x: number, y: number): Cover {
  const L = terraceOf(harjuLand, x, y);
  // the streets of the towns, inside their yards: a main street across the top, a street down from
  // it at the station, and a second one four tiles east that the town builds at size 3
  for (const d of HARJU_SITES) {
    if (d.kind !== 'town') continue;
    const top = d.cy - 5.5;
    const main = Math.abs(y - top) < 0.6 && x > d.cx - 5 && x < d.cx + 6;
    const down = (Math.abs(x - (d.cx + 0.5)) < 0.6 || Math.abs(x - (d.cx + 4.5)) < 0.6) && y > d.cy - 6 && y < d.cy - 0.5;
    if (main || down) return 'street';
  }
  // Peltola's fields round the farm
  if (Math.hypot((x - 29) / 1.4, y - 9.5) < 2.6 && L <= 1) return 'field';
  const f = vnoise(x * 0.15 + 40, y * 0.15) + (x < 13 && y < 24 ? 0.25 : 0) + (L >= 2 ? 0.1 : 0) - (x > 20 && y < 16 ? 0.2 : 0);
  return f > 0.6 && !near(HARJU_SITES, x, y, 4.5) ? 'forest' : 'none';
}

export const HARJU: ScenarioDef = {
  id: 'harju',
  name: { fi: 'Harju', en: 'Harju' },
  blurb: { fi: '1862. Kolme kaupunkia kokoon 3 ennen vuotta 1872', en: '1862. Three towns to size 3 before 1872' },
  w: HARJU_W,
  h: HARJU_H,
  terrain: harjuLand,
  cover: harjuCover,
  sites: HARJU_SITES,
  startStation: 'forest',
  startStations: ['farm'],
  cash: 420,
  startYear: 1862,
  goal: { kind: 'towns', size: 3, count: 3, beforeYear: 1872 },
  stars: [1869, 1868],
  engines: ['hilma', 'jyry'],
};

export const SCENARIOS: ScenarioDef[] = [SAWMILL, HARJU];
export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
