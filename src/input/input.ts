/**
 * Fingers on the map. A drag that starts on a station or on a cell of laid
 * track builds track to the tile it ends on (a site, a station or open
 * ground, where it leaves a track end); the route and its cost follow the
 * finger, and when the lake or a hill offers two routes the lift hands them
 * to the UI to choose from. A drag that starts anywhere else pans the view. Two
 * fingers pinch to zoom and move the view, also while a drag from a station
 * goes on (the drag stays, the finger that holds it keeps aiming). Near an
 * edge of the screen a drag scrolls the view, faster the closer it gets
 * (`update`, called each frame). On the whole-map zoom a drag only pans, a
 * tap on a train follows it and a tap anywhere else zooms in there. A tap on
 * a train opens its card and the camera follows it; a tap on a site or on its
 * name and chips opens the site's; a tap on a station or a track cell the line's. Pointer events, so a
 * mouse works the same way (one finger only). With `laying` set (the site card's
 * "lay track from here") a tap on a marked site builds as the lift of a drag would.
 */
import type { SimState, Line, Site, Train } from '../game/types';
import { plan, endable } from '../game/sim';
import { lengthenOptions, type Lengthen } from '../game/advice';
import { idx, inside, routeVia, type Route } from '../game/grid';
import { siteAt } from '../game/state';
import { stationAt } from '../game/state';
import type { Renderer2D } from '../render/render2d';

export interface Drag {
  from: number;
  to: number | null;
  /** the route drawn under the finger: the cheap one of the options, or the one to open ground */
  route: Route | null;
  options: Route[];
  /** the finger, screen px */
  sx: number;
  sy: number;
  ok: boolean;
  /** the route runs to the finger's cell, not to a site: the lift lays a track end there */
  loose: boolean;
  /** the tiles the finger paused on, which the route runs through, in the order of the drag */
  via: number[];
}

/**
 * The route the player has drawn and not built yet: what the lift of a drag (or a tap in pick mode)
 * leaves on the map until Build or Cancel. `via` are the waypoints the route is bent through,
 * `options` the ways to the end (the cheap one and the short one), `extend` the lines the new stop
 * could lengthen, each with its own routes.
 */
export interface Plan {
  from: number;
  to: number;
  via: number[];
  options: Route[];
  extend: Lengthen[];
}

/** every route a plan offers, the new line's first and then the lengthenings', each with the line it lengthens */
export function planRoutes(p: Plan): { route: Route; extendId?: number }[] {
  return [...p.options.map((route) => ({ route })), ...p.extend.flatMap((e) => e.options.map((route) => ({ route, extendId: e.line.id })))];
}

export interface InputEvents {
  /** a tap on laid track that no line runs over */
  onTrack: (cell: number) => void;
  /**
   * the route the player drew waits on the map for Build or Cancel, or is gone (null). Called again
   * when the route is bent or a waypoint is taken away.
   */
  onPlan: (plan: Plan | null, sx: number, sy: number) => void;
  onLine: (line: Line) => void;
  onTrain: (train: Train) => void;
  onSite: (site: Site) => void;
  /** a tap on nothing: the cards close, the camera lets go of its train */
  onGround: () => void;
  /** a build the cash does not cover */
  onNote: (cell: number, text: string) => void;
  onAny: () => void;
  /** pick mode is over: a tap built or offered the choice (`kept`, the view stays) or fell on nothing */
  onLayEnd: (kept: boolean) => void;
  /** pick mode for a passing siding: a tap on the line's cell, which the UI tries to place the loop at */
  onSiding: (lineId: number, cell: number) => void;
  /** a tap in the siding's pick mode fell away from the line: the mode is over */
  onSidingEnd: () => void;
}

