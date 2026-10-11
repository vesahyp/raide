/**
 * Every number the balance is made of (ADR 0007). Money is in thousands of
 * markka (shown as "k"). A tile is 100 m for grades and 1 km for distance and
 * pay; a year is YEAR_SECONDS of play at normal speed.
 */
import type { Cargo, LocoId, SiteKind, StationSize, Text } from '../types';

export const YEAR_SECONDS = 240;
export const MONTHS = 12;
export const MONTH_SECONDS = YEAR_SECONDS / MONTHS;

// ---------------------------------------------------------------- land and track

/** a tile's side in metres, for grades */
export const CELL_M = 100;
/** the land is whole terraces of this many metres, up to TERRACE_MAX of them */
export const TERRACE_M = 10;
export const TERRACE_MAX = 3;
/** the rail clamped to this grade in percent: steeper land is cut and filled, and paid for */
export const GRADE_CHEAP = 4;
/** the level route's grade limit: more earthworks, faster trains */
export const GRADE_LEVEL = 1.5;
/** a tile of track on flat open land */
export const TRACK_COST = 1.6;
/** a tile of track through forest: the clearing on top */
export const CLEAR_COST = 0.5;
/** a tile of bridge over water */
export const BRIDGE_COST = 9;
/** per metre of earth cut away or filled in, per tile */
export const EARTH_COST = 0.3;
/** a yearly upkeep per tile of track, and per tile of bridge */
export const TRACK_UPKEEP = 0.2;
export const BRIDGE_UPKEEP = 1;
/** the share of the build price that comes back when track is removed */
export const REFUND = 0.4;
/** the rail over water on a bridge, metres */
export const BRIDGE_CLEAR = 4;

// ---------------------------------------------------------------- stations

export interface StationDef {
  name: Text;
  /** tiles from the station cell to the edge of its catchment square */
  radius: number;
  price: number;
  upkeep: number;
}
export const STATIONS: Record<StationSize, StationDef> = {
  0: { name: { fi: 'Pieni asema', en: 'Small station' }, radius: 2, price: 10, upkeep: 2 },
  1: { name: { fi: 'Keskikokoinen', en: 'Medium station' }, radius: 3, price: 22, upkeep: 4 },
  2: { name: { fi: 'Suuri asema', en: 'Large station' }, radius: 4, price: 40, upkeep: 7 },
};
/** the fewest tiles between two stations, along either axis */
export const STATION_GAP = 4;
/** the most loads of one cargo that wait at a station; more is lost */
export const WAITING_CAP = 16;
/** the share of waiting cargo that goes elsewhere every month */
export const WAITING_DECAY = 0.06;

// ---------------------------------------------------------------- cargo and pay

/** what a load pays for every 10 tiles of straight distance, before demand and time */
export const BASE_PAY: Record<Cargo, number> = { pax: 1.3, mail: 1.9, logs: 2.0, lumber: 3.4, paper: 4.3, grain: 2.0, food: 3.7 };
/** the distance pay counts at full value up to this many tiles; beyond it, at half */
export const DIST_FULL = 40;
/** a haul shorter than this pays nothing: the cargo would go by cart */
export const DIST_MIN = 4;
/** the speed in tiles a second a load expects; slower pays less, faster pays more */
export const EXPECT_SPEED = 2.1;
/** how much each cargo cares about time: 1 perishable, 0 not at all */
export const HASTE: Record<Cargo, number> = { pax: 1, mail: 1.2, logs: 0.25, lumber: 0.35, paper: 0.35, grain: 0.4, food: 0.8 };
/** the glut a load adds at a station: 1 / the loads a month the market takes */
export const GLUT_STEP: Record<Cargo, number> = { pax: 0.06, mail: 0.1, logs: 0.07, lumber: 0.09, paper: 0.12, grain: 0.07, food: 0.08 };
/** the share of a station's glut that drains every month */
export const GLUT_DRAIN = 0.35;
/** the price at full glut, as a share of the full price */
export const GLUT_FLOOR = 0.25;

export const CARGO_NAME: Record<Cargo, Text> = {
  pax: { fi: 'matkustajat', en: 'passengers' },
  mail: { fi: 'posti', en: 'mail' },
  logs: { fi: 'tukit', en: 'logs' },
  lumber: { fi: 'sahatavara', en: 'lumber' },
  paper: { fi: 'paperi', en: 'paper' },
  grain: { fi: 'vilja', en: 'grain' },
  food: { fi: 'elintarvikkeet', en: 'food' },
};
/** a car's look: the body the renderer draws, and its colour */
export const CAR_LOOK: Record<Cargo, { body: 'coach' | 'van' | 'flat' | 'hopper' | 'box'; colour: string }> = {
  pax: { body: 'coach', colour: '#3f6b4f' },
  mail: { body: 'van', colour: '#b0392b' },
  logs: { body: 'flat', colour: '#7a4b2a' },
  lumber: { body: 'flat', colour: '#e3c387' },
  paper: { body: 'box', colour: '#e8e4d8' },
  grain: { body: 'hopper', colour: '#e3b23c' },
  food: { body: 'box', colour: '#3a6fa0' },
};
/** the weight of a car, empty and loaded, in the train's weight units */
export const CAR_EMPTY = 1;
export const CAR_FULL: Record<Cargo, number> = { pax: 1.4, mail: 1.3, logs: 2.2, lumber: 2, paper: 2, grain: 2.1, food: 1.8 };
export const CARS_MAX = 8;
/** seconds to load or unload one car, and the stop's fixed time */
export const CAR_DWELL = 0.35;
export const STOP_SECONDS = 1;

