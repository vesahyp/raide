/** The goods so far: two chains, each raw to refined to town. Later eras add ore, iron, tar, coal, paper. */
export type Good = 'timber' | 'boards' | 'grain' | 'flour';
export const GOODS: Good[] = ['timber', 'boards', 'grain', 'flour'];

/** What travellers and the post are: carried by coaches and mail vans, paid by distance and time, never stored in a town */
export type Fare = 'pax' | 'mail';
export const FARES: Fare[] = ['pax', 'mail'];
/** everything a wagon can carry */
export type Cargo = Good | Fare;
export const CARGOS: Cargo[] = [...GOODS, ...FARES];

/** what a tile shows on top of the land: drawing data only, the sim never reads it */
export type Cover = 'none' | 'forest' | 'field' | 'street';

export type SiteKind = 'forest' | 'sawmill' | 'farm' | 'mill' | 'town';

/** A wagon carries one family of goods: flat wagons timber, box wagons boards and flour, hoppers grain; coaches travellers, mail vans the post. */
export type WagonType = 'flat' | 'box' | 'hopper' | 'coach' | 'mailvan';

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
  /** net worth at the end for two and for three stars */
  stars: [number, number];
  /** the engines on sale */
  engines: EngineId[];
}

export interface Site extends SiteDef {
  /** what the site holds of what it makes (a forest's timber, a sawmill's boards) */
  stock: number;
  /** a refinery's input: what it has taken in over the last months, per good, for the demand curve; decays. Towns use `store` */
  taken: Record<Good, number>;
  /** a town's store: loads of each good it holds, up to TOWN_STORE_CAP per size, eaten continuously */
  store: Record<Good, number>;
  /** a town's growth meter, 0..1: it grows when the meter is full */
  growth: number;
  /** travellers and mail waiting at a town's station, by the id of the town they want to reach; whole numbers are loads a coach or a van can take */
  pax: Record<string, number>;
  mail: Record<string, number>;
  /** travellers who arrived at this town in the month so far, for the town card */
  arrived: number;
  /** the sim time the last travellers arrived, for the growth rule; minus infinity when none have */
  lastArrival: number;
  /** loads delivered here, all time */
  delivered: number;
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
  /** the platform tracks: trains at the station at once; more arrive and wait on their line */
  platforms: number;
  /** the crane is bought: timber, boards and grain load and unload twice as fast here; it needs the crew */
  crane: boolean;
}

/** a passing siding on a line: a loop beside the track between two distances along the path */
export interface Siding {
  /** where the loop's points are, as distances along the line's path in cells; s0 < s1 */
  s0: number;
  s1: number;
  /** the side of the track the loop lies on, a unit vector in cells */
  nx: number;
  ny: number;
}

/**
 * One stretch of a line between two neighbouring stops. The track itself is the line's path; a leg
 * marks which part of it, and keeps its own block, so a train can run one leg while another runs the next.
 */
export interface Leg {
  /** the path indexes of the leg's two stations, a < b */
  a: number;
  b: number;
  /** the block: the cells between the two stations. One running train at a time on any of them */
  block: Set<number>;
  /** the steepest step on this leg, in percent */
  worst: number;
}

export interface Line {
  id: number;
  /** two to four stations, in order: the train runs from the first to the last and back */
  stops: number[];
  /** the cells from the first stop to the last, the legs' tracks laid end to end */
  path: number[];
  /** cumulative distance along the path, in cells, per path index */
  dist: number[];
  /** the rail's height in metres per path index: the land, cut and filled to the grade limit */
  rail: number[];
  /** the path index of each stop */
  stopAt: number[];
  /** the stretches between neighbouring stops, one fewer than the stops */
  legs: Leg[];
  /** the steepest step on the line, in percent */
  worst: number;
  /** the passing siding, when the line has one (only a two-stop line can): it splits the block in two */
  siding: Siding | null;
  /** pay earned and running cost paid by this line's trains this year, for the line card */
  earnedYear: number;
  runYear: number;
}

export type TrainState = 'run' | 'stop';

/**
 * a load on one wagon: the cargo, and the distance along the line's path where it was loaded, for the
 * pay. Travellers and mail also keep the sim time they boarded (the pay falls with the trip's time)
 * and the town they want to reach.
 */
