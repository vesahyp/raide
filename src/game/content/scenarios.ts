/**
 * The hand-made maps. A scenario is data: a size in tiles (a tile is 100 m), the land as a
 * height function in metres, what covers it, the sites, the start and the goal.
 *
 * The land is drawn as a valley: a river, a lake, a ridge, hills and a little value noise. The
 * sim cuts the heights into whole terraces of 10 m, so a hill is a stack of one-tile steps and
 * the grade comes from the cut and the fill. Below zero is water: a bridge to cross. Each site is
 * one tile with a yard of tiles to the north, and the land is flat around both.
 *
 * Sawmill: a forest, a sawmill and a town across a river, one chain, deliver 20 boards before
 * 1866. The tutorial.
 *
 * Harju: a forest and a sawmill, a farm and a mill behind a ridge, two towns and a lake
 * between everything. Grow both towns to size 3 before 1872: it takes both chains to both
 * towns, so a network. The layout is the valley of docs/mockups/topdown/scene.html.
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
    if (Math.hypot(x - d.cx - 0.5, y - d.cy - 0.5) < 7) return true;
    const r = yard(d.kind);
    if (x >= d.cx + r.dx0 - 2 && x <= d.cx + r.dx1 + 3 && y >= d.cy + r.dy0 - 2 && y <= d.cy + 2) return true;
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

// ---------- Sawmill: 64 by 48 tiles ----------

const SAW_W = 64;
const SAW_H = 48;
const SAW_SITES: SiteDef[] = [
  { id: 'forest', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 10, cy: 31 },
  { id: 'sawmill', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 28, cy: 33 },
  { id: 'town', kind: 'town', name: { fi: 'Hämeenlinna', en: 'Hämeenlinna' }, cx: 52, cy: 34, size: 1 },
];
const SAW_RIVER = [[39, -2], [38, 12], [40, 24], [38, 36], [39, 50]];
const SAW_LAKE = { x: 54, y: 8, rx: 7, ry: 4.5 };
const sawWater = (x: number, y: number): boolean =>
  polyDist(x, y, SAW_RIVER) < 1.2 + vnoise(x * 0.3, y * 0.3) * 0.8 ||
  ((x - SAW_LAKE.x) / SAW_LAKE.rx) ** 2 + ((y - SAW_LAKE.y) / SAW_LAKE.ry) ** 2 + (vnoise(x * 0.25, y * 0.25) - 0.5) * 0.5 < 1;
// a low rise in the west under the forest, a hill beyond the town, noise on top
const sawLevel = (x: number, y: number): number => Math.max(bump(x, y, 8, 18, 1.8, 60), bump(x, y, 20, 8, 1.3, 40), bump(x, y, 58, 20, 1.6, 50)) + (vnoise(x * 0.09, y * 0.09) - 0.5) * 1.1;
const sawLand = landOf(SAW_SITES, sawWater, sawLevel);

function sawCover(x: number, y: number): Cover {
  const L = terraceOf(sawLand, x, y);
  if (Math.abs(y - 31.5) < 0.6 && x > 46 && x < 59) return 'street';
  if (Math.abs(x - 52.5) < 0.6 && y > 28 && y < 34) return 'street';
  if (Math.hypot((x - 56) / 1.3, y - 41) < 6 && L === 0) return 'field';
  const f = vnoise(x * 0.11 + 40, y * 0.11) + (x < 22 ? 0.3 : 0) + (L >= 1 ? 0.1 : 0);
  return f > 0.58 && !near(SAW_SITES, x, y, 5.5) ? 'forest' : 'none';
}

export const SAWMILL: ScenarioDef = {
  id: 'sawmill',
  name: { fi: 'Saha', en: 'Sawmill' },
  blurb: { fi: '1862. 15 lautakuormaa ennen vuotta 1866', en: '1862. 15 loads of boards before 1866' },
  w: SAW_W,
  h: SAW_H,
  terrain: sawLand,
  cover: sawCover,
  sites: SAW_SITES,
  startStation: 'forest',
  cash: 200,
  startYear: 1862,
  goal: { kind: 'deliver', good: 'boards', site: 'town', count: 15, beforeYear: 1866 },
  stars: [1864, 1863],
  engines: ['hilma'],
};

// ---------- Harju: 120 by 100 tiles ----------

const HARJU_W = 120;
const HARJU_H = 100;
const HARJU_SITES: SiteDef[] = [
  { id: 'forest', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 14, cy: 30, rawRate: 0.6, rawCap: 4 },
  { id: 'sawmill', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 36, cy: 33 },
  { id: 'farm', kind: 'farm', name: { fi: 'Peltola', en: 'Peltola' }, cx: 106, cy: 33, rawRate: 1.4, rawCap: 10 },
  { id: 'mill', kind: 'mill', name: { fi: 'Myllykylä', en: 'Myllykylä' }, cx: 62, cy: 66 },
  { id: 'hameenlinna', kind: 'town', name: { fi: 'Hämeenlinna', en: 'Hämeenlinna' }, cx: 73, cy: 36, size: 1 },
  { id: 'tampere', kind: 'town', name: { fi: 'Tampere', en: 'Tampere' }, cx: 27, cy: 72, size: 1 },
  // the second forest in the north west woods, the second farm south of the lake, the third town
  // beyond the ridge's south end
  { id: 'korpela', kind: 'forest', name: { fi: 'Korpela', en: 'Korpela' }, cx: 12, cy: 18, rawRate: 1.2, rawCap: 8 },
  { id: 'niittyla', kind: 'farm', name: { fi: 'Niittylä', en: 'Niittylä' }, cx: 50, cy: 96, rawRate: 0.75, rawCap: 4 },
  { id: 'lahti', kind: 'town', name: { fi: 'Lahti', en: 'Lahti' }, cx: 96, cy: 72, size: 2, growth: 0.75 },
];
const RIVER = [[46, -2], [44, 12], [45.5, 24], [44, 34], [41, 46], [45, 58], [50, 68], [54, 74]];
const LAKE = { x: 56, y: 77, rx: 17, ry: 8 };
const RIDGE = [[70, 92], [104, 2]];

/** the land in levels (one level is a terrace): the ridge with its saddle at y 56, the hills, the noise */
function rawHeight(x: number, y: number): number {
  let h = 0;
  const dr = segDist(x, y, RIDGE[0][0], RIDGE[0][1], RIDGE[1][0], RIDGE[1][1]);
  const along = vnoise(y * 0.12, 3.3);
  // a broad crest with steep one-tile steps down both sides, wider where the noise is high
  let rh = 3.8 * Math.max(0, Math.min(1, (6.4 + along * 1.4 - dr) / 3.5));
  rh *= 1 - 0.97 * Math.exp(-(((y - 56) / 6.5) ** 2));
  h = Math.max(h, rh);
  // the hill the line to the town cuts through, the forest hill, the farm hill
  h = Math.max(h, 2.6 * Math.exp(-(((x - 51.5) ** 2 + (y - 33.5) ** 2) / 30)));
  h = Math.max(h, 2.6 * Math.exp(-(((x - 24) ** 2 + (y - 50) ** 2) / 70)));
  h = Math.max(h, 2.2 * Math.exp(-(((x - 84) ** 2 + (y - 14) ** 2) / 50)));
  h += (vnoise(x * 0.09, y * 0.09) - 0.5) * 1.3;
  return h;
}
const harjuWater = (x: number, y: number): boolean =>
  polyDist(x, y, RIVER) < 1.5 + vnoise(x * 0.3, y * 0.3) * 0.9 ||
  ((x - LAKE.x) / LAKE.rx) ** 2 + ((y - LAKE.y) / LAKE.ry) ** 2 + (vnoise(x * 0.25, y * 0.25) - 0.5) * 0.5 < 1;
