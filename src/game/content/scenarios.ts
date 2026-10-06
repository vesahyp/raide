/**
 * The hand-made maps. A scenario is data: a size, the water, the ridges,
 * the sites, the start and the goal.
 *
 * Sawmill: a forest, a sawmill and a town across a river, one chain,
 * deliver 20 boards before 1866. The tutorial.
 *
 * Harju: a forest and a sawmill, a farm and a mill behind a ridge, two
 * towns and a lake between everything. Grow both towns to size 3 before
 * 1872: it takes both chains to both towns, so a network.
 */
import type { ScenarioDef } from '../types';

function cells(w: number, h: number, fill: (x: number, y: number) => boolean): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fill(x, y)) out.push(y * w + x);
  return out;
}

const W = 16;
const H = 24;

/** the river winds across the lower map; a lake sits in the top right corner */
function sawmillWater(x: number, y: number): boolean {
  // three rows wide, winding under one row per column so a diagonal step cannot slip between cells
  const river = 15.5 + Math.sin(x * 0.42 + 0.6) * 1.3;
  if (Math.abs(y + 0.5 - river) < 1.7) return true;
  const lx = (x + 0.5 - 13.6) / 2.6;
  const ly = (y + 0.5 - 3.2) / 2.1;
  return lx * lx + ly * ly < 1;
}

export const SAWMILL: ScenarioDef = {
  id: 'sawmill',
  name: { fi: 'Saha', en: 'Sawmill' },
  blurb: { fi: '1862. 20 lautakuormaa ennen vuotta 1866', en: '1862. 20 loads of boards before 1866' },
  w: W,
  h: H,
  water: cells(W, H, sawmillWater),
  ridge: [],
  sites: [
    { id: 'forest', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 3, cy: 5 },
    { id: 'sawmill', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 9, cy: 11 },
    { id: 'town', kind: 'town', name: { fi: 'Hämeenlinna', en: 'Hämeenlinna' }, cx: 10, cy: 20, size: 1 },
  ],
  startStation: 'forest',
  cash: 150,
  startYear: 1862,
  goal: { kind: 'deliver', good: 'boards', site: 'town', count: 20, beforeYear: 1866 },
  trainsMax: 3,
  stars: [150, 320],
  engines: ['hilma'],
};

/** a lake in the middle of the map, between the mills and the towns */
function harjuWater(x: number, y: number): boolean {
  const lx = (x + 0.5 - 8.9) / 5.0;
  const ly = (y + 0.5 - 14.2) / 3.2;
  return lx * lx + ly * ly < 1;
}
/** a ridge across the top right, between the farm and the mill */
function harjuRidge(x: number, y: number): boolean {
  const crest = 5.6 + Math.sin(x * 0.5) * 0.4;
  return x >= 6 && Math.abs(y + 0.5 - crest) < 1.05;
}

export const HARJU: ScenarioDef = {
  id: 'harju',
  name: { fi: 'Harju', en: 'Harju' },
  blurb: { fi: '1862. Kaksi kaupunkia kokoon 3 ennen vuotta 1872', en: '1862. Both towns to size 3 before 1872' },
  w: W,
  h: H,
  water: cells(W, H, harjuWater),
  ridge: cells(W, H, harjuRidge),
  sites: [
    { id: 'forest', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 2, cy: 3 },
    { id: 'sawmill', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 5, cy: 8 },
    { id: 'farm', kind: 'farm', name: { fi: 'Peltola', en: 'Peltola' }, cx: 13, cy: 2 },
    { id: 'mill', kind: 'mill', name: { fi: 'Myllykylä', en: 'Myllykylä' }, cx: 12, cy: 9 },
    { id: 'hameenlinna', kind: 'town', name: { fi: 'Hämeenlinna', en: 'Hämeenlinna' }, cx: 2, cy: 15, size: 1 },
    { id: 'tampere', kind: 'town', name: { fi: 'Tampere', en: 'Tampere' }, cx: 11, cy: 20, size: 1 },
  ],
  startStation: 'forest',
  cash: 200,
  startYear: 1862,
  goal: { kind: 'towns', size: 3, beforeYear: 1872 },
  trainsMax: 6,
  stars: [800, 1500],
  engines: ['hilma', 'jyry'],
};

export const SCENARIOS: ScenarioDef[] = [SAWMILL, HARJU];
export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
