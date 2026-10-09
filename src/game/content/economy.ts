/**
 * Every number the balance is made of. Starting values from docs/design.md,
 * tuned by the bot (tools/balance.ts). Money has no unit on screen.
 */
import type { Cargo, EngineId, Fare, Good, SiteKind, Text, WagonType } from '../types';

/** sim seconds in a year at normal speed; the year-end card is the natural stop */
export const YEAR_SECONDS = 90;
export const MONTHS = 12;

/** what a delivery pays before demand and distance */
export const BASE_PRICE: Record<Good, number> = { timber: 8.4, boards: 6.83, grain: 7.67, flour: 6.83 };

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
export const TOWN_EATS = 0.13;
/** a town of size n eats TOWN_EATS times (1 + EAT_GROWTH times (n - 1)): twice the size is not twice the appetite */
export const EAT_GROWTH = 0.25;
/** a refinery keeps its own input model: loads taken in lately set the price, and they decay this much a month */
export const MILL_EATS = 1.5;
/** supplied months (every good the town wants had stock at the month's start) that fill the growth meter */
export const GROW_MONTHS = 4;
/** what a short month takes off the growth meter, as a share of the whole meter */
export const GROW_LOSS = 1 / 24;
export const TOWN_MAX = 5;

/** what a wagon carries */
export const WAGON_GOODS: Record<WagonType, Good[]> = { flat: ['timber'], box: ['boards', 'flour'], hopper: ['grain'], coach: [], mailvan: [] };
/** the fare a coach or a mail van carries, null for the goods wagons */
export const WAGON_FARE: Record<WagonType, Fare | null> = { flat: null, box: null, hopper: null, coach: 'pax', mailvan: 'mail' };
export const WAGON_NAME: Record<WagonType, Text> = {
  flat: { fi: 'Lavavaunut', en: 'Flat wagons' },
  box: { fi: 'Umpivaunut', en: 'Box wagons' },
  hopper: { fi: 'Viljavaunut', en: 'Grain wagons' },
  coach: { fi: 'Henkilövaunut', en: 'Coaches' },
  mailvan: { fi: 'Postivaunut', en: 'Mail vans' },
};
export const GOOD_NAME: Record<Cargo, Text> = {
  timber: { fi: 'tukit', en: 'timber' },
  boards: { fi: 'laudat', en: 'boards' },
  grain: { fi: 'vilja', en: 'grain' },
  flour: { fi: 'jauhot', en: 'flour' },
  pax: { fi: 'matkustajat', en: 'travellers' },
  mail: { fi: 'posti', en: 'mail' },
};
export function wagonFor(good: Good): WagonType {
  return (Object.keys(WAGON_GOODS) as WagonType[]).find((w) => WAGON_GOODS[w].includes(good))!;
}

/**
 * Travellers and mail. A town with a station makes PAX_RATE and MAIL_RATE loads a month for every size,
 * shared among the other towns with a station by their size, and holds at most PAX_CAP and MAIL_CAP per
 * size for each of them. A load pays BASE_FARE with the distance factor, less FARE_DECAY of the full pay
 * for every second past a fair trip (the distance at FARE_SPEED cells a second), never below FARE_FLOOR.
 * Mail pays more and loses a third as fast.
 */
export const PAX_RATE = 0.5;
export const MAIL_RATE = 0.25;
export const PAX_CAP = 2;
export const MAIL_CAP = 2;
export const BASE_FARE: Record<Fare, number> = { pax: 3.5, mail: 5 };
export const FARE_SPEED = 1.2;
export const PAX_DECAY = 0.02;
export const FARE_DECAY: Record<Fare, number> = { pax: PAX_DECAY, mail: PAX_DECAY / 3 };
export const FARE_FLOOR = 0.25;
/** a town from this size on wants travellers to arrive, besides its goods, to count a month as supplied */
export const PAX_GROW_SIZE = 2;
/** travellers who arrived within this many months keep a town supplied: a train calls once a round trip, which is several months on a long line */
export const PAX_MEMORY = 24;

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
  hilma: { id: 'hilma', name: { fi: 'Pikku-Hilma', en: 'Little Hilma' }, price: 100, upkeep: 6, runCost: 0.055, speed: 3.2, climb: 0.25, blurb: { fi: 'kevyt ja nopea, ryömii ylämäessä', en: 'light and fast, crawls uphill' } },
  jyry: { id: 'jyry', name: { fi: 'Jyry', en: 'Jyry' }, price: 180, upkeep: 14, runCost: 0.2, speed: 2.5, climb: 0.9, blurb: { fi: 'hidas ja vahva, vetää mäen yli', en: 'slow and strong, pulls over a hill' } },
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
export const WAGON_RUN = 0.11;
export const WAGONS_DEFAULT = 2;
export const WAGONS_MAX = 4;
/** the most stops a line has: a line is extended by a drag from its end station */
export const LINE_STOPS_MAX = 4;
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

/** seconds a train has stood ready to leave and been held by a block before the trains that would run over its legs hold back for it: first come, first served, kept to a bounded wait */
export const GATE_RESERVE = 30;

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

/**
 * The passing siding: its price, the tiles of main line it keeps clear of a station at each end, and
 * how it is laid out. The loop lies beside the track, SIDING_OFFSET tiles away; the track leaves the
 * main line over SIDING_RAMP tiles at each end (the points). A train held in the loop stops
 * SIDING_GAP short of the far points so the whole of it lies on the loop; one that waits before the
 * near points stops SIDING_WAIT short of them. The loop is as long as the longest train (an engine
 * and four wagons) plus the two gaps.
 */
export const SIDING_PRICE = 120;
export const SIDING_FROM_STATION = 6;
export const SIDING_RAMP = 1;
export const SIDING_OFFSET = 0.9;
export const SIDING_GAP = SIDING_RAMP + 0.15;
export const SIDING_WAIT = 0.4;
/** seconds a round trip gains when two trains meet at the siding: the one that waits stands for the other to pass the points */
export const SIDING_MEET = 3;
export const SIDING_LEN = ENGINE_LEN + WAGONS_MAX * (WAGON_LEN + 0.08) + 2 * SIDING_GAP;

/** the crane: its price, the share of the dwell it takes off (it halves it), and the goods it lifts */
export const CRANE_PRICE = 150;
export const CRANE_CUT = 0.5;
export const CRANE_GOODS: Good[] = ['timber', 'boards', 'grain'];
/** the sites whose station can have a crane */
export const CRANE_SITES: SiteKind[] = ['forest', 'sawmill', 'farm', 'mill'];

/** contracts: how many a player holds at once, the months of one train's loads a contract asks for, and the share of those loads' pay paid on top */
export const CONTRACT_MAX = 2;
export const CONTRACT_MONTHS = 8;
export const CONTRACT_SHARE = 0.4;
export const CONTRACT_MIN = 3;
/** the share of its free-running trips a train makes on a busy map, for the count a contract asks */
export const CONTRACT_PACE = 0.6;

/** seconds the Cancel button stays under the thumb after a build */
export const UNDO_SECONDS = 1.5;
