/**
 * The map on Canvas 2D. Everything is drawn with paths: no image assets.
 * The static layer (land, water, sites) is baked once per size into an
 * offscreen canvas in map orientation and blitted through the camera's
 * transform; the track, the trains, the smoke and the floats are drawn on
 * top each frame. Text stays upright: it is drawn in screen space after
 * converting the point, so a turned map keeps readable names.
 */
import type { Good, SimState, Site, Train, WagonType } from '../game/types';
import type { Route } from '../game/grid';
import { DIRS, cx, cy, idx } from '../game/grid';
import { along, centre, lineOf, trainLength } from '../game/sim';
import { ENGINE_LEN, WAGON_LEN } from '../game/content/economy';
import { fitCamera, toScreen, type Camera, type Insets } from './camera';

/** the Finnish summer palette */
export const PAL = {
  land: '#7ea463',
  land2: '#729a5a',
  tree: '#3f7343',
  tree2: '#2f5a36',
  water: '#9fc8d8',
  water2: '#b9dbe7',
  shore: '#c9c08a',
  rail: '#2b2620',
  sleeper: '#6b4f2e',
  deck: '#b58a55',
  deck2: '#8d6a3d',
  platform: '#d9c7a0',
  ink: '#1b1a16',
  houseRed: '#b5382c',
  houseOchre: '#d4a64c',
  roof: '#4a2f24',
  engine: '#1f1d1a',
  brass: '#d8a63a',
  flat: '#7b5a3a',
  box: '#8f3b2e',
  timber: '#c69a62',
  boards: '#e8d2a0',
  smoke: 'rgba(240,240,235,0.55)',
  ridge: '#9a7d58',
  ridge2: '#86694a',
  contour: 'rgba(70,45,25,0.35)',
  rock: '#6e665c',
  rock2: '#8c847a',
  field: '#d9c25a',
  field2: '#c4ab45',
  hopper: '#6f6a5a',
  grain: '#e2c04a',
  flour: '#f2efe6',
  sail: '#e8e0cc',
  gold: '#ffd870',
  ghost: 'rgba(27,26,22,0.55)',
  ghostBridge: 'rgba(40,90,140,0.7)',
  ghostBad: 'rgba(180,40,30,0.6)',
};

function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Puff {
  x: number;
  y: number;
  r: number;
  age: number;
  vx: number;
  vy: number;
}

export interface Hint {
  /** the drag the hand shows, from a cell to a cell, looping until the first build */
  from: number;
  to: number;
}

export class Renderer {
  private ctx: CTX;
  private dpr = 1;
  w = 1;
  h = 1;
  cam: Camera;
  private base: HTMLCanvasElement | OffscreenCanvas | null = null;
  private baseKey = '';
  private puffs: Puff[] = [];
  private hintT = 0;
  insets: Insets = { top: 64, bottom: 20, left: 8, right: 8 };

  constructor(
    public canvas: HTMLCanvasElement,
    private s: SimState,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.cam = fitCamera(1, 1, s.w, s.h, this.insets);
    this.resize();
  }

