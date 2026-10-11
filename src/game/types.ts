/**
 * The model of a mobile Railroad Tycoon 2 (ADR 0007). Track is a network of
 * cells the player lays freely; stations stand on it and gather cargo from a
 * square catchment; trains run a route of stops and change their cars at each
 * stop; industries make, convert and use cargo; towns grow from service; the
 * company pays upkeep, fuel, repairs and interest, and borrows with bonds.
 */

/** RT2's cargo, cut to what 1860s Finland needs: people and post between towns, and three chains */
export type Cargo = 'pax' | 'mail' | 'logs' | 'lumber' | 'paper' | 'grain' | 'food';
export const CARGOS: Cargo[] = ['pax', 'mail', 'logs', 'lumber', 'paper', 'grain', 'food'];

/** what a tile shows on top of the land: drawing data only, the sim never reads it */
export type Cover = 'none' | 'forest' | 'field' | 'street';

export type SiteKind = 'forest' | 'farm' | 'sawmill' | 'papermill' | 'mill' | 'town';

export type LocoId = 'hilma' | 'jyry' | 'ukko' | 'karhu';

export interface Text {
  fi: string;
  en: string;
}

export interface SiteDef {
  id: string;
  kind: SiteKind;
  name: Text;
  /** the centre cell */
  cx: number;
  cy: number;
  /** a town's houses at the start */
  houses?: number;
  /** a raw site's loads a month; the economy's default when left out */
  rate?: number;
}

/**
 * The scenario's goal (RT2's bronze, silver and gold): a number to reach by the end of a year.
 * Reaching gold ends the game at once; at the deadline the best tier reached is the result, and
 * none is a loss.
 */
export type Goal =
  | { kind: 'worth'; tiers: [number, number, number]; byYear: number }
  | { kind: 'haul'; cargo: Cargo; tiers: [number, number, number]; byYear: number };

export interface ScenarioDef {
  id: string;
  name: Text;
  /** one line for the title screen */
  blurb: Text;
  /** map size in tiles */
  w: number;
  h: number;
  /** the land: height in metres at a point in tiles; below zero is water */
  terrain: (x: number, y: number) => number;
  cover: (x: number, y: number) => Cover;
  sites: SiteDef[];
  cash: number;
  startYear: number;
  goal: Goal;
  /** the tile the camera opens on, and px a tile */
  view: [number, number, number];
}

export interface Site extends SiteDef {
  /** loads made and not yet taken by a station: a raw site's output, a converter's product */
  stock: Partial<Record<Cargo, number>>;
  /** a converter's input waiting to be worked */
  input: Partial<Record<Cargo, number>>;
  /** loads a month a raw site makes */
  rate: number;
  /** a town's houses, as cells; the town's size is their count */
  homes: number[];
  /** a town's service so far towards its next house */
  growth: number;
  /** loads delivered here, all time */
  delivered: number;
  /** a converter's output last month and this month so far, for the card */
  madeLast: number;
  madeMonth: number;
}

export type StationSize = 0 | 1 | 2;

export interface Station {
  id: number;
  name: string;
  /** the cell, on track */
  cell: number;
  size: StationSize;
  /** the axis of the platform: the direction index (0 to 3) of the track through the cell */
  axis: number;
  /** cargo waiting to be picked up, in loads, by cargo */
  waiting: Partial<Record<Cargo, number>>;
  /**
   * how full the market is here for each cargo, 0 empty to 1 glutted: each delivery adds to it,
   * and it drains month by month. The price paid falls as it fills.
   */
  glut: Partial<Record<Cargo, number>>;
  builtCost: number;
}

/** one stop of a train's route: the station, the cars the train leaves with, and whether it waits for a full load */
export interface Stop {
  station: number;
  cars: Cargo[];
  waitFull: boolean;
}

export interface Car {
  cargo: Cargo;
  /** the load: the station it was picked up at and the sim time it left there; null when empty */
  load: { from: number; at: number } | null;
}

