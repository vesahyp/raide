/**
 * What a planned route says to the player, in words, shared by the plate over the finger, the
 * pill on the way round and the choice card, so the map and the card agree.
 */
import type { EngineId, SimState } from '../game/types';
import type { Route } from '../game/grid';
import { routeTrips } from '../game/sim';
import { CELL_M } from '../game/content/economy';
import { tr } from '../i18n';

/** the colour of a grade in percent: green under 1.5, amber to 3.5, red above */
export const GRADE_COL = (g: number) => (g < 1.5 ? '#3fa84b' : g < 3.5 ? '#e8a82b' : '#d8402f');

export const routeKm = (r: Route): string => ((r.length * CELL_M) / 1000).toFixed(1);

/** the worst grade as text: "flat" under 1 % */
export const gradeText = (r: Route): string => (r.worst < 1 ? tr('tasainen', 'flat') : `${r.worst.toFixed(0)} %`);

/** the earthwork word, or null on plain land */
export function earthWord(r: Route): { kind: 'bridge' | 'cut' | 'fill'; text: string } | null {
  if (r.bridge.length) return { kind: 'bridge', text: tr('silta', 'bridge') };
  if (r.cutting.length) return { kind: 'cut', text: tr('leikkaus', 'cutting') };
  if (r.fill.length) return { kind: 'fill', text: tr('penger', 'embankment') };
  return null;
}

/** "6/yr" */
export const perYear = (n: number): string => tr(`${n.toFixed(1)}/v`, `${n.toFixed(1)}/yr`);

/** trips a year for each engine the scenario sells */
export function tripsByEngine(s: SimState, r: Route): { engine: EngineId; trips: number }[] {
  return s.scenario.engines.map((engine) => ({ engine, trips: routeTrips(s, r, engine) }));
}

/** the best engine's trips a year */
export const bestTrips = (s: SimState, r: Route): number => Math.max(...tripsByEngine(s, r).map((x) => x.trips));
