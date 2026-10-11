/**
 * The map, top down in Canvas 2D (ADR 0003), for a mobile Railroad Tycoon 2 (ADR 0007).
 *
 * One tile is a cell of the sim. The land is whole terraces of 10 m: a tile's top is lifted by its
 * level, and a lower tile to the south shows the terrace's front face. A track cell is drawn at its
 * rail height, so a cutting or an embankment shows as a step in the land.
 *
 * The static layers (land, faces, track, trees, buildings, houses, stations) are drawn once per
 * chunk of 16 by 16 tiles into a canvas of their own at a cached scale, and drawn to the screen
 * scaled in between. What changes (trains, smoke, sails, the route being planned, the catchment
 * square, the stops of a route) is drawn on top every frame. Under LOD_S px a tile the whole map is
 * one canvas in a simpler look.
 *
 * Names, cargo chips and floats are HTML in the overlay div, placed each frame by projecting tile
 * points, so they stay crisp at any zoom.
 */
import type { Cargo, ScenarioDef, SimState, Site, StationSize, Station, Train } from '../game/types';
import type { Route } from '../game/grid';
import { DIRS, cx, cy, gradeOf, idx, stepLen, dirOf } from '../game/grid';
import { along, catchment, accepts, covered } from '../game/sim';
import { createState, streetOf, stationById } from '../game/state';
import { CONVERTS, RAW, STATIONS, TERRACE_M } from '../game/content/economy';
import { t as tt } from '../i18n';
import { cargoIcon } from '../ui/icons';
import { Clouds } from './clouds';
import {
  GRASS, LIFT, OUT, bridgeDeck, bridgeRails, building, birch, church, drawEngine, drawWagon, hash, logPile, boardStack, sacks, makeView, pine,
  platform, sails, scaled, shade, trackCell, windmillBody, type Ctx, type Spoke, type View,
} from './draw2d';

/** tiles in a chunk's side */
const CH = 16;
/** margins of a chunk's canvas in tiles: above for terrace lift and tall sprites, below, and at the sides */
const TOPM = 4.5;
const BOTM = 1.5;
const SIDE = 1.2;
/** water is drawn a little below the shore, in terraces */
const WATER_LV = -0.4;
/** under this many px a tile the whole-map look is drawn */
export const LOD_S = 9;
const MAX_S = 56;
/** the scale a game opens at */
export const PLAY_S = 22;
const CHUNK_KEEP = 90;
const CHUNK_PIXELS = 42e6;
/** px a tile in the whole-map canvas */
const OV = 8;
const SMOKE_LIFE = 2.2;
/** lengths in tiles, for the trains */
export const ENGINE_LEN = 1.45;
export const CAR_LEN = 1.0;
const GAP = 0.05;

const qIndex = (dev: number): number => Math.round(Math.log(dev / 4) / Math.log(1.25));

/** the colour of a step of a route by its grade, green to red */
export function gradeColour(g: number): string {
  return g < 0.5 ? '#5fae4a' : g < 1.5 ? '#9fc44a' : g < 2.5 ? '#e5c43c' : g < 3.5 ? '#e8913a' : '#d4452f';
}

interface Chunk {
  canvas: HTMLCanvasElement;
  rs: number;
  ver: number;
  used: number;
  px: number;
}

/** a thing drawn into a chunk, sorted by its front edge `oy` */
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
  ang: number;
  len: number;
}

/** what the UI asks the map to show on top of the world */
export interface MapView {
  /** a track route being planned: its options, the one chosen, the waypoints */
  plan: { options: Route[]; chosen: number; via: number[]; from: number; to: number } | null;
  /** a drag in progress: the route under the finger */
  drag: { route: Route | null; from: number; to: number; via: number[]; sx: number; sy: number } | null;
  /** a station about to be placed */
  catchment: { cell: number; size: StationSize; ok: boolean } | null;
  /** the stops of a route being edited, as station ids in order */
  stops: number[] | null;
  /** the thing a card is open on */
  selected: { kind: 'station'; id: number } | { kind: 'train'; id: number } | { kind: 'site'; id: string } | { kind: 'track'; cells: number[] } | null;
  /** the cargo overlay: where a cargo is made and where it is taken */
  cargo: Cargo | null;
  /** a tool is active: the map marks where it can act */
  tool: 'track' | 'station' | 'route' | null;
}

export function emptyView(): MapView {
  return { plan: null, drag: null, catchment: null, stops: null, selected: null, cargo: null, tool: null };
}

export class Renderer2D {
  view: MapView = emptyView();
  /** the start screen: the map as a backdrop, no overlay */
  backdrop = false;
  fixed: { w: number; h: number } | null = null;
  /** the free area of the screen, the HUD above and the tool bar below */
  insets = { top: 64, bottom: 84 };

