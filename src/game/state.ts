import type { Cargo, Good, ScenarioDef, SimState, Site } from './types';
import { CARGOS, GOODS } from './types';
import { idx, inside } from './grid';
import { RAW_CAP, RAW_RATE, RAW_START, TERRACE_M, TERRACE_MAX, yard } from './content/economy';
import { emptyPerks } from './sim';

const COVER = { none: 0, forest: 1, field: 2, street: 3 } as const;

/** a raw height in metres as a whole terrace: 0, 10, 20 or 30 on land, the raw value in the water */
function terrace(raw: number): number {
  return raw < 0 ? raw : Math.min(TERRACE_MAX, Math.floor(raw / TERRACE_M)) * TERRACE_M;
}

/** the cell indices of a site's yard, clipped to the map */
export function yardOf(s: { w: number; h: number }, site: { kind: Site['kind']; cx: number; cy: number }): number[] {
  const r = yard(site.kind);
  const out: number[] = [];
  for (let dy = r.dy0; dy <= r.dy1; dy++)
    for (let dx = r.dx0; dx <= r.dx1; dx++) if (inside(s, site.cx + dx, site.cy + dy)) out.push(idx(s, site.cx + dx, site.cy + dy));
  return out;
}

/** the time of the last delivery of each good, before any: minus infinity */
export const lastNever = (): Record<Good, number> => Object.fromEntries(GOODS.map((g) => [g, -Infinity])) as Record<Good, number>;
export const zeroGoods = (): Record<Good, number> => Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<Good, number>;

export const zeroCargo = (): Record<Cargo, number> => Object.fromEntries(CARGOS.map((g) => [g, 0])) as Record<Cargo, number>;

export function createState(sc: ScenarioDef): SimState {
  const n = sc.w * sc.h;
  const water = new Uint8Array(n);
  const height = new Float32Array(n);
  const cover = new Uint8Array(n);
  const yardMask = new Uint8Array(n);
  for (let y = 0; y < sc.h; y++)
    for (let x = 0; x < sc.w; x++) {
      const i = idx(sc, x, y);
      height[i] = terrace(sc.terrain(x + 0.5, y + 0.5));
      water[i] = height[i] < 0 ? 1 : 0;
      cover[i] = water[i] ? 0 : COVER[sc.cover(x + 0.5, y + 0.5)];
    }
  const sites: Site[] = sc.sites.map((d) => ({
    ...d,
    // a raw site starts three quarters full, so a rich site shows a bigger pile from the first frame
    stock: RAW_RATE[d.kind] ? (d.rawCap ? Math.round(d.rawCap * 0.75) : RAW_START) : 0,
    taken: zeroGoods(),
    delivered: 0,
    lastDelivery: lastNever(),
    store: zeroGoods(),
    growth: 0,
    rawRate: d.rawRate ?? RAW_RATE[d.kind] ?? 0,
    rawCap: d.rawCap ?? RAW_CAP,
    rate: d.rawRate ?? RAW_RATE[d.kind] ?? 0,
    lastPickup: -Infinity,
    size: d.kind === 'town' ? d.size ?? 1 : 0,
    grewAt: -Infinity,
    level: 0,
  }));
  // a site's cell and its yard are land at the site's terrace; only a town's yard keeps its streets
  for (const d of sc.sites) {
    const i = idx(sc, d.cx, d.cy);
    const base = water[i] ? 0 : height[i];
    for (const j of yardOf(sc, d)) {
      water[j] = 0;
      height[j] = base;
      if (d.kind !== 'town' || cover[j] !== COVER.street) cover[j] = 0;
      yardMask[j] = 1;
    }
    water[i] = 0;
    height[i] = base;
    cover[i] = 0;
    yardMask[i] = 2;
    // the platform runs the yard's width; the cell beside each end of it is closed too, so no track
    // brushes the platform's corner
    const r = yard(d.kind);
    for (const dx of [r.dx0 - 1, r.dx1 + 1]) if (inside(sc, d.cx + dx, d.cy - 1)) yardMask[idx(sc, d.cx + dx, d.cy - 1)] = Math.max(yardMask[idx(sc, d.cx + dx, d.cy - 1)], 1);
  }
  const s: SimState = {
    scenario: sc,
    w: sc.w,
    h: sc.h,
    water,
    height,
    cover,
    yardMask,
    track: new Uint8Array(sc.w * sc.h),
    sites,
    stations: [],
    lines: [],
    trains: [],
    cash: sc.cash,
    time: 0,
    year: sc.startYear,
    yearFrac: 0,
    month: 0,
    income: zeroCargo(),
    upkeep: 0,
    running: 0,
    engineUp: 0,
    trackUp: 0,
    loan: 0,
    assets: 0,
    paid: new Float32Array(sc.w * sc.h),
    broke: 0,
    lastYear: null,
    history: [],
    pick: null,
    nextPickAt: Infinity,
    picks: 0,
    perks: emptyPerks(),
    goalCount: 0,
    result: null,
    grewYear: [],
    floats: [],
    sounds: [],
    lastBuild: null,
    firstPayAt: null,
    nextId: 1,
  };
  for (const id of [sc.startStation, ...(sc.startStations ?? [])]) {
    const d = sc.sites.find((o) => o.id === id)!;
    s.stations.push({ id: s.nextId++, cell: idx(s, d.cx, d.cy), siteId: d.id });
  }
  return s;
}

export function siteAt(s: SimState, cell: number): Site | undefined {
  return s.sites.find((x) => idx(s, x.cx, x.cy) === cell);
}

export function stationAt(s: SimState, cell: number) {
  return s.stations.find((x) => x.cell === cell);
}

export function siteById(s: SimState, id: string): Site {
  return s.sites.find((x) => x.id === id)!;
}

/** the goods some site on the map makes: what a town can be fed */
export function goodsOnMap(s: SimState): Good[] {
  const out = new Set<Good>();
  for (const site of s.sites) {
    const g = ({ forest: 'timber', sawmill: 'boards', farm: 'grain', mill: 'flour', town: null } as const)[site.kind];
    if (g) out.add(g);
  }
  return GOODS.filter((g) => out.has(g));
}