export interface Load {
  good: Cargo;
  from: number;
  at?: number;
  to?: string;
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
  /** the train waits at a loading stop until every wagon is full */
  fullLoad: boolean;
  /** +1 runs the path from the first stop towards the last */
  dir: 1 | -1;
  /** the stop (an index into the line's stops) the train stands at, or left last */
  idx: number;
  /** the leading end of the train, as a distance along the line's path in cells */
  s: number;
  state: TrainState;
  /** seconds left at the station */
  stopLeft: number;
  /** loads on board: the wagons that are not empty */
  cargo: number;
  /** the station cell the train stands at, while it stops */
  at: number | null;
  /** the train waits on its line before a station whose platforms are all taken; it moves on when one is free */
  queued: boolean;
  /** a train the line has no platform for: it stands on a siding beside the station and runs when one is free */
  parked: boolean;
  /** the train may take a siding track at the station it runs to when every platform is taken: the dispatcher's way out of a standstill */
  siding: boolean;
  /**
   * where the train is at the line's passing siding: 0 not yet there, 1 passing straight through,
   * 2 in the loop (moving in, held there, or moving out), 3 past it
   */
  loop: 0 | 1 | 2 | 3;
  /** seconds the train has stood ready to leave and been held by the block: the longest waiter goes first */
  gate: number;
  /** seconds the train has waited for a platform ahead of it */
  waited: number;
  /** the train has been given the platform it runs to; before that it may have to wait */
  claimed: boolean;
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
  kind: 'pay' | 'cost' | 'note' | 'grow';
  /** seconds the float stays; 1.6 when missing */
  life?: number;
  /** a town that grew: the renderer words it in the player's language */
  grew?: { site: string; size: number };
  /** a siding could not be laid because a train runs over the place: the renderer words it */
  busy?: boolean;
  /** a contract that was lost: the renderer words it in the player's language */
  lost?: { site: string; good: Good };
}

/** A contract: loads of a good to a site by the end of a year, for a reward on top of the loads' own pay. */
export interface Contract {
  id: number;
  site: string;
  good: Good;
  count: number;
  /** loads delivered since it was taken */
  got: number;
  /** the contract ends with this year */
  deadline: number;
  /** paid when the count is reached */
  reward: number;
}

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
  /** the contracts that ran out unfulfilled at this year end */
  lost: Contract[];
  /** the rewards paid this year */
  bonus: number;
  /** towns that grew during the year */
  grew: string[];
  /** every town's growth meter at the year end, 0..1, by site id */
  growth: Record<string, number>;
}

export interface LastBuild {
  cost: number;
  cells: number[];
  station: number | null;
  /** a line this build made */
  line: number | null;
  /** a line this build lengthened: how it was, and how far the trains' distances moved when the new stop went in front */
  extend: { lineId: number; before: Pick<Line, 'stops' | 'path' | 'dist' | 'rail' | 'stopAt' | 'legs' | 'worst'>; shift: number } | null;
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
  /** income this year by cargo, and the costs paid so far this year */
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
  /** a year end waiting for the player's choice; the sim holds while it is set */
  yearEnd: YearEnd | null;
  /** every closed year: the cash at its end and its profit, for the ledger's chart */
  history: { year: number; cash: number; profit: number; worth: number; loan: number }[];
  /** the contract on offer at the year end card, taken or skipped when the card closes */
  offer: Contract | null;
  /** contracts taken and not yet done or lost, two at most */
  contracts: Contract[];
  /** rewards of finished contracts this year, paid into cash */
  bonus: number;
  /** loads of the goal good delivered at the goal site, for a deliver goal */
  goalCount: number;
  /** the scenario's end, set once */
  result: { won: boolean; year: number; cash: number; worth: number; stars: number; reason: 'goal' | 'time' | 'bankrupt' } | null;
  /** towns that grew since the last year end, site ids */
  grewYear: string[];
  floats: Float[];
  sounds: string[];
  lastBuild: LastBuild | null;
  /** the first delivery that paid, in sim seconds, for the 90 s rule */
  firstPayAt: number | null;
  nextId: number;
}
