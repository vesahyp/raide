/** The goods so far: two chains, each raw to refined to town. Later eras add ore, iron, tar, coal, paper. */
export type Good = 'timber' | 'boards' | 'grain' | 'flour';
export const GOODS: Good[] = ['timber', 'boards', 'grain', 'flour'];

/** what a tile shows on top of the land: drawing data only, the sim never reads it */
export type Cover = 'none' | 'forest' | 'field' | 'street';

export type SiteKind = 'forest' | 'sawmill' | 'farm' | 'mill' | 'town';

/** A wagon carries one family of goods: flat wagons timber, box wagons boards and flour, hoppers grain. */
export type WagonType = 'flat' | 'box' | 'hopper';

export type EngineId = 'hilma' | 'jyry';

export interface Text {
  fi: string;
  en: string;
}

export interface SiteDef {
  id: string;
  kind: SiteKind;
  name: Text;
  cx: number;
  cy: number;
  /** a town's size at the start, 1 to 5 */
  size?: number;
}

export type Goal =
  | { kind: 'deliver'; good: Good; site: string; count: number; beforeYear: number }
  | { kind: 'towns'; size: number; /** how many towns must reach it */ count: number; beforeYear: number };

export interface ScenarioDef {
  id: string;
  name: Text;
  /** one line for the title screen */
  blurb: Text;
  /** map size in cells; the grid the player never sees, eight directions */
  w: number;
  h: number;
  /**
   * the land: height in metres at a point in cells. The sim reads it at cell centres and cuts it
   * into terraces (see TERRACE_M). Below zero is water: a bridge to cross. A terrace step is a
   * grade that slows a train, a cutting and a fill when the line goes through it.
   */
  terrain: (x: number, y: number) => number;
  /** what covers the land at a point: forest, a field, a street. Drawing data for the renderer */
  cover: (x: number, y: number) => Cover;
  sites: SiteDef[];
  /** the station the player starts with, a site id */
  startStation: string;
  /** more stations the player starts with, site ids: a second place to begin from */
  startStations?: string[];
  cash: number;
  startYear: number;
  goal: Goal;
  /** how many trains the player may run */
  trainsMax: number;
  /** cash at the end for two and for three stars */
  stars: [number, number];
  /** the engines on sale */
  engines: EngineId[];
}

export interface Site extends SiteDef {
  /** what the site holds of what it makes (a forest's timber, a sawmill's boards) */
  stock: number;
  /** what it has taken in over the last months, per good, for the demand curve; decays */
  taken: Record<Good, number>;
  /** loads delivered here, all time */
  delivered: number;
  /** loads delivered this year, per good, for a town's growth */
  fed: Record<Good, number>;
  /** production rate per month, raised by frequent pickups */
  rate: number;
  /** sim time of the last pickup here, for the served-rate rule */
  lastPickup: number;
  /** a town's size, 1 to 5; 0 for other sites */
  size: number;
  /** the year a town last grew, for the house that is being built */
  grewAt: number;
}

export interface Station {
  id: number;
  /** the cell, which is the site's cell */
  cell: number;
  siteId: string;
  /** the loading crew is bought: every wagon takes a third less time here */
  crew: boolean;
}

export interface Line {
  id: number;
  /** two stations: the train runs forward and back */
  stops: [number, number];
  /** the cells from the first stop to the second */
  path: number[];
  /** cumulative distance along the path, in cells, per path index */
  dist: number[];
  /** the rail's height in metres per path index: the land, cut and filled to the grade limit */
  rail: number[];
  /** the steepest step on the line, in percent */
  worst: number;
  /** the block: the cells between the two stations. One running train at a time on any of them */
  block: Set<number>;
}

export type TrainState = 'run' | 'stop';

export interface Train {
  id: number;
  lineId: number;
  engine: EngineId;
  wagons: WagonType;
  nWagons: number;
  /** the train waits at a loading stop until every wagon is full */
  fullLoad: boolean;
  /** +1 runs the path from stop 0 to stop 1 */
  dir: 1 | -1;
  /** the leading end of the train, as a distance along the line's path in cells */
  s: number;
  state: TrainState;
  /** seconds left at the station */
  stopLeft: number;
  /** loads on board */
  cargo: number;
  /** the good on board, while cargo is above zero */
  good: Good | null;
  /** the station cell the train stands at, while it stops */
  at: number | null;
  /** the platform track the train stands on at the station it is at or runs to: 0 is nearest the platform */
  slot: number;
  /** the platform track it stood on at the station it left, so it pulls out along the same one */
  slotFrom: number;
  /** cells per second right now: the engine's, cut on a grade */
  speed: number;
  /** for the smoke and the wheels: distance run */
  odometer: number;
  /** pay earned, all time */
  earned: number;
  /** pay earned this year and last year, for the train card */
  earnedYear: number;
  earnedLast: number;
  /** what the train is doing at the platform: a load or an unload in hand, or neither */
  dock: 'load' | 'unload' | null;
  /** seconds until the load now being moved is on board (or off it) */
  work: number;
  /** wagons emptied so far this stop, counted from the front: the full ones are `unloaded` up to `unloaded + cargo` */
  unloaded: number;
  /** pay for each load that comes off, set when the train arrives */
  unitPay: number;
  /** pay taken this stop, shown as one float when the unloading ends */
  paid: number;
}

export interface Float {
  x: number;
  y: number;
  text: string;
  age: number;
  kind: 'pay' | 'cost' | 'note';
}

export type YearEndChoice = 'wagon' | 'speed' | 'forest';

export interface YearEnd {
  year: number;
  income: Record<Good, number>;
  upkeep: number;
  profit: number;
  cash: number;
  choice: YearEndChoice | null;
  /** towns that grew this year end */
  grew: string[];
}

export interface LastBuild {
  cost: number;
  cells: number[];
  station: number | null;
  line: number | null;
  /** seconds left to undo */
  left: number;
  /** where the finger lifted, a cell */
  cell: number;
}

export interface SimState {
  scenario: ScenarioDef;
  w: number;
  h: number;
  water: Uint8Array;
  /** the land's height per cell in metres: whole terraces, water below zero */
  height: Float32Array;
  /** what covers each cell: 0 none, 1 forest, 2 field, 3 street. Drawing data, water is always 0 */
  cover: Uint8Array;
  /** 0 free, 1 a site's yard cell, 2 a site's own cell: the cells a route may not cross */
  yardMask: Uint8Array;
  /** track links per cell: a bitmask of the eight directions that carry track out of the cell */
  track: Uint8Array;
  sites: Site[];
  stations: Station[];
  lines: Line[];
  trains: Train[];
  cash: number;
  /** sim seconds since the start */
  time: number;
  year: number;
  /** 0..1 through the year */
  yearFrac: number;
  month: number;
  /** income this year by good, and the upkeep paid so far this year */
  income: Record<Good, number>;
  upkeep: number;
  /** a year end waiting for the player's choice; the sim holds while it is set */
  yearEnd: YearEnd | null;
  /** every closed year: the cash at its end and its profit, for the ledger's chart */
  history: { year: number; cash: number; profit: number }[];
  /** choices taken, each once */
  perks: YearEndChoice[];
  /** loads of the goal good delivered at the goal site, for a deliver goal */
  goalCount: number;
  /** the scenario's end, set once */
  result: { won: boolean; year: number; cash: number; stars: number } | null;
  floats: Float[];
  sounds: string[];
  lastBuild: LastBuild | null;
  /** the first delivery that paid, in sim seconds, for the 90 s rule */
  firstPayAt: number | null;
  nextId: number;
}
