/**
 * The hand-made maps. A scenario is data: a size, the land as a height
 * function, the sites, the start and the goal.
 *
 * The land is metres above the water: a sum of hills (and a basin for a
 * lake), a river channel, and a little noise so no slope is flat. Below
 * zero is water. The sim reads the height at cell centres; the renderer
 * samples it everywhere.
 *
 * Sawmill: a forest, a sawmill and a town across a river, one chain,
 * deliver 20 boards before 1866. The tutorial.
 *
 * Harju: a forest and a sawmill, a farm and a mill behind a ridge, two
 * towns and a lake between everything. Grow both towns to size 3 before
 * 1872: it takes both chains to both towns, so a network.
 */
import type { ScenarioDef } from '../types';

const W = 16;
const H = 24;

interface Hill {
  x: number;
  y: number;
  /** metres at the top; negative for a basin */
  h: number;
  /** radius in cells, where the hill is at 60 % of its height */
  r: number;
  /** stretch along x, for a ridge; 1 is round */
  sx?: number;
}

const gauss = (x: number, y: number, o: Hill): number => {
  const dx = (x - o.x) / (o.sx ?? 1);
  const dy = y - o.y;
  return o.h * Math.exp(-(dx * dx + dy * dy) / (2 * o.r * o.r));
};
const noise = (x: number, y: number): number => 1.6 * Math.sin(x * 1.3 + 0.4) * Math.cos(y * 0.9) + 1.1 * Math.sin((x + y) * 0.7 + 1.7) + 0.6 * Math.cos(x * 2.1 - y * 1.7);

/** land from hills and basins: a base height plus the hills, plus the noise */
function land(base: number, hills: Hill[], extra: (x: number, y: number) => number = () => 0) {
  return (x: number, y: number): number => {
    let h = base + noise(x, y) + extra(x, y);
    for (const o of hills) h += gauss(x, y, o);
    return h;
  };
}

/** a river: a channel that follows a winding line of cells, `depth` metres below the land */
function river(line: (x: number) => number, width: number, depth: number) {
  return (x: number, y: number): number => {
    const d = Math.abs(y - line(x));
    const t = Math.min(1, d / width);
    return -depth * (1 - t * t * (3 - 2 * t));
  };
}

export const SAWMILL: ScenarioDef = {
  id: 'sawmill',
  name: { fi: 'Saha', en: 'Sawmill' },
  blurb: { fi: '1862. 20 lautakuormaa ennen vuotta 1866', en: '1862. 20 loads of boards before 1866' },
  w: W,
  h: H,
  // a rise to the north under the forest, a river across the lower map, a lake in the top right
  terrain: land(
    7,
    [
      { x: 3, y: 2, h: 14, r: 4 },
      { x: 14, y: 3, h: -22, r: 1.5 },
      { x: 4, y: 21, h: 8, r: 3 },
    ],
    river((x) => 16 + Math.sin(x * 0.42 + 0.6) * 1.3, 2.4, 15),
  ),
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

export const HARJU: ScenarioDef = {
  id: 'harju',
  name: { fi: 'Harju', en: 'Harju' },
  blurb: { fi: '1862. Kaksi kaupunkia kokoon 3 ennen vuotta 1872', en: '1862. Both towns to size 3 before 1872' },
  w: W,
  h: H,
  // the ridge runs across the top right between the farm and the mill; the lake fills the
  // middle; a hill rises in the south west corner and the forest stands on a rise
  terrain: land(6, [
    { x: 11, y: 5.6, h: 48, r: 1.3, sx: 3.2 },
    { x: 8.9, y: 14.2, h: -40, r: 1.65, sx: 1.56 },
    { x: 2, y: 2, h: 9, r: 3 },
    { x: 3, y: 21, h: 16, r: 2.6 },
    { x: 15, y: 15, h: 10, r: 3 },
  ]),
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
