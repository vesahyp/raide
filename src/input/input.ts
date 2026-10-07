/**
 * Fingers on the map. A drag that starts on a station builds track to the
 * site or station it ends on; the route and its cost follow the finger,
 * and when the lake or a hill offers two routes the lift hands them to the
 * UI to choose from. A drag that starts anywhere else pans the view. Two
 * fingers pinch to zoom and move the view, also while a drag from a station
 * goes on (the drag stays, the finger that holds it keeps aiming). Near an
 * edge of the screen a drag scrolls the view, faster the closer it gets
 * (`update`, called each frame). On the whole-map zoom a drag only pans, a
 * tap on a train follows it and a tap anywhere else zooms in there. A tap on
 * a train opens its card and the camera follows it; a tap on a site opens the
 * site's; a tap on a station or a track cell the line's. Pointer events, so a
 * mouse works the same way (one finger only).
 */
import type { SimState, Line, Site, Train } from '../game/types';
import { plan, build } from '../game/sim';
import { idx, inside, route, type Route } from '../game/grid';
import { stationAt } from '../game/state';
import type { Renderer2D } from '../render/render2d';

export interface Drag {
  from: number;
  to: number | null;
  /** the route drawn under the finger: the cheap one of the options, or the loose preview */
  route: Route | null;
  options: Route[];
  /** the finger, screen px */
  sx: number;
  sy: number;
  ok: boolean;
  /** the route runs to the finger's cell, not to a site: a preview that builds nothing */
  loose: boolean;
}

export interface InputEvents {
  /** a build landed: the line, and where the finger lifted (screen px) */
  onBuild: (line: Line, sx: number, sy: number) => void;
  /** the lift offers two routes: the UI asks which */
  onChoice: (options: Route[], sx: number, sy: number) => void;
  onLine: (line: Line) => void;
  onTrain: (train: Train) => void;
  onSite: (site: Site) => void;
  /** a tap on nothing: the cards close, the camera lets go of its train */
  onGround: () => void;
  /** a build the cash does not cover */
  onNote: (cell: number, text: string) => void;
  onAny: () => void;
}

/** how close to a station's centre a finger must land to start a drag, in cells */
const GRAB = 1.1;
/** how close to a site's centre the finger must be for the route to snap to it */
const SNAP = 1.4;
/** a dragging finger this close to the edge of the free area scrolls the view, in px */
const EDGE = 48;
/** the scroll speed at the edge, px a second */
const EDGE_SPEED = 600;

interface Finger {
  id: number;
  x: number;
  y: number;
  x0: number;
  y0: number;
}

