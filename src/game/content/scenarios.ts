/**
 * The hand-made maps (ADR 0007): southern Finland from 1862, larger than the
 * screen so that a route has real choices round lakes and over ridges. A tile
 * is 1 km for pay, 100 m for grades. The land is a height function in metres,
 * cut by the sim into terraces of 10 m; below zero is water.
 *
 * Sawmill: the tutorial. One forest, one sawmill across a river, one town
 * behind a hill. Haul lumber to the town before the end of 1865.
 *
 * Harju: Tampere to Helsinki. Three forests, three farms, a sawmill, a paper
 * mill, a mill and five towns; Vanajavesi and Vesijärvi in the north, the
 * Salpausselkä ridge across the middle with one low pass, the sea in the
 * south. Make the company worth the goal before the end of 1869.
 */
import type { Cover, ScenarioDef, SiteDef } from '../types';
import { TERRACE_M } from './economy';

// ---------- helpers ----------

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** value noise, 0 to 1 */
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
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function polyDist(px: number, py: number, pts: number[][]): number {
  let m = 1e9;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return m;
}
const bump = (x: number, y: number, hx: number, hy: number, level: number, spread: number): number => level * Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / spread);
const ellipse = (x: number, y: number, ex: number, ey: number, rx: number, ry: number): number => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2;
const near = (sites: SiteDef[], x: number, y: number, r: number): boolean => sites.some((d) => Math.hypot(x - d.cx - 0.5, y - d.cy - 0.5) < r);

/** the land in metres from a water test and a height in terraces; a site's ground is flat */
function landOf(sites: SiteDef[], isWater: (x: number, y: number) => boolean, level: (x: number, y: number) => number) {
  return (x: number, y: number): number => {
    for (const d of sites) if (Math.abs(x - d.cx - 0.5) < (d.kind === 'town' ? 3 : 2.6) && Math.abs(y - d.cy - 0.5) < (d.kind === 'town' ? 3 : 2.6)) return 0;
    if (isWater(x, y)) return -4;
    return Math.max(0, level(x, y)) * TERRACE_M;
  };
}

function coverOf(sites: SiteDef[], land: (x: number, y: number) => number, forestBias: (x: number, y: number) => number) {
  return (x: number, y: number): Cover => {
    const lv = Math.floor(land(x, y) / TERRACE_M);
    for (const d of sites) if (d.kind === 'farm' && ellipse(x, y, d.cx + 0.5, d.cy + 3.5, 4.2, 2.6) < 1 && lv <= 1) return 'field';
    const f = vnoise(x * 0.13 + 40, y * 0.13) + forestBias(x, y) + (lv >= 2 ? 0.12 : 0);
    if (near(sites, x, y, 4.5)) return 'none';
    return f > 0.62 ? 'forest' : 'none';
  };
}

// ---------- Sawmill: 44 by 56 ----------

const SAW_SITES: SiteDef[] = [
  { id: 'kuusikko', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 8, cy: 9, rate: 2.6 },
  { id: 'saha', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 33, cy: 14 },
  { id: 'hameenlinna', kind: 'town', name: { fi: 'Hämeenlinna', en: 'Hämeenlinna' }, cx: 22, cy: 45, houses: 12 },
  { id: 'peltola', kind: 'farm', name: { fi: 'Peltola', en: 'Peltola' }, cx: 7, cy: 34, rate: 1.8 },
];
const SAW_RIVER = [[22, -2], [20, 10], [23, 20], [19, 30], [21, 40], [16, 58]];
const sawWater = (x: number, y: number): boolean => polyDist(x, y, SAW_RIVER) < 1.0 + vnoise(x * 0.3, y * 0.3) * 0.8;
const sawLevel = (x: number, y: number): number =>
  Math.max(bump(x, y, 34, 30, 3.4, 40), bump(x, y, 9, 20, 2.2, 22), bump(x, y, 40, 48, 2, 30)) + (vnoise(x * 0.12, y * 0.12) - 0.5) * 0.9;
const sawLand = landOf(SAW_SITES, sawWater, sawLevel);

export const SAWMILL: ScenarioDef = {
  id: 'sawmill',
  name: { fi: 'Saha', en: 'Sawmill' },
  blurb: { fi: '1862. Sahatavaraa Hämeenlinnaan ennen vuoden 1865 loppua', en: '1862. Lumber to Hämeenlinna before the end of 1865' },
  w: 44,
  h: 56,
  terrain: sawLand,
  cover: coverOf(SAW_SITES, sawLand, (x, y) => (x < 16 && y < 26 ? 0.25 : 0)),
  sites: SAW_SITES,
  cash: 160,
  startYear: 1862,
  goal: { kind: 'haul', cargo: 'lumber', tiers: [40, 60, 80], byYear: 1865 },
  view: [20, 14],
};

// ---------- Harju: 64 by 88 ----------

