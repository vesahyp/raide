/**
 * The map, top down in Canvas 2D (ADR 0003), in the look of docs/mockups/topdown/scene.html.
 *
 * One tile is a cell of the sim, 100 m. The land is whole terraces of 10 m: a tile's top is
 * lifted by its level, and a lower tile to the south shows the terrace's front face. A track
 * cell is drawn at its rail height, so a cutting or an embankment is a few steps in the land.
 *
 * The static layers (land, faces, track, trees, the yard buildings) are drawn once per chunk of
 * 16 by 16 tiles into a canvas of their own at a cached scale, and drawn to the screen scaled in
 * between. What changes (piles, trains, smoke, sails, the route under the finger) is drawn on
 * top every frame. Under 9 px a tile the whole map is one canvas in a simpler look.
 *
 * Text and chips are HTML in the overlay div, placed each frame by projecting tile points, so
 * they stay crisp at any zoom.
 */
import type { Good, Line, SimState, Site, Train } from '../game/types';
import type { Route } from '../game/grid';
import { DIRS, cx, cy, gradeOf, idx, stepLen } from '../game/grid';
import { GRADE_COL, bestTrips, earthWord, gradeText, perYear, routeKm, tripsByEngine } from '../ui/routeinfo';
import { plan, along, lineOf, railAlong, trainLength, price, demand, SLOTS_MAX, workingWagon } from '../game/sim';
import { Clouds } from './clouds';
import { planTown, secondStreet, type TownItem } from './town';
import { ENGINE_LEN, WAGON_LEN, MAKES, TAKES, RAW_CAP, RAW_RATE, DEMAND_FLOOR, TERRACE_M, yard } from '../game/content/economy';
import { t as tt } from '../i18n';
import {
  GRASS, LIFT, OUT, boardStack, bridgeDeck, bridgeRails, building, birch, bufferStop, drawEngine, drawWagon, hash, logPile, makeView, pine,
  crew, platform, sacks, sails, shade, trackCell, trackLine, windmillBody, type Ctx, type Spoke, type View,
} from './draw2d';

export const OPTION_COLOUR = ['rgba(239,230,207,0.95)', 'rgba(70,150,230,0.95)'];


export interface Hint {
  from: number;
  to: number;
}

export interface DragView {
  route: Route | null;
  /** the routes the lift would offer: one, or the cheap one and the way round */
  options?: Route[];
  from: number;
  sx: number;
  sy: number;
  ok: boolean;
  loose: boolean;
  /** the cell the finger is on or snapped to */
  to: number | null;
}

/** tiles in a chunk's side */
const CH = 16;
/** margins of a chunk's canvas in tiles: above for terrace lift and tall sprites, below, and at the sides */
const TOPM = 4.5;
const BOTM = 1.5;
const SIDE = 1.2;
/** water is drawn a little below the shore, in terraces */
const WATER_LV = -0.4;
/** under this many px a tile the whole-map look is drawn */
const LOD_S = 9;
const MAX_S = 64;
const PLAY_S = 23;
/** the four zoom levels, close up, play, route and the whole map (the last is worked out) */
const ZOOMS = [56, PLAY_S, 15];
const CHUNK_KEEP = 80;
/** px kept free beside the two stations when the first view is framed */
const FIT_PAD = 78;
/**
 * The tracks of a station. Every line runs its last APPROACH cells straight along the station's
 * row, so the platform tracks can lie parallel to it, 0.8 tile apart and south of the platform:
 * track 0 is the line's own; track 1 leaves it in a switch far out (`FAN1`), and track 2 leaves
 * track 1 in a second one nearer in (`FAN2`), both as distances along the row from the station's centre. Where no line comes in, the tracks run
 * on to a buffer stop `STUB` from the centre. A train stands centred on the station.
 */
const SLOT_GAP = 0.8;
const FAN1: [number, number] = [5.6, 7.2];
const FAN2: [number, number] = [4.0, 5.6];
const STUB = 4.5;
const smooth01 = (t: number): number => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

/** how far south of the station's row platform track k lies at a distance q along the row from the station's centre */
export function slotOffset(k: number, q: number): number {
  const d = Math.abs(q);
  let off = 0;
  if (k >= 1) off += SLOT_GAP * (1 - smooth01((d - FAN1[0]) / (FAN1[1] - FAN1[0])));
  if (k >= 2) off += SLOT_GAP * (1 - smooth01((d - FAN2[0]) / (FAN2[1] - FAN2[0])));
  return off;
}

/** the platform tracks of one station, from the lines that end there and the trains that stand there */
interface Apron {
  cell: number;
  x: number;
  y: number;
  /** a line comes in from the west, and from the east */
  west: boolean;
  east: boolean;
  /** the number of platform tracks drawn: the lines, and the most trains seen standing at once, three at most */
  k: number;
}
/** the chunk canvases may hold this many pixels in all, so a phone keeps its memory */
const CHUNK_PIXELS = 42e6;
/** px a tile in the whole-map canvas */
const OV = 10;
const SMOKE_LIFE = 2.2;
/** the round brass badge beside a station's name: two rails and sleepers, track starts here */
const RAIL_BADGE = '<span class="rail"><svg viewBox="0 0 24 24"><g stroke="#2a2010" stroke-linecap="round"><path d="M8.5 3 V21 M15.5 3 V21" stroke-width="2.4"/><path d="M5.5 6.5 H18.5 M5.5 11 H18.5 M5.5 15.5 H18.5 M5.5 20 H18.5" stroke-width="2"/></g></svg></span>';


interface Chunk {
  canvas: HTMLCanvasElement;
  /** device px a tile it was drawn at */
  rs: number;
  ver: number;
  used: number;
  px: number;
}

interface Obj {
  oy: number;
  ox0: number;
  ox1: number;
  draw: (v: View) => void;
}

interface TreeObj {
  oy: number;
  x: number;
  y: number;
  r: number;
  birch: boolean;
  lv: number;
}

interface SiteLook {
  site: Site;
  /** the yard's flat level in terraces */
  lv: number;
  statics: Obj[];
  /** where the windmill's hub is, if there is one */
  hub: { x: number; y: number } | null;
  stationKey: number;
}

interface PileLayer {
  key: string;
  qi: number;
  rs: number;
  canvas: HTMLCanvasElement;
}

/** the nodes of one site label or badge that change between frames */
/** one wants chip: its nodes, and what it has shown so far, so a delivery can be seen landing */
interface WantRefs {
  good: Good;
  b: HTMLElement;
  i: HTMLElement;
  chip: HTMLElement;
  /** the loads taken in the last time the chip looked, to see a delivery land */
  taken: number;
  /** the price the chip shows now, and the time its text was last written */
  price: number;
  at: number;
  /** the old and the new price, shown as "23 → 19" until this time */
  change: { from: number; to: number; until: number } | null;
  /** the bar width in percent now */
  bar: number;
}

/** a town's buildings for all sizes, how many are standing, and the rise of the next ones */
interface TownState {
  items: TownItem[];
  shown: number;
  /** the count when the rise began, and the time the first one starts; null when nothing is rising */
  from: number;
  start: number | null;
  dusted: number;
}

/** seconds between one new building starting to rise and the next, and how long one takes */
const RISE_STEP = 0.5;
const RISE_TIME = 0.6;
/** seconds the dust of a new house hangs */
const DUST_TIME = 0.9;

interface TagRefs {
  key: string;
  has: { b: HTMLElement; i: HTMLElement } | null;
  wants: WantRefs[];
  /** a badge's count on a raw site */
  n: HTMLElement | null;
}

interface TagPlace {
  id: string;
  el: HTMLElement;
  x: number;
  y: number;
  k: number;
  w: number;
  h: number;
}

interface Puff {
  x: number;
  y: number;
  lv: number;
  up: number;
  age: number;
}

interface Veh {
  t: Train;
  i: number;
  px: number;
  py: number;
  /** the middle of the vehicle in tiles */
  wx: number;
  wy: number;
  ang: number;
  len: number;
}

const qIndex = (dev: number): number => Math.round(Math.log(dev / 4) / Math.log(1.25));

export class Renderer2D {
  private ctx: Ctx;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** the camera: the tile at the middle of the free area of the screen, and px a tile */
  private cam = { x: 0, y: 0, s: PLAY_S };
  private zoomTo: number | null = null;
  /** a tile point the view eases to, with the zoom */
  private glide: { x: number; y: number } | null = null;
  private followId: number | null = null;
  private time = 0;
  private frames = 0;

  // the land, as flat arrays
  private lvA: Float32Array;
  private jA: Float32Array;
  private railA: Float32Array;
  private kindA: Uint8Array;
  private terrA: Uint8Array;
  private nearTrack: Uint8Array;
  private sigKey = -1;
  private looks: SiteLook[] = [];
  /** the platform tracks of every station, and the most platform tracks each has needed */
  private aprons: Apron[] = [];
  private apronAt = new Map<number, Apron>();
  private kSeen = new Map<number, number>();
  /** the pillars drawn this frame, by site, so the HTML labels keep clear of their bright foot */
  /** the cloud cover that fades in when the map is zoomed out */
  private clouds: Clouds;
  private pillars = new Map<string, { w: number; h: number; lod: boolean }>();
  private statics = new Map<number, Obj[]>();
  private chunks = new Map<string, Chunk>();
  private chunkPixels = 0;
  private chunkVer = new Map<number, number>();
  private overview: HTMLCanvasElement | null = null;
  private overviewDirty = true;
  private piles = new Map<string, PileLayer>();
  private puffs = new Map<number, { list: Puff[]; last: number }>();
  private scaleStamp = 0;
  private frameStamp = 0;

  // the overlay
  private labels = new Map<string, HTMLElement>();
  /** what a drag from one station can reach: the cheapest cost by site cell, null when no route; worked out once per drag */
  private targets: { key: string; from: number; cost: Map<number, number | null> } | null = null;
  /** the site card's "lay track from here": the marks are shown as for a drag, from this cell; `reverse` marks the stations that can reach this site instead */
  laying: { from: number; reverse: boolean } | null = null;
  /** the view the player had when pick mode began, and whether the zoom to fit the marks is still to be worked out */
  private pickView: { x: number; y: number; s: number } | null = null;
  private pickFitDue = false;
  /** what each site's label was built from, and the nodes its numbers live in, so a frame only sets text and widths */
  private tags = new Map<string, TagRefs>();
  /** each town's buildings and how many of them stand: the rest rise one by one when the town grows */
  private towns = new Map<string, TownState>();
  /** the dust under a house that is going up */
  private dust: { x: number; y: number; lv: number; t0: number }[] = [];
  /** the labels placed this frame, laid out together so none covers another */
  private tagQueue: TagPlace[] = [];
  /** the whole-map badges placed this frame, nudged down where two would overlap */
  private badgeQueue: { el: HTMLElement; x: number; y: number }[] = [];
  /** where each site tag stands on the screen now, for a tap on a label */
  private tagBox = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  private floatEls = new Map<object, HTMLElement>();
  private hintEl: HTMLElement | null = null;
  private plateEl: HTMLElement | null = null;
  private pillEl: HTMLElement | null = null;