  /** whether the canvas still measures what it was last sized to */
  fits(): boolean {
    return Math.round(this.canvas.clientWidth) === this.w && Math.round(this.canvas.clientHeight) === this.h && Math.min(2, window.devicePixelRatio || 1) === this.dpr;
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.round(this.canvas.clientWidth));
    this.h = Math.max(1, Math.round(this.canvas.clientHeight));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // the HUD is a bar on top in portrait and a column on the left on a phone in landscape (styles.css)
    const column = this.w > this.h && this.h <= 520;
    const insets: Insets = column ? { top: 8, bottom: 8, left: 166, right: 8 } : this.insets;
    this.cam = fitCamera(this.w, this.h, this.s.w, this.s.h, insets);
  }

  /** the baked land: rebuilt when the scale changes */
  private baked(): HTMLCanvasElement | OffscreenCanvas {
    const s = this.s;
    const px = this.cam.scale * this.dpr;
    const key = `${px.toFixed(2)}|${s.sites.map((o) => o.size).join(',')}`;
    if (this.base && this.baseKey === key) return this.base;
    const W = Math.ceil(s.w * px);
    const H = Math.ceil(s.h * px);
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = c.getContext('2d') as CTX;
    g.scale(px, px);
    // land: two greens in a soft patchwork
    g.fillStyle = PAL.land;
    g.fillRect(0, 0, s.w, s.h);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        if (hash(x, y, 1) < 0.35) {
          g.fillStyle = PAL.land2;
          g.beginPath();
          g.ellipse(x + 0.5 + (hash(x, y, 2) - 0.5) * 0.6, y + 0.5 + (hash(x, y, 3) - 0.5) * 0.6, 0.9, 0.7, hash(x, y, 4) * 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    // the ridge: a brown rise with contour lines, drawn as overlapping rounded cells
    const ridgeCells: [number, number][] = [];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.ridge[idx(s, x, y)]) ridgeCells.push([x, y]);
    g.fillStyle = PAL.ridge2;
    for (const [x, y] of ridgeCells) {
      g.beginPath();
      g.roundRect(x - 0.2, y - 0.2, 1.4, 1.4, 0.5);
      g.fill();
    }
    g.fillStyle = PAL.ridge;
    for (const [x, y] of ridgeCells) {
      g.beginPath();
      g.roundRect(x - 0.02, y - 0.1, 1.04, 1.1, 0.4);
      g.fill();
    }
    g.strokeStyle = PAL.contour;
    g.lineWidth = 0.04;
    for (const [x, y] of ridgeCells) {
      for (let k = 0; k < 2; k++) {
        const ry = y + 0.3 + k * 0.4;
        g.beginPath();
        g.moveTo(x + 0.05, ry + (hash(x, y, 50 + k) - 0.5) * 0.2);
        g.quadraticCurveTo(x + 0.5, ry - 0.15, x + 0.95, ry + (hash(x, y, 60 + k) - 0.5) * 0.2);
        g.stroke();
      }
    }
    // forest dots: pines scattered over the land, thinner near sites, water and the ridge
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const i = idx(s, x, y);
        if (s.water[i]) continue;
        const near = s.sites.some((o) => Math.hypot(o.cx - x, o.cy - y) < 2.2);
        const n = near ? 0 : s.ridge[i] ? (hash(x, y, 5) < 0.3 ? 1 : 0) : hash(x, y, 5) < 0.55 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const tx = x + 0.15 + hash(x, y, 10 + k) * 0.7;
          const ty = y + 0.15 + hash(x, y, 20 + k) * 0.7;
          pine(g, tx, ty, 0.16 + hash(x, y, 30 + k) * 0.1, hash(x, y, 40 + k) < 0.5 ? PAL.tree : PAL.tree2);
        }
      }
    // water: the shore first, then the water as overlapping rounded cells, then a few ripples
    const waterCells: [number, number][] = [];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.water[idx(s, x, y)]) waterCells.push([x, y]);
    g.fillStyle = PAL.shore;
    for (const [x, y] of waterCells) {
      g.beginPath();
      g.roundRect(x - 0.14, y - 0.14, 1.28, 1.28, 0.3);
      g.fill();
    }
    g.fillStyle = PAL.water;
    for (const [x, y] of waterCells) {
      g.beginPath();
      g.roundRect(x - 0.01, y - 0.01, 1.02, 1.02, 0.12);
      g.fill();
    }
    g.strokeStyle = PAL.water2;
    g.lineWidth = 0.05;
    g.lineCap = 'round';
    for (const [x, y] of waterCells) {
      if (hash(x, y, 7) > 0.4) continue;
      const rx = x + 0.2 + hash(x, y, 8) * 0.3;
      const ry = y + 0.3 + hash(x, y, 9) * 0.4;
      g.beginPath();
      g.moveTo(rx, ry);
      g.quadraticCurveTo(rx + 0.15, ry - 0.08, rx + 0.3, ry);
      g.quadraticCurveTo(rx + 0.45, ry + 0.08, rx + 0.6, ry);
      g.stroke();
    }
    for (const site of s.sites) drawSite(g, site);
    this.base = c;
    this.baseKey = key;
    return c;
  }

  /** the dirt beneath a train: smoke and the rest are per frame */
  draw(dt: number, drag: { route: Route | null; from: number; sx: number; sy: number; ok: boolean; loose: boolean } | null, hint: Hint | null, pending: Route[] | null = null): void {
    if (!this.fits()) this.resize();
    const s = this.s;
    const ctx = this.ctx;
    const cam = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#5f7f4e';
    ctx.fillRect(0, 0, this.w, this.h);
    // the baked land through the camera
    const base = this.baked();
    ctx.save();
    ctx.setTransform(cam.m[0] * this.dpr, cam.m[1] * this.dpr, cam.m[2] * this.dpr, cam.m[3] * this.dpr, cam.m[4] * this.dpr, cam.m[5] * this.dpr);
    ctx.drawImage(base, 0, 0, s.w, s.h);
    this.drawStations(ctx);
    this.drawTrack(ctx);
    if (drag?.route) this.drawGhost(ctx, drag.route, drag.ok, drag.loose);
    if (pending && pending.length) this.drawGhost(ctx, pending[0], true, false, pending[1]);
    for (const t of s.trains) this.drawTrain(ctx, t);
    this.drawSmoke(ctx, dt);
    if (hint && s.lines.length === 0) this.drawHint(ctx, hint, dt);
    if (DEBUG) {
      ctx.fillStyle = 'magenta';
      for (const l of s.lines) for (const c of l.path) { const p = centre(s, c); ctx.beginPath(); ctx.arc(p.x, p.y, 0.08, 0, 7); ctx.fill(); }
      ctx.fillStyle = 'cyan';
      for (const t of s.trains) { const p = along(lineOf(s, t), t.s, s.w); ctx.beginPath(); ctx.arc(p.x, p.y, 0.1, 0, 7); ctx.fill(); }
    }
    ctx.restore();
    // screen space: names, floats, the drag's cost
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLabels(ctx);
    this.drawFloats(ctx);
    if (drag) this.drawDragLabel(ctx, drag);
  }

  private drawTrack(ctx: CTX): void {
    const s = this.s;
    const sc = this.cam.scale;
    // bridges and cuttings first: a plank deck, or a rock trench, under the rails
    ctx.lineCap = 'butt';
    for (let i = 0; i < s.track.length; i++) {
      if (!s.track[i]) continue;
      const a = centre(s, i);
      for (let d = 0; d < 4; d++) {
        if (!(s.track[i] & (1 << d))) continue;
        const j = idx(s, cx(s, i) + DIRS[d][0], cy(s, i) + DIRS[d][1]);
        const water = s.water[i] || s.water[j];
        const ridge = s.ridge[i] || s.ridge[j];
        if (!water && !ridge) continue;
        const b = centre(s, j);
        ctx.strokeStyle = water ? PAL.deck2 : PAL.rock;
        ctx.lineWidth = water ? 0.62 : 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.strokeStyle = water ? PAL.deck : PAL.rock2;
        ctx.lineWidth = water ? 0.5 : 0.5;
        ctx.stroke();
      }
    }
    // sleepers, then the two rails, every link once
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < s.track.length; i++) {
        if (!s.track[i]) continue;
        const a = centre(s, i);
        for (let d = 0; d < 4; d++) {
          if (!(s.track[i] & (1 << d))) continue;
          const j = idx(s, cx(s, i) + DIRS[d][0], cy(s, i) + DIRS[d][1]);
          const b = centre(s, j);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          const nx = -dy / len;
          const ny = dx / len;
          if (pass === 0) {
            ctx.strokeStyle = PAL.sleeper;
            ctx.lineWidth = Math.max(0.07, 1.6 / sc);
            ctx.beginPath();
            const n = Math.round(len * 4);
            for (let k = 0; k <= n; k++) {
              const t = k / n;
              const px = a.x + dx * t;
              const py = a.y + dy * t;
              ctx.moveTo(px + nx * 0.19, py + ny * 0.19);
              ctx.lineTo(px - nx * 0.19, py - ny * 0.19);
            }
            ctx.stroke();
          } else {
            ctx.strokeStyle = PAL.rail;
            ctx.lineWidth = Math.max(0.05, 1.4 / sc);
            ctx.beginPath();
            ctx.moveTo(a.x + nx * 0.1, a.y + ny * 0.1);
            ctx.lineTo(b.x + nx * 0.1, b.y + ny * 0.1);
            ctx.moveTo(a.x - nx * 0.1, a.y - ny * 0.1);
            ctx.lineTo(b.x - nx * 0.1, b.y - ny * 0.1);
            ctx.stroke();
          }
        }
      }
    }
  }

  /** the route under the finger: loose (to the finger, a thin dashed line), or snapped to a site (solid, a ring at the end).
   *  The second option, when there is one, is drawn in the choice's colour beside the first */
  private drawGhost(ctx: CTX, r: Route, ok: boolean, loose: boolean, second?: Route): void {
    const s = this.s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokeRoute = (route: Route, colour: (water: boolean, ridge: boolean) => string) => {
      for (let k = 1; k < route.cells.length; k++) {
        const a = centre(s, route.cells[k - 1]);
        const b = centre(s, route.cells[k]);
        const water = !!(s.water[route.cells[k]] || s.water[route.cells[k - 1]]);
        const ridge = !!(s.ridge[route.cells[k]] || s.ridge[route.cells[k - 1]]);
        ctx.strokeStyle = colour(water, ridge);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    };
    ctx.lineWidth = loose ? 0.22 : 0.34;
    if (loose) ctx.setLineDash([0.35, 0.3]);
    strokeRoute(r, (water, ridge) => (loose ? (water ? 'rgba(40,90,140,0.5)' : ridge ? 'rgba(110,100,90,0.5)' : 'rgba(27,26,22,0.4)') : !ok ? PAL.ghostBad : water ? PAL.ghostBridge : ridge ? 'rgba(90,80,70,0.8)' : PAL.ghost));
    ctx.setLineDash([]);
    if (second) {
      ctx.lineWidth = 0.34;
      strokeRoute(second, () => OPTION_COLOUR[1]);
      ctx.lineWidth = 0.34;
      strokeRoute(r, () => OPTION_COLOUR[0]);
    }
    if (loose) return;
    // the far end: a ring where the station goes
    const end = centre(s, r.cells[r.cells.length - 1]);
    ctx.strokeStyle = ok ? 'rgba(255,255,255,0.9)' : PAL.ghostBad;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(end.x, end.y, 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawStations(ctx: CTX): void {
    const s = this.s;
    for (const st of s.stations) {
      const p = centre(s, st.cell);
      // the platform: a pale slab with a dark edge, across the track's run
      ctx.fillStyle = PAL.platform;
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.roundRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5, 0.3);
      ctx.fill();
      ctx.stroke();
      // the station house: a small red hut on the slab
      ctx.fillStyle = PAL.houseRed;
      ctx.fillRect(p.x - 0.5, p.y - 0.55, 1.0, 0.36);
      ctx.fillStyle = PAL.roof;
      ctx.fillRect(p.x - 0.55, p.y - 0.62, 1.1, 0.14);
    }
  }

  /** a train's wagons and engine along its line, the engine at the leading end */
  private drawTrain(ctx: CTX, t: Train): void {
    const s = this.s;
    const line = lineOf(s, t);
    const end = line.dist[line.dist.length - 1];
    const L = trainLength(t);
    // the slot: a lateral offset that ramps in over the last cell and a half before the station
    const toStop = t.dir === 1 ? end - t.s : t.s;
    const fromStop = t.dir === 1 ? t.s - L : end - t.s - L;
    const ramp = t.state === 'stop' ? 1 : Math.max(0, 1 - Math.min(toStop, Math.max(0, fromStop)) / 1.5);
    const off = t.slot * 0.55 * ramp;
    // the pieces, from the leading end back: the engine, then the wagons
    const pieces: { len: number; kind: 'engine' | 'wagon' }[] = [{ len: ENGINE_LEN, kind: 'engine' }];
    for (let k = 0; k < t.nWagons; k++) pieces.push({ len: WAGON_LEN, kind: 'wagon' });
    const good = t.good;
    for (let k = pieces.length - 1; k >= 0; k--) {
      // draw back to front so the engine sits on top
      let back = 0;
      for (let m = 0; m < k; m++) back += pieces[m].len;
      const piece = pieces[k];
      const mid = t.s - t.dir * (back + piece.len / 2);
      const p = along(line, mid, s.w);
      const fx = p.dx * t.dir;
      const fy = p.dy * t.dir;
      const nx = -fy;
      const ny = fx;
      const x = p.x + nx * off;
      const y = p.y + ny * off;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(fy, fx));
      if (piece.kind === 'engine') drawEngine(ctx, piece.len, t.engine === 'jyry');
      else drawWagon(ctx, piece.len, t.wagons, k - 1 < t.cargo ? good : null);
      ctx.restore();
    }
    // smoke from the chimney while the train runs
    if (t.state === 'run') {
      const p = along(line, t.s - t.dir * 0.25, s.w);
      const fx = p.dx * t.dir;
      const fy = p.dy * t.dir;
      if (Math.floor(t.odometer * 5) !== Math.floor((t.odometer - t.speed / 60) * 5)) {
        // the puff drifts up the screen and a little back along the track
        const up = this.cam.turned ? { x: -1, y: 0 } : { x: 0, y: -1 };
        this.puffs.push({ x: p.x - fy * off, y: p.y + fx * off, r: 0.07, age: 0, vx: -fx * 0.25 + up.x * 0.3 + (Math.random() - 0.5) * 0.15, vy: -fy * 0.25 + up.y * 0.3 + (Math.random() - 0.5) * 0.15 });
      }
    }
  }

  private drawSmoke(ctx: CTX, dt: number): void {
    for (const p of this.puffs) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += dt * 0.16;
    }
    this.puffs = this.puffs.filter((p) => p.age < 1.8);
    for (const p of this.puffs) {
      ctx.fillStyle = `rgba(245,245,240,${0.5 * (1 - p.age / 1.8)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** the hand: a ring that runs from the start station to the first site, again and again */
  private drawHint(ctx: CTX, hint: Hint, dt: number): void {
    const s = this.s;
    this.hintT = (this.hintT + dt / 2.4) % 1;
    const a = centre(s, hint.from);
    const b = centre(s, hint.to);
    const t = Math.min(1, Math.max(0, (this.hintT - 0.15) / 0.6));
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    ctx.setLineDash([0.3, 0.25]);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e);
    ctx.stroke();
    ctx.setLineDash([]);
    const hx = a.x + (b.x - a.x) * e;
    const hy = a.y + (b.y - a.y) * e;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.arc(hx, hy, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawLabels(ctx: CTX): void {
    const s = this.s;
    const sc = this.cam.scale;
    ctx.font = `600 ${Math.max(11, Math.round(sc * 0.55))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const site of s.sites) {
      const p = toScreen(this.cam, site.cx + 0.5, site.cy + 0.5);
      const text = site.name.fi;
      const y = p.y + sc * 1.25;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(30,40,25,0.8)';
      ctx.strokeText(text, p.x, y);
      ctx.fillStyle = '#f3ecd6';
      ctx.fillText(text, p.x, y);
      // the stock: a small row of what the site holds; a town shows its size
      if (site.kind === 'town') {
        ctx.font = `700 ${Math.max(10, Math.round(sc * 0.45))}px system-ui, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeText(`${'●'.repeat(site.size)}`, p.x, y + sc * 0.62);
        ctx.fillStyle = PAL.gold;
        ctx.fillText(`${'●'.repeat(site.size)}`, p.x, y + sc * 0.62);
      } else if (site.stock >= 1) {
        const n = Math.min(8, Math.floor(site.stock));
        const w = Math.max(4, sc * 0.22);
        const x0 = p.x - (n * (w + 2)) / 2;
        ctx.fillStyle = site.kind === 'forest' ? PAL.timber : site.kind === 'sawmill' ? PAL.boards : site.kind === 'farm' ? PAL.grain : PAL.flour;
        for (let k = 0; k < n; k++) ctx.fillRect(x0 + k * (w + 2), y + sc * 0.68, w, w * 0.5);
      }
    }
  }

  private drawFloats(ctx: CTX): void {
    const sc = this.cam.scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.s.floats) {
      const p = toScreen(this.cam, f.x, f.y);
      const rise = f.age * sc * 1.2;
      const alpha = f.age < 1.1 ? 1 : 1 - (f.age - 1.1) / 0.5;
      ctx.font = `800 ${Math.round(sc * (f.kind === 'note' ? 0.6 : 0.85))}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(20,25,15,${0.8 * alpha})`;
      ctx.strokeText(f.text, p.x, p.y - sc * 0.6 - rise);
      ctx.fillStyle = f.kind === 'pay' ? `rgba(255,224,110,${alpha})` : f.kind === 'cost' ? `rgba(255,170,150,${alpha})` : `rgba(240,240,230,${alpha})`;
      ctx.fillText(f.text, p.x, p.y - sc * 0.6 - rise);
    }
  }

  private drawDragLabel(ctx: CTX, drag: { route: Route | null; sx: number; sy: number; ok: boolean; loose: boolean }): void {
    if (!drag.route) return;
    const r = drag.route;
    const text = `${r.cost}`;
    const sub = r.bridge.length ? `silta ${r.bridge.length}` : r.cutting.length ? `leikkaus ${r.cutting.length}` : '';
    ctx.font = `800 22px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = drag.sx;
    const y = drag.sy - 64;
    const w = 86;
    ctx.fillStyle = drag.loose ? 'rgba(27,26,22,0.6)' : drag.ok ? 'rgba(27,26,22,0.88)' : 'rgba(150,40,30,0.9)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 22, w, 44, 10);
    ctx.fill();
    ctx.fillStyle = '#f3ecd6';
    ctx.fillText(text, x, y - (sub ? 7 : 0));
    if (sub) {
      ctx.font = `600 12px system-ui, sans-serif`;
      ctx.fillStyle = '#9fd0e8';
      ctx.fillText(sub, x, y + 13);
    }
  }
}

type CTX = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const DEBUG = typeof location !== 'undefined' && /[?&]dbg=1/.test(location.search);
/** the two route options' colours: the cheap one dark, the short one blue; the choice card uses the same */
export const OPTION_COLOUR = ['rgba(27,26,22,0.85)', 'rgba(30,110,190,0.9)'];

function pine(g: CTX, x: number, y: number, r: number, colour: string): void {
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(x, y - r * 1.6);
  g.lineTo(x + r, y + r * 0.6);
  g.lineTo(x - r, y + r * 0.6);
  g.closePath();
  g.fill();
}

function house(g: CTX, x: number, y: number, w: number, h: number, colour: string): void {
  g.fillStyle = colour;
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.fillStyle = PAL.roof;
  g.fillRect(x - w / 2 - 0.04, y - h / 2 - 0.1, w + 0.08, h * 0.42);
}

function drawSite(g: CTX, site: Site): void {
  const x = site.cx + 0.5;
  const y = site.cy + 0.5;
  if (site.kind === 'forest') {
    // a thick stand of pines around the station cell, a log pile beside it
    for (let k = 0; k < 26; k++) {
      const a = hash(site.cx, site.cy, 100 + k) * Math.PI * 2;
      const d = 0.9 + hash(site.cx, site.cy, 200 + k) * 1.3;
      const px = x + Math.cos(a) * d * 1.3;
      const py = y + Math.sin(a) * d;
      pine(g, px, py, 0.22 + hash(site.cx, site.cy, 300 + k) * 0.12, k % 3 ? PAL.tree2 : PAL.tree);
    }
    g.fillStyle = PAL.timber;
    for (let k = 0; k < 3; k++) g.fillRect(x + 0.9, y - 0.35 + k * 0.22, 0.75, 0.16);
  } else if (site.kind === 'sawmill') {
    // a long red shed with a saw wheel, a plank stack and a mill race
    g.fillStyle = PAL.houseRed;
    g.fillRect(x - 1.3, y - 1.05, 1.6, 0.7);
    g.fillStyle = PAL.roof;
    g.fillRect(x - 1.36, y - 1.15, 1.72, 0.3);
    g.fillStyle = PAL.brass;
    g.beginPath();
    g.arc(x + 0.55, y - 0.7, 0.28, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 0.04;
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.moveTo(x + 0.55, y - 0.7);
      g.lineTo(x + 0.55 + Math.cos(a) * 0.28, y - 0.7 + Math.sin(a) * 0.28);
    }
    g.stroke();
    g.fillStyle = PAL.boards;
    for (let k = 0; k < 3; k++) g.fillRect(x + 0.95, y - 0.3 + k * 0.2, 0.7, 0.14);
    g.fillStyle = PAL.timber;
    for (let k = 0; k < 3; k++) g.fillRect(x - 1.7, y - 0.3 + k * 0.2, 0.7, 0.14);
  } else if (site.kind === 'farm') {
    // striped fields around a red barn
    for (let k = 0; k < 3; k++) {
      const fx = x - 1.9 + k * 1.3;
      g.fillStyle = k % 2 ? PAL.field2 : PAL.field;
      g.fillRect(fx, y - 1.5, 1.1, 0.9);
      g.strokeStyle = 'rgba(120,95,30,0.35)';
      g.lineWidth = 0.03;
      for (let r = 0; r < 4; r++) {
        g.beginPath();
        g.moveTo(fx, y - 1.4 + r * 0.22);
        g.lineTo(fx + 1.1, y - 1.4 + r * 0.22);
        g.stroke();
      }
    }
    g.fillStyle = PAL.houseRed;
    g.fillRect(x - 1.5, y + 0.6, 1.1, 0.6);
    g.fillStyle = PAL.roof;
    g.fillRect(x - 1.56, y + 0.5, 1.22, 0.22);
    g.fillStyle = PAL.grain;
    for (let k = 0; k < 3; k++) g.fillRect(x + 0.95, y - 0.3 + k * 0.2, 0.6, 0.14);
  } else if (site.kind === 'mill') {
    // a windmill: a tapered tower and four sails, and sacks beside it
    g.fillStyle = '#5a4a3a';
    g.beginPath();
    g.moveTo(x - 1.5, y + 0.2);
    g.lineTo(x - 0.9, y + 0.2);
    g.lineTo(x - 1.0, y - 1.0);
    g.lineTo(x - 1.4, y - 1.0);
    g.closePath();
    g.fill();
    g.strokeStyle = PAL.sail;
    g.lineWidth = 0.1;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      g.beginPath();
      g.moveTo(x - 1.2, y - 1.0);
      g.lineTo(x - 1.2 + Math.cos(a) * 0.75, y - 1.0 + Math.sin(a) * 0.75);
      g.stroke();
    }
    g.fillStyle = PAL.ink;
    g.beginPath();
    g.arc(x - 1.2, y - 1.0, 0.08, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAL.flour;
    for (let k = 0; k < 3; k++) g.fillRect(x + 0.95, y - 0.3 + k * 0.2, 0.55, 0.14);
    g.fillStyle = PAL.grain;
    for (let k = 0; k < 2; k++) g.fillRect(x - 1.7, y + 0.5 + k * 0.2, 0.55, 0.14);
  } else {
    // the town: houses by size in a ring, a church from size 2, more rings as it grows
    const spots: [number, number][] = [
      [-1.3, -0.9], [-0.5, -1.2], [0.5, -1.2], [1.3, -0.9], [-1.5, 0.1],
      [1.5, 0.1], [-1.2, 1.0], [-0.3, 1.2], [0.6, 1.2], [1.4, 1.0],
      [-2.2, -0.4], [-2.2, 0.6], [2.2, -0.4], [2.2, 0.6], [-1.6, -1.7],
      [0, -2.0], [1.6, -1.7], [-1.4, 1.9], [0.2, 2.0], [1.5, 1.9],
    ];
    const n = Math.min(spots.length, 3 + site.size * 3);
    spots.slice(0, n).forEach(([dx, dy], k) => house(g, x + dx, y + dy, 0.5, 0.42, k % 3 === 1 ? PAL.houseOchre : PAL.houseRed));
    if (site.size >= 2) {
      g.fillStyle = '#efe6cf';
      g.fillRect(x + 0.85, y - 0.45, 0.5, 0.9);
      g.fillStyle = PAL.roof;
      g.beginPath();
      g.moveTo(x + 0.8, y - 0.45);
      g.lineTo(x + 1.1, y - 1.1);
      g.lineTo(x + 1.4, y - 0.45);
      g.closePath();
      g.fill();
    }
  }
}

function drawEngine(ctx: CTX, len: number, strong = false): void {
  const w = strong ? 0.58 : 0.5;
  // the frame and the wheels
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(-len / 2, -w / 2 - 0.04, len, w + 0.08);
  // the boiler, the cab at the back, the chimney at the front, a brass dome
  ctx.fillStyle = PAL.engine;
  ctx.beginPath();
  ctx.roundRect(-len / 2 + 0.05, -w / 2, len - 0.1, w, 0.12);
  ctx.fill();
  ctx.fillStyle = '#3b3632';
  ctx.fillRect(-len / 2 + 0.05, -w / 2 + 0.04, 0.32, w - 0.08);
  ctx.fillStyle = PAL.brass;
  ctx.beginPath();
  ctx.arc(len / 2 - 0.2, 0, strong ? 0.13 : 0.1, 0, Math.PI * 2);
  ctx.fill();
  if (strong) {
    ctx.fillStyle = PAL.houseRed;
    ctx.fillRect(-len / 2 + 0.4, -w / 2 + 0.06, len - 0.75, 0.08);
  }
  ctx.fillStyle = '#6b6560';
  ctx.beginPath();
  ctx.arc(0, 0, 0.08, 0, Math.PI * 2);
  ctx.fill();
  // a red buffer beam at the front
  ctx.fillStyle = PAL.houseRed;
  ctx.fillRect(len / 2 - 0.06, -w / 2, 0.06, w);
}

function drawWagon(ctx: CTX, len: number, kind: WagonType, load: Good | null): void {
  const w = 0.46;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(-len / 2, -w / 2 - 0.03, len, w + 0.06);
  if (kind === 'hopper') {
    ctx.fillStyle = PAL.hopper;
    ctx.fillRect(-len / 2 + 0.04, -w / 2, len - 0.08, w);
    ctx.fillStyle = '#4e4a3e';
    ctx.fillRect(-len / 2 + 0.1, -w / 2 + 0.06, len - 0.2, w - 0.12);
    if (load) {
      ctx.fillStyle = PAL.grain;
      ctx.beginPath();
      ctx.ellipse(0, 0, len / 2 - 0.12, w / 2 - 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'flat') {
    ctx.fillStyle = PAL.flat;
    ctx.fillRect(-len / 2 + 0.04, -w / 2, len - 0.08, w);
    if (load) {
      // logs lying along the wagon
      ctx.fillStyle = PAL.timber;
      for (let k = -1; k <= 1; k++) ctx.fillRect(-len / 2 + 0.08, k * 0.13 - 0.05, len - 0.16, 0.1);
      ctx.fillStyle = '#8a6a44';
      for (let k = -1; k <= 1; k++) ctx.fillRect(-len / 2 + 0.08, k * 0.13 - 0.05, 0.05, 0.1);
    }
  } else {
    ctx.fillStyle = PAL.box;
    ctx.beginPath();
    ctx.roundRect(-len / 2 + 0.04, -w / 2, len - 0.08, w, 0.05);
    ctx.fill();
    ctx.fillStyle = '#5a241c';
    ctx.fillRect(-0.03, -w / 2, 0.06, w);
    if (load === 'boards') {
      ctx.fillStyle = PAL.boards;
      ctx.fillRect(-len / 2 + 0.12, -w / 2 + 0.08, len - 0.24, w - 0.16);
      ctx.fillStyle = '#c9b27d';
      for (let k = 0; k < 3; k++) ctx.fillRect(-len / 2 + 0.12, -w / 2 + 0.12 + k * 0.1, len - 0.24, 0.02);
    } else if (load === 'flour') {
      ctx.fillStyle = PAL.flour;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.ellipse(-len / 2 + 0.22 + k * 0.23, 0, 0.1, 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
