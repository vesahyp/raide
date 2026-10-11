/**
 * Fingers on the map (ADR 0007): RT2's mouse controls mapped to a thumb.
 *
 * Browse: one finger pans, two fingers pinch, a tap opens what is under it (a train, a station, a
 * site, a piece of track).
 *
 * Track: one finger lays track. The drag starts on any tile (snapping to laid track or a station
 * near the finger) and the route follows the finger; a finger that rests a moment on a tile pins
 * the route through it (a bend point). The lift leaves the planned route on the map for Build or
 * Cancel. Two fingers move and pinch the map. A tap on laid track selects the piece for removal.
 *
 * Station: the catchment square follows the finger, snapped to the nearest straight laid track; the
 * lift leaves it for the card's Build.
 *
 * Route: a tap on a station adds it as the next stop; one finger still pans.
 *
 * Pointer events, so a mouse works the same way. Near the edge of the screen a drag in track mode
 * scrolls the map.
 */
import type { SimState, Site, Station, Train } from '../game/types';
import { idx, linksOf, routeOptions, type Route } from '../game/grid';
import { stationAt } from '../game/state';
import { stationBlock } from '../game/sim';
import type { Renderer2D } from '../render/render2d';

export type Tool = 'browse' | 'track' | 'station' | 'route';

export interface Plan {
  from: number;
  to: number;
  via: number[];
  options: Route[];
}

export interface InputEvents {
  onTrain: (t: Train) => void;
  onStation: (st: Station) => void;
  onSite: (site: Site) => void;
  /** a tap on laid track: in browse mode and track mode alike */
  onTrack: (cell: number) => void;
  /** a tap on nothing */
  onGround: () => void;
  /** track mode: the drag ended with a route to build, or none */
  onPlan: (plan: Plan | null) => void;
  /** station mode: the finger lifted on a cell (ok says whether a station can stand there) */
  onStationSpot: (cell: number, ok: boolean) => void;
  /** route mode: a station was tapped */
  onStop: (st: Station) => void;
  /** any touch */
  onAny: () => void;
}

/** seconds a finger rests on a tile before the route bends through it */
const DWELL = 0.35;
/** a dragging finger this close to the edge of the free area scrolls the map, px, and the speed, px a second */
const EDGE = 44;
const EDGE_SPEED = 520;
/** px a finger may move and still be a tap */
const TAP = 12;

interface Finger {
  id: number;
  x: number;
  y: number;
  x0: number;
  y0: number;
}