const HARJU_SITES: SiteDef[] = [
  { id: 'tampere', kind: 'town', name: { fi: 'Tampere', en: 'Tampere' }, cx: 10, cy: 9, houses: 16 },
  { id: 'valkeakoski', kind: 'papermill', name: { fi: 'Valkeakoski', en: 'Valkeakoski' }, cx: 27, cy: 13 },
  { id: 'korpi', kind: 'forest', name: { fi: 'Korpi', en: 'Korpi' }, cx: 50, cy: 7, rate: 2.4 },
  { id: 'kuusikko', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 5, cy: 30, rate: 2.6 },
  { id: 'koskensaha', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 27, cy: 33 },
  { id: 'peltola', kind: 'farm', name: { fi: 'Peltola', en: 'Peltola' }, cx: 40, cy: 28, rate: 2.2 },
  { id: 'hameenlinna', kind: 'town', name: { fi: 'Hämeenlinna', en: 'Hämeenlinna' }, cx: 13, cy: 45, houses: 10 },
  { id: 'lahti', kind: 'town', name: { fi: 'Lahti', en: 'Lahti' }, cx: 52, cy: 44, houses: 11 },
  { id: 'hollola', kind: 'farm', name: { fi: 'Hollola', en: 'Hollola' }, cx: 59, cy: 31, rate: 2 },
  { id: 'myllykyla', kind: 'mill', name: { fi: 'Myllykylä', en: 'Myllykylä' }, cx: 40, cy: 63 },
  { id: 'riihimaki', kind: 'town', name: { fi: 'Riihimäki', en: 'Riihimäki' }, cx: 24, cy: 66, houses: 6 },
  { id: 'nurmi', kind: 'farm', name: { fi: 'Nurmijärvi', en: 'Nurmijärvi' }, cx: 10, cy: 70, rate: 2 },
  { id: 'salo', kind: 'forest', name: { fi: 'Salo', en: 'Salo' }, cx: 57, cy: 66, rate: 2.2 },
  { id: 'helsinki', kind: 'town', name: { fi: 'Helsinki', en: 'Helsinki' }, cx: 35, cy: 80, houses: 22 },
];
/** Vanajavesi: a long lake from Tampere's south down past Hämeenlinna, and the river that leaves it */
const VANAJA = [[15, 16], [17, 24], [16, 33], [19, 40]];
const VANAJA_RIVER = [[19, 40], [22, 48], [21, 56]];
/** the ridge: east to west across the middle, with a low pass at x 30 */
const RIDGE = [[-2, 55], [20, 53], [44, 52], [66, 54]];
const PASS_X = 31;

function harjuLevel(x: number, y: number): number {
  const dr = polyDist(x, y, RIDGE);
  let ridge = 3.4 * Math.max(0, Math.min(1, (3.2 - dr) / 2));
  // the pass: the ridge falls to one terrace over a few tiles
  ridge *= 0.3 + 0.7 * Math.min(1, Math.abs(x - PASS_X) / 4);
  let h = ridge;
  h = Math.max(h, bump(x, y, 36, 18, 2.6, 26), bump(x, y, 6, 20, 2, 18), bump(x, y, 46, 70, 2.2, 30), bump(x, y, 60, 18, 2.4, 20));
  h += (vnoise(x * 0.11, y * 0.11) - 0.5) * 1.0;
  return h;
}
function harjuWater(x: number, y: number): boolean {
  const wob = vnoise(x * 0.3, y * 0.3) * 0.8;
  if (polyDist(x, y, VANAJA) < 2.4 + wob * 1.4) return true;
  if (polyDist(x, y, VANAJA_RIVER) < 0.9 + wob) return true;
  if (ellipse(x, y, 49, 25, 4.5, 3.2) + (vnoise(x * 0.25, y * 0.25) - 0.5) * 0.5 < 1) return true;
  // the sea: the coast south of Helsinki, with a bay to its west
  const coast = 85.5 + Math.sin(x * 0.35) * 0.8 + vnoise(x * 0.2, 5) * 1.5 - (x < 26 ? 2.4 * smooth(Math.min(1, (26 - x) / 8)) : 0);
  return y > coast;
}
const harjuLand = landOf(HARJU_SITES, harjuWater, harjuLevel);

export const HARJU: ScenarioDef = {
  id: 'harju',
  name: { fi: 'Harju', en: 'Harju' },
  blurb: { fi: '1862. Tampereelta Helsinkiin: yhtiön arvo tavoitteeseen ennen vuoden 1869 loppua', en: '1862. Tampere to Helsinki: grow the company before the end of 1869' },
  w: 64,
  h: 88,
  terrain: harjuLand,
  cover: coverOf(HARJU_SITES, harjuLand, (x, y) => (x < 14 && y < 40 ? 0.2 : 0) + (x > 44 && y < 16 ? 0.2 : 0) + (x > 48 && y > 58 ? 0.2 : 0)),
  sites: HARJU_SITES,
  cash: 220,
  startYear: 1862,
  goal: { kind: 'worth', tiers: [700, 1200, 1900], byYear: 1869 },
  view: [26, 30],
};

export const SCENARIOS: ScenarioDef[] = [SAWMILL, HARJU];
export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
