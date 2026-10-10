/** The goods so far: two chains, each raw to refined to town. Later eras add ore, iron, tar, coal, paper. */
export type Good = 'timber' | 'boards' | 'grain' | 'flour';
export const GOODS: Good[] = ['timber', 'boards', 'grain', 'flour'];

/** everything a wagon can carry: the goods (the name stays for the ledger's rows) */
export type Cargo = Good;
export const CARGOS: Cargo[] = GOODS;

/** what a tile shows on top of the land: drawing data only, the sim never reads it */
export type Cover = 'none' | 'forest' | 'field' | 'street';

export type SiteKind = 'forest' | 'sawmill' | 'farm' | 'mill' | 'town';

/** A wagon carries one family of goods: flat wagons timber, box wagons boards and flour, hoppers grain. A line's trains get the type of the good it carries. */
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
  /** a raw site's loads a month and the most its pile holds; the economy's RAW_RATE and RAW_CAP when left out */
  rawRate?: number;
  rawCap?: number;
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
  /** the last year a win may end in for two stars and for three (a win is one star) */
  stars: [number, number];
  /** the engines on sale */
  engines: EngineId[];
}

export interface Site extends SiteDef {
  /** the base rate and the pile cap, from the site's definition or the economy's defaults; 0 for a site that makes no raw goods */
  rawRate: number;
  rawCap: number;
  /** what the site holds of what it makes (a forest's timber, a sawmill's boards) */
  stock: number;
  /** a refinery's input: what it has taken in over the last months, per good, for the demand curve; decays. Towns use `store` */
  taken: Record<Good, number>;
  /** a town's store: loads of each good it holds, up to TOWN_STORE_CAP per size, eaten continuously. It sets the price, not the growth */
  store: Record<Good, number>;
  /** a town's growth so far towards its next size, in points: every load delivered adds to it, nothing takes it away (growNeed has the target) */
  growth: number;
  /** loads delivered here, all time */
  delivered: number;
  /** the sim time a load of each good last arrived here; minus infinity when none has */
  lastDelivery: Record<Good, number>;
  /** production rate per month, raised by frequent pickups */
  rate: number;
  /** sim time of the last pickup here, for the served-rate rule */
  lastPickup: number;
  /** a town's size, 1 to 5; 0 for other sites */
  size: number;
  /** the sim time a town last grew; minus infinity before */
  grewAt: number;
}

export interface Station {
  id: number;
  /** the cell, which is the site's cell */
  cell: number;
  siteId: string;
}

/**
 * A line: its own double track between two stations (ADR 0005). The trains run from one stop to the
 * other and back; trains in opposite directions pass, trains in one direction keep their gap.
 */
export interface Line {
  id: number;
  /** two stations, in order: the train runs from the first to the last and back */
  stops: number[];
  /** the cells from the first stop to the last */
  path: number[];
  /** cumulative distance along the path, in cells, per path index */
  dist: number[];
  /** the rail's height in metres per path index: the land, cut and filled to the grade limit */
  rail: number[];
  /** the path index of each stop: 0 and the last */
  stopAt: number[];
  /** the platform track the line has at each of its stops, 0 nearest the platform */
  slots: number[];
  /** the steepest step on the line, in percent */
  worst: number;
  /** pay earned and running cost paid by this line's trains this year, for the line card */
  earnedYear: number;
  runYear: number;
}

export type TrainState = 'run' | 'stop';

/** a load on one wagon: the good, and the distance along the line's path where it was loaded, for the pay */
export interface Load {
  good: Cargo;
  from: number;
}

