/**
 * The hand-made maps. A scenario is data: a size, the water, the sites, the
 * start and the goal. The first is the sawmill: a forest, a sawmill and a
 * town across a river, one chain, deliver 20 boards before 1866.
 */
import type { ScenarioDef } from '../types';

function water(w: number, h: number, fill: (x: number, y: number) => boolean): number[] {
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
  // the lake: a blob around (13.5, 3)
  const lx = (x + 0.5 - 13.6) / 2.6;
  const ly = (y + 0.5 - 3.2) / 2.1;
  if (lx * lx + ly * ly < 1) return true;
  return false;
}

export const SAWMILL: ScenarioDef = {
  id: 'sawmill',
  name: { fi: 'Saha', en: 'Sawmill' },
  w: W,
  h: H,
  water: water(W, H, sawmillWater),
  sites: [
    { id: 'forest', kind: 'forest', name: { fi: 'Kuusikko', en: 'Kuusikko' }, cx: 3, cy: 5 },
    { id: 'sawmill', kind: 'sawmill', name: { fi: 'Koskensaha', en: 'Koskensaha' }, cx: 9, cy: 11 },
    { id: 'town', kind: 'town', name: { fi: 'Hämeenlinna', en: 'Hämeenlinna' }, cx: 10, cy: 20 },
  ],
  startStation: 'forest',
  cash: 150,
  startYear: 1862,
  goal: { good: 'boards', site: 'town', count: 20, beforeYear: 1866 },
};

export const SCENARIOS: ScenarioDef[] = [SAWMILL];