/** how close to a station's centre a finger must land to start a drag, in cells */
const GRAB = 1.1;
/** how close to the centre of a cell of laid track a finger must land to start a drag from it, in cells */
const GRAB_TRACK = 0.8;
/** how close to a site's centre the finger must be for the route to snap to it */
const SNAP = 1.4;
/** seconds a finger stays on one tile before the route is pinned to it */
const DWELL = 0.3;
/** seconds a finger rests on laid track before a drag starts from it */
const ARM = 0.3;
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
  /**
   * Pick mode, from the site card's "lay track from here": `cell` is the site's cell. A tap on a
   * marked site does what the lift of a drag on it does; `reverse` is a site with no station,
   * where the marked ones are the stations that can reach it and the track runs from the one tapped.
   */
  laying: { cell: number; reverse: boolean } | null = null;
  /** pick mode for a passing siding: the line whose green stretch takes the tap */
  siding: { lineId: number } | null = null;
  private fingers: Finger[] = [];
  /** the route waiting for Build or Cancel */
  plan: Plan | null = null;
  /** which of the plan's routes is chosen, an index into planRoutes */
  chosen = 0;
  private mode: 'none' | 'build' | 'pan' | 'bend' | 'unway' = 'none';
  /** a plan's waypoint under the finger (for a tap that takes it away), or the index in the route a bend started from */
  private grab = -1;
  /** how long the drag's finger has stayed on one tile, in seconds, and the tile */
  private dwell = 0;
  private dwellCell = -1;
  private bendCell = -1;
  /** a finger resting on laid track: the drag starts from the cell once it has stayed a moment */
  arm: { cell: number; wait: number; id: number } | null = null;
  private pinch: { dist: number; ang: number; mx: number; my: number } | null = null;
  /** the finger that holds the drag */
  private dragId = -1;
  private moved = 0;
  /** until this time (performance.now) the touch that ends sends no click */
  private noClickUntil = 0;
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
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
  }

  /**
   * A tap in pick mode opens a card or a Cancel button under the finger. The browser sends the
   * tap's own click after the touch ends, and it would land on that new button (the first
   * "Extend" choice, or Cancel). Cancelling the touch's default stops the click.
   */
  private onTouchEnd = (e: TouchEvent): void => {
    if (performance.now() < this.noClickUntil) e.preventDefault();
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
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

  /** the cell of laid track under or next to a world point, the nearest one within reach */
  private trackNear(x: number, y: number, reach: number): number | null {
    let best: number | null = null;
    let bd = reach;
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!inside(this.s, fx + dx, fy + dy)) continue;
        const i = idx(this.s, fx + dx, fy + dy);
        if (!this.s.track[i]) continue;
        const d = Math.hypot(fx + dx + 0.5 - x, fy + dy + 0.5 - y);
        if (d < bd) {
          bd = d;
          best = i;
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
      if (this.plan) {
        // a route waits for Build or Cancel: a finger on a waypoint takes it away on a tap, a finger on the ghost bends it, anywhere else pans
        this.mode = 'pan';
        if (at) {
          const w = this.plan.via.findIndex((c) => Math.hypot((c % this.s.w) + 0.5 - at.x, Math.floor(c / this.s.w) + 0.5 - at.y) < 0.9);
          const cells = this.chosenRoute()?.cells ?? [];
          let k = -1;
          let bd = 0.9;
          for (let i = 2; i < cells.length - 2; i++) {
            const d = Math.hypot((cells[i] % this.s.w) + 0.5 - at.x, Math.floor(cells[i] / this.s.w) + 0.5 - at.y);
            if (d < bd) {
              bd = d;
              k = i;
            }
          }
          if (w >= 0) {
            this.mode = 'unway';
            this.grab = w;
          } else if (k >= 0) {
            this.mode = 'bend';
            this.bendBase = null;
            this.grab = k;
            this.bendCell = -1;
          }
        }
        this.dragId = e.pointerId;
        return;
      }
      // a drag starts at a station, or at any cell of laid track (a junction is made there)
      const station = at ? this.stationNear(at.x, at.y, GRAB) : null;
      const from = station;
      if (from !== null && !this.r.whole && !this.laying && !this.siding) {
        this.mode = 'build';
        this.dragId = e.pointerId;
        this.dwell = 0;
        this.dwellCell = -1;
        this.drag = { from, to: null, route: null, options: [], sx: e.clientX, sy: e.clientY, ok: false, loose: true, via: [] };
      } else {
        this.mode = 'pan';
        // a finger that rests on laid track for a moment starts a drag from it; one that moves at once pans the map
        const track = at && !this.r.whole && !this.laying && !this.siding ? this.trackNear(at.x, at.y, GRAB_TRACK) : null;
        if (track !== null) this.arm = { cell: track, wait: 0, id: e.pointerId };
      }
    } else if (this.fingers.length === 2) {
      this.arm = null;
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
    if (this.arm && this.mode === 'pan') {
      this.arm.wait += dt;
      if (this.moved > 8) this.arm = null;
      else if (this.arm.wait >= ARM) {
        const f = this.fingers.find((o) => o.id === this.arm!.id);
        if (f) {
          this.mode = 'build';
          this.dragId = f.id;
          this.dwell = 0;
          this.dwellCell = -1;
          this.drag = { from: this.arm.cell, to: null, route: null, options: [], sx: f.x, sy: f.y, ok: false, loose: true, via: [] };
          this.aim(this.drag);
        }
        this.arm = null;
      }
    }
    const d = this.drag;
    if (!d || this.mode !== 'build') return;
    // a finger that stays on one open tile for a moment pins the route there: a waypoint
    if (d.to !== null && d.to === this.dwellCell) {
      this.dwell += dt;
      if (this.dwell >= DWELL && this.dwell < 1e8 && d.loose && d.to !== d.from && !d.via.includes(d.to) && !siteAt(this.s, d.to) && !this.s.stations.some((st) => st.cell === d.to) && endable(this.s, d.to)) {
        d.via.push(d.to);
        this.dwell = 1e9;
        d.to = -1;
        this.aim(d);
        this.dwellCell = d.to;
      }
    } else {
      this.dwellCell = d.to ?? -1;
      this.dwell = 0;
    }
    // a finger that rests on a site stays: the map scrolls only while the finger is off every site
    if (!d.loose) return;
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
    if (this.mode === 'bend' && this.plan && this.moved > 8) {
      // the ghost follows the finger: a waypoint on the tile under it, the route found again on each new tile
      const at = this.cellAt(e.clientX, e.clientY);
      if (at && at.cell !== this.bendCell && endable(this.s, at.cell) && !siteAt(this.s, at.cell) && at.cell !== this.plan.from && at.cell !== this.plan.to) {
        this.bendCell = at.cell;
        this.bent(this.withBend(at.cell), false, e.clientX, e.clientY);
      }
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
      d.options = plan(this.s, d.from, target, undefined, d.via);
      d.route = d.options[0] ?? null;
    } else {
      d.options = [];
      d.route = endable(this.s, to) ? routeVia(this.s, d.from, to, d.via.filter((c) => c !== to)) : null;
    }
    d.ok = !!d.route && d.route.cost <= this.s.cash;
  }

  /** a tap in pick mode: the marked site under the finger gets its track, anything else ends the mode */
  private tapLaying(sx: number, sy: number): void {
    const lay = this.laying!;
    this.laying = null;
    let best: number | null = null;
    let bd = 44;
    for (const site of this.s.sites) {
      const cell = idx(this.s, site.cx, site.cy);
      if (cell === lay.cell || (lay.reverse && !stationAt(this.s, cell))) continue;
      const p = this.r.project(site.cx + 0.5, site.cy + 0.5, 0);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) {
        bd = d;
        best = cell;
      }
    }
    const from = best === null ? null : lay.reverse ? best : lay.cell;
    const to = best === null ? null : lay.reverse ? lay.cell : best;
    const ok = from !== null && to !== null && plan(this.s, from, to).length > 0;
    this.ev.onLayEnd(ok);
    if (!ok || from === null || to === null) return;
    this.lifted(from, to, [], sx, sy);
  }

  /**
   * A drag or a tap in pick mode has settled on a site: a new line is the default. A line the station ends is
   * offered on the card only when one of its trains carries something the new stop takes or makes; two routes ask which
   * way, one route is built. The drag and the pick mode both come here.
   */
  private lifted(from: number, to: number, via: number[], sx: number, sy: number): void {
    this.openPlan(from, to, via.filter((c) => c !== to && c !== from), sx, sy);
  }

  /**
   * The lift of a drag, or a tap in pick mode, leaves the route on the map for the player to build or
   * cancel: nothing is bought until Build. A line the end station has room to lengthen is offered
   * with its own routes beside the new line's.
   */
  private openPlan(from: number, to: number, via: number[], sx: number, sy: number): boolean {
    const options = plan(this.s, from, to, undefined, via);
    if (!options.length) return false;
    this.plan = { from, to, via, options, extend: lengthenOptions(this.s, from, to, via) };
    this.chosen = 0;
    this.noClickUntil = performance.now() + 300;
    this.ev.onPlan(this.plan, sx, sy);
    return true;
  }

  /** the route the plan's chosen button stands for */
  chosenRoute(): Route | null {
    return this.plan ? planRoutes(this.plan)[this.chosen]?.route ?? null : null;
  }

  /** the player picks another of the plan's routes */
  choose(i: number): void {
    this.chosen = i;
  }

  /** Cancel, or the build is done: the ghost route goes */
  cancelPlan(): void {
    this.plan = null;
    this.chosen = 0;
    this.mode = 'none';
    this.grab = -1;
  }

  /** the plan's waypoints with one more at a tile, in the order the route runs through them */
  private withBend(cell: number): number[] {
    const p = this.plan!;
    const base = this.bendBase ?? (this.bendBase = { via: p.via, cells: this.chosenRoute()?.cells ?? [] });
    const at = (c: number) => base.cells.indexOf(c);
    const k = base.cells[this.grab] !== undefined ? this.grab : 0;
    const before = base.via.filter((c) => at(c) >= 0 && at(c) < k).length;
    const out = base.via.slice();
    out.splice(before, 0, cell);
    return out;
  }
  private bendBase: { via: number[]; cells: number[] } | null = null;

  /** the plan with other waypoints: the routes are found again, and the chosen one stays when it still exists */
  private bent(via: number[], full: boolean, sx: number, sy: number): void {
    const p = this.plan;
    if (!p) return;
    const options = plan(this.s, p.from, p.to, undefined, via);
    if (!options.length) return;
    this.plan = { ...p, via, options, extend: full ? lengthenOptions(this.s, p.from, p.to, via) : [] };
    this.chosen = Math.min(this.chosen, planRoutes(this.plan).length - 1);
    this.ev.onPlan(this.plan, sx, sy);
  }

  /** a tap in the siding's pick mode: the line's cell nearest the finger, or the end of the mode when the finger is far from the line */
  private tapSiding(sx: number, sy: number): void {
    const pick = this.siding!;
    const line = this.s.lines.find((l) => l.id === pick.lineId);
    const at = this.cellAt(sx, sy);
    if (!line || !at) return this.ev.onSidingEnd();
    let best = -1;
    let bd = 1.8;
    for (const c of line.path) {
      const d = Math.hypot((c % this.s.w) + 0.5 - at.x, Math.floor(c / this.s.w) + 0.5 - at.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best < 0) return this.ev.onSidingEnd();
    this.ev.onSiding(line.id, best);
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
    this.arm = null;
    const mode = this.mode;
    const drag = this.drag;
    this.mode = 'none';
    this.drag = null;
    if (this.fingers.length) return;
    const moved = this.moved;
    if (mode === 'bend' && this.plan) {
      // the bend is settled: the lengthenings are looked for again on the new route
      if (this.bendCell >= 0) this.bent(this.plan.via, true, e.clientX, e.clientY);
      this.bendCell = -1;
      this.bendBase = null;
      return;
    }
    if (mode === 'unway' && this.plan) {
      if (moved <= 12 && this.grab >= 0) this.bent(this.plan.via.filter((_, i) => i !== this.grab), true, e.clientX, e.clientY);
      return;
    }
    if (this.plan) return;
    if (mode === 'build' && drag && drag.route && moved > 12) {
      const to = drag.route.cells[drag.route.cells.length - 1];
      this.lifted(drag.from, to, drag.via, e.clientX, e.clientY);
      return;
    }
    if (moved > 12) return;
    if (this.laying) return this.tapLaying(e.clientX, e.clientY);
    if (this.siding) return this.tapSiding(e.clientX, e.clientY);
    // a tap: a train, a station, a track cell, or a site
    const train = this.r.trainAt(e.clientX, e.clientY);
    if (this.r.whole) {
      // the whole map is a map: a train is followed, anything else zooms in there
      if (train) return this.ev.onTrain(train);
      this.r.zoomAt(e.clientX, e.clientY);
      return this.ev.onGround();
    }
    // a tap on a site's name and chips opens the site
    const tagged = this.r.siteTagAt(e.clientX, e.clientY);
    if (tagged) return this.ev.onSite(tagged);
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
    // laid track that no line runs over: its card offers to lift a dead end
    const free = this.s.track[at.cell] ? at.cell : this.trackNear(at.x, at.y, GRAB_TRACK);
    if (free !== null) return this.ev.onTrack(free);
    this.ev.onGround();
  };
}
