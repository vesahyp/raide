/**
 * Every number the balance is made of. Starting values from docs/design.md,
 * tuned by the bot (tools/balance.ts). Money has no unit on screen.
 */
import type { EngineId, Good, SiteKind, Text, WagonType } from '../types';

/** sim seconds in a year at normal speed; the year-end card is the natural stop */
export const YEAR_SECONDS = 90;
export const MONTHS = 12;

/** what a delivery pays before demand and distance */
export const BASE_PRICE: Record<Good, number> = { timber: 8, boards: 19, grain: 7, flour: 18 };

/** demand falls towards this as a site fills with recent deliveries of a good */
export const DEMAND_FLOOR = 0.4;
/** recent deliveries that take demand to the floor */
export const DEMAND_FILL = 10;
/** the distance factor runs from 1 at zero to DIST_BONUS at DIST_CAP cells, capped */
export const DIST_BONUS = 1.5;
export const DIST_CAP = 80;

/** what each site makes and takes */
export const MAKES: Record<SiteKind, Good | null> = { forest: 'timber', sawmill: 'boards', farm: 'grain', mill: 'flour', town: null };
export const TAKES: Record<SiteKind, Good[]> = { forest: [], sawmill: ['timber'], farm: [], mill: ['grain'], town: ['boards', 'flour'] };

/** a raw site's loads per month, its cap, its start stock */
export const RAW_RATE: Partial<Record<SiteKind, number>> = { forest: 0.9, farm: 0.85 };
export const RAW_CAP = 6;
export const RAW_START = 3;
/** a served raw site's rate climbs to this times the base, and falls back when pickups stop */
export const SERVED_RATE = 1.6;
/** months without a pickup before the rate starts to fall */
export const SERVED_MEMORY = 2;

/** a town eats this much of each good a month per size: its demand recovers that fast */
export const TOWN_EATS = 1.5;
/** a refinery's input stock decays this much a month: its demand recovers */
export const MILL_EATS = 1.5;
/** loads of each good on the map a town must take in a year to grow one size */
export const GROW_NEED = 3;
export const TOWN_MAX = 5;

/** what a wagon carries */
export const WAGON_GOODS: Record<WagonType, Good[]> = { flat: ['timber'], box: ['boards', 'flour'], hopper: ['grain'] };
export const WAGON_NAME: Record<WagonType, Text> = { flat: { fi: 'Lavavaunut', en: 'Flat wagons' }, box: { fi: 'Umpivaunut', en: 'Box wagons' }, hopper: { fi: 'Viljavaunut', en: 'Grain wagons' } };
export const GOOD_NAME: Record<Good, Text> = { timber: { fi: 'tukit', en: 'timber' }, boards: { fi: 'laudat', en: 'boards' }, grain: { fi: 'vilja', en: 'grain' }, flour: { fi: 'jauhot', en: 'flour' } };
export function wagonFor(good: Good): WagonType {
  return (Object.keys(WAGON_GOODS) as WagonType[]).find((w) => WAGON_GOODS[w].includes(good))!;
}

export interface EngineDef {
  id: EngineId;
  name: Text;
  price: number;
  upkeep: number;
  /** cells per second on the flat */
  speed: number;
  /** the share of its speed an engine keeps on a ridge with an empty train; a load cuts it further */
  climb: number;
  blurb: Text;
}
/** the engines of the wood era: a light wood burner, and a slow strong one for grades */
export const ENGINES: Record<EngineId, EngineDef> = {
  hilma: { id: 'hilma', name: { fi: 'Pikku-Hilma', en: 'Little Hilma' }, price: 50, upkeep: 15, speed: 3.2, climb: 0.25, blurb: { fi: 'kevyt ja nopea, ryömii ylämäessä', en: 'light and fast, crawls uphill' } },
  jyry: { id: 'jyry', name: { fi: 'Jyry', en: 'Jyry' }, price: 90, upkeep: 22, speed: 2.5, climb: 0.9, blurb: { fi: 'hidas ja vahva, vetää mäen yli', en: 'slow and strong, pulls over a hill' } },
};
/** a cell's side in metres: grades and the distance factor are read in these */
export const CELL_M = 100;
/** the land is whole terraces of this many metres, up to TERRACE_MAX of them */
export const TERRACE_M = 10;
export const TERRACE_MAX = 3;

/** a site's yard: the cells north of its station cell where its buildings and piles stand, relative to the site cell */
export function yard(kind: SiteKind): { dx0: number; dx1: number; dy0: number; dy1: number } {
  return kind === 'town' ? { dx0: -6, dx1: 6, dy0: -7, dy1: -1 } : { dx0: -3, dx1: 3, dy0: -4, dy1: -1 };
}
/** the steepest grade a line is built at, in percent; steeper land is cut and filled to it */
export const GRADE_MAX = 4;
/** on the grade limit an engine keeps its climb share of its speed; less grade, less loss */
/** a loaded wagon takes this share off a train's speed on the grade limit */
export const GRADE_LOAD = 0.07;
export const WAGON_PRICE = 10;
export const WAGONS_DEFAULT = 2;
export const WAGONS_MAX = 4;
/** what a sold train or engine returns */
export const RESALE = 0.5;
/** seconds a train stands at a station */
export const STOP_SECONDS = 1;
/** seconds one wagon takes to unload, and again to load: each wagon in turn, then the stop lasts STOP_SECONDS more */
export const WAGON_DWELL = 0.6;
/** the loading crew a station can buy: its price, and the share of the dwell it takes off */
export const CREW_PRICE = 30;
export const CREW_CUT = 1 / 3;
/** lengths in tiles, for the renderer and the station slots */
export const ENGINE_LEN = 2.2;
export const WAGON_LEN = 1.4;

/** the year-end choices, once each */
export const PERK_SPEED = 1.25;
export const PERK_FOREST = 1.5;

/** seconds the Cancel button stays under the thumb after a build */
export const UNDO_SECONDS = 1.5;