export type TrainState = 'run' | 'stop' | 'broken' | 'lost';

export interface Train {
  id: number;
  name: string;
  loco: LocoId;
  /** the year (with its fraction) the locomotive was bought, for its age */
  built: number;
  route: Stop[];
  /** the stop the train stands at or runs to: an index into route */
  next: number;
  cars: Car[];
  /** the cells of the leg it is on, from the stop it left to the one it runs to */
  path: number[];
  /** distance along the path in tiles, per path index */
  dist: number[];
  /** rail height in metres, per path index */
  rail: number[];
  /** the head of the train, as a distance along the path */
  pos: number;
  state: TrainState;
  /** seconds left of the stop's work, or of the breakdown */
  timer: number;
  /** the train is held at the stop waiting for loads to fill its cars */
  waiting: boolean;
  /** tiles a second now */
  speed: number;
  odometer: number;
  /** the money this train made and cost, this year and last, and all time */
  earnedYear: number;
  costYear: number;
  earnedLast: number;
  costLast: number;
  profitAll: number;
  breakdowns: number;
}

export interface Float {
  x: number;
  y: number;
  text: string;
  age: number;
  kind: 'pay' | 'cost' | 'note' | 'grow';
  life?: number;
}

export interface Bond {
  amount: number;
  /** the interest a year, as a fraction */
  rate: number;
}

/** a closed year, for the ledger */
export interface YearEnd {
  year: number;
  revenue: number;
  fuel: number;
  upkeep: number;
  repairs: number;
  interest: number;
  build: number;
  profit: number;
  cash: number;
  debt: number;
  worth: number;
}

export interface Book {
  revenue: number;
  /** revenue by cargo */
  byCargo: Partial<Record<Cargo, number>>;
  fuel: number;
  /** track, station and locomotive upkeep */
  upkeep: number;
  repairs: number;
  interest: number;
  /** money spent on track, stations and trains: not a cost in the year's profit, shown apart */
  build: number;
}

export interface SimState {
  scenario: ScenarioDef;
  w: number;
  h: number;
  water: Uint8Array;
  /** the land's height per cell in metres: whole terraces, water below zero */
  height: Float32Array;
  /** 0 none, 1 forest, 2 field, 3 street */
  cover: Uint8Array;
  /** 0 free; 1 a site's building or a house: no track may be laid there */
  blocked: Uint8Array;
  /** the site whose building or house stands on a cell, by index into sites; -1 none */
  siteOf: Int16Array;
  /** track links per cell: bit d means track leaves the cell in DIRS[d] */
  track: Uint8Array;
  /** the rail's height per laid cell, in metres */
  rail: Float32Array;
  /** what each cell's track cost, for the refund and the book value */
  paid: Float32Array;
  /** counts every change to the laid track, so trains find their way again */
  netVersion: number;
  /** counts every change to the stations or the houses, so the catchment lists are worked out again */
  coverVersion: number;
  sites: Site[];
  stations: Station[];
  trains: Train[];
  bonds: Bond[];
  cash: number;
  /** sim seconds since the start */
  time: number;
  year: number;
  /** 0..1 through the year */
  yearFrac: number;
  month: number;
  book: Book;
  lastYear: YearEnd | null;
  history: YearEnd[];
  /** month ends in a row the cash stood below zero with no credit left */
  red: number;
  /** loads of each cargo delivered, all time, for a haul goal */
  hauled: Partial<Record<Cargo, number>>;
  /** the best goal tier reached so far: 0 none, 1 bronze, 2 silver, 3 gold */
  tier: number;
  result: { won: boolean; tier: number; year: number; worth: number; reason: 'gold' | 'deadline' | 'bankrupt'; time: number } | null;
  floats: Float[];
  sounds: string[];
  /** short news: breakdowns, a town that grew, a forced bond */
  news: { text: Text; time: number; cell?: number }[];
  nextId: number;
  /** the random state for breakdowns, so a run replays the same */
  seed: number;
}