  // the frame timer for ?fps=1
  private logFps = new URLSearchParams(location.search).get('fps') === '1';
  private lastDraw = 0;
  private frameMs = 0;
  private drawMs = 0;
  private frameN = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLElement,
    private s: SimState,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const n = s.w * s.h;
    this.lvA = new Float32Array(n);
    this.jA = new Float32Array(n);
    this.railA = new Float32Array(n);
    this.kindA = new Uint8Array(n);
    this.terrA = new Uint8Array(n);
    this.nearTrack = new Uint8Array(n);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) this.jA[y * s.w + x] = hash(x * 7 + 1, y * 13 + 5);
    this.clouds = new Clouds(s.w, s.h, s.scenario.id);
    this.rebuildLand();
    this.resize();
    this.fit();
  }

  dispose(): void {
    this.overlay.innerHTML = '';
    this.chunks.clear();
    this.piles.clear();
    this.overview = null;
  }

  // ------------------------------------------------------------------ the land

  /** the land's draw height in terraces: the rail on a track cell, the water a little low */
  private levelAt(x: number, y: number): number {
    const s = this.s;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= s.w || iy >= s.h) return 0;
    return this.lvA[iy * s.w + ix];
  }

  /** the land's height in metres at a point in tiles, with the rail height on track cells */
  groundAt(x: number, y: number): number {
    return this.levelAt(x, y) * TERRACE_M;
  }

  /** what the sim says about each cell, as arrays the drawing reads; run again when a line or a station changes */
  private rebuildLand(): void {
    const s = this.s;
    const n = s.w * s.h;
    this.railA.fill(NaN);
    for (const l of s.lines) l.path.forEach((c, k) => Number.isNaN(this.railA[c]) && (this.railA[c] = l.rail[k] / TERRACE_M));
    for (let i = 0; i < n; i++) {
      const water = !!s.water[i];
      const rail = this.railA[i];
      this.lvA[i] = water ? WATER_LV : Number.isNaN(rail) ? s.height[i] / TERRACE_M : rail;
      this.kindA[i] = water ? 1 : s.cover[i] === 3 ? 2 : s.cover[i] === 2 ? 3 : s.cover[i] === 1 ? 4 : 0;
      this.terrA[i] = Math.max(0, Math.min(3, Math.round(water ? 0 : this.lvA[i])));
    }
    // a town's second street is laid when the town reaches size 3
    for (const site of s.sites) {
      if (site.kind !== 'town') continue;
      const t = this.townState(site);
      const k = t.items.findIndex((o) => o.kind === 'street');
      if (k >= t.shown) for (const i of secondStreet(s, site)) this.kindA[i] = 0;
    }
    this.nearTrack.fill(0);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++)
        if (s.track[y * s.w + x])
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < s.w && y + dy < s.h) this.nearTrack[(y + dy) * s.w + x + dx] = 1;
    // no tree grows on the platform tracks of a station
    for (const a of this.aprons)
      for (let y = a.y - 1; y <= a.y + 3; y++) for (let x = a.x - 6; x <= a.x + 6; x++) if (x >= 0 && y >= 0 && x < s.w && y < s.h) this.nearTrack[y * s.w + x] = 1;
  }

  /** a number that changes when a line, a station or a town's size does */
  private signature(): number {
    const s = this.s;
    let h = 17;
    for (const l of s.lines) h = (Math.imul(h, 31) + l.id) | 0;
    for (const st of s.stations) h = (Math.imul(h, 37) + st.id * 8 + this.platformsNeeded(st.cell) + (st.crew ? 1000003 : 0)) | 0;
    for (const site of s.sites) h = (Math.imul(h, 41) + (site.kind === 'town' ? this.townState(site).shown : 0)) | 0;
    return h;
  }

  /** the chunks a rectangle of tiles touches are drawn again */
  private dirty(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.s;
    const nx = Math.ceil(s.w / CH);
    for (let cj = Math.max(0, Math.floor((y0 - 1) / CH)); cj <= Math.min(Math.ceil(s.h / CH) - 1, Math.floor((y1 + 1) / CH)); cj++)
      for (let ci = Math.max(0, Math.floor((x0 - 3) / CH)); ci <= Math.min(nx - 1, Math.floor((x1 + 3) / CH)); ci++) this.chunkVer.set(cj * nx + ci, (this.chunkVer.get(cj * nx + ci) ?? 0) + 1);
  }

  /** follow the sim's lines and stations: the arrays, the yards, the chunks that changed */
  private sync(): void {
    const sig = this.signature();
    if (sig === this.sigKey) return;
    const first = this.sigKey === -1;
    this.sigKey = sig;
    const s = this.s;
    const before = this.lvA.slice();
    const links = s.track.slice();
    this.aprons = this.computeAprons();
    this.apronAt = new Map(this.aprons.map((a) => [a.cell, a]));
    this.rebuildLand();
    if (!first) {
      // the cells whose height, or whose track, differ from the last drawing
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < this.lvA.length; i++)
        if (before[i] !== this.lvA[i] || links[i] !== this.lastTrack?.[i]) {
          const x = i % s.w;
          const y = (i / s.w) | 0;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      if (x1 >= 0) this.dirty(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    }
    this.lastTrack = s.track.slice();
    const oldKeys = new Map(this.looks.map((l) => [l.site.id, l.stationKey]));
    this.layoutYards();
    for (const l of this.looks) if (first || oldKeys.get(l.site.id) !== l.stationKey) this.dirtyYard(l.site);
    this.overviewDirty = true;
  }
  private lastTrack: Uint8Array | null = null;

  private dirtyYard(site: Site): void {
    const r = yard(site.kind);
    this.dirty(Math.min(site.cx + r.dx0 - 2, site.cx - 8), site.cy + r.dy0 - 2, Math.max(site.cx + r.dx1 + 2, site.cx + 8), site.cy + 4);
  }

  /** the platform tracks the station at a cell needs now: one for each line that ends there, more while trains stand together */
  private platformsNeeded(cell: number): number {
    const s = this.s;
    let k = 0;
    for (const l of s.lines) if (l.path[0] === cell || l.path[l.path.length - 1] === cell) k++;
    for (const t of s.trains) for (const [c, slot] of this.slotCells(t)) if (c === cell) k = Math.max(k, slot + 1);
    k = Math.max(1, Math.min(SLOTS_MAX, k));
    const seen = Math.max(k, this.kSeen.get(cell) ?? 0);
    this.kSeen.set(cell, seen);
    return seen;
  }

  /** the stations a train uses a platform track at now: where it stands, or where it runs to and where it left */
  private slotCells(t: Train): [number, number][] {
    const line = lineOf(this.s, t);
    const a = line.path[0];
    const b = line.path[line.path.length - 1];
    if (t.state === 'stop') return [[t.at ?? a, t.slot]];
    return t.dir === 1 ? [[b, t.slot], [a, t.slotFrom]] : [[a, t.slot], [b, t.slotFrom]];
  }

  private computeAprons(): Apron[] {
    const s = this.s;
    return s.stations.map((st) => {
      const x = cx(s, st.cell);
      const y = cy(s, st.cell);
      let west = false;
      let east = false;
      for (const l of s.lines) {
        const n = l.path.length;
        if (l.path[0] === st.cell) (l.path[1] === st.cell - 1 ? (west = true) : (east = true));
        if (l.path[n - 1] === st.cell) (l.path[n - 2] === st.cell - 1 ? (west = true) : (east = true));
      }
      return { cell: st.cell, x, y, west, east, k: this.platformsNeeded(st.cell) };
    });
  }

  /** how far south of the station's row platform track k lies at a world x: it follows the switches on the sides a line comes in from */
  private platformY(a: Apron, k: number, x: number): number {
    const u = x - (a.x + 0.5);
    const side = u < 0 ? a.west : a.east;
    return slotOffset(k, side ? u : 0);
  }

  // ------------------------------------------------------------------ the yards

  private layoutYards(): void {
    const s = this.s;
    this.looks = s.sites.map((site) => {
      const station = s.stations.some((st) => st.siteId === site.id);
      const ap = this.apronAt.get(idx(s, site.cx, site.cy));
      const look: SiteLook = { site, lv: s.height[site.cy * s.w + site.cx] / TERRACE_M, statics: [], hub: null, stationKey: (station ? 1 : 0) + (site.kind === 'town' ? this.townState(site).shown * 2 : 0) + (ap ? 100 * ap.k + (ap.west ? 1000 : 0) + (ap.east ? 2000 : 0) : 0) + (s.stations.find((st) => st.siteId === site.id)?.crew ? 5000 : 0) };
      this.layoutSite(look, station);
      return look;
    });
    this.statics.clear();
    const nx = Math.ceil(s.w / CH);
    for (const look of this.looks)
      for (const o of look.statics) {
        const row = Math.floor(o.oy);
        const cj = Math.floor(row / CH);
        for (let ci = Math.floor((o.ox0 - 3) / CH); ci <= Math.floor((o.ox1 + 3) / CH); ci++) {
          if (ci < 0 || ci >= nx || cj < 0) continue;
          const k = cj * nx + ci;
          let list = this.statics.get(k);
          if (!list) this.statics.set(k, (list = []));
          list.push(o);
        }
      }
  }

  private layoutSite(look: SiteLook, station: boolean): void {
    const { site, lv } = look;
    const x = site.cx;
    const y = site.cy;
    const add = (oy: number, ox0: number, ox1: number, draw: (v: View) => void) => look.statics.push({ oy, ox0, ox1, draw });
    const bld = (bx: number, by: number, w: number, d: number, o: Omit<Parameters<typeof building>[5], 'lv'>) => add(by + d, bx, bx + w, (v) => building(v, bx, by, w, d, { ...o, lv }));
    if (station) {
      // the station building stands at the platform's east end, inside the yard so no track can cross it
      add(y - 0.1, x - 3, x + 4, (v) => platform(v, x - 3, y - 0.58, 7, lv));
      if (this.s.stations.find((st) => st.siteId === site.id)?.crew) add(y - 0.05, x - 3, x, (v) => crew(v, x - 2.6, y - 0.28, lv));
      bld(x + 1.3, y - 1.5, 2.6, 0.9, { walls: '#d9a441', roof: '#7a3a2a', wall: 0.6, door: 1 });
    }
    if (site.kind === 'forest') {
      bld(x - 2.9, y - 2.1, 1.7, 1.2, { walls: '#9c3a2c', roof: '#4a3a32', wall: 0.6, door: 0 });
    } else if (site.kind === 'sawmill') {
      bld(x - 3, y - 3.9, 4.4, 1.3, { walls: '#9b3226', roof: '#6d6a66', wall: 1.0, door: 2, chimney: [x - 2.2, y - 3.6] });
    } else if (site.kind === 'farm') {
      bld(x - 2.8, y - 3.9, 3.2, 1.9, { walls: '#9c3a2c', roof: '#4e4a44', wall: 1.0, door: 1 });
      bld(x + 1.2, y - 3.9, 1.8, 1.4, { walls: '#e6dcc4', roof: '#7a3a2a', wall: 0.7, door: 0 });
    } else if (site.kind === 'mill') {
      add(y - 1.1, x - 3, x, (v) => windmillBody(v, x - 1.9, y - 1.6, lv));
      look.hub = { x: x - 1.9, y: y - 1.6 - 0.9 / 1 };
      bld(x + 2.4, y - 3.9, 1.5, 1.3, { walls: '#e6dcc4', roof: '#5d4a3c', wall: 0.7, door: 0 });
    } else if (site.kind === 'town') {
      this.layoutTown(look, add);
    }
  }

  /** a town's buildings, laid out the first time they are asked for; a town starts with all it has for its size */
  private townState(site: Site): TownState {
    let t = this.towns.get(site.id);
    if (!t) {
      const items = planTown(this.s, site, this.s.height[site.cy * this.s.w + site.cx] / TERRACE_M);
      t = { items, shown: this.targetOf(items, site), from: 0, start: null, dusted: 0 };
      this.towns.set(site.id, t);
    }
    return t;
  }

  /** how many of a town's buildings its size calls for */
  private targetOf(items: TownItem[], site: Site): number {
    let n = 0;
    while (n < items.length && items[n].minSize <= site.size) n++;
    return n;
  }

  private layoutTown(look: SiteLook, add: (oy: number, ox0: number, ox1: number, draw: (v: View) => void) => void): void {
    const t = this.townState(look.site);
    for (let i = 0; i < t.shown; i++) {
      const o = t.items[i];
      if (o.kind !== 'street') add(o.oy, o.ox0, o.ox1, o.draw);
    }
  }

  /**
   * A town that grew builds its new houses over the first seconds of the next year, one after the
   * other (the ledger holds them back while it is open). A building that has risen joins the
   * cached chunks; one on its way up is drawn live by drawRising.
   */
  private growTowns(): void {
    const s = this.s;
    for (const site of s.sites) {
      if (site.kind !== 'town') continue;
      const t = this.townState(site);
      const target = this.targetOf(t.items, site);
      if (t.shown > target) t.shown = target;
      if (t.shown >= target || s.yearEnd) {
        if (t.shown >= target) t.start = null;
        continue;
      }
      if (t.start === null) {
        t.start = this.time + 0.4;
        t.from = t.shown;
        t.dusted = t.shown;
      }
      const startOf = (k: number): number => t.start! + (k - t.from) * RISE_STEP;
      for (let k = t.dusted; k < target && this.time >= startOf(k) + 0.1; k++, t.dusted++) {
        const o = t.items[k];
        if (o.kind !== 'street') this.dust.push({ x: o.x + o.w / 2, y: o.y + o.d, lv: s.height[site.cy * s.w + site.cx] / TERRACE_M, t0: startOf(k) + 0.1 });
      }
      while (t.shown < target && this.time >= startOf(t.shown) + RISE_TIME) t.shown++;
    }
    this.dust = this.dust.filter((d) => this.time - d.t0 < DUST_TIME);
  }

  /** the buildings on their way up: scaled from 0.6 with a little rise, and a puff of dust at the foot */
  private drawRising(): void {
    const c = this.ctx;
    const S = this.cam.s;
    const v = makeView(c, S, this.cam.x - this.ox / S, this.cam.y - this.oy / S);
    for (const site of this.s.sites) {
      if (site.kind !== 'town') continue;
      const t = this.townState(site);
      if (t.start === null) continue;
      const lv = this.s.height[site.cy * this.s.w + site.cx] / TERRACE_M;
      const target = this.targetOf(t.items, site);
      for (let k = t.shown; k < target; k++) {
        const o = t.items[k];
        if (o.kind === 'street') continue;
        const p = Math.min(1, (this.time - (t.start + (k - t.from) * RISE_STEP)) / RISE_TIME);
        if (p <= 0) continue;
        const e = 1 - (1 - p) * (1 - p);
        const k0 = 0.6 + 0.4 * e;
        const bx = this.sx(o.x + o.w / 2);
        const by = this.sy(o.y + o.d, lv);
        c.save();
        c.globalAlpha = Math.min(1, p * 2.5);
        c.translate(bx, by + (1 - e) * S * 0.3);
        c.scale(k0, k0);
        c.translate(-bx, -by);
        o.draw(v);
        c.restore();
      }
    }
    // the dust: grey-tan puffs that drift out from the foot of the house and fade
    for (const d of this.dust) {
      const u = (this.time - d.t0) / DUST_TIME;
      if (u < 0 || u > 1) continue;
      const bx = this.sx(d.x);
      const by = this.sy(d.y, d.lv);
      for (let j = 0; j < 7; j++) {
        const a = (j / 7) * Math.PI * 2 + 0.6;
        const dist = S * (0.25 + 0.55 * u) * (0.7 + 0.5 * hash(j, 17));
        c.fillStyle = `rgba(214,200,168,${(0.55 * (1 - u)).toFixed(3)})`;
        c.beginPath();
        c.arc(bx + Math.cos(a) * dist, by - S * 0.12 + Math.sin(a) * dist * 0.4 - u * S * 0.25, S * (0.1 + 0.16 * u), 0, 7);
        c.fill();
      }
    }
  }

  /** the piles a site holds now, from its stock: what it makes and, for a refinery, what it has taken in */
  private pileSpec(look: SiteLook): { key: string; draw: (v: View) => void } | null {
    // the piles are drawn into a canvas that is lifted as a whole, so their own level is 0
    const { site } = look;
    const lv = 0;
    const x = site.cx;
    const y = site.cy;
    if (site.kind === 'forest') {
      const logs = Math.min(27, Math.floor(site.stock * 4.5));
      const per = [Math.min(9, logs), Math.min(9, Math.max(0, logs - 9)), Math.max(0, logs - 18)];
      return { key: per.join(','), draw: (v) => per.forEach((m, i) => logPile(v, x - 2.9 + i * 2, y - 3.9, m, lv)) };
    }
    if (site.kind === 'sawmill') {
      // logs in follow the recent deliveries (full at the demand fill), boards out follow the stock (full at the raw cap)
      const logs = Math.min(9, Math.ceil(site.taken.timber * 0.9));
      const layers = Math.min(12, Math.round(site.stock * 2));
      const stacks = [Math.min(6, layers), Math.max(0, layers - 6)];
      return {
        key: `${logs}:${stacks.join(',')}`,
        draw: (v) => {
          logPile(v, x + 1.8, y - 3.9, logs, lv);
          boardStack(v, x - 3.0, y - 1.75, stacks[0], lv);
          boardStack(v, x - 1.3, y - 1.75, stacks[1], lv);
        },
      };
    }
    if (site.kind === 'farm') {
      const n = Math.min(12, Math.floor(site.stock * 2));
      return { key: String(n), draw: (v) => sacks(v, x - 2.8, y - 1.5, n, '#e9c547', lv, 6) };
    }
    if (site.kind === 'mill') {
      const flour = Math.min(9, Math.floor(site.stock * 1.5));
      const grain = Math.min(6, Math.ceil(site.taken.grain * 0.6));
      return {
        key: `${flour}:${grain}`,
        draw: (v) => {
          sacks(v, x - 0.6, y - 3.9, flour, '#f4f0e4', lv);
          sacks(v, x + 1.0, y - 3.5, grain, '#e9c547', lv, 2);
        },
      };
    }
    if (site.kind === 'town') {
      // what the town was sent lately waits by the platform and shrinks as the town eats it
      const boards = Math.min(10, Math.ceil(site.taken.boards));
      const flour = Math.min(9, Math.ceil(site.taken.flour));
      return {
        key: `${boards}:${flour}`,
        draw: (v) => {
          boardStack(v, x - 2.9, y - 1.45, boards, lv);
          sacks(v, x - 0.9, y - 1.95, flour, '#f4f0e4', lv);
        },
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ chunks

  private chunkKey(ci: number, cj: number, qi: number): string {
    return `${ci},${cj},${qi}`;
  }

  private makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    return c;
  }

  /** one chunk drawn at rs px a tile: the land row by row, the track, then the objects of each row */
  private buildChunk(ci: number, cj: number, rs: number): HTMLCanvasElement {
    const s = this.s;
    const x0 = ci * CH;
    const y0 = cj * CH;
    const x1 = Math.min(s.w, x0 + CH);
    const y1 = Math.min(s.h, y0 + CH);
    const canvas = this.makeCanvas((CH + 2 * SIDE) * rs + 2, (CH + TOPM + BOTM) * rs);
    const c = canvas.getContext('2d')!;
    const v = makeView(c, rs, x0 - SIDE, y0 - TOPM);
    // the objects by row: trees and the yards' buildings, each row in order of its front edge
    const rows: (TreeObj | Obj)[][] = Array.from({ length: y1 - y0 }, () => []);
    for (let y = y0; y < y1; y++)
      for (let x = Math.max(0, x0 - 2); x < Math.min(s.w, x1 + 2); x++) this.treesOf(x, y, rows[y - y0]);
    const nx = Math.ceil(s.w / CH);
    for (const o of this.statics.get(cj * nx + ci) ?? []) {
      const r = Math.floor(o.oy) - y0;
      if (r >= 0 && r < rows.length && o.ox1 > x0 - SIDE - 0.5 && o.ox0 < x1 + SIDE + 0.5) rows[r].push(o);
    }
    for (const list of rows) list.sort((a, b) => a.oy - b.oy);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) this.drawTile(v, x, y);
      for (let x = x0; x < x1; x++) this.drawEdges(v, x, y);
      for (let x = x0; x < x1; x++) this.drawFace(v, x, y);
      for (let x = x0; x < x1; x++) this.drawBridge(v, x, y);
      for (const o of rows[y - y0]) {
        if ('draw' in o) o.draw(v);
        else (o.birch ? birch : pine)(c, rs, v.x(o.x), v.y(o.y, o.lv) - rs * 0.15, o.r * rs);
      }
    }
    // the track after all the land, so a cell's ballast that runs past its edge is not covered by the next row's tiles
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.drawTrack(v, x, y);
    for (const a of this.aprons) if (a.x + 7 > x0 - SIDE && a.x - 6 < x1 + SIDE && a.y + 4 > y0 - TOPM && a.y - 1 < y1 + BOTM) this.drawApron(v, a);
    return canvas;
  }

  /** the trees of one cell: pines and birches on forest, a lone one now and then in the meadow */
  private treesOf(x: number, y: number, out: (TreeObj | Obj)[]): void {
    const s = this.s;
    const i = y * s.w + x;
    if (this.nearTrack[i] || s.yardMask[i] || this.kindA[i] === 1 || this.kindA[i] === 2) return;
    const lv = this.lvA[i];
    const j = this.jA[i];
    if (this.kindA[i] === 4) {
      const n = j > 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const jx = hash(x * 3 + k, y) * 0.6 + 0.2;
        const jy = hash(x, y * 5 + k) * 0.5 + 0.25;
        out.push({ oy: y + jy, x: x + jx, y: y + jy, r: 0.42 + hash(x + k, y + 9) * 0.2, birch: hash(x * 11, y * 7 + k) < 0.16, lv });
      }
    } else if (this.kindA[i] === 0 && j < 0.025 && !this.nearSite(x, y, 6)) out.push({ oy: y + 0.5, x: x + 0.5, y: y + 0.5, r: 0.45, birch: j < 0.012, lv });
  }

  private nearSite(x: number, y: number, r: number): boolean {
    return this.s.sites.some((d) => Math.hypot(x - d.cx, y - d.cy) < r);
  }

  private tileColour(i: number): string {
    const k = this.kindA[i];
    const j = this.jA[i];
    if (k === 1) return j < 0.5 ? '#3f88b4' : '#4189b5';
    if (k === 2) return '#cdb88c';
    if (k === 3) return (((i / this.s.w) | 0) >> 1) % 2 ? '#bfae4e' : '#d9bd5a';
    if (!Number.isNaN(this.railA[i])) return shade(GRASS[this.terrA[i]], 0.97);
    const base = k === 4 ? '#5f8f42' : GRASS[this.terrA[i]];
    return shade(base, 0.96 + Math.floor(j * 8) * 0.01);
  }

  private tileAt(x: number, y: number): number {
    const s = this.s;
    return x < 0 || y < 0 || x >= s.w || y >= s.h ? -1 : y * s.w + x;
  }

  private drawTile(v: View, x: number, y: number): void {
    const { c, S } = v;
    const s = this.s;
    const i = y * s.w + x;
    const lv = this.lvA[i];
    const X = v.x(x);
    const Y = v.y(y, lv);
    const k = this.kindA[i];
    const j = this.jA[i];
    c.fillStyle = this.tileColour(i);
    c.fillRect(X, Y, S + 0.6, S + 0.6);
    if (k === 1) {
      c.strokeStyle = 'rgba(255,255,255,.18)';
      c.lineWidth = Math.max(1, S * 0.05);
      if (j < 0.35) {
        c.beginPath();
        c.moveTo(X + S * 0.2, Y + S * 0.5);
        c.quadraticCurveTo(X + S * 0.4, Y + S * 0.38, X + S * 0.6, Y + S * 0.5);
        c.stroke();
      }
      // the shore: sand where land meets the water to the north, west and east
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) {
        const n = this.tileAt(x + dx, y + dy);
        if (n >= 0 && this.kindA[n] !== 1) {
          c.fillStyle = 'rgba(232,214,160,.85)';
          if (dy) c.fillRect(X, Y, S, S * 0.12);
          else c.fillRect(dx < 0 ? X : X + S * 0.88, Y, S * 0.12, S);
        }
      }
      // the rapids where the river falls past a sawmill
      if (this.rapids(x, y)) {
        c.strokeStyle = 'rgba(255,255,255,.6)';
        c.lineWidth = Math.max(1.2, S * 0.08);
        for (let q = 0; q < 2; q++) {
          const yy = Y + S * (0.3 + q * 0.4 + j * 0.1);
          c.beginPath();
          c.moveTo(X + S * 0.15, yy);
          c.quadraticCurveTo(X + S * 0.5, yy + S * 0.15, X + S * 0.85, yy);
          c.stroke();
        }
      }
      return;
    }
    const rail = !Number.isNaN(this.railA[i]);
    if (k === 3) {
      c.strokeStyle = 'rgba(120,90,30,.35)';
      c.lineWidth = Math.max(1, S * 0.06);
      for (let q = 1; q < 4; q++) {
        c.beginPath();
        c.moveTo(X, Y + (S * q) / 4);
        c.lineTo(X + S, Y + (S * q) / 4);
        c.stroke();
      }
    } else if (k === 0 && !rail && j > 0.82) {
      c.fillStyle = shade(GRASS[this.terrA[i]], 0.78);
      const bx = X + S * (0.25 + j * 0.4);
      const by = Y + S * 0.7;
      for (let q = 0; q < 3; q++) {
        c.beginPath();
        c.moveTo(bx + q * S * 0.12, by);
        c.lineTo(bx + q * S * 0.12 + S * 0.05, by - S * (0.18 + (q % 2) * 0.08));
        c.lineTo(bx + q * S * 0.12 + S * 0.1, by);
        c.fill();
      }
    }
    if (this.terrA[i] === 3 && !rail && k === 0 && hash(x, y * 3) < 0.25 && !s.yardMask[i]) {
      c.fillStyle = '#9a9488';
      c.strokeStyle = OUT;
      c.lineWidth = Math.max(1, S * 0.05);
      c.beginPath();
      c.ellipse(X + S * 0.5, Y + S * 0.5, S * 0.28, S * 0.2, 0.3, 0, 7);
      c.fill();
      c.stroke();
      c.fillStyle = '#b8b2a6';
      c.beginPath();
      c.ellipse(X + S * 0.44, Y + S * 0.44, S * 0.13, S * 0.08, 0.3, 0, 7);
      c.fill();
    }
    // light from the north west: a tile under a higher west or north neighbour is in shade
    const w = this.tileAt(x - 1, y);
    const n = this.tileAt(x, y - 1);
    if (w >= 0 && this.lvA[w] > lv + 0.05) {
      c.fillStyle = 'rgba(30,40,20,.22)';
      c.fillRect(X, Y, S * 0.3, S);
    }
    if (n >= 0 && this.lvA[n] > lv + 0.05) {
      c.fillStyle = 'rgba(30,40,20,.18)';
      c.fillRect(X, Y, S, S * 0.25);
    }
  }

  /** a stretch of river with fast water: the cells beside a sawmill's cell */
  private rapids(x: number, y: number): boolean {
    for (const d of this.s.sites) if (d.kind === 'sawmill' && Math.abs(x - d.cx - 9) < 5 && Math.abs(y - d.cy) < 4) return true;
    return false;
  }

  private drawEdges(v: View, x: number, y: number): void {
    const s = this.s;
    const i = y * s.w + x;
    if (this.kindA[i] === 1) return;
    const { c, S } = v;
    const lv = this.lvA[i];
    const X = v.x(x);
    const Y = v.y(y, lv);
    const lw = Math.max(1, S * 0.06);
    c.lineWidth = lw;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) {
      const n = this.tileAt(x + dx, y + dy);
      if (n < 0 || this.lvA[n] >= lv - 0.25) continue;
      c.strokeStyle = 'rgba(22,18,14,.55)';
      c.beginPath();
      if (dy < 0) {
        c.moveTo(X, Y);
        c.lineTo(X + S, Y);
      } else if (dx < 0) {
        c.moveTo(X, Y);
        c.lineTo(X, Y + S);
      } else {
        c.moveTo(X + S, Y);
        c.lineTo(X + S, Y + S);
      }
      c.stroke();
      if (dy < 0) {
        c.strokeStyle = 'rgba(255,255,220,.35)';
        c.beginPath();
        c.moveTo(X, Y + lw * 1.5);
        c.lineTo(X + S, Y + lw * 1.5);
        c.stroke();
      }
    }
  }

  /** the front face down to a lower neighbour to the south: earth, rock in a cutting, sand under the track */
  private drawFace(v: View, x: number, y: number): void {
    const s = this.s;
    const i = y * s.w + x;
    const n = this.tileAt(x, y + 1);
    if (n < 0 || this.kindA[i] === 1) return;
    const { c, S } = v;
    const top = v.y(y + 1, this.lvA[i]);
    const bot = v.y(y + 1, this.lvA[n]);
    if (bot - top < 0.5) return;
    const X = v.x(x);
    const rail = !Number.isNaN(this.railA[i]);
    const cut = !Number.isNaN(this.railA[n]) && this.kindA[n] !== 1 && !rail;
    c.fillStyle = rail ? '#c9a86a' : cut ? '#8f897c' : '#8a6a44';
    c.fillRect(X, top, S + 0.6, bot - top);
    c.fillStyle = 'rgba(0,0,0,.12)';
    for (let yy = top + S * 0.18; yy < bot - 2; yy += S * 0.18) c.fillRect(X, yy, S + 0.6, Math.max(1, S * 0.04));
    if (!rail) {
      c.fillStyle = shade(GRASS[this.terrA[i]], 0.72);
      c.fillRect(X, top, S + 0.6, Math.max(1.5, S * 0.08));
    }
    c.fillStyle = 'rgba(22,18,14,.5)';
    c.fillRect(X, bot - Math.max(1, S * 0.05), S + 0.6, Math.max(1, S * 0.05));
    for (const dx of [-1, 1]) {
      const e = this.tileAt(x + dx, y);
      if (e >= 0 && this.lvA[e] < this.lvA[i] - 0.25) {
        c.fillStyle = 'rgba(22,18,14,.55)';
        c.fillRect(dx < 0 ? X : X + S - 1, top, Math.max(1, S * 0.05), bot - top);
      }
    }
  }

  /** the links of a cell as step vectors, in the order of DIRS */
  private linksOf(i: number): Spoke[] {
    const m = this.s.track[i];
    const out: Spoke[] = [];
    for (let d = 0; d < 8; d++) if (m & (1 << d)) out.push(DIRS[d]);
    return out;
  }

  private drawTrack(v: View, x: number, y: number): void {
    const s = this.s;
    const i = y * s.w + x;
    if (!s.track[i] || s.water[i]) return;
    this.trackAt(v, x, y);
  }

  private trackAt(v: View, x: number, y: number, bridge = false): void {
    const s = this.s;
    const i = y * s.w + x;
    const links = this.linksOf(i);
    if (!links.length) return;
    const lm = Number.isNaN(this.railA[i]) ? this.lvA[i] : this.railA[i];
    // each end meets its neighbour at the height halfway between the two cells
    const las = links.map((d) => {
      const n = this.tileAt(x + d[0], y + d[1]);
      const ln = n >= 0 && !Number.isNaN(this.railA[n]) ? this.railA[n] : lm;
      return (lm + ln) / 2;
    });
    trackCell(v, x, y, links, las, lm, bridge);
  }

  /**
   * The platform tracks of a station, drawn once into the chunk. Track 0 is the line's own, so only
   * the side with no line gets a stub of it, to a buffer stop. Tracks 1 and 2 run the whole
   * length, leave the line's track in a switch on each side a line comes in from, and end in a
   * buffer stop on each side where none does.
   */
  private drawApron(v: View, a: Apron): void {
    const { c, S } = v;
    const cxp = a.x + 0.5;
    const cyp = a.y + 0.5;
    const home = this.railA[a.cell];
    const levelAtX = (x: number): number => {
      const r = this.railA[a.y * this.s.w + Math.max(0, Math.min(this.s.w - 1, Math.floor(x)))];
      return Number.isNaN(r) ? (Number.isNaN(home) ? 0 : home) : r;
    };
    for (let k = 0; k < a.k; k++) {
      let from = a.west ? -FAN1[1] : -STUB;
      let to = a.east ? FAN1[1] : STUB;
      if (k === 0) {
        if (a.west && a.east) continue;
        if (a.west) from = 0;
        else to = 0;
      }
      const pts: [number, number][] = [];
      const n = Math.max(2, Math.ceil((to - from) / 0.2));
      for (let i = 0; i <= n; i++) {
        const x = cxp + from + ((to - from) * i) / n;
        pts.push([v.x(x), v.y(cyp + this.platformY(a, k, x), levelAtX(x))]);
      }
      trackLine(c, S, pts);
      if (!a.west) bufferStop(c, S, pts[0][0], pts[0][1], Math.PI);
      if (!a.east) bufferStop(c, S, pts[n][0], pts[n][1], 0);
    }
  }

  private drawBridge(v: View, x: number, y: number): void {
    const s = this.s;
    const i = y * s.w + x;
    if (!s.track[i] || !s.water[i]) return;
    const links = this.linksOf(i);
    const lm = Number.isNaN(this.railA[i]) ? 0.4 : this.railA[i];
    const a = links[0];
    const b = links.length > 1 ? links[1] : [-a[0], -a[1]];
    const ang = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : Math.PI / 2;
    bridgeDeck(v, x, y, ang, lm, WATER_LV);
    this.trackAt(v, x, y, true);
    bridgeRails(v, x, y, ang, lm);
  }

  // ------------------------------------------------------------------ the whole-map canvas

  /** the whole map in one canvas: flat colours by terrace, faces as thin bands, forest as dark blocks */
  private buildOverview(): void {
    const s = this.s;
    const canvas = this.overview ?? this.makeCanvas(s.w * OV, (s.h + TOPM + BOTM) * OV);
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const v = makeView(c, OV, 0, -TOPM);
    const terr = ['#86b552', '#a4bf5c', '#c0b96a', '#c9a77c'];
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x;
        const k = this.kindA[i];
        c.fillStyle = k === 1 ? '#3f88b4' : k === 2 ? '#cdb88c' : k === 3 ? '#d9bd5a' : terr[this.terrA[i]];
        c.fillRect(v.x(x), v.y(y, this.lvA[i]), OV + 0.6, OV + 0.6);
      }
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x;
        const n = this.tileAt(x, y + 1);
        if (n >= 0 && this.kindA[i] !== 1) {
          const top = v.y(y + 1, this.lvA[i]);
          const bot = v.y(y + 1, this.lvA[n]);
          if (bot - top >= 0.5) {
            c.fillStyle = !Number.isNaN(this.railA[i]) ? '#c9a86a' : !Number.isNaN(this.railA[n]) ? '#8f897c' : '#8a6a44';
            c.fillRect(v.x(x), top, OV + 0.6, bot - top);
            c.fillStyle = 'rgba(22,18,14,.35)';
            c.fillRect(v.x(x), bot - 1, OV + 0.6, 1);
          }
        }
        if (this.kindA[i] === 4 && !this.nearTrack[i]) {
          c.fillStyle = '#2f5f30';
          c.fillRect(v.x(x), v.y(y, this.lvA[i]), OV + 0.6, OV + 0.6);
        }
      }
    }
    this.overview = canvas;
    this.overviewDirty = false;
  }

  // ------------------------------------------------------------------ trains

  /** a point on a line, past its ends along the end segments so a train can stand at a station */
  private linePos(line: Line, d: number): { x: number; y: number; lv: number; dx: number; dy: number } {
    const end = line.dist[line.dist.length - 1];
    const p = along(line, Math.max(0, Math.min(end, d)), this.s.w);
    let x = p.x;
    let y = p.y;
    if (d < 0) {
      x += p.dx * d;
      y += p.dy * d;
    } else if (d > end) {
      x += p.dx * (d - end);
      y += p.dy * (d - end);
    }
    return { x, y, lv: railAlong(line, d) / TERRACE_M, dx: p.dx, dy: p.dy };
  }

  /** the platform track a train uses at the end of its line, 0 or 1: where it stands or runs to, or where it left */
  private slotAtEnd(t: Train, end: 0 | 1): number {
    if (t.state === 'stop') {
      const line = lineOf(this.s, t);
      const cell = end === 0 ? line.path[0] : line.path[line.path.length - 1];
      return t.at === cell ? t.slot : t.slotFrom;
    }
    return end === (t.dir === 1 ? 1 : 0) ? t.slot : t.slotFrom;
  }

  /** the drawn length of a train, a little more than the sum of its parts for the gaps */
  private drawnLength(t: Train): number {
    return trainLength(t) + t.nWagons * 0.08;
  }

  /**
   * A point on a train's line at distance d, moved south onto the platform track of its slot where
   * the line runs into a station. The line is straight along the station's row there, so the move
   * is the same offset the switches in `drawApron` draw.
   */
  private trainPos(t: Train, line: Line, d: number): { x: number; y: number; lv: number; dx: number; dy: number } {
    const p = this.linePos(line, d);
    const end = line.dist[line.dist.length - 1];
    const e = d < end / 2 ? 0 : 1;
    const a = this.apronAt.get(e === 0 ? line.path[0] : line.path[line.path.length - 1]);
    if (a && Math.abs(p.x - (a.x + 0.5)) < FAN1[1] + 0.5) p.y += this.platformY(a, this.slotAtEnd(t, e), p.x);
    return p;
  }

  /**
   * The train's front is half its length ahead of where the sim holds it: a standing train is
   * centred on the station, and one that leaves has the engine at the old tail.
   */
  private frontOf(t: Train): number {
    return t.s + t.dir * (this.drawnLength(t) / 2);
  }

  private vehicles(t: Train): Veh[] {
    const line = lineOf(this.s, t);
    const out: Veh[] = [];
    let d = this.frontOf(t);
    for (let i = 0; i <= t.nWagons; i++) {
      const len = i === 0 ? ENGINE_LEN : WAGON_LEN;
      const back = d - t.dir * len;
      const a = this.trainPos(t, line, d);
      const b = this.trainPos(t, line, back);
      const ax = this.sx(a.x);
      const ay = this.sy(a.y, a.lv);
      const bx = this.sx(b.x);
      const by = this.sy(b.y, b.lv);
      // the vehicle's centre is the point of the track half its length behind its front, so a bend never carries the middle off the rails; its angle is the chord's
      const m = this.trainPos(t, line, d - (t.dir * len) / 2);
      out.push({ t, i, px: this.sx(m.x), py: this.sy(m.y, m.lv), wx: m.x, wy: m.y, ang: Math.atan2(ay - by, ax - bx), len });
      d = back - t.dir * 0.08;
    }
    return out;
  }

  /** the engine's drawn place, for the camera and the smoke */
  private enginePos(t: Train, behind = 0): { x: number; y: number; lv: number } {
    return this.trainPos(t, lineOf(this.s, t), this.frontOf(t) - t.dir * behind);
  }

  /** the share of a wagon that is full: the wagon at work shows its load changing a third at a time, the others are full or empty */
  private wagonFill(t: Train, w: number): number {
    const work = workingWagon(this.s, t);
    if (work && w === work.wagon) {
      const thirds = Math.min(2, Math.floor(work.progress * 3)) + 1;
      return t.dock === 'load' ? thirds / 3 : 1 - (thirds - 1) / 3;
    }
    return w >= t.unloaded && w < t.unloaded + t.cargo ? 1 : 0;
  }

  /** the good a wagon shows: what is aboard, or what is being loaded */
  private wagonGood(t: Train): Good | null {
    if (t.good) return t.good;
    if (t.dock !== 'load' || t.at === null) return null;
    const st = this.s.stations.find((o) => o.cell === t.at);
    const site = st && this.s.sites.find((o) => o.id === st.siteId);
    return site ? MAKES[site.kind] : null;
  }

  /** the train under a screen point, by its engine and wagons */
  trainAt(sx: number, sy: number): Train | null {
    const reach = Math.max(22, this.cam.s * 0.9);
    for (const t of this.s.trains) {
      if (this.cam.s < LOD_S) {
        const p = this.linePos(lineOf(this.s, t), t.s);
        if (Math.hypot(this.sx(p.x) - sx, this.sy(p.y, p.lv) - sy) < 24) return t;
        continue;
      }
      for (const veh of this.vehicles(t)) if (Math.hypot(veh.px - sx, veh.py - sy) < reach) return t;
    }
    return null;
  }

  private drawTrains(dt: number): void {
    const c = this.ctx;
    const S = this.cam.s;
    const s = this.s;
    const seen = new Set<number>();
    if (S < LOD_S) {
      for (const t of s.trains) {
        const p = this.linePos(lineOf(s, t), t.s);
        c.fillStyle = '#b5382c';
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(this.sx(p.x), this.sy(p.y, p.lv), 4.5, 0, 7);
        c.fill();
        c.stroke();
      }
      return;
    }
    const all: Veh[][] = s.trains.map((t) => this.vehicles(t));
    // the shadows first so one wagon's never falls over the next one's body
    for (const list of all)
      for (const veh of list) {
        c.save();
        c.translate(veh.px + S * 0.12, veh.py + S * 0.16);
        c.rotate(veh.ang);
        c.fillStyle = 'rgba(20,30,10,.35)';
        c.beginPath();
        c.roundRect((-veh.len * S) / 2, -S * 0.34, veh.len * S, S * 0.68, S * 0.12);
        c.fill();
        c.restore();
      }
    for (const list of all)
      for (const veh of list) {
        const t = veh.t;
        c.save();
        c.translate(veh.px, veh.py);
        c.rotate(veh.ang);
        if (veh.i === 0) drawEngine(c, veh.len * S, S, t.engine);
        else drawWagon(c, veh.len * S, S, t.wagons, this.wagonGood(t), this.wagonFill(t, veh.i - 1));
        c.restore();
      }
    for (const list of all) this.goodsStream(list);
    for (const t of s.trains) {
      seen.add(t.id);
      this.smoke(t, dt);
    }
    for (const id of this.puffs.keys()) if (!seen.has(id)) this.puffs.delete(id);
  }

  /** where a good's pile stands in a site's yard, in tiles: the stream of goods runs between it and the wagon at work */
  private pileAnchor(site: Site, good: Good): [number, number] {
    const x = site.cx;
    const y = site.cy;
    switch (site.kind) {
      case 'forest':
        return [x - 0.9, y - 3.4];
      case 'sawmill':
        return good === 'timber' ? [x + 2.4, y - 3.4] : [x - 1.6, y - 1.4];
      case 'farm':
        return [x - 1.7, y - 1.1];
      case 'mill':
        return good === 'grain' ? [x + 1.6, y - 3.2] : [x + 0.1, y - 3.4];
      default:
        return good === 'boards' ? [x - 1.9, y - 1.0] : [x - 0.1, y - 1.5];
    }
  }

  /** a few logs, boards or sacks in the air between the yard's pile and the wagon at work, going on or coming off */
  private goodsStream(list: Veh[]): void {
    const t = list[0].t;
    const S = this.cam.s;
    const work = workingWagon(this.s, t);
    const good = this.wagonGood(t);
    if (!work || !good || S < 14 || t.at === null) return;
    const veh = list[work.wagon + 1];
    const st = this.s.stations.find((o) => o.cell === t.at);
    const site = st && this.s.sites.find((o) => o.id === st.siteId);
    if (!veh || !site) return;
    const [ax, ay] = this.pileAnchor(site, good);
    const pile = this.project(ax, ay, 0);
    const c = this.ctx;
    const [from, to] = t.dock === 'load' ? [pile, { x: veh.px, y: veh.py }] : [{ x: veh.px, y: veh.py }, pile];
    for (let i = 0; i < 4; i++) {
      const u = (this.time * 1.6 + i / 4) % 1;
      const X = from.x + (to.x - from.x) * u;
      const Y = from.y + (to.y - from.y) * u - Math.sin(Math.PI * u) * S * 0.8;
      c.save();
      c.translate(X, Y);
      c.rotate(u * 2 + i);
      c.strokeStyle = OUT;
      c.lineWidth = Math.max(1, S * 0.04);
      if (good === 'timber') {
        c.fillStyle = '#8a5a2b';
        c.beginPath();
        c.roundRect(-S * 0.28, -S * 0.07, S * 0.56, S * 0.14, S * 0.07);
      } else if (good === 'boards') {
        c.fillStyle = '#e6cf98';
        c.beginPath();
        c.rect(-S * 0.26, -S * 0.05, S * 0.52, S * 0.1);
      } else {
        c.fillStyle = good === 'flour' ? '#f4f0e4' : '#e2c04a';
        c.beginPath();
        c.ellipse(0, 0, S * 0.16, S * 0.1, 0, 0, 7);
      }
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  /** white puffs from the chimney that drift and fade; new ones come while the train runs */
  private smoke(t: Train, dt: number): void {
    const c = this.ctx;
    const S = this.cam.s;
    let st = this.puffs.get(t.id);
    if (!st) this.puffs.set(t.id, (st = { list: [], last: 0 }));
    if (t.state === 'run' && this.time - st.last > 0.22) {
      st.last = this.time;
      const p = this.enginePos(t, 0.32);
      st.list.push({ x: p.x, y: p.y, lv: p.lv, up: 0.25, age: 0 });
    }
    for (const p of st.list) {
      p.age += dt;
      p.up += dt * 0.7;
      p.x -= dt * 0.22;
    }
    st.list = st.list.filter((p) => p.age < SMOKE_LIFE);
    for (const p of st.list) {
      const u = p.age / SMOKE_LIFE;
      const r = S * (0.14 + u * 0.3);
      const X = this.sx(p.x);
      const Y = this.sy(p.y, p.lv) - p.up * S;
      c.fillStyle = `rgba(160,160,165,${0.4 * (1 - u)})`;
      c.beginPath();
      c.arc(X + S * 0.06, Y + S * 0.06, r, 0, 7);
      c.fill();
      c.fillStyle = `rgba(250,250,248,${0.9 * (1 - u)})`;
      c.beginPath();
      c.arc(X, Y, r, 0, 7);
      c.fill();
    }
  }

  // ------------------------------------------------------------------ routes

  private routePoint(r: Route, k: number): [number, number] {
    const cell = r.cells[k];
    return [this.sx(cx(this.s, cell) + 0.5), this.sy(cy(this.s, cell) + 0.5, r.rail[k] / TERRACE_M)];
  }

  /**
   * A route that is not built: a band along its cells. `colour` null colours each step by its grade;
   * a string is one colour for all. A dashed band is one that cannot be built yet.
   */
  private drawRoute(r: Route, colour: string | null, dashed: boolean, stripe: boolean): void {
    const c = this.ctx;
    const S = this.cam.s;
    const s = this.s;
    const n = r.cells.length;
    const band = Math.max(3, S * 0.7);
    const grade = (k: number) => Math.abs(gradeOf(r.rail[k] - r.rail[k - 1], stepLen(cx(s, r.cells[k]) - cx(s, r.cells[k - 1]), cy(s, r.cells[k]) - cy(s, r.cells[k - 1]))));
    const bridge = new Set(r.bridge);
    c.lineCap = dashed ? 'butt' : 'round';
    c.lineJoin = 'round';
    // the cuttings and the fills: grey and sand blocks either side of the band
    if (S >= LOD_S) {
      const at = new Map(r.cells.map((cell, k) => [cell, k]));
      for (const [list, col] of [[r.cutting, 'rgba(150,144,131,.97)'], [r.fill, 'rgba(214,180,110,.97)']] as [number[], string][])
        for (const cell of list) {
          const k = at.get(cell);
          if (k === undefined) continue;
          const a = this.routePoint(r, Math.max(0, k - 1));
          const b = this.routePoint(r, Math.min(n - 1, k + 1));
          const p = this.routePoint(r, k);
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          c.save();
          c.translate(p[0], p[1]);
          c.rotate(ang);
          c.fillStyle = col;
          c.strokeStyle = OUT;
          c.lineWidth = 1.5;
          for (const side of [-1, 1]) {
            c.beginPath();
            c.rect(-S * 0.5, side * S * 0.62 - S * 0.17, S, S * 0.34);
            c.fill();
            c.stroke();
          }
          c.restore();
        }
    }
    const dash = dashed ? [Math.max(5, S * 0.55), Math.max(4, S * 0.4)] : [];
    for (const pass of [0, 1, 2]) {
      if (pass === 2 && !stripe) continue;
      c.setLineDash(dash);
      c.lineWidth = pass === 0 ? band + 5 : pass === 1 ? band : band * 0.32;
      // one colour all along: one path, so a dash runs on across the corners
      const single = pass === 0 || (pass === 1 && colour !== null && bridge.size === 0);
      if (single) {
        c.strokeStyle = pass === 0 ? (dashed ? '#2a2418' : '#fff') : colour!;
        c.beginPath();
        for (let k = 0; k < n; k++) {
          const p = this.routePoint(r, k);
          if (k) c.lineTo(p[0], p[1]);
          else c.moveTo(p[0], p[1]);
        }
        c.stroke();
        continue;
      }
      for (let k = 1; k < n; k++) {
        const a = this.routePoint(r, k - 1);
        const b = this.routePoint(r, k);
        const over = bridge.has(r.cells[k]) && bridge.has(r.cells[k - 1]);
        c.strokeStyle = pass === 1 ? (over ? '#3d8fd6' : colour ?? GRADE_COL(grade(k))) : GRADE_COL(grade(k));
        c.beginPath();
        c.moveTo(a[0], a[1]);
        c.lineTo(b[0], b[1]);
        c.stroke();
      }
    }
    c.setLineDash([]);
    // white chevrons point uphill on every step steeper than 1.5 %, one a step so they never touch
    if (S >= LOD_S)
      for (let k = 1; k < n; k++) {
        if (grade(k) < 1.5) continue;
        const a = this.routePoint(r, k - 1);
        const b = this.routePoint(r, k);
        let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (r.rail[k] < r.rail[k - 1]) ang += Math.PI;
        c.save();
        c.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        c.rotate(ang);
        c.lineCap = 'round';
        c.lineJoin = 'round';
        // white on a grade colour, dark on the cream way round
        c.strokeStyle = colour === OPTION_COLOUR[0] ? '#2a2418' : '#fff';
        c.lineWidth = Math.max(2, S * 0.15);
        c.beginPath();
        c.moveTo(-S * 0.14, -S * 0.2);
        c.lineTo(S * 0.1, 0);
        c.lineTo(-S * 0.14, S * 0.2);
        c.stroke();
        c.restore();
      }
  }

  // ------------------------------------------------------------------ the camera

  private get landscape(): boolean {
    return this.w > this.h;
  }

  /** the screen's free area: under the HUD bar in portrait, right of the HUD column in landscape */
  area(): { l: number; t: number; w: number; h: number } {
    // the landscape HUD column is 150 px wide at an 8 px margin
    const l = this.landscape ? 160 : 0;
    const t = this.landscape ? 0 : 68;
    return { l, t, w: this.w - l, h: this.h - t };
  }

  private get ox(): number {
    const a = this.area();
    return a.l + a.w / 2;
  }

  private get oy(): number {
    const a = this.area();
    return a.t + a.h / 2;
  }

  private sx(x: number): number {
    return (x - this.cam.x) * this.cam.s + this.ox;
  }

  private sy(y: number, lv = 0): number {
    return (y - this.cam.y) * this.cam.s + this.oy - lv * LIFT * this.cam.s;
  }

  /** px a tile at which the whole map fits the free area */
  private wholeScale(): number {
    const a = this.area();
    return Math.max(1, Math.min((a.w - 16) / this.s.w, (a.h - 16) / this.s.h));
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h) return;
    const first = this.w === 1;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (!first) this.fit();
  }

  /** the start station and the nearest other site in view, at play zoom or a little wider */
  fit(): void {
    const s = this.s;
    const start = s.sites.find((x) => x.id === s.scenario.startStation) ?? s.sites[0];
    let other = start;
    let bd = Infinity;
    for (const o of s.sites) {
      const d = Math.hypot(o.cx - start.cx, o.cy - start.cy);
      if (o !== start && d < bd) {
        bd = d;
        other = o;
      }
    }
    const top = (o: Site) => o.cy + yard(o.kind).dy0;
    // both stations, at least FIT_PAD px from the sides so a drag between them is clear of the edge scroll
    const x0 = Math.min(start.cx, other.cx);
    const x1 = Math.max(start.cx, other.cx) + 1;
    const y0 = Math.min(top(start), top(other)) - 1.5;
    const y1 = Math.max(start.cy, other.cy) + 2;
    const a = this.area();
    const fitS = Math.min((a.w - 2 * FIT_PAD) / (x1 - x0), (a.h - 24) / (y1 - y0));
    // as wide as the whole-map look allows, never the whole map itself
    this.cam.s = Math.max(Math.max(LOD_S + 0.5, this.wholeScale()), Math.min(PLAY_S, fitS));
    this.zoomTo = null;
    this.glide = null;
    this.cam.x = (x0 + x1) / 2;
    this.cam.y = (y0 + y1) / 2 + 0.3;
    this.clampCam();
  }

  private clampCam(): void {
    const s = this.s;
    const a = this.area();
    const c = this.cam;
    c.s = Math.max(this.wholeScale(), Math.min(MAX_S, c.s));
    // the view stays on the map, with a little ground beyond its edge (and the lift of the northern terraces)
    const hx = a.w / 2 / c.s;
    const hy = a.h / 2 / c.s;
    c.x = s.w <= 2 * hx - 2 ? s.w / 2 : Math.max(hx - 1, Math.min(s.w - hx + 1, c.x));
    c.y = s.h <= 2 * hy - 2 ? s.h / 2 : Math.max(hy - 2, Math.min(s.h - hy + 1, c.y));
  }

  /** move the view by a screen delta in CSS pixels */
  pan(dx: number, dy: number): void {
    this.followId = null;
    this.glide = null;
    this.cam.x -= dx / this.cam.s;
    this.cam.y -= dy / this.cam.s;
    this.clampCam();
  }

  /**
   * Zoom by a factor and move with the fingers: the map point that was under (fromX, fromY) ends up
   * under (sx, sy). The map never turns, so `rotate` is ignored.
   */
  pinch(scale: number, _rotate: number, sx: number, sy: number, fromX = sx, fromY = sy): void {
    const before = this.pick(fromX, fromY);
    this.zoomTo = null;
    this.glide = null;
    this.followId = null;
    this.setScale(this.cam.s * scale);
    if (before) {
      const lv = this.levelAt(before.x, before.y);
      this.cam.x = before.x - (sx - this.ox) / this.cam.s;
      this.cam.y = before.y - lv * LIFT - (sy - this.oy) / this.cam.s;
    }
    this.clampCam();
  }

  private setScale(v: number): void {
    const was = this.cam.s;
    this.cam.s = Math.max(this.wholeScale(), Math.min(MAX_S, v));
    if (Math.abs(this.cam.s - was) > 1e-6) this.scaleStamp = this.time;
  }

  /** the next of the four zoom levels, in (1) or out (-1) */
  zoomStep(dir: 1 | -1): void {
    const levels = [...ZOOMS, this.wholeScale()].filter((l, i, all) => all.findIndex((o) => Math.abs(Math.log(o / l)) < 0.05) === i).sort((a, b) => a - b);
    const cur = this.zoomTo ?? this.cam.s;
    const next = dir > 0 ? levels.find((l) => l > cur * 1.04) ?? levels[levels.length - 1] : [...levels].reverse().find((l) => l < cur / 1.04) ?? levels[0];
    this.zoomTo = next;
  }

  get scale(): number {
    return this.cam.s;
  }

  /** whether the whole-map look is drawn: a route is too small to read, so the input only pans and taps */
  get whole(): boolean {
    return this.cam.s < LOD_S;
  }

  /** ease to play zoom with the tile under a screen point at the middle of the free area */
  zoomAt(sx: number, sy: number): void {
    const p = this.pick(sx, sy);
    this.followId = null;
    this.glide = { x: p.x, y: p.y - this.levelAt(p.x, p.y) * LIFT };
    this.zoomTo = PLAY_S;
  }

  /** keep the view on a train, eased in to play zoom; null lets go */
  follow(train: Train | null): void {
    this.followId = train ? train.id : null;
    if (train) {
      this.zoomTo = null;
      this.glide = null;
    }
  }

  get following(): number | null {
    return this.followId;
  }

  /** the tile point under a screen point */
  pick(sx: number, sy: number): { x: number; y: number } {
    const x = this.cam.x + (sx - this.ox) / this.cam.s;
    let y = this.cam.y + (sy - this.oy) / this.cam.s;
    for (let k = 0; k < 5; k++) y = this.cam.y + (sy - this.oy) / this.cam.s + this.levelAt(x, y) * LIFT;
    return { x, y };
  }

  /** a point in tiles to screen px; `lift` is metres above the ground there */
  project(x: number, y: number, lift = 0): { x: number; y: number } {
    return { x: this.sx(x), y: this.sy(y, this.levelAt(x, y) + lift / TERRACE_M) };
  }

  trainLengthCells(t: Train): number {
    return trainLength(t);
  }

  // ------------------------------------------------------------------ the frame

  /** draw the chunks in view, building the ones missing within a time budget */
  private drawChunks(): void {
    const s = this.s;
    const c = this.ctx;
    const S = this.cam.s;
    const dev = S * this.dpr;
    const qi = qIndex(dev);
    const nx = Math.ceil(s.w / CH);
    const ny = Math.ceil(s.h / CH);
    const ty0 = this.cam.y - this.oy / S;
    const ty1 = this.cam.y + (this.h - this.oy) / S;
    const tx0 = this.cam.x - this.ox / S;
    const tx1 = this.cam.x + (this.w - this.ox) / S;
    const cj0 = Math.max(0, Math.floor(ty0 / CH));
    const cj1 = Math.min(ny - 1, Math.floor((ty1 + TOPM) / CH));
    const ci0 = Math.max(0, Math.floor((tx0 - SIDE) / CH));
    const ci1 = Math.min(nx - 1, Math.floor((tx1 + SIDE) / CH));
    const settled = this.time - this.scaleStamp > 0.15;
    const t0 = performance.now();
    let built = 0;
    for (let cj = cj0; cj <= cj1; cj++)
      for (let ci = ci0; ci <= ci1; ci++) {
        const ver = this.chunkVer.get(cj * nx + ci) ?? 0;
        let e = this.touch(this.chunkKey(ci, cj, qi));
        const stale = !!e && e.ver !== ver;
        if ((!e || stale) && settled) {
          // an urgent build: the first frame, a chunk with nothing to show in its place, or a changed chunk
          const alt = e ?? this.anyLevel(ci, cj);
          if (!alt || stale || performance.now() - t0 < 7 || built === 0) {
            e = this.makeChunk(ci, cj, qi, dev, ver);
            built++;
          }
        }
        if (!e) e = this.anyLevel(ci, cj);
        if (e) this.blit(c, e, ci, cj);
        else this.blitOverview(c, ci, cj);
      }
    // spare time builds the ring around the view, so a pan finds its chunks ready
    if (settled && built === 0 && performance.now() - t0 < 4)
      for (const [ci, cj] of this.ring(ci0, ci1, cj0, cj1, nx, ny)) {
        if (this.chunks.has(this.chunkKey(ci, cj, qi))) continue;
        this.makeChunk(ci, cj, qi, dev, this.chunkVer.get(cj * nx + ci) ?? 0);
        break;
      }
  }

  private ring(ci0: number, ci1: number, cj0: number, cj1: number, nx: number, ny: number): [number, number][] {
    const out: [number, number][] = [];
    for (let cj = Math.max(0, cj0 - 1); cj <= Math.min(ny - 1, cj1 + 1); cj++)
      for (let ci = Math.max(0, ci0 - 1); ci <= Math.min(nx - 1, ci1 + 1); ci++) if (ci < ci0 || ci > ci1 || cj < cj0 || cj > cj1) out.push([ci, cj]);
    return out;
  }

  /** a cached chunk, marked as used this frame */
  private touch(key: string): Chunk | undefined {
    const e = this.chunks.get(key);
    if (e) {
      this.chunks.delete(key);
      e.used = this.frameStamp;
      this.chunks.set(key, e);
    }
    return e;
  }

  /** a chunk of another zoom level, the nearest one, to stand in while the right one is built */
  private anyLevel(ci: number, cj: number): Chunk | undefined {
    const qi = qIndex(this.cam.s * this.dpr);
    let best: Chunk | undefined;
    let bd = 99;
    for (let d = -6; d <= 6; d++) {
      const e = this.chunks.get(this.chunkKey(ci, cj, qi + d));
      if (e && Math.abs(d) < bd) {
        best = e;
        bd = Math.abs(d);
      }
    }
    return best;
  }

  private makeChunk(ci: number, cj: number, qi: number, dev: number, ver: number): Chunk {
    const rs = Math.round(dev * 16) / 16;
    const canvas = this.buildChunk(ci, cj, rs);
    const e: Chunk = { canvas, rs, ver, used: this.frameStamp, px: canvas.width * canvas.height };
    const key = this.chunkKey(ci, cj, qi);
    const old = this.chunks.get(key);
    if (old) {
      this.chunkPixels -= old.px;
      this.chunks.delete(key);
    }
    this.chunks.set(key, e);
    this.chunkPixels += e.px;
    // the oldest go first, never one drawn this frame
    for (const [k, o] of this.chunks) {
      if (this.chunks.size <= CHUNK_KEEP && this.chunkPixels <= CHUNK_PIXELS) break;
      if (o.used === this.frameStamp) continue;
      this.chunks.delete(k);
      this.chunkPixels -= o.px;
    }
    return e;
  }

  private blit(c: Ctx, e: Chunk, ci: number, cj: number): void {
    const k = this.cam.s / e.rs;
    c.drawImage(e.canvas, this.sx(ci * CH - SIDE), this.sy(cj * CH - TOPM), e.canvas.width * k, e.canvas.height * k);
  }

  /** the whole-map canvas in a chunk's place, blurry but there */
  private blitOverview(c: Ctx, ci: number, cj: number): void {
    if (!this.overview || this.overviewDirty) this.buildOverview();
    const ov = this.overview!;
    const s = this.s;
    let sx0 = (ci * CH - SIDE) * OV;
    let sy0 = (cj * CH - TOPM + TOPM) * OV;
    let sw = (CH + 2 * SIDE) * OV;
    let sh = (CH + TOPM + BOTM) * OV;
    const k = this.cam.s / OV;
    let dx = this.sx(ci * CH - SIDE);
    let dy = this.sy(cj * CH - TOPM);
    // clip the source to the canvas, with the destination following
    if (sx0 < 0) {
      dx -= sx0 * k;
      sw += sx0;
      sx0 = 0;
    }
    if (sx0 + sw > ov.width) sw = ov.width - sx0;
    if (sy0 + sh > ov.height) sh = ov.height - sy0;
    if (sw <= 0 || sh <= 0) return;
    void s;
    c.drawImage(ov, sx0, sy0, sw, sh, dx, dy, sw * k, sh * k);
  }

  private drawOverview(): void {
    if (!this.overview || this.overviewDirty) this.buildOverview();
    const k = this.cam.s / OV;
    const ov = this.overview!;
    this.ctx.drawImage(ov, this.sx(0), this.sy(-TOPM), ov.width * k, ov.height * k);
    // the lines as brass strokes with a dark edge
    const c = this.ctx;
    const S = this.cam.s;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const [w, col] of [[3 + S * 0.4, '#16120e'], [1.4 + S * 0.25, '#d8a63a']] as [number, string][]) {
      c.strokeStyle = col;
      c.lineWidth = w;
      for (const l of this.s.lines) {
        c.beginPath();
        l.path.forEach((cell, i) => {
          const X = this.sx(cx(this.s, cell) + 0.5);
          const Y = this.sy(cy(this.s, cell) + 0.5, l.rail[i] / TERRACE_M);
          if (i) c.lineTo(X, Y);
          else c.moveTo(X, Y);
        });
        c.stroke();
      }
    }
  }

  /** the piles of every site in view, from a small canvas per site that is redrawn when the counts change */
  private drawPiles(): void {
    const c = this.ctx;
    const S = this.cam.s;
    const dev = S * this.dpr;
    const qi = qIndex(dev);
    for (const look of this.looks) {
      const site = look.site;
      const x0 = site.cx - 3.5;
      const y0 = site.cy - 5;
      const X = this.sx(x0);
      const Y = this.sy(y0, look.lv);
      if (X > this.w || Y > this.h || X + 8 * S < 0 || Y + 6 * S < 0) continue;
      const spec = this.pileSpec(look);
      if (!spec) continue;
      let layer = this.piles.get(site.id);
      if (!layer || layer.key !== spec.key || layer.qi !== qi) {
        const rs = Math.round(dev * 16) / 16;
        const canvas = layer?.canvas ?? document.createElement('canvas');
        canvas.width = Math.ceil(8 * rs);
        canvas.height = Math.ceil(6 * rs);
        const pc = canvas.getContext('2d')!;
        pc.clearRect(0, 0, canvas.width, canvas.height);
        spec.draw(makeView(pc, rs, x0, y0));
        layer = { key: spec.key, qi, rs, canvas };
        this.piles.set(site.id, layer);
      }
      const k = S / layer.rs;
      c.drawImage(layer.canvas, X, Y, layer.canvas.width * k, layer.canvas.height * k);
    }
    // the windmills' sails
    const lw = this.time * 0.6;
    for (const look of this.looks)
      if (look.hub) sails(c, S, this.sx(look.hub.x), this.sy(look.hub.y, look.lv), lw);
  }

  // ------------------------------------------------------------------ where a track can start and end

  /** the marks for a drag or a pick: planned once when it starts, dropped when it ends */
  private syncTargets(drag: DragView | null): void {
    const src = drag ? { from: drag.from, reverse: false } : this.laying;
    if (!src) {
      this.targets = null;
      return;
    }
    const key = `${src.reverse ? 'in' : 'out'}${src.from}`;
    if (this.targets && this.targets.key === key) return;
    const cost = new Map<number, number | null>();
    const cheapest = (from: number, to: number): number | null => {
      const opts = plan(this.s, from, to);
      return opts.length ? Math.min(...opts.map((r) => r.cost)) : null;
    };
    if (src.reverse) {
      for (const st of this.s.stations) if (st.cell !== src.from) cost.set(st.cell, cheapest(st.cell, src.from));
    } else {
      for (const site of this.s.sites) {
        const cell = idx(this.s, site.cx, site.cy);
        if (cell !== src.from) cost.set(cell, cheapest(src.from, cell));
      }
    }
    this.targets = { key, from: src.from, cost };
  }

  /** how a site is marked now: start (idle station, or where the track starts), plain, ok (reachable and paid for), dear (reachable, cash short), none */
  private markOf(site: Site): { kind: 'start' | 'plain' | 'ok' | 'dear' | 'none'; cost: number } {
    const cell = idx(this.s, site.cx, site.cy);
    const t = this.targets;
    if (!t) return { kind: this.s.stations.some((o) => o.cell === cell) ? 'start' : 'plain', cost: 0 };
    if (cell === t.from) return { kind: 'start', cost: 0 };
    const c = t.cost.get(cell);
    if (c === undefined || c === null) return { kind: 'none', cost: 0 };
    return { kind: c <= this.s.cash ? 'ok' : 'dear', cost: c };
  }

  /**
   * The light pillars on the map, after Höyry's level exit: a column of light that fades out
   * upward, standing on a site. Warm brass where a track starts, green where the drag can end and
   * the cash covers it, amber where it cannot pay; the one under the finger is brighter and wider.
   * Idle start stations pulse slowly and dim so they do not pull the eye while trains run.
   */
  private drawMarks(drag: DragView | null, lod: boolean): void {
    const c = this.ctx;
    const S = this.cam.s;
    this.pillars.clear();
    for (const site of this.s.sites) {
      const m = this.markOf(site);
      if (m.kind === 'plain' || m.kind === 'none') continue;
      const p = this.project(site.cx + 0.5, site.cy + 0.5, 0);
      if (p.x < -80 || p.x > this.w + 80 || p.y < -80 || p.y > this.h + 280) continue;
      const here = !!drag && drag.to === idx(this.s, site.cx, site.cy);
      const idle = m.kind === 'start' && !this.targets;
      const rgb = m.kind === 'start' ? '255,227,154' : m.kind === 'ok' ? '157,255,160' : '255,196,106';
      const pulse = idle ? 0.5 + 0.5 * Math.sin(this.time * 2) : 0.5 + 0.5 * Math.sin(this.time * 5);
      const alpha = here ? 0.7 + 0.2 * pulse : idle ? 0.4 + 0.2 * pulse : 0.55 + 0.25 * pulse;
      const W = Math.max(1.6 * S, 22) * (here ? 1.3 : 1);
      const H = Math.max(6 * S, 64);
      // a soft dark halo, so the light has something to stand against on bright grass
      const hw = W * 0.9;
      const hg = c.createLinearGradient(0, p.y - H, 0, p.y);
      hg.addColorStop(0, 'rgba(10,25,12,0)');
      hg.addColorStop(1, 'rgba(10,25,12,0.15)');
      c.fillStyle = hg;
      c.fillRect(p.x - hw, p.y - H, hw * 2, H);
      const g = c.createLinearGradient(0, p.y - H, 0, p.y);
      g.addColorStop(0, `rgba(${rgb},0)`);
      g.addColorStop(1, `rgba(${rgb},${alpha.toFixed(3)})`);
      c.fillStyle = g;
      c.fillRect(p.x - W / 2, p.y - H, W, H);
      // a bright edge on each side, fading up with the light
      const eg = c.createLinearGradient(0, p.y - H, 0, p.y);
      eg.addColorStop(0, 'rgba(255,255,255,0)');
      eg.addColorStop(1, 'rgba(255,255,255,0.9)');
      c.fillStyle = eg;
      c.fillRect(p.x - W / 2, p.y - H, 2, H);
      c.fillRect(p.x + W / 2 - 2, p.y - H, 2, H);
      // motes drifting up inside it and fading
      for (let i = 0; i < 5; i++) {
        const u = (this.time * 0.35 + i * 0.21 + hash(i, site.cx) * 0.3) % 1;
        const mx = p.x + (hash(i, site.cy + 3) - 0.5) * W * 0.7 + Math.sin(this.time * 2 + i) * W * 0.06;
        c.fillStyle = `rgba(255,255,255,${(0.85 * (1 - u)).toFixed(3)})`;
        c.beginPath();
        c.arc(mx, p.y - u * H * 0.9, Math.max(1.5, W * 0.045), 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = `rgba(${rgb},${(alpha * 0.9).toFixed(3)})`;
      c.beginPath();
      c.ellipse(p.x, p.y, W * 0.75, W * 0.26, 0, 0, Math.PI * 2);
      c.fill();
      this.pillars.set(site.id, { w: W, h: H, lod });
    }
  }

  get picking(): boolean {
    return this.pickView !== null;
  }

  /** pick mode begins: remember the view and, once the marks are known, ease to the closest view that shows them all */
  beginPick(): void {
    this.pickView = { x: this.cam.x, y: this.cam.y, s: this.cam.s };
    this.pickFitDue = true;
  }

  /** pick mode is over: the view the player had comes back unless `keep` */
  endPick(keep: boolean): void {
    this.pickFitDue = false;
    const v = this.pickView;
    this.pickView = null;
    if (!v || keep) return;
    this.followId = null;
    this.glide = { x: v.x, y: v.y };
    this.zoomTo = v.s;
  }

  /**
   * The closest zoom that shows the origin and every green or amber site inside the HUD, the pick
   * banner and clear of the zoom buttons, never wider than the whole map and never closer than now.
   */
  private fitPick(): void {
    const t = this.targets;
    if (!t) return;
    const pts: { x: number; y: number }[] = [];
    for (const site of this.s.sites) {
      const m = this.markOf(site);
      if (m.kind === 'plain' || m.kind === 'none') continue;
      // the pillar rises 4.5 tiles above the site, the ring's foot is a tile wide
      pts.push({ x: site.cx + 0.5 - 1, y: site.cy + 0.5 - 4.5 }, { x: site.cx + 0.5 + 1, y: site.cy + 1.5 });
    }
    if (pts.length < 2) return;
    const a = this.area();
    const banner = 56;
    const l = a.l + 28;
    const r = a.l + a.w - 28;
    const top = a.t + banner + 14;
    const bot = a.t + a.h - 28;
    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    let S = Math.min((r - l) / Math.max(1, x1 - x0), (bot - top) / Math.max(1, y1 - y0));
    const lvMid = this.levelAt(mx, my) * LIFT;
    // the zoom buttons stand bottom right: shrink until no mark's foot is under them
    const buttons = { x0: this.w - 84, y0: this.h - 160 };
    for (let i = 0; i < 12; i++) {
      const cxs = (l + r) / 2;
      const cys = (top + bot) / 2;
      const under = pts.some((p, k) => k % 2 === 1 && cxs + (p.x - mx) * S > buttons.x0 && cys + (p.y - my) * S > buttons.y0);
      if (!under) break;
      S *= 0.92;
    }
    S = Math.max(this.wholeScale(), Math.min(this.cam.s, S));
    // the middle of the box sits at the middle of the free area below the banner
    const shiftY = ((top + bot) / 2 - this.oy) / S;
    const shiftX = ((l + r) / 2 - this.ox) / S;
    this.followId = null;
    this.glide = { x: mx - shiftX, y: my - lvMid - shiftY };
    this.zoomTo = S;
  }

  draw(dt: number, drag: DragView | null, hint: Hint | null, pending: Route[] | null = null): void {
    const t0 = performance.now();
    const s = this.s;
    this.time += dt;
    this.frames++;
    this.frameStamp++;
    this.resize();
    this.growTowns();
    this.sync();
    // the camera: ease a zoom step, follow a train
    if (this.zoomTo !== null) {
      const k = 1 - Math.exp(-dt * 10);
      this.setScale(this.cam.s * Math.pow(this.zoomTo / this.cam.s, k));
      if (Math.abs(Math.log(this.zoomTo / this.cam.s)) < 0.004) {
        this.setScale(this.zoomTo);
        this.zoomTo = null;
      }
      if (this.glide) {
        this.cam.x += (this.glide.x - this.cam.x) * k;
        this.cam.y += (this.glide.y - this.cam.y) * k;
        if (this.zoomTo === null) {
          this.cam.x = this.glide.x;
          this.cam.y = this.glide.y;
          this.glide = null;
        }
      }
      this.clampCam();
    }
    if (this.followId !== null) {
      const t = s.trains.find((o) => o.id === this.followId);
      if (!t) this.followId = null;
      else {
        const p = this.enginePos(t);
        const k = Math.min(1, dt * 4);
        this.cam.x += (p.x - this.cam.x) * k;
        this.cam.y += (p.y - p.lv * LIFT - this.cam.y) * k;
        if (this.cam.s < PLAY_S - 0.05) this.setScale(this.cam.s + (PLAY_S - this.cam.s) * k);
        this.clampCam();
      }
    }
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#1b2a1e';
    c.fillRect(0, 0, this.w, this.h);
    const lod = this.cam.s < LOD_S;
    if (lod) this.drawOverview();
    else {
      this.drawChunks();
      this.drawPiles();
      this.drawRising();
    }
    // the route under the finger, and the two on offer after a lift
    if (pending) pending.forEach((r, i) => this.drawRoute(r, OPTION_COLOUR[i] ?? OPTION_COLOUR[0], i > 0, true));
    else if (drag?.route) {
      // the way round beside the one the lift builds first: dashed cream
      if (!drag.loose && drag.options && drag.options.length > 1) this.drawRoute(drag.options[1], OPTION_COLOUR[0], true, false);
      this.drawRoute(drag.route, drag.loose ? 'rgba(255,255,255,.85)' : null, false, false);
    }
    this.drawTrains(dt);
    // clouds and their shadows over land, track and trains, under the pillars and the HTML overlay
    this.clouds.draw(c, this.dpr, this.time, dt, this.cam.s, this.wholeScale(), !!drag || this.picking || !!this.laying,
      (x) => this.sx(x), (y) => this.sy(y), { w: this.w, h: this.h });
    this.syncTargets(drag);
    if (this.pickFitDue && this.targets) {
      this.pickFitDue = false;
      this.fitPick();
    }
    this.drawMarks(drag, lod);
    this.overlayFrame(drag, hint, pending, lod);
    if (this.logFps) this.fpsTick(t0);
  }

  private fpsTick(t0: number): void {
    const now = performance.now();
    if (this.lastDraw) {
      this.frameMs += now - this.lastDraw;
      this.drawMs += now - t0;
      this.frameN++;
    }
    this.lastDraw = now;
    if (this.frameN >= 120) {
      const out = { frameMs: +(this.frameMs / this.frameN).toFixed(2), drawMs: +(this.drawMs / this.frameN).toFixed(2), scale: +this.cam.s.toFixed(1), chunks: this.chunks.size, mpx: +(this.chunkPixels / 1e6).toFixed(1) };
      (window as unknown as { __fps?: unknown }).__fps = out;
      console.log(`fps ${JSON.stringify(out)}`);
      this.frameMs = this.drawMs = this.frameN = 0;
    }
  }

  // ------------------------------------------------------------------ the overlay

  private label(key: string, cls: string): HTMLElement {
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      el.dataset.key = key;
      this.overlay.appendChild(el);
      this.labels.set(key, el);
    }
    return el;
  }

  private place(el: HTMLElement, p: { x: number; y: number }, show = true): void {
    const on = show && p.x > -200 && p.x < this.w + 200 && p.y > -100 && p.y < this.h + 100;
    el.style.display = on ? '' : 'none';
    if (on) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }

  private goodIcon(g: Good): string {
    return `<svg class="gi"><use href="#g-${g}"/></svg>`;
  }

  /** a number into a node, written only when it changed */
  private setText(el: HTMLElement, text: string): void {
    if (el.textContent !== text) el.textContent = text;
  }

  /**
   * A site's name and its chips: what it has (count and stock bar), what it wants (price and
   * demand bar, red at the floor). The nodes are made once per look of the label; a frame sets
   * the numbers and the bar widths. In the whole-map look the label is a badge: the made good's
   * icon, a count on a raw site, the name and a dot for each wanted good.
   */
  private siteLabel(site: Site, lod: boolean): void {
    const s = this.s;
    const mk = this.markOf(site);
    const fade = mk.kind === 'none' ? '0.35' : '';
    const cost = mk.kind === 'ok' || mk.kind === 'dear' ? `<span class="chip cost${mk.kind === 'dear' ? ' dear' : ''}"><svg class="gi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#d8a63a" stroke="#16120e" stroke-width="2"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#8a6414" stroke-width="2"/></svg><b>${mk.cost}</b></span>` : '';
    const el = this.label(`site:${site.id}`, 'tag site-tag');
    const badge = this.label(`badge:${site.id}`, 'badge');
    const makes = MAKES[site.kind];
    const takes = TAKES[site.kind].filter((g) => s.sites.some((o) => MAKES[o.kind] === g));
    if (lod) {
      el.style.display = 'none';
      const raw = !!RAW_RATE[site.kind];
      const floors = takes.filter((g) => demand(site.taken[g]) <= DEMAND_FLOOR + 1e-6);
      const key = `b|${makes}|${takes.join()}|${raw}|${mk.kind}|${mk.cost}|${floors.join()}`;
      let refs = this.tags.get(`badge:${site.id}`);
      if (!refs || refs.key !== key) {
        const icon = makes ? this.goodIcon(makes) : '<svg class="gi" viewBox="0 0 24 24"><path d="M3 11 L12 3 L21 11 V21 H3 Z" fill="#b5382c"/><path d="M1 12 L12 2 L23 12" stroke="#4a2f24" stroke-width="2.5" fill="none"/></svg>';
        badge.innerHTML = `<span class="c">${icon}${raw ? '<em class="n"></em>' : ''}</span><span class="nm">${tt(site.name)}</span>${takes.length ? `<span class="wd">${takes.map((g) => `<span class="wg${floors.includes(g) ? ' floor' : ''}">${this.goodIcon(g)}</span>`).join('')}</span>` : ''}${cost}`;
        refs = { key, has: null, wants: [], n: badge.querySelector('.n') };
        this.tags.set(`badge:${site.id}`, refs);
      }
      if (refs.n) this.setText(refs.n, String(Math.floor(site.stock)));
      badge.style.opacity = fade;
      badge.style.translate = '';
      const bp = this.project(site.cx + 0.5, site.cy + 0.5, 0);
      this.place(badge, bp);
      this.badgeQueue.push({ el: badge, x: bp.x, y: bp.y });
      return;
    }
    badge.style.display = 'none';
    const rail = mk.kind === 'start' ? RAIL_BADGE : '';
    const key = `t|${makes}|${takes.join()}|${mk.kind}|${mk.cost}|${site.size}`;
    let refs = this.tags.get(`site:${site.id}`);
    if (!refs || refs.key !== key) {
      let html = `<div class="name">${rail}${tt(site.name)}${site.kind === 'town' ? ` <small>${site.size}</small>` : ''}${cost}</div><div class="chips">`;
      if (makes) html += `<span class="chip has">${this.goodIcon(makes)}<b></b><i></i></span>`;
      for (const g of takes) html += `<span class="chip wants">${this.goodIcon(g)}<b></b><i></i></span>`;
      el.innerHTML = html + '</div>';
      const chips = Array.from(el.querySelectorAll<HTMLElement>('.chip.wants'));
      const has = el.querySelector<HTMLElement>('.chip.has');
      refs = {
        key,
        has: has ? { b: has.querySelector('b')!, i: has.querySelector('i')! } : null,
        wants: takes.map((good, k) => ({ good, chip: chips[k], b: chips[k].querySelector('b')!, i: chips[k].querySelector('i')!, taken: site.taken[good], price: price(s, good, site.id, 0), at: -9, change: null, bar: -1 })),
        n: null,
      };
      this.tags.set(`site:${site.id}`, refs);
    }
    if (refs.has) {
      this.setText(refs.has.b, String(Math.floor(site.stock)));
      refs.has.i.style.width = `${Math.min(100, (100 * site.stock) / RAW_CAP)}%`;
    }
    for (const w of refs.wants) {
      const taken = site.taken[w.good];
      const p = price(s, w.good, site.id, 0);
      // a delivery landed: the price steps down, and the chip says from what to what for a moment
      if (taken > w.taken + 0.5 && p !== w.price) w.change = { from: w.price, to: p, until: this.time + 1.6 };
      w.taken = taken;
      const showing = w.change && this.time < w.change.until ? w.change : null;
      if (!showing) w.change = null;
      // the number is written a few times a second at most; a delivery is written at once
      if (showing || p !== w.price) {
        if (showing || this.time - w.at > 0.25) {
          w.price = p;
          w.at = this.time;
        }
      }
      this.setText(w.b, showing ? `${showing.from} → ${showing.to}` : String(w.price));
      w.chip.classList.toggle('chg', !!showing);
      // the bar eases down quickly when a load lands and refills slowly as the town eats
      const bar = Math.round(1000 * demand(taken)) / 10;
      if (bar !== w.bar) {
        w.i.style.transitionDuration = w.bar >= 0 && bar < w.bar ? '0.35s' : '2.4s';
        w.i.style.width = `${bar}%`;
        w.bar = bar;
      }
      w.chip.classList.toggle('low', demand(taken) < 0.55);
      w.chip.classList.toggle('floor', demand(taken) <= DEMAND_FLOOR + 1e-6);
    }
    el.style.opacity = fade;
    // the tag stands over the yard, which is north of the station; the route look shrinks it
    const top = site.cy + yard(site.kind).dy0;
    const p = this.project(site.cx + 0.5, top - (site.kind === 'town' ? 0.3 : 1.35), 0);
    this.tagQueue.push({ id: site.id, el, x: p.x, y: p.y, k: this.cam.s < 20 ? 0.85 : 1, w: 0, h: 0 });
  }

  /** the site whose tag is under a screen point, so a tap on a name and its chips opens the site */
  siteTagAt(sx: number, sy: number): Site | null {
    const pad = 4;
    for (const [id, b] of this.tagBox) if (sx >= b.x0 - pad && sx <= b.x1 + pad && sy >= b.y0 - pad && sy <= b.y1 + pad) return this.s.sites.find((o) => o.id === id) ?? null;
    return null;
  }

  /** the badges stand centred on their sites; where two would overlap, the later one moves down below the earlier */
  private layoutBadges(): void {
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const b of this.badgeQueue) {
      if (b.el.style.display === 'none') continue;
      const w = b.el.offsetWidth;
      const h = b.el.offsetHeight;
      let y = b.y - 19;
      for (let pass = 0; pass < 8; pass++) {
        const hit = placed.find((o) => b.x - w / 2 < o.x1 + 2 && o.x0 < b.x + w / 2 + 2 && y < o.y1 + 2 && o.y0 < y + h + 2);
        if (!hit) break;
        // the shorter move, up or down, clear of the one it hit
        const down = hit.y1 + 3;
        const up = hit.y0 - h - 3;
        y = Math.abs(down - (b.y - 19)) <= Math.abs(up - (b.y - 19)) ? down : up;
      }
      // the whole badge, name and chips, stays on the screen: a site at the map's edge nudges its badge in
      const a = this.area();
      const bx = Math.max(a.l + w / 2 + 3, Math.min(a.l + a.w - w / 2 - 3, b.x));
      y = Math.max(a.t + 2, Math.min(this.h - h - 16, y));
      placed.push({ x0: bx - w / 2, x1: bx + w / 2, y0: y, y1: y + h });
      b.el.style.transform = `translate(${bx.toFixed(1)}px, ${(y + 19).toFixed(1)}px)`;
    }
    this.badgeQueue.length = 0;
  }

  /** put the site tags on the screen, the later one nudged down where it would cover an earlier one */
  private layoutTags(): void {
    const q = this.tagQueue;
    const show = (p: TagPlace) => p.x > -200 && p.x < this.w + 200 && p.y > -100 && p.y < this.h + 200;
    for (const p of q) p.el.style.display = show(p) ? '' : 'none';
    for (const p of q) if (show(p)) {
      p.w = p.el.offsetWidth * p.k;
      p.h = p.el.offsetHeight * p.k;
    }
    const placed: TagPlace[] = [];
    this.tagBox.clear();
    for (const p of q) {
      if (!show(p)) continue;
      // the tag's box: bottom centre at (x, y)
      for (let pass = 0; pass < 6; pass++) {
        const hit = placed.find((o) => Math.abs(o.x - p.x) < (o.w + p.w) / 2 + 2 && p.y - p.h < o.y + 2 && o.y - o.h < p.y + 2);
        if (!hit) break;
        p.y = hit.y + 2 + p.h;
      }
      placed.push(p);
      this.tagBox.set(p.id, { x0: p.x - p.w / 2, y0: p.y - p.h, x1: p.x + p.w / 2, y1: p.y });
      p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${p.k})`;
    }
    q.length = 0;
  }

  /** the plate above the finger (below it in the top quarter), kept inside the free area */
  private placeBox(el: HTMLElement, sx: number, sy: number, gap: number): void {
    const a = this.area();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const m = 8;
    const below = sy < this.h * 0.25;
    const x = Math.min(a.l + a.w - w - m, Math.max(a.l + m, sx - w / 2));
    const y = Math.min(this.h - h - m, Math.max(a.t + m, below ? sy + gap : sy - gap - h));
    el.style.translate = '0 0';
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }

  /** the plate on a route under the finger: cost and length, then worst grade, earthwork, trips a year; and the pill on the way round */
  private routePlate(drag: DragView | null, pending: Route[] | null): void {
    const r = drag?.route ?? null;
    const show = !!r && !drag!.loose && !pending;
    if (!show) {
      if (this.plateEl) this.plateEl.style.display = 'none';
      if (this.pillEl) this.pillEl.style.display = 'none';
      return;
    }
    if (!this.plateEl) {
      this.plateEl = document.createElement('div');
      this.plateEl.className = 'tag plate';
      this.overlay.appendChild(this.plateEl);
    }
    const earth = earthWord(r);
    const trips = tripsByEngine(this.s, r)
      .map((x) => `<span class="eng"><i class="pic eng${x.engine === 'jyry' ? ' strong' : ''}"></i>${perYear(x.trips)}</span>`)
      .join('');
    const html =
      `<div class="top"><i class="coin"></i><b class="${drag!.ok ? '' : 'red'}">${r.cost}</b><span class="km">${routeKm(r)} km</span></div>` +
      `<div class="sub"><span class="g" style="color:${GRADE_COL(r.worst)}">${r.worst < 1 ? '' : '▲ '}${gradeText(r)}</span>${earth ? `<span class="${earth.kind}">${earth.text}</span>` : ''}${trips}</div>`;
    if (this.plateEl.innerHTML !== html) this.plateEl.innerHTML = html;
    this.plateEl.style.display = '';
    this.placeBox(this.plateEl, drag!.sx, drag!.sy, 56);
    // the way round: a pill at the middle of its band, its cost and the best engine's trips a year
    const alt = drag!.options && drag!.options.length > 1 ? drag!.options[1] : null;
    if (!alt) {
      if (this.pillEl) this.pillEl.style.display = 'none';
      return;
    }
    if (!this.pillEl) {
      this.pillEl = document.createElement('div');
      this.pillEl.className = 'pill alt';
      this.overlay.appendChild(this.pillEl);
    }
    const mid = Math.floor(alt.cells.length / 2);
    const [px, py] = this.routePoint(alt, mid);
    const text = `${alt.cost} · ${perYear(bestTrips(this.s, alt))}`;
    if (this.pillEl.textContent !== text) this.pillEl.textContent = text;
    this.pillEl.style.display = '';
    const a = this.area();
    const hw = this.pillEl.offsetWidth / 2 + 6;
    const x = Math.min(a.l + a.w - hw, Math.max(a.l + hw, px));
    const y = Math.min(this.h - 20, Math.max(a.t + 16, py));
    this.pillEl.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }

  private overlayFrame(drag: DragView | null, hint: Hint | null, pending: Route[] | null, lod: boolean): void {
    const s = this.s;
    for (const site of s.sites) this.siteLabel(site, lod);
    this.layoutTags();
    this.layoutBadges();
    const seen = new Set<object>();
    for (const f of s.floats) {
      seen.add(f);
      let el = this.floatEls.get(f);
      if (!el) {
        el = document.createElement('div');
        el.className = `float ${f.kind}`;
        el.textContent = f.text;
        this.overlay.appendChild(el);
        this.floatEls.set(f, el);
      }
      const p = this.project(f.x, f.y, 6);
      el.style.opacity = String(Math.max(0, 1 - f.age / 1.6));
      this.place(el, { x: p.x, y: p.y - f.age * 40 });
    }
    for (const [f, el] of this.floatEls) {
      if (seen.has(f)) continue;
      el.remove();
      this.floatEls.delete(f);
    }
    if (hint && s.lines.length === 0 && !drag) {
      if (!this.hintEl) {
        this.hintEl = document.createElement('div');
        this.hintEl.className = 'hand';
        this.overlay.appendChild(this.hintEl);
      }
      const a = this.project(cx(s, hint.from) + 0.5, cy(s, hint.from) + 0.5, 2);
      const b = this.project(cx(s, hint.to) + 0.5, cy(s, hint.to) + 0.5, 2);
      const u = (this.time % 2.2) / 2.2;
      const k = u < 0.15 ? 0 : u > 0.85 ? 1 : (u - 0.15) / 0.7;
      this.place(this.hintEl, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      this.hintEl.style.opacity = u < 0.1 || u > 0.92 ? '0' : '1';
    } else if (this.hintEl) {
      this.hintEl.remove();
      this.hintEl = null;
    }
    this.routePlate(drag, pending);
    this.loadTags(lod);
  }

  /**
   * A small tag over a train that stands at a platform, at close up: the good, the load of the
   * capacity, and a bar that fills as the wagons do. The tag of a train being followed shows at
   * play zoom too.
   */
  private loadTags(lod: boolean): void {
    const seen = new Set<string>();
    for (const t of this.s.trains) {
      const on = !lod && t.state === 'stop' && (this.cam.s >= 34 || (this.followId === t.id && this.cam.s >= 18));
      if (!on) continue;
      const key = `load:${t.id}`;
      seen.add(key);
      const el = this.label(key, 'tag load-tag');
      const good = this.wagonGood(t);
      // the loads aboard, and the one in hand counted by how far it has come
      const work = workingWagon(this.s, t);
      const frac = work ? (t.dock === 'load' ? work.progress : -work.progress) : 0;
      const shown = Math.max(0, Math.min(t.nWagons, t.cargo + frac));
      const html = `${good ? this.goodIcon(good) : ''}<span>${t.cargo}<span class="u">/${t.nWagons}</span></span><i style="width:${((shown / t.nWagons) * 100).toFixed(1)}%;max-width:calc(100% - 12px)"></i>`;
      if (el.dataset.html !== html) {
        el.innerHTML = html;
        el.dataset.html = html;
      }
      const vs = this.vehicles(t);
      const mid = vs[Math.floor(vs.length / 2)];
      el.style.display = '';
      el.style.transform = `translate(${mid.px.toFixed(1)}px, ${(mid.py - this.cam.s * 0.55).toFixed(1)}px)`;
    }
    for (const [key, el] of this.labels) if (key.startsWith('load:') && !seen.has(key)) el.style.display = 'none';
  }
}