// ---------------------------------------------------------------- industries and towns

/** what each kind of site makes from nothing (raw), turns into what (converts), and takes */
export const RAW: Partial<Record<SiteKind, Cargo>> = { forest: 'logs', farm: 'grain' };
export const CONVERTS: Partial<Record<SiteKind, { from: Cargo; to: Cargo }>> = {
  sawmill: { from: 'logs', to: 'lumber' },
  papermill: { from: 'logs', to: 'paper' },
  mill: { from: 'grain', to: 'food' },
};
/** a raw site's default loads a month */
export const RAW_RATE = 2.2;
/** the most loads a site holds before it stops making more */
export const SITE_CAP = 10;
/** the most input a converter works a month */
export const CONVERT_RATE = 4;
/** the goods a town takes; paper only from a town of PAPER_HOUSES houses */
export const TOWN_TAKES: Cargo[] = ['pax', 'mail', 'food', 'lumber', 'paper'];
export const PAPER_HOUSES = 14;
/** a station takes a town's cargo when this many of its houses stand in the catchment */
export const TOWN_ACCEPT = 3;
/** passengers and mail a house makes a month */
export const PAX_RATE = 0.07;
export const MAIL_RATE = 0.025;
/** a town's growth: service points for each load in, and for each passenger load picked up */
export const GROW_IN = 1;
export const GROW_OUT = 0.5;
/** points to the next house: this, and this much more for every house already standing */
export const GROW_BASE = 3;
export const GROW_PER = 0.12;
/** a town's houses stand within this many tiles of its centre */
export const TOWN_RADIUS = 7;

export const KIND_NAME: Record<SiteKind, Text> = {
  forest: { fi: 'Metsä', en: 'Forest' },
  farm: { fi: 'Maatila', en: 'Farm' },
  sawmill: { fi: 'Saha', en: 'Sawmill' },
  papermill: { fi: 'Paperitehdas', en: 'Paper mill' },
  mill: { fi: 'Mylly', en: 'Mill' },
  town: { fi: 'Kaupunki', en: 'Town' },
};

// ---------------------------------------------------------------- locomotives

export interface LocoDef {
  id: LocoId;
  name: Text;
  /** the year it goes on sale */
  year: number;
  price: number;
  /** top speed, tiles a second */
  speed: number;
  /** pulling power: the speed it holds on a grade with a heavy train */
  power: number;
  /** its own weight */
  weight: number;
  /** reliability when new, 0..1; it falls with age */
  reliability: number;
  /** upkeep a year when new; it grows with age */
  upkeep: number;
  /** fuel per tile run, for every 10 units of train weight */
  fuel: number;
  blurb: Text;
}
export const LOCOS: Record<LocoId, LocoDef> = {
  hilma: { id: 'hilma', name: { fi: 'Pikku-Hilma', en: 'Little Hilma' }, year: 1860, price: 32, speed: 3.6, power: 1, weight: 3, reliability: 0.82, upkeep: 7, fuel: 0.04, blurb: { fi: 'halpa ja nopea tasamaalla, ryömii mäessä', en: 'cheap and quick on the flat, crawls uphill' } },
  jyry: { id: 'jyry', name: { fi: 'Jyry', en: 'Jyry' }, year: 1860, price: 48, speed: 2.6, power: 2.1, weight: 5, reliability: 0.9, upkeep: 10, fuel: 0.045, blurb: { fi: 'hidas ja vahva, ei väsy mäessä', en: 'slow and strong, keeps going uphill' } },
  ukko: { id: 'ukko', name: { fi: 'Ukko-Pekka', en: 'Ukko-Pekka' }, year: 1866, price: 64, speed: 4.8, power: 1.5, weight: 4, reliability: 0.86, upkeep: 12, fuel: 0.05, blurb: { fi: 'nopea matkustajajuna', en: 'a fast passenger engine' } },
  karhu: { id: 'karhu', name: { fi: 'Karhu', en: 'Karhu' }, year: 1869, price: 75, speed: 3.4, power: 3.2, weight: 6, reliability: 0.92, upkeep: 13, fuel: 0.05, blurb: { fi: 'raskas ja varma', en: 'heavy and reliable' } },
};
export const LOCO_IDS: LocoId[] = ['hilma', 'jyry', 'ukko', 'karhu'];
/** the grade model: speed = min(top, POWER_K * power / (weight * (ROLL + grade %))) */
export const POWER_K = 52;
export const ROLL = 0.5;
/** reliability lost every year of age */
export const AGE_WEAR = 0.035;
/** a breakdown's chance per tile run is (1 - reliability) / this */
export const BREAK_TILES = 50;
/** a breakdown: the seconds the train stands, and the repair */
export const BREAK_SECONDS = 8;
export const BREAK_COST = 3;
/** upkeep grows by this share for every year of age */
export const UPKEEP_AGE = 0.12;
/** a locomotive's value falls to nothing over this many years, and never below SCRAP of its price */
export const LOCO_LIFE = 16;
export const SCRAP = 0.1;

// ---------------------------------------------------------------- money

/** one bond */
export const BOND = 50;
/** a new bond's interest a year: this, and BOND_STEP more for every bond already out */
export const BOND_RATE = 0.05;
export const BOND_STEP = 0.01;
/** the most debt: this, and this share of the book value of track, stations and trains */
export const CREDIT_BASE = 100;
export const CREDIT_SHARE = 0.5;
/** month ends in a row with cash below zero and no credit left that end the company */
export const BANKRUPT_MONTHS = 3;
/** the share of the build price of track and stations that counts in the company's worth */
export const BOOK_SHARE = 0.5;
