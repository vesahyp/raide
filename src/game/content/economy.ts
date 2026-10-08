/**
 * Every number the balance is made of. Starting values from docs/design.md,
 * tuned by the bot (tools/balance.ts). Money has no unit on screen.
 */
import type { EngineId, Good, SiteKind, Text, WagonType } from '../types';

/** sim seconds in a year at normal speed; the year-end card is the natural stop */
export const YEAR_SECONDS = 90;
export const MONTHS = 12;

/** what a delivery pays before demand and distance */
export const BASE_PRICE: Record<Good, number> = { timber: 6.8, boards: 5.6, grain: 5.6, flour: 5 };

/** demand falls towards this as a site fills with recent deliveries of a good */
export const DEMAND_FLOOR = 0.4;
/** recent deliveries that take demand to the floor */
export const DEMAND_FILL = 4;
/** the distance factor runs from 1 at zero to DIST_BONUS at DIST_CAP cells, capped */
export const DIST_BONUS = 11;
export const DIST_CAP = 100;

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

/** a town's store of each good holds this many loads for every size it has; a full store pays the floor price */
export const TOWN_STORE_CAP = 4;
/** loads of each good a town eats a month for every size it has, taken continuously from its store */
export const TOWN_EATS = 0.25;
/** a refinery keeps its own input model: loads taken in lately set the price, and they decay this much a month */
export const MILL_EATS = 1.5;
/** supplied months (every good the town wants had stock at the month's start) that fill the growth meter */
export const GROW_MONTHS = 8;
/** what a short month takes off the growth meter, as a share of the whole meter */
export const GROW_LOSS = 1 / 24;
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
  /** a year of upkeep, charged monthly whether the engine runs or stands */
  upkeep: number;
  /** what the engine costs for every tile it runs, loaded or empty (fuel and crew) */
  runCost: number;
  /** cells per second on the flat */
  speed: number;
  /** the share of its speed an engine keeps on a ridge with an empty train; a load cuts it further */
  climb: number;
  blurb: Text;
}
/** the engines of the wood era: a light wood burner, and a slow strong one for grades */
export const ENGINES: Record<EngineId, EngineDef> = {
  hilma: { id: 'hilma', name: { fi: 'Pikku-Hilma', en: 'Little Hilma' }, price: 100, upkeep: 5, runCost: 0.052, speed: 3.2, climb: 0.25, blurb: { fi: 'kevyt ja nopea, ryömii ylämäessä', en: 'light and fast, crawls uphill' } },
  jyry: { id: 'jyry', name: { fi: 'Jyry', en: 'Jyry' }, price: 180, upkeep: 8, runCost: 0.18, speed: 2.5, climb: 0.9, blurb: { fi: 'hidas ja vahva, vetää mäen yli', en: 'slow and strong, pulls over a hill' } },
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
/** a wagon's price; twice the first prices, so money is tight (docs/economy.md) */
export const WAGON_PRICE = 20;
/** every wagon on a train adds this to the cost of a tile run: a longer train burns more */
export const WAGON_RUN = 0.104;
export const WAGONS_DEFAULT = 2;
export const WAGONS_MAX = 4;
/** what a sold train or engine returns */
export const RESALE = 0.5;
/** seconds a train stands at a station */
export const STOP_SECONDS = 1;
/** seconds one wagon takes to unload, and again to load: each wagon in turn, then the stop lasts STOP_SECONDS more */
export const WAGON_DWELL = 0.6;
/** the loading crew a station can buy: its price, and the share of the dwell it takes off */
export const CREW_PRICE = 60;
export const CREW_CUT = 1 / 3;
/** lengths in tiles, for the renderer and the station slots */
export const ENGINE_LEN = 2.2;
export const WAGON_LEN = 1.4;

/** a station's platforms at the start: a train that finds them all taken waits on the line */
export const PLATFORMS_START = 1;
/** what the second and the third platform of a station cost */
export const PLATFORM_PRICE = [80, 160];
/** tiles of clear track between a waiting train and the train on the platform */
export const QUEUE_GAP = 0.4;

/** seconds a train waits for a platform before it takes a siding track instead, so a ring of busy stations never freezes */
export const PATIENCE_SECONDS = 12;

/** the yearly upkeep of one built tile of track; a bridge tile costs BRIDGE_UPKEEP times that. Charged monthly */
export const TRACK_UPKEEP = 0.15;
export const BRIDGE_UPKEEP = 4;
/** the share of the build price that comes back when a line is lifted, and that counts in net worth */
export const LIFT_BACK = 0.5;

/** the loan: the ceiling is LOAN_BASE plus LOAN_SHARE of net worth, the interest is paid at the year end */
export const LOAN_BASE = 150;
export const LOAN_SHARE = 0.5;
export const LOAN_RATE = 0.08;
/** one tap on Borrow or Repay */
export const LOAN_STEP = 100;
/** year ends in a row with cash below zero and the loan at its ceiling that end the scenario */
export const BANKRUPT_YEARS = 2;

/** the year-end choices, once each */
export const PERK_SPEED = 1.25;
export const PERK_FOREST = 1.5;

/** seconds the Cancel button stays under the thumb after a build */
export const UNDO_SECONDS = 1.5;
