import type { Cargo, ScenarioDef, SimState, Site, SiteDef } from './types';
import { idx, inside } from './grid';
import { RAW, RAW_RATE, TERRACE_M, TERRACE_MAX, TOWN_RADIUS } from './content/economy';

const COVER = { none: 0, forest: 1, field: 2, street: 3 } as const;

/** a raw height in metres as a whole terrace: 0, 10, 20 or 30 on land, the raw value in the water */
function terrace(raw: number): number {
  return raw < 0 ? raw : Math.min(TERRACE_MAX, Math.floor(raw / TERRACE_M)) * TERRACE_M;
}

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** an industry's buildings: the 3 by 3 tiles round its centre */
export function footprint(s: { w: number; h: number }, site: { kind: string; cx: number; cy: number }): number[] {
  const out: number[] = [];
  const r = site.kind === 'town' ? 0 : 1;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inside(s, site.cx + dx, site.cy + dy)) out.push(idx(s, site.cx + dx, site.cy + dy));
  return out;
}

/** whether a town's tile is a street: every third row and column from its centre stays open, so track can run through */
export function streetOf(site: { cx: number; cy: number }, x: number, y: number): boolean {
  return (x - site.cx + 300) % 3 === 1 || (y - site.cy + 300) % 3 === 1;
}

/** the tiles a town builds its houses on, in the order it builds them: near the centre first, between its streets */
export function townPlots(s: SimState, site: SiteDef): number[] {
  const out: { i: number; d: number }[] = [];
  for (let dy = -TOWN_RADIUS; dy <= TOWN_RADIUS; dy++)
    for (let dx = -TOWN_RADIUS; dx <= TOWN_RADIUS; dx++) {
      const x = site.cx + dx;
      const y = site.cy + dy;
      if (!inside(s, x, y) || (dx === 0 && dy === 0) || streetOf(site, x, y)) continue;
      const d = Math.hypot(dx, dy * 1.15) + hash(x, y) * 1.6;
      if (d > TOWN_RADIUS) continue;
      out.push({ i: idx(s, x, y), d });
    }
  return out.sort((a, b) => a.d - b.d).map((o) => o.i);
}

/** the next tile a town can build a house on, or -1 */
export function nextPlot(s: SimState, site: Site): number {
  for (const i of townPlots(s, site)) if (!s.water[i] && !s.blocked[i] && !s.track[i]) return i;
  return -1;
}

export function createState(sc: ScenarioDef): SimState {
  const n = sc.w * sc.h;
  const water = new Uint8Array(n);
  const height = new Float32Array(n);
  const cover = new Uint8Array(n);
  for (let y = 0; y < sc.h; y++)
    for (let x = 0; x < sc.w; x++) {
      const i = idx(sc, x, y);
      height[i] = terrace(sc.terrain(x + 0.5, y + 0.5));
      water[i] = height[i] < 0 ? 1 : 0;
      cover[i] = water[i] ? 0 : COVER[sc.cover(x + 0.5, y + 0.5)];
    }
  const s: SimState = {
    scenario: sc,
    w: sc.w,
    h: sc.h,
    water,
    height,
    cover,
    blocked: new Uint8Array(n),
    siteOf: new Int16Array(n).fill(-1),
    track: new Uint8Array(n),
    rail: new Float32Array(n),
    paid: new Float32Array(n),
    netVersion: 0,
    coverVersion: 0,
    sites: [],
    stations: [],
    trains: [],
    bonds: [],
    cash: sc.cash,
    time: 0,
    year: sc.startYear,
    yearFrac: 0,
    month: 0,
    book: emptyBook(),
    lastYear: null,
    history: [],
    red: 0,
    hauled: {},
    tier: 0,
    result: null,
    floats: [],
    sounds: [],
    news: [],
    nextId: 1,
    seed: 12345,
  };
  sc.sites.forEach((d, k) => {
    const raw = RAW[d.kind];
    const site: Site = {
      ...d,
      stock: raw ? { [raw]: 4 } : {},
      input: {},
      rate: raw ? d.rate ?? RAW_RATE : 0,
      homes: [],
      growth: 0,
      delivered: 0,
      madeLast: 0,
      madeMonth: 0,
    };
    s.sites.push(site);
    // a site stands on flat dry land
    const base = Math.max(0, height[idx(s, d.cx, d.cy)]);
    for (const i of footprint(s, d)) {
      water[i] = 0;
      height[i] = base;
      cover[i] = 0;
      s.blocked[i] = 1;
      s.siteOf[i] = k;
    }
    if (d.kind === 'town') {
      for (let j = 0; j < (d.houses ?? 6); j++) {
        const p = nextPlot(s, site);
        if (p < 0) break;
        addHome(s, k, p);
      }
    }
  });
  return s;
}

/** a house on a tile of a town: it blocks track, and the tile is street round it */
export function addHome(s: SimState, k: number, cell: number): void {
  const site = s.sites[k];
  site.homes.push(cell);
  s.coverVersion++;
  s.blocked[cell] = 1;
  s.siteOf[cell] = k;
  s.cover[cell] = 0;
  if (s.height[cell] < 0) s.height[cell] = 0;
}

export function emptyBook() {
  return { revenue: 0, byCargo: {} as Partial<Record<Cargo, number>>, fuel: 0, upkeep: 0, repairs: 0, interest: 0, build: 0 };
}

export function siteById(s: SimState, id: string): Site {
  return s.sites.find((x) => x.id === id)!;
}

export function stationById(s: SimState, id: number) {
  return s.stations.find((x) => x.id === id);
}

export function stationAt(s: SimState, cell: number) {
  return s.stations.find((x) => x.cell === cell);
}
