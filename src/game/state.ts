import type { Good, ScenarioDef, SimState, Site } from './types';
import { GOODS } from './types';
import { idx } from './grid';
import { RAW_RATE, RAW_START } from './content/economy';

export const zeroGoods = (): Record<Good, number> => Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<Good, number>;

export function createState(sc: ScenarioDef): SimState {
  const water = new Uint8Array(sc.w * sc.h);
  const ridge = new Uint8Array(sc.w * sc.h);
  for (const i of sc.water) water[i] = 1;
  for (const i of sc.ridge) if (!water[i]) ridge[i] = 1;
  const sites: Site[] = sc.sites.map((d) => ({
    ...d,
    stock: RAW_RATE[d.kind] ? RAW_START : 0,
    taken: zeroGoods(),
    delivered: 0,
    fed: zeroGoods(),
    rate: RAW_RATE[d.kind] ?? 0,
    lastPickup: -Infinity,
    size: d.kind === 'town' ? d.size ?? 1 : 0,
    grewAt: -1,
  }));
  // a site's cell is never water or ridge
  for (const d of sc.sites) {
    water[idx(sc, d.cx, d.cy)] = 0;
    ridge[idx(sc, d.cx, d.cy)] = 0;
  }
  const s: SimState = {
    scenario: sc,
    w: sc.w,
    h: sc.h,
    water,
    ridge,
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
    income: zeroGoods(),
    upkeep: 0,
    yearEnd: null,
    perks: [],
    goalCount: 0,
    result: null,
    floats: [],
    sounds: [],
    lastBuild: null,
    firstPayAt: null,
    nextId: 1,
  };
  const start = sc.sites.find((d) => d.id === sc.startStation)!;
  s.stations.push({ id: s.nextId++, cell: idx(s, start.cx, start.cy), siteId: start.id });
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