export interface Train {
  id: number;
  lineId: number;
  engine: EngineId;
  /** the consist, front to back: each wagon its own type, one load each */
  wagons: WagonType[];
  /** how many wagons: `wagons.length`, kept so the pictures and the cards read it */
  nWagons: number;
  /** what each wagon carries now, null when empty */
  loads: (Load | null)[];
  /** +1 runs the path from the first stop towards the last; a standing train keeps the way it came in */
  dir: 1 | -1;
  /** the stop (an index into the line's stops) the train stands at, or left last */
  idx: number;
  /** the stop the train runs to */
  to: number;
  /** the middle of the train, as a distance along the line's path in cells */
  s: number;
  state: TrainState;
  /** seconds left at the station */
  stopLeft: number;
  /** loads on board: the wagons that are not empty */
  cargo: number;
  /** the station cell the train stands at, while it stops */
  at: number | null;
  /** the train is held behind another train of its line */
  queued: boolean;
  /** seconds the train has stood at a loading stop waiting for its wagons to fill */
  waited: number;
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
  /** running cost paid this year and last year */
  runYear: number;
  runLast: number;
  /** round trips finished, all time */
  trips: number;
  /** what the train is doing at the platform: a load or an unload in hand, or neither */
  dock: 'load' | 'unload' | null;
  /** seconds until the load now being moved is on board (or off it) */
  work: number;
  /** the wagon the load in hand belongs to, counted from the front; -1 when none */
  job: number;
  /** the demand a good paid at this stop when its first load came off, so the loads of one stop pay alike */
  quote: Partial<Record<Good, number>>;
  /** pay taken this stop, shown as one float when the unloading ends */
  paid: number;
}

export interface Float {
  x: number;
  y: number;
  text: string;
  age: number;
  kind: 'pay' | 'cost' | 'note' | 'grow' | 'house';
  /** seconds the float stays; 1.6 when missing */
  life?: number;
  /** a town that grew: the renderer words it in the player's language */
  grew?: { site: string; size: number };
}

/** The upgrades the pick offers. Each one changes the whole network from the moment it is taken. */
export type PerkId = 'wagon' | 'speed' | 'output' | 'loading' | 'track' | 'train' | 'cash' | 'fair';

/** the upgrades taken so far, as counts, and the free trains still to buy */
export interface Perks {
  taken: Record<PerkId, number>;
  freeTrains: number;
}

/** a pick on the table: two upgrades to choose one of; the sim holds while it is set */
export interface Pick {
  /** the pick's number, from 1 */
  n: number;
  options: [PerkId, PerkId];
  /** the cash the cash option gives, fixed when the pick is drawn */
  cash: number;
}

/** a closed year, for the ledger */
export interface YearEnd {
  year: number;
  income: Record<Cargo, number>;
  /** the year's costs: per tile run, engine upkeep, track upkeep, interest */
  running: number;
  engine: number;
  track: number;
  interest: number;
  /** running plus engine upkeep, the running costs the balance checks measure */
  upkeep: number;
  profit: number;
  cash: number;
  loan: number;
  worth: number;
  /** towns that grew during the year */
  grew: string[];
  /** every town's growth at the year end, 0..1 of the way to the next size, by site id */
  growth: Record<string, number>;
}

export interface LastBuild {
  cost: number;
  cells: number[];
  station: number | null;
  /** a line this build made */
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
  /** income this year by cargo */
  income: Record<Cargo, number>;
  /** running costs this year: tiles run plus engine upkeep (the split is in `running` and `engineUp`) */
  upkeep: number;
  running: number;
  engineUp: number;
  trackUp: number;
  /** what is owed, paid 8 % a year at the year end */
  loan: number;
  /** the build price of all track and stations standing; half of it counts in net worth */
  assets: number;
  /** what each cell of track cost to lay, for the refund when a line is lifted */
  paid: Float32Array;
  /** year ends in a row with cash below zero and the loan at its ceiling */
  broke: number;
  /** the last closed year, for the ledger; the year end does not hold the game */
  lastYear: YearEnd | null;
  /** every closed year: the cash at its end and its profit, for the ledger's chart */
  history: { year: number; cash: number; profit: number; worth: number; loan: number }[];
  /** the upgrade pick waiting for the player's choice; the sim holds while it is set */
  pick: Pick | null;
  /** the sim time the next pick comes; Infinity until the first train runs */
  nextPickAt: number;
  /** picks drawn so far */
  picks: number;
  /** the upgrades taken */
  perks: Perks;
  /** loads of the goal good delivered at the goal site, for a deliver goal */
  goalCount: number;
  /** the scenario's end, set once */
  result: { won: boolean; year: number; cash: number; worth: number; stars: number; reason: 'goal' | 'time' | 'bankrupt'; /** sim seconds played */ time: number } | null;
  /** towns that grew since the last year end, site ids */
  grewYear: string[];
  floats: Float[];
  sounds: string[];
  lastBuild: LastBuild | null;
  /** the first delivery that paid, in sim seconds, for the 90 s rule */
  firstPayAt: number | null;
  nextId: number;
}