const harjuLand = landOf(HARJU_SITES, harjuWater, rawHeight);

function harjuCover(x: number, y: number): Cover {
  const L = terraceOf(harjuLand, x, y);
  // the streets of the towns, inside their yards: a main street across the top, a street down from
  // it at the station, and a second one four tiles east that the town builds at size 3
  for (const d of HARJU_SITES) {
    if (d.kind !== 'town') continue;
    const top = d.cy - 5.5;
    const main = Math.abs(y - top) < 0.6 && x > d.cx - 6 && x < d.cx + 7;
    const down = (Math.abs(x - (d.cx + 0.5)) < 0.6 || Math.abs(x - (d.cx + 4.5)) < 0.6) && y > d.cy - 7 && y < d.cy - 0.5;
    if (main || down) return 'street';
  }
  // the fields of the farms: Peltola's east of the ridge, Niittylä's beside it, Tampere's west of the town
  if (Math.hypot((x - 109) / 1.3, y - 33) < 9 && L <= 1) return 'field';
  if (Math.hypot((x - 55) / 1.3, y - 96) < 6.5 && L === 0) return 'field';
  if (Math.hypot((x - 22) / 1.4, y - 76) < 6 && L === 0) return 'field';
  const f = vnoise(x * 0.11 + 40, y * 0.11) + (x < 32 ? 0.22 : 0) + (L >= 2 ? 0.1 : 0) - (x > 95 ? 0.15 : 0);
  return f > 0.58 && !near(HARJU_SITES, x, y, 5.5) ? 'forest' : 'none';
}

export const HARJU: ScenarioDef = {
  id: 'harju',
  name: { fi: 'Harju', en: 'Harju' },
  blurb: { fi: '1862. Kaksi kaupunkia kokoon 3 ennen vuotta 1872', en: '1862. Two towns to size 3 before 1872' },
  w: HARJU_W,
  h: HARJU_H,
  terrain: harjuLand,
  cover: harjuCover,
  sites: HARJU_SITES,
  startStation: 'forest',
  startStations: ['korpela'],
  cash: 450,
  startYear: 1862,
  goal: { kind: 'towns', size: 3, count: 2, beforeYear: 1872 },
  stars: [1870, 1869],
  engines: ['hilma', 'jyry'],
};

export const SCENARIOS: ScenarioDef[] = [SAWMILL, HARJU];
export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
