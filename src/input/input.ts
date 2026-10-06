/**
 * One finger on the map. A drag that starts on a station builds track to
 * the site or station it ends on; the route and its cost follow the finger.
 * A tap on a station, a track cell or a train opens the line's card. Pointer
 * events, so a mouse works the same way. No pan, no zoom in this slice: the
 * camera shows the whole map.
 */
import type { SimState, Line } from '../game/types';
import { plan, build, lineOf, along, trainLength } from '../game/sim';
import { idx, inside, route, type Route } from '../game/grid';
import { stationAt, siteAt } from '../game/state';
import { toWorld, type Camera } from '../render/camera';

export interface Drag {
  from: number;
  to: number | null;
  route: Route | null;
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
  /** a tap on something of a line */
  onLine: (line: Line) => void;
  /** a tap on a site with no station, or a build the cash does not cover */
  onNote: (cell: number, text: string) => void;
  onAny: () => void;
}

/** how close to a station's centre a finger must land to start a drag, in cells */
const GRAB = 1.1;
/** how close to a site's centre the finger must be for the route to snap to it */
const SNAP = 1.4;

export class Input {
  drag: Drag | null = null;
  private down: { x: number; y: number; cell: number; id: number } | null = null;
  constructor(
    private canvas: HTMLCanvasElement,
    private s: SimState,
    private cam: () => Camera,
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
    const p = toWorld(this.cam(), sx, sy);
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
      const d = Math.hypot(st.cell % this.s.w + 0.5 - x, Math.floor(st.cell / this.s.w) + 0.5 - y);
      if (d < bd) {
        bd = d;
        best = st.cell;
      }
    }
    return best;
  }

  private siteNear(x: number, y: number, reach: number): number | null {
    let best: number | null = null;
    let bd = reach;
    for (const site of this.s.sites) {
      const d = Math.hypot(site.cx + 0.5 - x, site.cy + 0.5 - y);
      if (d < bd) {
        bd = d;
        best = idx(this.s, site.cx, site.cy);
      }
    }
    return best;
  }

  private onDown = (e: PointerEvent): void => {
    this.ev.onAny();
    if (this.down) return;
    const at = this.cellAt(e.clientX, e.clientY);
    if (!at) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.down = { x: e.clientX, y: e.clientY, cell: at.cell, id: e.pointerId };
    const from = this.stationNear(at.x, at.y, GRAB);
    if (from !== null) this.drag = { from, to: null, route: null, sx: e.clientX, sy: e.clientY, ok: false, loose: true };
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.down || e.pointerId !== this.down.id) return;
    if (!this.drag) return;
    const d = this.drag;
    d.sx = e.clientX;
    d.sy = e.clientY;
    const at = this.cellAt(e.clientX, e.clientY);
    if (!at) {
      d.to = null;
      d.route = null;
      return;
    }
    const target = this.siteNear(at.x, at.y, SNAP);
    // snapped to a site: the route that would be built; elsewhere: the track under the finger, a preview
    const to = target ?? at.cell;
    if (to === d.to) return;
    d.to = to;
    d.loose = target === null;
    d.route = to === d.from ? null : target !== null ? plan(this.s, d.from, target) : route(this.s, d.from, to);
    d.ok = !d.loose && !!d.route && d.route.cost <= this.s.cash;
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.down || e.pointerId !== this.down.id) return;
    const down = this.down;
    const drag = this.drag;
    this.down = null;
    this.drag = null;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (drag && drag.route && !drag.loose && moved > 12) {
      if (drag.route.cost > this.s.cash) {
        this.ev.onNote(drag.route.cells[drag.route.cells.length - 1], 'cash');
        return;
      }
      const line = build(this.s, drag.route);
      if (line) this.ev.onBuild(line, e.clientX, e.clientY);
      return;
    }
    if (moved > 12) return;
    // a tap: a train, a station, a track cell, or a site without a station
    const at = this.cellAt(e.clientX, e.clientY);
    if (!at) return;
    const train = this.trainNear(at.x, at.y);
    if (train) return this.ev.onLine(train);
    const st = stationAt(this.s, at.cell) ? at.cell : this.stationNear(at.x, at.y, GRAB);
    if (st !== null) {
      const line = this.s.lines.find((l) => l.path[0] === st || l.path[l.path.length - 1] === st);
      if (line) return this.ev.onLine(line);
    }
    const onTrack = this.s.lines.find((l) => l.path.includes(at.cell));
    if (onTrack) return this.ev.onLine(onTrack);
    const site = this.siteNear(at.x, at.y, SNAP);
    if (site !== null && siteAt(this.s, site) && !stationAt(this.s, site)) this.ev.onNote(site, 'drag');
  };

  private trainNear(x: number, y: number): Line | null {
    for (const t of this.s.trains) {
      const line = lineOf(this.s, t);
      const L = trainLength(t);
      for (let k = 0; k <= 3; k++) {
        const p = along(line, t.s - t.dir * (L * k) / 3, this.s.w);
        if (Math.hypot(p.x - x, p.y - y) < 0.9) return line;
      }
    }
    return null;
  }
}
