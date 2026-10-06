import type { ScenarioDef, SimState, Site } from './types';
import { idx } from './grid';
import { FOREST_RATE, FOREST_START } from './content/economy';

export function createState(sc: ScenarioDef): SimState {
  const water = new Uint8Array(sc.w * sc.h);
  for (const i of sc.water) water[i] = 1;
  const sites: Site[] = sc.sites.map((d) => ({
    ...d,
    stock: d.kind === 'forest' ? FOREST_START : 0,
    taken: 0,
    delivered: 0,
    rate: d.kind === 'forest' ? FOREST_RATE : 0,
    lastPickup: -Infinity,
  }));
  // a site's cell is never water
  for (const d of sc.sites) water[idx(sc, d.cx, d.cy)] = 0;
  const s: SimState = {
    scenario: sc,
    w: sc.w,
    h: sc.h,
    water,
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
    income: { timber: 0, boards: 0 },
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