  private ctx: Ctx;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private cam = { x: 0, y: 0, s: PLAY_S };
  private glide: { x: number; y: number; s: number } | null = null;
  private time = 0;
  private frameStamp = 0;
  private lvA: Float32Array;
  private jA: Float32Array;
  private railA: Float32Array;
  private kindA: Uint8Array;
  private terrA: Uint8Array;
  private nearTrack: Uint8Array;
  private sigKey = '';
  private statics = new Map<number, Obj[]>();
  private chunks = new Map<string, Chunk>();
  private chunkPixels = 0;
  private chunkVer = new Map<number, number>();
  private overview: HTMLCanvasElement | null = null;
  private overviewDirty = true;
  private puffs = new Map<number, { list: Puff[]; last: number }>();
  private scaleStamp = 0;
  private lastTrack: Uint8Array | null = null;
  private lastBlocked: Uint8Array | null = null;
  private mills: { x: number; y: number; lv: number }[] = [];
  private labels = new Map<string, HTMLElement>();
  private floatEls = new Map<object, HTMLElement>();
  private clouds: Clouds;

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
    this.layoutStatics();
    this.resize();
    this.cam.x = s.scenario.view[0] + 0.5;
    this.cam.y = s.scenario.view[1] + 0.5;
    this.cam.s = s.scenario.view[2];
    this.clampCam();
  }

  dispose(): void {
    this.overlay.innerHTML = '';
    this.chunks.clear();
    this.overview = null;
  }

  // ------------------------------------------------------------------ the land

  private levelAt(x: number, y: number): number {
    const s = this.s;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= s.w || iy >= s.h) return 0;
    return this.lvA[iy * s.w + ix];
  }

  /** what the sim says about each cell, as arrays the drawing reads */
  private rebuildLand(): void {
    const s = this.s;
    const n = s.w * s.h;
    for (let i = 0; i < n; i++) {
      const water = !!s.water[i];
      this.railA[i] = s.track[i] ? s.rail[i] / TERRACE_M : NaN;
      const rail = this.railA[i];
      this.lvA[i] = water && Number.isNaN(rail) ? WATER_LV : water ? WATER_LV : Number.isNaN(rail) ? s.height[i] / TERRACE_M : rail;
      this.kindA[i] = water ? 1 : this.isStreet(i) ? 2 : s.cover[i] === 2 ? 3 : s.cover[i] === 1 ? 4 : 0;
      this.terrA[i] = Math.max(0, Math.min(3, Math.round(water ? 0 : s.height[i] / TERRACE_M)));
    }
    this.nearTrack.fill(0);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++)
        if (s.track[y * s.w + x] || s.blocked[y * s.w + x])
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < s.w && y + dy < s.h) this.nearTrack[(y + dy) * s.w + x + dx] = 1;
  }

  /** a town's street: the open rows and columns between its houses, near enough to a house */
  private isStreet(i: number): boolean {
    const s = this.s;
    if (s.blocked[i]) return false;
    const x = cx(s, i);
    const y = cy(s, i);
    for (const site of s.sites) {
      if (site.kind !== 'town' || Math.abs(x - site.cx) > 8 || Math.abs(y - site.cy) > 8) continue;
      if (!streetOf(site, x, y)) continue;
      for (const h of site.homes) if (Math.abs(cx(s, h) - x) <= 1 && Math.abs(cy(s, h) - y) <= 1) return true;
      if (Math.abs(x - site.cx) <= 1 && Math.abs(y - site.cy) <= 1) return true;
    }
    return false;
  }

  /** a key that changes when the track, a station or a house does */
  private signature(): string {
    const s = this.s;
    return `${s.netVersion}:${s.coverVersion}:${s.stations.length}`;
  }

  private dirty(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.s;
    const nx = Math.ceil(s.w / CH);
    for (let cj = Math.max(0, Math.floor((y0 - 1) / CH)); cj <= Math.min(Math.ceil(s.h / CH) - 1, Math.floor((y1 + TOPM) / CH)); cj++)
      for (let ci = Math.max(0, Math.floor((x0 - 3) / CH)); ci <= Math.min(nx - 1, Math.floor((x1 + 3) / CH)); ci++) this.chunkVer.set(cj * nx + ci, (this.chunkVer.get(cj * nx + ci) ?? 0) + 1);
  }

  /** follow the sim: the arrays, the statics, the chunks that changed */
  private sync(): void {
    const sig = this.signature();
    if (sig === this.sigKey) return;
    const first = this.sigKey === '';
    this.sigKey = sig;
    const s = this.s;
    const before = this.lvA.slice();
    const kinds = this.kindA.slice();
    this.rebuildLand();
    this.layoutStatics();
    if (!first) {
      let x0 = 1e9,
        y0 = 1e9,
        x1 = -1,
        y1 = -1;
      for (let i = 0; i < this.lvA.length; i++)
        if (before[i] !== this.lvA[i] || s.track[i] !== this.lastTrack?.[i] || s.blocked[i] !== this.lastBlocked?.[i] || kinds[i] !== this.kindA[i]) {
          const x = i % s.w;
          const y = (i / s.w) | 0;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      if (x1 >= 0) this.dirty(x0 - 2, y0 - 2, x1 + 2, y1 + 2);
      // a station's platform reaches a few tiles past its cell
      for (const st of s.stations) this.dirty(cx(s, st.cell) - 3, cy(s, st.cell) - 3, cx(s, st.cell) + 3, cy(s, st.cell) + 3);
    }
    this.lastTrack = s.track.slice();
    this.lastBlocked = s.blocked.slice();
    this.overviewDirty = true;
  }

  // ------------------------------------------------------------------ the buildings

  private layoutStatics(): void {
    const s = this.s;
    const objs: Obj[] = [];
    const add = (oy: number, ox0: number, ox1: number, draw: (v: View) => void) => objs.push({ oy, ox0, ox1, draw });
    this.mills = [];
    for (const site of s.sites) {
      const lv = s.height[idx(s, site.cx, site.cy)] / TERRACE_M;
      const x = site.cx;
      const y = site.cy;
      const bld = (bx: number, by: number, w: number, d: number, o: Omit<Parameters<typeof building>[5], 'lv'>) => add(by + d, bx, bx + w, (v) => building(v, bx, by, w, d, { ...o, lv }));
      if (site.kind === 'forest') {
        bld(x - 1.2, y - 0.9, 1.5, 1.1, { walls: '#9c3a2c', roof: '#4a3a32', wall: 0.6, door: 0 });
        add(y + 1.4, x - 1, x + 2, (v) => logPile(v, x + 0.4, y + 0.3, 9, lv));
      } else if (site.kind === 'sawmill') {
        bld(x - 1.4, y - 1.2, 2.9, 1.3, { walls: '#9b3226', roof: '#6d6a66', wall: 1.0, door: 2, chimney: [x - 0.8, y - 1] });
        add(y + 1.4, x - 1.4, x + 1.6, (v) => (logPile(v, x - 1.3, y + 0.5, 6, lv), boardStack(v, x + 0.3, y + 0.6, 4, lv)));
      } else if (site.kind === 'papermill') {
        bld(x - 1.5, y - 1.4, 3, 1.5, { walls: '#d9d2bf', roof: '#5d5a56', wall: 1.2, door: 2, chimney: [x + 0.9, y - 1.2] });
        bld(x - 1.3, y + 0.3, 1.4, 1, { walls: '#b9b2a0', roof: '#4a4744', wall: 0.7, door: 0 });
      } else if (site.kind === 'farm') {
        bld(x - 1.4, y - 1.2, 1.9, 1.5, { walls: '#9c3a2c', roof: '#4e4a44', wall: 1.0, door: 1 });
        bld(x + 0.6, y - 0.6, 1.1, 0.9, { walls: '#e6dcc4', roof: '#7a3a2a', wall: 0.7, door: 0 });
        add(y + 1.5, x - 1, x + 1, (v) => sacks(v, x - 1.2, y + 0.6, 6, '#e9c547', lv, 3));
      } else if (site.kind === 'mill') {
        add(y + 0.3, x - 1.5, x + 0.5, (v) => windmillBody(v, x - 0.5, y - 0.2, lv));
        this.mills.push({ x: x - 0.5, y: y - 1.1, lv });
        bld(x + 0.4, y - 0.4, 1.1, 1, { walls: '#e6dcc4', roof: '#5d4a3c', wall: 0.7, door: 0 });
        add(y + 1.5, x - 1, x + 1, (v) => sacks(v, x - 1.3, y + 0.7, 5, '#f4f0e4', lv, 3));
      } else if (site.kind === 'town') {
        add(y + 0.95, x - 0.2, x + 1.2, (v) => church(scaled(v, x - 0.1, y + 0.1, lv, 0.36), x - 0.1, y + 0.1, lv));
        for (const h of site.homes) {
          const hx = cx(s, h);
          const hy = cy(s, h);
          const j = hash(hx, hy);
          const hl = s.height[h] / TERRACE_M;
          const walls = ['#a8352a', '#c98d3a', '#e6dcc4', '#9c3a2c', '#d7a84a', '#7a8a9a'][Math.floor(j * 6)];
          const roof = ['#4a3a32', '#5d4a3c', '#7a3a2a', '#3d3a3a'][Math.floor(hash(hy, hx) * 4)];
          const w = 0.62 + j * 0.2;
          const d = 0.5 + hash(hx + 3, hy) * 0.2;
          const bx = hx + 0.5 - w / 2;
          const by = hy + 0.55 - d / 2;
          add(by + d, bx, bx + w, (v) => building(v, bx, by, w, d, { walls, roof, wall: 0.45 + j * 0.2, lv: hl, door: 0 }));
        }
      }
    }
    for (const st of s.stations) {
      const x = cx(s, st.cell) + 0.5;
      const y = cy(s, st.cell) + 0.5;
      const lv = s.rail[st.cell] / TERRACE_M;
      const len = 2 + st.size;
      const [ax, ay] = DIRS[st.axis];
      const al = Math.hypot(ax, ay);
      const ux = ax / al;
      const uy = ay / al;
      // the platform beside the track, on the north or west side, and the station house on it
      let nx = uy;
      let ny = -ux;
      if (ny > 0 || (ny === 0 && nx > 0)) {
        nx = -nx;
        ny = -ny;
      }
      add(y + 0.5, x - len, x + len, (v) => stationShape(v, x, y, ux, uy, nx, ny, len, lv, st.size));
    }
    this.statics.clear();
    const nx = Math.ceil(s.w / CH);
    for (const o of objs) {
      const cj = Math.floor(Math.floor(o.oy) / CH);
      for (let ci = Math.floor((o.ox0 - 3) / CH); ci <= Math.floor((o.ox1 + 3) / CH); ci++) {
        if (ci < 0 || ci >= nx || cj < 0) continue;
        const k = cj * nx + ci;
        let list = this.statics.get(k);
        if (!list) this.statics.set(k, (list = []));
        list.push(o);
      }
    }
  }

  // ------------------------------------------------------------------ chunks

  private makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    return c;
  }

  private buildChunk(ci: number, cj: number, rs: number): HTMLCanvasElement {
    const s = this.s;
    const x0 = ci * CH;
    const y0 = cj * CH;
    const x1 = Math.min(s.w, x0 + CH);
    const y1 = Math.min(s.h, y0 + CH);
    const canvas = this.makeCanvas((CH + 2 * SIDE) * rs + 2, (CH + TOPM + BOTM) * rs);
    const c = canvas.getContext('2d')!;
    const v = makeView(c, rs, x0 - SIDE, y0 - TOPM);
    const rows: (TreeObj | Obj)[][] = Array.from({ length: y1 - y0 }, () => []);
    for (let y = y0; y < y1; y++) for (let x = Math.max(0, x0 - 2); x < Math.min(s.w, x1 + 2); x++) this.treesOf(x, y, rows[y - y0]);
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
      for (let x = x0; x < x1; x++) this.drawTrack(v, x, y);
      for (const o of rows[y - y0]) {
        if ('draw' in o) o.draw(v);
        else (o.birch ? birch : pine)(c, rs, v.x(o.x), v.y(o.y, o.lv) - rs * 0.15, o.r * rs);
      }
    }
    return canvas;
  }

  private treesOf(x: number, y: number, out: (TreeObj | Obj)[]): void {
    const s = this.s;
    const i = y * s.w + x;
    if (this.nearTrack[i] || this.kindA[i] === 1 || this.kindA[i] === 2) return;
    const lv = this.lvA[i];
    const j = this.jA[i];
    if (this.kindA[i] === 4) {
      const n = j > 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const jx = hash(x * 3 + k, y) * 0.6 + 0.2;
        const jy = hash(x, y * 5 + k) * 0.5 + 0.25;
        out.push({ oy: y + jy, x: x + jx, y: y + jy, r: 0.42 + hash(x + k, y + 9) * 0.2, birch: hash(x * 11, y * 7 + k) < 0.16, lv });
      }
    } else if (this.kindA[i] === 0 && j < 0.025) out.push({ oy: y + 0.5, x: x + 0.5, y: y + 0.5, r: 0.45, birch: j < 0.012, lv });
  }

  private tileColour(i: number): string {
    const k = this.kindA[i];
    const j = this.jA[i];
    if (k === 1) return j < 0.5 ? '#3f88b4' : '#4189b5';
    if (k === 2) return '#cdb88c';
    if (k === 3) return (((i / this.s.w) | 0) >> 1) % 2 ? '#bfae4e' : '#d9bd5a';
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
    const lv = this.kindA[i] === 1 ? WATER_LV : s.height[i] / TERRACE_M;
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
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) {
        const n = this.tileAt(x + dx, y + dy);
        if (n >= 0 && this.kindA[n] !== 1) {
          c.fillStyle = 'rgba(232,214,160,.85)';
          if (dy) c.fillRect(X, Y, S, S * 0.12);
          else c.fillRect(dx < 0 ? X : X + S * 0.88, Y, S * 0.12, S);
        }
      }
      return;
    }
    if (k === 3) {
      c.strokeStyle = 'rgba(120,90,30,.35)';
      c.lineWidth = Math.max(1, S * 0.06);
      for (let q = 1; q < 4; q++) {
        c.beginPath();
        c.moveTo(X, Y + (S * q) / 4);
        c.lineTo(X + S, Y + (S * q) / 4);
        c.stroke();
      }
    } else if (k === 0 && j > 0.82 && !s.track[i]) {
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
    // light from the north west: a tile under a higher west or north neighbour is in shade
    const w = this.tileAt(x - 1, y);
    const n = this.tileAt(x, y - 1);
    const hl = (t: number) => (this.kindA[t] === 1 ? WATER_LV : s.height[t] / TERRACE_M);
    if (w >= 0 && hl(w) > lv + 0.05) {
      c.fillStyle = 'rgba(30,40,20,.22)';
      c.fillRect(X, Y, S * 0.3, S);
    }
    if (n >= 0 && hl(n) > lv + 0.05) {
      c.fillStyle = 'rgba(30,40,20,.18)';
      c.fillRect(X, Y, S, S * 0.25);
    }
    // track on a cutting or an embankment: the rail's own little plinth at its height
    const rail = this.railA[i];
    if (!Number.isNaN(rail) && Math.abs(rail - lv) > 0.05) {
      const Yr = v.y(y, rail);
      c.fillStyle = rail > lv ? '#c9a86a' : '#8f897c';
      c.fillRect(X + S * 0.1, Math.min(Y, Yr) + S * 0.1, S * 0.8, Math.abs(Yr - Y) + S * 0.8);
    }
  }

  private drawEdges(v: View, x: number, y: number): void {
    const s = this.s;
    const i = y * s.w + x;
    if (this.kindA[i] === 1) return;
    const { c, S } = v;
    const hl = (t: number) => (this.kindA[t] === 1 ? WATER_LV : s.height[t] / TERRACE_M);
    const lv = hl(i);
    const X = v.x(x);
    const Y = v.y(y, lv);
    const lw = Math.max(1, S * 0.06);
    c.lineWidth = lw;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) {
      const n = this.tileAt(x + dx, y + dy);
      if (n < 0 || hl(n) >= lv - 0.25) continue;
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
    }
  }

  private drawFace(v: View, x: number, y: number): void {
    const s = this.s;
    const i = y * s.w + x;
    const n = this.tileAt(x, y + 1);
    if (n < 0 || this.kindA[i] === 1) return;
    const { c, S } = v;
    const hl = (t: number) => (this.kindA[t] === 1 ? WATER_LV : s.height[t] / TERRACE_M);
    const top = v.y(y + 1, hl(i));
    const bot = v.y(y + 1, hl(n));
    if (bot - top < 0.5) return;
    const X = v.x(x);
    c.fillStyle = '#8a6a44';
    c.fillRect(X, top, S + 0.6, bot - top);
    c.fillStyle = 'rgba(0,0,0,.12)';
    for (let yy = top + S * 0.18; yy < bot - 2; yy += S * 0.18) c.fillRect(X, yy, S + 0.6, Math.max(1, S * 0.04));
    c.fillStyle = shade(GRASS[this.terrA[i]], 0.72);
    c.fillRect(X, top, S + 0.6, Math.max(1.5, S * 0.08));
    c.fillStyle = 'rgba(22,18,14,.5)';
    c.fillRect(X, bot - Math.max(1, S * 0.05), S + 0.6, Math.max(1, S * 0.05));
  }

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
    const i = y * this.s.w + x;
    const links = this.linksOf(i);
    if (!links.length) return;
    const lm = this.railA[i];
    const las = links.map((d) => {
      const n = this.tileAt(x + d[0], y + d[1]);
      const ln = n >= 0 && !Number.isNaN(this.railA[n]) ? this.railA[n] : lm;
      return (lm + ln) / 2;
    });
    trackCell(v, x, y, links, las, lm, bridge);
  }

  private drawBridge(v: View, x: number, y: number): void {
    const s = this.s;
    const i = y * s.w + x;
    if (!s.track[i] || !s.water[i]) return;
    const links = this.linksOf(i);
    const lm = this.railA[i];
    const a = links[0];
    const b: Spoke = links.length > 1 ? links[1] : [-a[0], -a[1]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    bridgeDeck(v, x, y, ang, lm, WATER_LV);
    this.trackAt(v, x, y, true);
    bridgeRails(v, x, y, ang, lm);
  }

  // ------------------------------------------------------------------ the whole-map canvas

  private buildOverview(): void {
    const s = this.s;
    const canvas = this.overview ?? this.makeCanvas(s.w * OV, (s.h + TOPM + BOTM) * OV);
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const v = makeView(c, OV, 0, -TOPM);
    const terr = ['#86b552', '#a4bf5c', '#c0b96a', '#c9a77c'];
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x;
        const k = this.kindA[i];
        const lv = k === 1 ? WATER_LV : s.height[i] / TERRACE_M;
        c.fillStyle = k === 1 ? '#3f88b4' : k === 2 ? '#cdb88c' : k === 3 ? '#d9bd5a' : k === 4 ? '#3f6f35' : terr[this.terrA[i]];
        c.fillRect(v.x(x), v.y(y, lv), OV + 0.6, OV + 0.6);
        const n = this.tileAt(x, y + 1);
        if (n >= 0 && k !== 1) {
          const ln = this.kindA[n] === 1 ? WATER_LV : s.height[n] / TERRACE_M;
          const top = v.y(y + 1, lv);
          const bot = v.y(y + 1, ln);
          if (bot - top >= 0.5) {
            c.fillStyle = '#8a6a44';
            c.fillRect(v.x(x), top, OV + 0.6, bot - top);
          }
        }
        if (s.blocked[i] && s.siteOf[i] >= 0) {
          const site = s.sites[s.siteOf[i]];
          c.fillStyle = site.kind === 'town' ? '#b5382c' : '#6b4a2e';
          c.fillRect(v.x(x) + 1, v.y(y, lv) + 1, OV - 2, OV - 2);
        }
      }
    this.overview = canvas;
    this.overviewDirty = false;
  }

  private drawOverview(): void {
    if (!this.overview || this.overviewDirty) this.buildOverview();
    const k = this.cam.s / OV;
    const ov = this.overview!;
    this.ctx.drawImage(ov, this.sx(0), this.sy(-TOPM), ov.width * k, ov.height * k);
    // the track as a dark line with a brass core
    const c = this.ctx;
    const s = this.s;
    c.lineCap = 'round';
    for (const [w, col] of [[Math.max(2.5, this.cam.s * 0.5), '#16120e'], [Math.max(1.2, this.cam.s * 0.25), '#d8a63a']] as [number, string][]) {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      for (let i = 0; i < s.track.length; i++) {
        const m = s.track[i];
        if (!m) continue;
        for (let d = 0; d < 4; d++) {
          if (!(m & (1 << d))) continue;
          const j = idx(s, cx(s, i) + DIRS[d][0], cy(s, i) + DIRS[d][1]);
          c.moveTo(this.sx(cx(s, i) + 0.5), this.sy(cy(s, i) + 0.5, this.railA[i]));
          c.lineTo(this.sx(cx(s, j) + 0.5), this.sy(cy(s, j) + 0.5, this.railA[j]));
        }
      }
      c.stroke();
    }
    for (const st of s.stations) {
      const p = this.project(cx(s, st.cell) + 0.5, cy(s, st.cell) + 0.5);
      c.fillStyle = '#efe6cf';
      c.strokeStyle = OUT;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x, p.y, 4 + st.size, 0, 7);
      c.fill();
      c.stroke();
    }
  }

  // ------------------------------------------------------------------ the camera

  /** the free area of the screen: under the HUD and above the tool bar */
  area(): { l: number; t: number; w: number; h: number } {
    if (this.backdrop) return { l: 0, t: 0, w: this.w, h: this.h };
    return { l: 0, t: this.insets.top, w: this.w, h: Math.max(100, this.h - this.insets.top - this.insets.bottom) };
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
  wholeScale(): number {
    const a = this.area();
    return Math.max(1, Math.min((a.w - 8) / this.s.w, (a.h - 8) / this.s.h));
  }

  resize(): void {
    const w = this.fixed?.w ?? (this.canvas.clientWidth || window.innerWidth);
    const h = this.fixed?.h ?? (this.canvas.clientHeight || window.innerHeight);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.clampCam();
  }

  setView(x: number, y: number, scale: number): void {
    this.cam.x = x;
    this.cam.y = y;
    this.cam.s = scale || this.wholeScale();
    this.clampCam();
  }

  private clampCam(): void {
    const s = this.s;
    const a = this.area();
    const c = this.cam;
    c.s = Math.max(Math.min(this.wholeScale(), PLAY_S), Math.min(MAX_S, c.s));
    const hx = a.w / 2 / c.s;
    const hy = a.h / 2 / c.s;
    // the map's last rows can be brought up above a card that covers the lower part of the screen
    const below = this.backdrop ? 2 : 2 + 300 / c.s;
    c.x = s.w <= 2 * hx - 2 ? s.w / 2 : Math.max(hx - 2, Math.min(s.w - hx + 2, c.x));
    c.y = s.h <= 2 * hy - 2 ? s.h / 2 : Math.max(hy - 3, Math.min(s.h - hy + below, c.y));
  }

  pan(dx: number, dy: number): void {
    this.glide = null;
    this.cam.x -= dx / this.cam.s;
    this.cam.y -= dy / this.cam.s;
    this.clampCam();
  }

  /** zoom by a factor so the map point under (fromX, fromY) ends under (sx, sy) */
  pinch(scale: number, sx: number, sy: number, fromX = sx, fromY = sy): void {
    const before = this.pick(fromX, fromY);
    this.glide = null;
    const was = this.cam.s;
    this.cam.s = this.cam.s * scale;
    this.clampCam();
    if (Math.abs(this.cam.s - was) > 1e-6) this.scaleStamp = this.time;
    const lv = this.levelAt(before.x, before.y);
    this.cam.x = before.x - (sx - this.ox) / this.cam.s;
    this.cam.y = before.y - lv * LIFT - (sy - this.oy) / this.cam.s;
    this.clampCam();
  }

  /** ease the view to a tile point, at a scale (the current one when left out) */
  glideTo(x: number, y: number, scale?: number): void {
    this.glide = { x, y: y - this.levelAt(x, y) * LIFT, s: scale ?? this.cam.s };
  }

  get scale(): number {
    return this.cam.s;
  }

  get whole(): boolean {
    return this.cam.s < LOD_S;
  }

  /** the tile point under a screen point */
  pick(sx: number, sy: number): { x: number; y: number } {
    const x = this.cam.x + (sx - this.ox) / this.cam.s;
    let y = this.cam.y + (sy - this.oy) / this.cam.s;
    for (let k = 0; k < 4; k++) y = this.cam.y + (sy - this.oy) / this.cam.s + this.levelAt(x, y) * LIFT;
    return { x, y };
  }

  /** the cell under a screen point, or -1 off the map */
  cellAt(sx: number, sy: number): number {
    const p = this.pick(sx, sy);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return x < 0 || y < 0 || x >= this.s.w || y >= this.s.h ? -1 : idx(this.s, x, y);
  }

  project(x: number, y: number, lift = 0): { x: number; y: number } {
    return { x: this.sx(x), y: this.sy(y, this.levelAt(x, y) + lift / TERRACE_M) };
  }

  /** a cell's centre on the screen, at its rail height when it has track */
  cellPoint(cell: number): { x: number; y: number } {
    const s = this.s;
    const lv = s.track[cell] ? this.railA[cell] : this.lvA[cell];
    return { x: this.sx(cx(s, cell) + 0.5), y: this.sy(cy(s, cell) + 0.5, lv) };
  }

  /** the station nearest a screen point, within a finger's reach */
  stationNear(sx: number, sy: number): Station | null {
    let best: Station | null = null;
    let bd = Math.max(26, this.cam.s * 1.1);
    for (const st of this.s.stations) {
      const p = this.cellPoint(st.cell);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return best;
  }

  /** the train under a screen point */
  trainAt(sx: number, sy: number): Train | null {
    const reach = Math.max(20, this.cam.s * 0.8);
    for (const t of this.s.trains) for (const veh of this.vehicles(t)) if (Math.hypot(veh.px - sx, veh.py - sy) < reach) return t;
    return null;
  }

  // ------------------------------------------------------------------ the frame

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
        const key = `${ci},${cj},${qi}`;
        let e = this.touch(key);
        const stale = !!e && e.ver !== ver;
        if ((!e || stale) && (settled || stale)) {
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
  }

  private touch(key: string): Chunk | undefined {
    const e = this.chunks.get(key);
    if (e) {
      this.chunks.delete(key);
      e.used = this.frameStamp;
      this.chunks.set(key, e);
    }
    return e;
  }

  private anyLevel(ci: number, cj: number): Chunk | undefined {
    const qi = qIndex(this.cam.s * this.dpr);
    const nx = Math.ceil(this.s.w / CH);
    const ver = this.chunkVer.get(cj * nx + ci) ?? 0;
    for (let d = 1; d <= 6; d++)
      for (const q of [qi - d, qi + d]) {
        const e = this.chunks.get(`${ci},${cj},${q}`);
        if (e && e.ver === ver) return e;
      }
    return undefined;
  }

  private makeChunk(ci: number, cj: number, qi: number, dev: number, ver: number): Chunk {
    const rs = Math.round(dev * 16) / 16;
    const canvas = this.buildChunk(ci, cj, rs);
    const e: Chunk = { canvas, rs, ver, used: this.frameStamp, px: canvas.width * canvas.height };
    const key = `${ci},${cj},${qi}`;
    const old = this.chunks.get(key);
    if (old) {
      this.chunkPixels -= old.px;
      this.chunks.delete(key);
    }
    this.chunks.set(key, e);
    this.chunkPixels += e.px;
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

  private blitOverview(c: Ctx, ci: number, cj: number): void {
    if (!this.overview || this.overviewDirty) this.buildOverview();
    const ov = this.overview!;
    let sx0 = (ci * CH - SIDE) * OV;
    const sy0 = cj * CH * OV;
    let sw = (CH + 2 * SIDE) * OV;
    let sh = (CH + TOPM + BOTM) * OV;
    const k = this.cam.s / OV;
    let dx = this.sx(ci * CH - SIDE);
    const dy = this.sy(cj * CH - TOPM);
    if (sx0 < 0) {
      dx -= sx0 * k;
      sw += sx0;
      sx0 = 0;
    }
    if (sx0 + sw > ov.width) sw = ov.width - sx0;
    if (sy0 + sh > ov.height) sh = ov.height - sy0;
    if (sw <= 0 || sh <= 0) return;
    c.drawImage(ov, sx0, sy0, sw, sh, dx, dy, sw * k, sh * k);
  }

  draw(dt: number): void {
    this.time += dt;
    this.frameStamp++;
    this.resize();
    this.sync();
    if (this.glide) {
      const k = 1 - Math.exp(-dt * 8);
      this.cam.x += (this.glide.x - this.cam.x) * k;
      this.cam.y += (this.glide.y - this.cam.y) * k;
      this.cam.s *= Math.pow(this.glide.s / this.cam.s, k);
      this.scaleStamp = this.time;
      if (Math.hypot(this.glide.x - this.cam.x, this.glide.y - this.cam.y) < 0.02 && Math.abs(Math.log(this.glide.s / this.cam.s)) < 0.01) {
        this.cam.x = this.glide.x;
        this.cam.y = this.glide.y;
        this.cam.s = this.glide.s;
        this.glide = null;
      }
      this.clampCam();
    }
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#1b2a1e';
    c.fillRect(0, 0, this.w, this.h);
    const lod = this.cam.s < LOD_S;
    if (lod) this.drawOverview();
    else {
      this.drawChunks();
      for (const m of this.mills) sails(c, this.cam.s, this.sx(m.x), this.sy(m.y, m.lv), this.time * 0.6);
    }
    if (this.backdrop) {
      this.drawTrains(dt, lod);
      if (!this.fixed) this.clouds.draw(c, this.dpr, this.time, dt, this.cam.s, this.wholeScale(), false, (x) => this.sx(x), (y) => this.sy(y), { w: this.w, h: this.h });
      return;
    }
    this.drawCargo();
    this.drawSelected();
    this.drawCatchment();
    const v = this.view;
    if (v.plan) v.plan.options.forEach((r, i) => i !== v.plan!.chosen && this.drawRoute(r, 'rgba(239,230,207,0.9)', true));
    if (v.plan) this.drawRoute(v.plan.options[v.plan.chosen], null, false);
    if (v.drag?.route) this.drawRoute(v.drag.route, null, false);
    this.drawWaypoints();
    this.drawTrains(dt, lod);
    this.drawStops();
    this.overlayFrame(lod);
  }

  // ------------------------------------------------------------------ trains

  private vehicles(t: Train): Veh[] {
    const s = this.s;
    const out: Veh[] = [];
    let d = t.pos;
    const n = t.cars.length;
    for (let i = 0; i <= n; i++) {
      const len = i === 0 ? ENGINE_LEN : CAR_LEN;
      const back = d - len;
      const a = along(s, t, d);
      const b = along(s, t, back);
      const m = along(s, t, d - len / 2);
      const ax = this.sx(a.x);
      const ay = this.sy(a.y, a.z / TERRACE_M);
      const bx = this.sx(b.x);
      const by = this.sy(b.y, b.z / TERRACE_M);
      out.push({ t, i, px: this.sx(m.x), py: this.sy(m.y, m.z / TERRACE_M), ang: Math.atan2(ay - by, ax - bx), len });
      d = back - GAP;
    }
    return out;
  }

  private drawTrains(dt: number, lod: boolean): void {
    const c = this.ctx;
    const S = this.cam.s;
    const s = this.s;
    if (lod) {
      for (const t of s.trains) {
        const p = along(s, t, t.pos);
        c.fillStyle = t.state === 'broken' ? '#d4452f' : '#efe6cf';
        c.strokeStyle = OUT;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(this.sx(p.x), this.sy(p.y, p.z / TERRACE_M), 4, 0, 7);
        c.fill();
        c.stroke();
      }
      return;
    }
    const all = s.trains.map((t) => this.vehicles(t));
    for (const list of all)
      for (const veh of list) {
        c.save();
        c.translate(veh.px + S * 0.1, veh.py + S * 0.13);
        c.rotate(veh.ang);
        c.fillStyle = 'rgba(20,30,10,.35)';
        c.beginPath();
        c.roundRect((-veh.len * S) / 2, -S * 0.3, veh.len * S, S * 0.6, S * 0.1);
        c.fill();
        c.restore();
      }
    const k = 0.95;
    for (const list of all)
      for (const veh of list) {
        const t = veh.t;
        c.save();
        c.translate(veh.px, veh.py);
        c.rotate(veh.ang);
        if (veh.i === 0) drawEngine(c, veh.len * S, S * k, t.loco);
        else {
          const car = t.cars[veh.i - 1];
          drawWagon(c, veh.len * S, S * k, car.cargo, car.load ? 1 : 0);
        }
        c.restore();
      }
    const seen = new Set<number>();
    for (const t of s.trains) {
      seen.add(t.id);
      this.smoke(t, dt);
    }
    for (const id of this.puffs.keys()) if (!seen.has(id)) this.puffs.delete(id);
  }

  private smoke(t: Train, dt: number): void {
    const c = this.ctx;
    const S = this.cam.s;
    let st = this.puffs.get(t.id);
    if (!st) this.puffs.set(t.id, (st = { list: [], last: 0 }));
    const running = t.state === 'run';
    if ((running && this.time - st.last > 0.22) || (t.state === 'broken' && this.time - st.last > 0.1)) {
      st.last = this.time;
      const p = along(this.s, t, t.pos - 0.25);
      st.list.push({ x: p.x, y: p.y, lv: p.z / TERRACE_M, up: 0.2, age: 0 });
    }
    for (const p of st.list) {
      p.age += dt;
      p.up += dt * 0.7;
      p.x -= dt * 0.22;
    }
    st.list = st.list.filter((p) => p.age < SMOKE_LIFE);
    const broken = t.state === 'broken';
    for (const p of st.list) {
      const u = p.age / SMOKE_LIFE;
      const r = S * (0.11 + u * 0.25);
      const X = this.sx(p.x);
      const Y = this.sy(p.y, p.lv) - p.up * S;
      c.fillStyle = broken ? `rgba(40,40,40,${0.6 * (1 - u)})` : `rgba(250,250,248,${0.85 * (1 - u)})`;
      c.beginPath();
      c.arc(X, Y, r, 0, 7);
      c.fill();
    }
  }

  // ------------------------------------------------------------------ routes, catchment, stops

  private routePoint(r: Route, k: number): [number, number] {
    const cell = r.cells[k];
    return [this.sx(cx(this.s, cell) + 0.5), this.sy(cy(this.s, cell) + 0.5, r.rail[k] / TERRACE_M)];
  }

  /** a route that is not built: a band along its cells, coloured by grade, blue over water; dashed for the other option */
  private drawRoute(r: Route, colour: string | null, dashed: boolean): void {
    const c = this.ctx;
    const S = this.cam.s;
    const s = this.s;
    const n = r.cells.length;
    const band = Math.max(4, S * 0.55);
    const grade = (k: number) => Math.abs(gradeOf(r.rail[k] - r.rail[k - 1], stepLen(dirOf(s, r.cells[k - 1], r.cells[k]))));
    const bridge = new Set(r.bridge);
    c.lineCap = dashed ? 'butt' : 'round';
    c.lineJoin = 'round';
    c.setLineDash(dashed ? [Math.max(5, S * 0.5), Math.max(4, S * 0.35)] : []);
    c.lineWidth = band + 4;
    c.strokeStyle = dashed ? 'rgba(42,36,24,.8)' : '#fff';
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const p = this.routePoint(r, k);
      if (k) c.lineTo(p[0], p[1]);
      else c.moveTo(p[0], p[1]);
    }
    c.stroke();
    c.lineWidth = band;
    for (let k = 1; k < n; k++) {
      const a = this.routePoint(r, k - 1);
      const b = this.routePoint(r, k);
      const over = bridge.has(r.cells[k]) || bridge.has(r.cells[k - 1]);
      c.strokeStyle = colour ?? (over ? '#3d8fd6' : gradeColour(grade(k)));
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      c.stroke();
    }
    c.setLineDash([]);
    // chevrons point uphill on every step of 1.5 % or more
    if (!dashed && S >= LOD_S)
      for (let k = 1; k < n; k++) {
        if (grade(k) < 1.5) continue;
        const a = this.routePoint(r, k - 1);
        const b = this.routePoint(r, k);
        let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (r.rail[k] < r.rail[k - 1]) ang += Math.PI;
        c.save();
        c.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        c.rotate(ang);
        c.strokeStyle = '#fff';
        c.lineWidth = Math.max(2, S * 0.12);
        c.beginPath();
        c.moveTo(-S * 0.12, -S * 0.17);
        c.lineTo(S * 0.08, 0);
        c.lineTo(-S * 0.12, S * 0.17);
        c.stroke();
        c.restore();
      }
  }

  private drawWaypoints(): void {
    const v = this.view;
    const pts = v.plan ? [v.plan.from, ...v.plan.via, v.plan.to] : v.drag ? [v.drag.from, ...v.drag.via] : [];
    const c = this.ctx;
    pts.forEach((cell, k) => {
      const p = this.cellPoint(cell);
      c.fillStyle = k === 0 ? '#ffe39a' : k === pts.length - 1 && v.plan ? '#ffe39a' : '#fff';
      c.strokeStyle = OUT;
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(p.x, p.y, Math.max(6, this.cam.s * 0.32), 0, 7);
      c.fill();
      c.stroke();
    });
  }

  /** the catchment square of a station being placed or the one selected, and the sites it reaches */
  private drawCatchment(): void {
    const s = this.s;
    const v = this.view;
    let box: { cell: number; size: StationSize; ok: boolean } | null = v.catchment;
    if (!box && v.selected?.kind === 'station') {
      const st = stationById(s, v.selected.id);
      if (st) box = { cell: st.cell, size: st.size, ok: true };
    }
    if (!box) return;
    const b = catchment(s, box.cell, box.size);
    const c = this.ctx;
    const tl = this.project(b.x0, b.y0);
    const br = this.project(b.x1 + 1, b.y1 + 1);
    c.fillStyle = box.ok ? 'rgba(255,227,154,.16)' : 'rgba(212,69,47,.16)';
    c.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    c.setLineDash([8, 6]);
    c.lineWidth = 2.5;
    c.strokeStyle = box.ok ? '#ffe39a' : '#d4452f';
    c.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    c.setLineDash([]);
    // the sites it reaches get a ring
    for (const { site } of covered(s, box.cell, box.size)) this.ring(site, '#ffe39a');
    const p = this.cellPoint(box.cell);
    c.fillStyle = box.ok ? '#ffe39a' : '#d4452f';
    c.strokeStyle = OUT;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(p.x, p.y, Math.max(6, this.cam.s * 0.35), 0, 7);
    c.fill();
    c.stroke();
  }

  private ring(site: Site, col: string): void {
    const c = this.ctx;
    const r = site.kind === 'town' ? 2.2 : 1.7;
    const p = this.project(site.cx + 0.5, site.cy + 0.5);
    c.strokeStyle = col;
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(p.x, p.y, r * this.cam.s, r * this.cam.s * 0.8, 0, 0, 7);
    c.stroke();
  }

  /** the cargo overlay: green rings where it is made, blue where it is taken, and the stations that take it */
  private drawCargo(): void {
    const g = this.view.cargo;
    if (!g) return;
    const s = this.s;
    const c = this.ctx;
    c.fillStyle = 'rgba(10,20,10,.25)';
    c.fillRect(0, 0, this.w, this.h);
    for (const site of s.sites) {
      const makes = RAW[site.kind] === g || CONVERTS[site.kind]?.to === g || (site.kind === 'town' && (g === 'pax' || g === 'mail'));
      const takes = CONVERTS[site.kind]?.from === g || (site.kind === 'town' && ['pax', 'mail', 'food', 'lumber', 'paper'].includes(g));
      if (makes) this.ring(site, '#7fe07a');
      if (takes) {
        const was = this.cam.s;
        void was;
        this.ring(site, '#6fb6ff');
      }
    }
    for (const st of s.stations)
      if (accepts(s, st, g)) {
        const p = this.cellPoint(st.cell);
        c.fillStyle = '#6fb6ff';
        c.beginPath();
        c.arc(p.x, p.y, 6, 0, 7);
        c.fill();
      }
  }

  private drawSelected(): void {
    const sel = this.view.selected;
    if (!sel) return;
    const c = this.ctx;
    if (sel.kind === 'track') {
      c.strokeStyle = 'rgba(255,227,154,.9)';
      c.lineWidth = Math.max(5, this.cam.s * 0.6);
      c.lineCap = 'round';
      c.beginPath();
      sel.cells.forEach((cell, k) => {
        const p = this.cellPoint(cell);
        if (k) c.lineTo(p.x, p.y);
        else c.moveTo(p.x, p.y);
      });
      c.stroke();
    } else if (sel.kind === 'site') {
      const site = this.s.sites.find((o) => o.id === sel.id);
      if (site) this.ring(site, '#ffe39a');
    } else if (sel.kind === 'train') {
      const t = this.s.trains.find((o) => o.id === sel.id);
      if (!t) return;
      const p = along(this.s, t, t.pos - 0.6);
      const X = this.sx(p.x);
      const Y = this.sy(p.y, p.z / TERRACE_M);
      c.strokeStyle = '#ffe39a';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(X, Y, Math.max(16, this.cam.s * 1.1), 0, 7);
      c.stroke();
      // its stops, numbered
      this.numberStops(t.route.map((r) => r.station));
    }
  }

  private drawStops(): void {
    if (this.view.stops) this.numberStops(this.view.stops);
  }

  private numberStops(ids: number[]): void {
    const c = this.ctx;
    const s = this.s;
    const pts = ids.map((id) => stationById(s, id)).filter((o): o is Station => !!o).map((st) => this.cellPoint(st.cell));
    if (pts.length > 1) {
      c.strokeStyle = 'rgba(255,227,154,.7)';
      c.lineWidth = 2;
      c.setLineDash([4, 6]);
      c.beginPath();
      pts.forEach((p, k) => (k ? c.lineTo(p.x, p.y - 22) : c.moveTo(p.x, p.y - 22)));
      c.stroke();
      c.setLineDash([]);
    }
    pts.forEach((p, k) => {
      c.fillStyle = '#ffe39a';
      c.strokeStyle = OUT;
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(p.x, p.y - 22, 12, 0, 7);
      c.fill();
      c.stroke();
      c.fillStyle = OUT;
      c.font = 'bold 14px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(k + 1), p.x, p.y - 21);
    });
  }

  // ------------------------------------------------------------------ the HTML overlay

  private label(key: string, cls: string): HTMLElement {
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
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

  private setHtml(el: HTMLElement, html: string): void {
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
  }

  private overlayFrame(lod: boolean): void {
    const s = this.s;
    const close = this.cam.s >= 15;
    for (const site of s.sites) {
      const el = this.label(`site:${site.id}`, 'tag site-tag');
      const makes = RAW[site.kind] ?? CONVERTS[site.kind]?.to;
      const icon = makes ? cargoIcon(makes) : '';
      const big = site.kind === 'town';
      const n = site.kind === 'town' ? `<em>${site.homes.length}</em>` : '';
      this.setHtml(el, `${icon}<span class="nm">${tt(site.name)}</span>${n}`);
      el.classList.toggle('town', big);
      el.classList.toggle('small', lod);
      const top = site.kind === 'town' ? 3.4 : 2.2;
      this.place(el, this.project(site.cx + 0.5, site.cy + 0.5 - top), !lod || big || this.cam.s > 5);
    }
    const seen = new Set<string>();
    for (const st of s.stations) {
      const key = `st:${st.id}`;
      seen.add(key);
      const el = this.label(key, 'tag st-tag');
      const chips = close
        ? (Object.keys(st.waiting) as Cargo[])
            .filter((c) => (st.waiting[c] ?? 0) >= 1)
            .map((c) => `<span class="chip">${cargoIcon(c)}<b>${Math.floor(st.waiting[c] ?? 0)}</b></span>`)
            .join('')
        : '';
      this.setHtml(el, `<span class="nm">${st.name}</span>${chips ? `<span class="chips">${chips}</span>` : ''}`);
      const p = this.cellPoint(st.cell);
      this.place(el, { x: p.x, y: p.y + Math.max(10, this.cam.s * 0.7) }, !lod);
    }
    for (const t of s.trains) {
      const key = `tr:${t.id}`;
      seen.add(key);
      const el = this.label(key, 'tag tr-tag');
      const warn = t.state === 'broken' ? '!' : t.state === 'lost' ? '?' : t.waiting ? '…' : '';
      this.setHtml(el, warn ? `<b>${warn}</b>` : '');
      if (!warn || lod) {
        el.style.display = 'none';
        continue;
      }
      const p = along(s, t, t.pos);
      this.place(el, { x: this.sx(p.x), y: this.sy(p.y, p.z / TERRACE_M) - 18 });
    }
    for (const [key, el] of this.labels)
      if ((key.startsWith('st:') || key.startsWith('tr:')) && !seen.has(key)) {
        el.remove();
        this.labels.delete(key);
      }
    // the floats: money in and out, notes
    const live = new Set<object>();
    for (const f of s.floats) {
      live.add(f);
      let el = this.floatEls.get(f);
      if (!el) {
        el = document.createElement('div');
        el.className = `float ${f.kind}`;
        el.textContent = f.text;
        this.overlay.appendChild(el);
        this.floatEls.set(f, el);
      }
      const p = this.project(f.x, f.y);
      const u = f.age / (f.life ?? 1.8);
      el.style.opacity = String(Math.max(0, 1 - u * u));
      this.place(el, { x: p.x, y: p.y - u * 30 });
    }
    for (const [f, el] of this.floatEls)
      if (!live.has(f)) {
        el.remove();
        this.floatEls.delete(f);
      }
  }
}

/** a station: the platform along the track on its north side, the house on it, longer for a bigger station */
function stationShape(v: View, x: number, y: number, ux: number, uy: number, nx: number, ny: number, len: number, lv: number, size: StationSize): void {
  const { c, S } = v;
  const X = v.x(x);
  const Y = v.y(y, lv);
  const ang = Math.atan2(uy, ux);
  c.save();
  c.translate(X + nx * S * 0.62, Y + ny * S * 0.62);
  c.rotate(ang);
  const L = len * S * 0.9;
  c.fillStyle = '#b9ab8f';
  c.strokeStyle = OUT;
  c.lineWidth = Math.max(1, S * 0.05);
  c.fillRect(-L / 2, -S * 0.2, L, S * 0.4);
  c.strokeRect(-L / 2, -S * 0.2, L, S * 0.4);
  c.fillStyle = '#d6c9a8';
  c.fillRect(-L / 2, -S * 0.2, L, S * 0.08);
  c.restore();
  // the house beside the platform, upright on the screen
  const hx = x + nx * (1.25 + size * 0.1);
  const hy = y + ny * (1.25 + size * 0.1);
  const w = 0.9 + size * 0.35;
  building(v, hx - w / 2, hy - 0.45, w, 0.7, { walls: '#d9a441', roof: '#7a3a2a', wall: 0.55 + size * 0.15, door: 1, lv });
  void platform;
}

/**
 * A scenario's whole map in the whole-map look, drawn once on an offscreen canvas of w by h CSS
 * pixels, with a dot for each site.
 */
export function mapPreview(sc: ScenarioDef, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const st = createState(sc);
  const r = new Renderer2D(canvas, document.createElement('div'), st);
  r.backdrop = true;
  r.fixed = { w, h };
  r.resize();
  r.setView(st.w / 2, st.h / 2, 0);
  r.draw(0);
  const c = canvas.getContext('2d')!;
  const DOT: Record<string, string> = { town: '#b5382c', forest: '#2f5f30', farm: '#d9bd5a', sawmill: '#8a6a44', papermill: '#efe6cf', mill: '#efe6cf' };
  for (const site of st.sites) {
    const p = r.project(site.cx + 0.5, site.cy + 0.5, 0);
    c.fillStyle = '#16120e';
    c.beginPath();
    c.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = DOT[site.kind] ?? '#d8a63a';
    c.beginPath();
    c.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
    c.fill();
  }
  r.dispose();
  return canvas;
}

export { STATIONS };