export class Input {
  tool: Tool = 'browse';
  /** the drag that lays track, while the finger is down */
  drag: { from: number; to: number; via: number[]; route: Route | null; sx: number; sy: number } | null = null;
  /** station mode: the cell the catchment square stands on, and whether a station fits there */
  spot: { cell: number; ok: boolean } | null = null;
  private fingers: Finger[] = [];
  private mode: 'none' | 'pan' | 'lay' | 'spot' = 'none';
  private pinch: { dist: number; mx: number; my: number } | null = null;
  private moved = 0;
  private dragId = -1;
  private dwell = 0;
  private dwellCell = -1;
  private noClickUntil = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private s: SimState,
    private r: Renderer2D,
    private ev: InputEvents,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.drag = null;
    this.spot = null;
    this.mode = 'none';
  }

  /** a tap that opens a card must not send its click on to the button the card puts under the finger */
  private onTouchEnd = (e: TouchEvent): void => {
    if (performance.now() < this.noClickUntil) e.preventDefault();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.r.pinch(Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
  };

  /** the start of a drag in track mode: laid track or a station within reach of the finger, else the tile itself */
  private snapStart(sx: number, sy: number): number {
    const st = this.r.stationNear(sx, sy);
    if (st) return st.cell;
    return this.snapTrack(sx, sy) ?? this.r.cellAt(sx, sy);
  }

  /** the laid cell nearest the finger within reach, preferring track ends */
  private snapTrack(sx: number, sy: number): number | null {
    const p = this.r.pick(sx, sy);
    const reach = Math.max(0.75, 18 / this.r.scale);
    let best: number | null = null;
    let bd = reach;
    const s = this.s;
    for (let y = Math.floor(p.y - 2); y <= Math.floor(p.y + 2); y++)
      for (let x = Math.floor(p.x - 2); x <= Math.floor(p.x + 2); x++) {
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        const i = idx(s, x, y);
        if (!s.track[i]) continue;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) - (linksOf(s, i).length === 1 ? 0.25 : 0);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    return best;
  }

  /** the cell a station would stand on: the nearest laid track cell to the finger where one fits, else the nearest laid cell */
  private snapStation(sx: number, sy: number): { cell: number; ok: boolean } | null {
    const p = this.r.pick(sx, sy);
    const s = this.s;
    let best: { cell: number; ok: boolean; d: number } | null = null;
    for (let y = Math.floor(p.y - 2); y <= Math.floor(p.y + 2); y++)
      for (let x = Math.floor(p.x - 2); x <= Math.floor(p.x + 2); x++) {
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        const i = idx(s, x, y);
        if (!s.track[i]) continue;
        const ok = stationBlock(s, i) === null;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) - (ok ? 0.6 : 0);
        if (!best || d < best.d) best = { cell: i, ok, d };
      }
    if (best) return { cell: best.cell, ok: best.ok };
    const c = this.r.cellAt(sx, sy);
    return c < 0 ? null : { cell: c, ok: false };
  }

  private onDown = (e: PointerEvent): void => {
    this.ev.onAny();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.fingers.push({ id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (this.fingers.length === 1) {
      this.moved = 0;
      this.dragId = e.pointerId;
      if (this.tool === 'track' && !this.r.whole) {
        const from = this.snapStart(e.clientX, e.clientY);
        if (from >= 0) {
          this.mode = 'lay';
          this.drag = { from, to: from, via: [], route: null, sx: e.clientX, sy: e.clientY };
          this.dwell = 0;
          this.dwellCell = from;
          return;
        }
      }
      if (this.tool === 'station' && !this.r.whole) {
        this.mode = 'spot';
        this.spot = this.snapStation(e.clientX, e.clientY);
        return;
      }
      this.mode = 'pan';
    } else if (this.fingers.length === 2) {
      // a second finger: the map pinches, and a drag in progress is dropped
      this.drag = null;
      this.mode = 'pan';
      this.moved = 99;
      this.startPinch();
    }
  };

  private startPinch(): void {
    const [a, b] = this.fingers;
    this.pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  /** each frame: a finger resting during a drag bends the route; a drag at the edge scrolls the map */
  update(dt: number): void {
    const d = this.drag;
    if (!d || this.mode !== 'lay') return;
    const cell = this.r.cellAt(d.sx, d.sy);
    if (cell === this.dwellCell) {
      this.dwell += dt;
      const last = d.via.length ? d.via[d.via.length - 1] : d.from;
      const far = Math.hypot((cell % this.s.w) - (last % this.s.w), Math.floor(cell / this.s.w) - Math.floor(last / this.s.w)) >= 3;
      if (this.dwell >= DWELL && far && this.moved > TAP && d.route) {
        d.via.push(cell);
        this.dwell = -99;
        this.aim();
      }
    } else {
      this.dwellCell = cell;
      this.dwell = 0;
    }
    const a = this.r.area();
    const near = (dist: number) => Math.min(1, Math.max(0, (EDGE - dist) / EDGE));
    const vx = near(a.l + a.w - d.sx) - near(d.sx - a.l);
    const vy = near(a.t + a.h - d.sy) - near(d.sy - a.t);
    if (vx === 0 && vy === 0) return;
    this.r.pan(-vx * EDGE_SPEED * dt, -vy * EDGE_SPEED * dt);
    this.aim();
  }

  private onMove = (e: PointerEvent): void => {
    const f = this.fingers.find((o) => o.id === e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x;
    const dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    this.moved = Math.max(this.moved, Math.hypot(f.x - f.x0, f.y - f.y0));
    if (this.pinch && this.fingers.length >= 2) {
      const [a, b] = this.fingers;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.r.pinch(dist / Math.max(1, this.pinch.dist), mx, my, this.pinch.mx, this.pinch.my);
      this.pinch = { dist, mx, my };
      return;
    }
    if (this.mode === 'pan') {
      if (this.moved > 6) this.r.pan(dx, dy);
      return;
    }
    if (this.mode === 'spot') {
      this.spot = this.snapStation(e.clientX, e.clientY);
      return;
    }
    if (this.mode === 'lay' && this.drag && e.pointerId === this.dragId) {
      this.drag.sx = e.clientX;
      this.drag.sy = e.clientY;
      this.aim();
    }
  };

  /** the route from the drag's start through its bend points to the tile under the finger (laid track near it snaps) */
  private aim(): void {
    const d = this.drag;
    if (!d) return;
    const raw = this.r.cellAt(d.sx, d.sy);
    if (raw < 0) return;
    const to = this.snapTrack(d.sx, d.sy) ?? raw;
    if (to === d.to && d.route) return;
    d.to = to;
    if (to === d.from) {
      d.route = null;
      return;
    }
    d.route = routeOptions(this.s, d.from, to, d.via)[0] ?? null;
  }

  private onCancel = (e: PointerEvent): void => {
    const k = this.fingers.findIndex((o) => o.id === e.pointerId);
    if (k >= 0) this.fingers.splice(k, 1);
    this.pinch = null;
    this.drag = null;
    this.spot = null;
    this.mode = 'none';
  };

  private onUp = (e: PointerEvent): void => {
    const k = this.fingers.findIndex((o) => o.id === e.pointerId);
    if (k < 0) return;
    this.fingers.splice(k, 1);
    if (this.pinch) {
      this.pinch = null;
      if (this.fingers.length >= 2) this.startPinch();
      else this.mode = 'pan';
      return;
    }
    if (this.fingers.length) return;
    const mode = this.mode;
    this.mode = 'none';
    const moved = this.moved;
    if (mode === 'lay') {
      const d = this.drag;
      this.drag = null;
      if (d && moved > TAP && d.route) {
        const options = routeOptions(this.s, d.from, d.to, d.via);
        this.noClickUntil = performance.now() + 300;
        this.ev.onPlan(options.length ? { from: d.from, to: d.to, via: d.via, options } : null);
        return;
      }
      // a tap in track mode: a piece of track is selected
      const cell = this.r.cellAt(e.clientX, e.clientY);
      const snap = this.snapTrack(e.clientX, e.clientY);
      if (snap !== null) return this.ev.onTrack(snap);
      if (cell >= 0 && this.s.track[cell]) return this.ev.onTrack(cell);
      this.ev.onPlan(null);
      return;
    }
    if (mode === 'spot') {
      const sp = this.spot;
      if (sp) {
        this.noClickUntil = performance.now() + 300;
        this.ev.onStationSpot(sp.cell, sp.ok);
      }
      return;
    }
    if (moved > TAP) return;
    this.noClickUntil = performance.now() + 300;
    this.tap(e.clientX, e.clientY);
  };

  private tap(sx: number, sy: number): void {
    const s = this.s;
    if (this.r.whole) {
      const p = this.r.pick(sx, sy);
      this.r.glideTo(p.x, p.y, 22);
      return this.ev.onGround();
    }
    if (this.tool === 'route') {
      const st = this.r.stationNear(sx, sy);
      if (st) return this.ev.onStop(st);
      return this.ev.onGround();
    }
    const train = this.r.trainAt(sx, sy);
    if (train) return this.ev.onTrain(train);
    const st = this.r.stationNear(sx, sy);
    if (st) return this.ev.onStation(st);
    const cell = this.r.cellAt(sx, sy);
    if (cell >= 0) {
      const k = s.siteOf[cell];
      if (k >= 0) return this.ev.onSite(s.sites[k]);
      const snap = this.snapTrack(sx, sy);
      if (snap !== null && !stationAt(s, snap)) return this.ev.onTrack(snap);
      // a site's name tag stands above its buildings
      for (const site of s.sites) {
        const p = this.r.project(site.cx + 0.5, site.cy + 0.5 - (site.kind === 'town' ? 3.4 : 2.2));
        if (Math.abs(p.x - sx) < 50 && Math.abs(p.y - sy) < 16) return this.ev.onSite(site);
      }
    }
    this.ev.onGround();
  }
}
