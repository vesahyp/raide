/** The goods of the first slice. Later chains add ore, iron, grain, flour, tar, coal, paper. */
export type Good = 'timber' | 'boards';

export type SiteKind = 'forest' | 'sawmill' | 'town';

/** A wagon carries one family of goods: flat wagons take timber, box wagons take boards. */
export type WagonType = 'flat' | 'box';

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
}

export interface ScenarioDef {
  id: string;
  name: Text;
  /** map size in cells; the grid the player never sees, eight directions */
  w: number;
  h: number;
  /** water cells, as cell indexes */
  water: number[];
  sites: SiteDef[];
  /** the station the player starts with, a site id */
  startStation: string;
  cash: number;
  startYear: number;
  /** the goal: deliver this many loads of the good to the site, before the year */
  goal: { good: Good; site: string; count: number; beforeYear: number };
}

export interface Site extends SiteDef {
  /** what the site holds of what it makes (a forest's timber, a sawmill's boards) */
  stock: number;
  /** what it has taken in over the last months, for the demand curve; decays */
  taken: number;
  /** loads delivered here, all time */
  delivered: number;
  /** production rate per month, raised by frequent pickups */
  rate: number;
  /** sim time of the last pickup here, for the served-rate rule */
  lastPickup: number;
}

export interface Station {
  id: number;
  /** the cell, which is the site's cell */
  cell: number;
  siteId: string;
}

export interface Line {
  id: number;
  /** two stations for now: the train runs forward and back */
  stops: [number, number];
  /** the cells from the first stop to the second */
  path: number[];
  /** cumulative distance along the path, in cells, per path index */
  dist: number[];
  /** the block: the cells between the two stations. One running train at a time on any of them */
  block: Set<number>;
}

export type TrainState = 'run' | 'stop';

export interface Train {
  id: number;
  lineId: number;
  wagons: WagonType;
  nWagons: number;
  /** +1 runs the path from stop 0 to stop 1 */
  dir: 1 | -1;
  /** the leading end of the train, as a distance along the line's path in cells */
  s: number;
  state: TrainState;
  /** seconds left at the station */
  stopLeft: number;
  /** loads on board, of the wagons' good */
  cargo: number;
  /** the station cell the train stands at, while it stops */
  at: number | null;
  /** where the train is stacked at its station, so two at one platform draw side by side */
  slot: number;
  /** cells per second, the engine's */
  speed: number;
  /** for the smoke and the wheels: distance run */
  odometer: number;
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
  /** choices taken, each once */
  perks: YearEndChoice[];
  /** loads of the goal good delivered at the goal site */
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