export class Input {
  drag: Drag | null = null;
  private fingers: Finger[] = [];
  private mode: 'none' | 'build' | 'pan' = 'none';
  private pinch: { dist: number; ang: number; mx: number; my: number } | null = null;
  /** the finger that holds the drag */
  private dragId = -1;
  private moved = 0;
  constructor(
    private canvas: HTMLCanvasElement,
    private s: SimState,
    private r: Renderer2D,
    private ev: InputEvents,
  ) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
  }

  private cellAt(sx: number, sy: number): { cell: number; x: number; y: number } | null {
    const p = this.r.pick(sx, sy);
    if (!p) return null;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (!inside(this.s, x, y)) return null;
    return { cell: idx(this.s, x, y), x: p.x, y: p.y };
  }

  /** the station within reach of a world point */
  private stationNear(x: number, y: number, reach: number): number | null {
    let best: number | null = null;
    let bd = reach;
    for (const st of this.s.stations) {
      const d = Math.hypot((st.cell % this.s.w) + 0.5 - x, Math.floor(st.cell / this.s.w) + 0.5 - y);
      if (d < bd) {
        bd = d;
        best = st.cell;
      }
    }
    return best;
  }

  private siteNear(x: number, y: number, reach: number): Site | null {
    let best: Site | null = null;
    let bd = reach;
    for (const site of this.s.sites) {
      const d = Math.hypot(site.cx + 0.5 - x, site.cy + 0.5 - y);
      if (d < bd) {
        bd = d;
        best = site;
      }
    }
    return best;
  }

  private onDown = (e: PointerEvent): void => {
    this.ev.onAny();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.fingers.push({ id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (this.fingers.length === 1) {
      this.moved = 0;
      const at = this.cellAt(e.clientX, e.clientY);
      const from = at ? this.stationNear(at.x, at.y, GRAB) : null;
      if (from !== null && !this.r.whole) {
        this.mode = 'build';
        this.dragId = e.pointerId;
        this.drag = { from, to: null, route: null, options: [], sx: e.clientX, sy: e.clientY, ok: false, loose: true };
      } else this.mode = 'pan';
    } else if (this.fingers.length === 2) {
      // a second finger: the view pinches; a drag from a station goes on under its own finger
      if (this.mode === 'none') this.mode = 'pan';
      this.startPinch();
    }
  };

  private startPinch(): void {
    const [a, b] = this.fingers;
    this.pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  /** each frame: a drag near the edge scrolls the view, and the route follows the map moving under the finger */
  update(dt: number): void {
    const d = this.drag;
    if (!d || this.mode !== 'build') return;
    const a = this.r.area();
    // 1 at the edge or beyond it, 0 at EDGE away
    const near = (dist: number) => Math.min(1, Math.max(0, (EDGE - dist) / EDGE));
    const vx = near(a.l + a.w - d.sx) - near(d.sx - a.l);
    const vy = near(a.t + a.h - d.sy) - near(d.sy - a.t);
    if (vx === 0 && vy === 0) return;
    // the view moves toward the edge, so the map moves the other way under the finger
    this.r.pan(-vx * EDGE_SPEED * dt, -vy * EDGE_SPEED * dt);
    this.aim(d);
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
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.r.pinch(dist / Math.max(1, this.pinch.dist), 0, mx, my, this.pinch.mx, this.pinch.my);
      this.pinch = { dist, ang, mx, my };
      // the drag's finger may not have moved, but the map did
      const held = this.fingers.find((o) => o.id === this.dragId);
      if (this.drag && held) {
        this.drag.sx = held.x;
        this.drag.sy = held.y;
        this.aim(this.drag);
      }
      return;
    }
    if (this.mode === 'pan') {
      if (this.moved > 6) this.r.pan(dx, dy);
      return;
    }
    if (this.mode !== 'build' || !this.drag) return;
    if (e.pointerId !== this.dragId) return;
    const d = this.drag;
    d.sx = e.clientX;
    d.sy = e.clientY;
    this.aim(d);
  };

  /** plan the route to what is under the drag's finger now */
  private aim(d: Drag): void {
    const at = this.cellAt(d.sx, d.sy);
    if (!at) {
      d.to = null;
      d.route = null;
      d.options = [];
      return;
    }
    const site = this.siteNear(at.x, at.y, SNAP);
    const target = site ? idx(this.s, site.cx, site.cy) : null;
    // snapped to a site: the routes that could be built; elsewhere: the track under the finger, a preview
    const to = target ?? at.cell;
    if (to === d.to) return;
    d.to = to;
    d.loose = target === null;
    if (to === d.from) {
      d.route = null;
      d.options = [];
    } else if (target !== null) {
      d.options = plan(this.s, d.from, target);
      d.route = d.options[0] ?? null;
    } else {
      d.options = [];
      d.route = route(this.s, d.from, to);
    }
    d.ok = !d.loose && !!d.route && d.route.cost <= this.s.cash;
  }

  private onUp = (e: PointerEvent): void => {
    const k = this.fingers.findIndex((o) => o.id === e.pointerId);
    if (k < 0) return;
    this.fingers.splice(k, 1);
    if (this.pinch) {
      this.pinch = null;
      if (this.fingers.length >= 2) this.startPinch();
      else if (this.mode === 'build' && this.drag && e.pointerId !== this.dragId) {
        // the drag's finger stays and goes on aiming
        this.drag.sx = this.fingers[0].x;
        this.drag.sy = this.fingers[0].y;
        this.aim(this.drag);
      } else {
        // the pinch ended, or the drag's own finger left: one finger left pans
        this.drag = null;
        this.mode = 'pan';
        this.moved = 99;
      }
      return;
    }
    const mode = this.mode;
    const drag = this.drag;
    this.mode = 'none';
    this.drag = null;
    if (this.fingers.length) return;
    const moved = this.moved;
    if (mode === 'build' && drag && drag.route && !drag.loose && moved > 12) {
      if (drag.options.length > 1) {
        this.ev.onChoice(drag.options, e.clientX, e.clientY);
        return;
      }
      if (drag.route.cost > this.s.cash) {
        this.ev.onNote(drag.route.cells[drag.route.cells.length - 1], 'cash');
        return;
      }
      const line = build(this.s, drag.route);
      if (line) this.ev.onBuild(line, e.clientX, e.clientY);
      return;
    }
    if (moved > 12) return;
    // a tap: a train, a station, a track cell, or a site
    const train = this.r.trainAt(e.clientX, e.clientY);
    if (this.r.whole) {
      // the whole map is a map: a train is followed, anything else zooms in there
      if (train) return this.ev.onTrain(train);
      this.r.zoomAt(e.clientX, e.clientY);
      return this.ev.onGround();
    }
    const at = this.cellAt(e.clientX, e.clientY);
    if (!at) {
      if (train) return this.ev.onTrain(train);
      return this.ev.onGround();
    }
    // the site's own cell is the site's, even with a train standing in its station
    const close = this.siteNear(at.x, at.y, 0.7);
    if (close) return this.ev.onSite(close);
    if (train) return this.ev.onTrain(train);
    const st = stationAt(this.s, at.cell) ? at.cell : this.stationNear(at.x, at.y, GRAB);
    const site = this.siteNear(at.x, at.y, SNAP);
    if (site) return this.ev.onSite(site);
    if (st !== null) {
      const line = this.s.lines.find((l) => l.path[0] === st || l.path[l.path.length - 1] === st);
      if (line) return this.ev.onLine(line);
    }
    const onTrack = this.s.lines.find((l) => l.path.includes(at.cell));
    if (onTrack) return this.ev.onLine(onTrack);
    this.ev.onGround();
  };
}
