/**
 * The sprites of the top-down map (ADR 0003), ported from docs/mockups/topdown/scene.html.
 * Every function draws with Canvas 2D into a `View`: a context, a scale in pixels per tile and
 * the two maps from tile coordinates to pixels. The same code serves the cached chunks, the
 * cached piles and the live frame, because only the View differs.
 */
import type { EngineId, Good, WagonType } from '../game/types';

export const OUT = '#16120e';
/** a terrace step on screen, in tiles of height per terrace */
export const LIFT = 0.6;
export const GRASS = ['#86b552', '#a4bf5c', '#c0b96a', '#c9a77c'];

export type Ctx = CanvasRenderingContext2D;

export interface View {
  c: Ctx;
  /** pixels per tile */
  S: number;
  /** a tile x to a pixel x */
  x(x: number): number;
  /** a tile y at a height in terraces to a pixel y */
  y(y: number, lv?: number): number;
}

/** a view whose tile (ox, oy) is at pixel (0, 0) */
export function makeView(c: Ctx, S: number, ox: number, oy: number): View {
  return { c, S, x: (x) => (x - ox) * S, y: (y, lv = 0) => (y - oy) * S - lv * LIFT * S };
}

const shades = new Map<string, string>();
/** a colour made lighter or darker, cached because the same few come back thousands of times */
export function shade(hex: string, f: number): string {
  const key = hex + f.toFixed(2);
  let out = shades.get(key);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) * f));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (n & 255) * f));
  out = `rgb(${r | 0},${g | 0},${b | 0})`;
  shades.set(key, out);
  return out;
}

export function hash(a: number, b: number, k = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(k | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function shadowEll(c: Ctx, x: number, y: number, rx: number, ry: number): void {
  c.fillStyle = 'rgba(20,30,10,.28)';
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, 7);
  c.fill();
}

// ------------------------------------------------------------------ trees

export function pine(c: Ctx, S: number, px: number, py: number, r: number): void {
  shadowEll(c, px + r * 0.35, py + r * 0.45, r * 0.95, r * 0.7);
  const spikes = 9;
  const star = (rr: number, col: string, dy: number) => {
    c.fillStyle = col;
    c.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + 0.2;
      const R = i % 2 ? rr * 0.68 : rr;
      c.lineTo(px + Math.cos(a) * R, py - dy + Math.sin(a) * R);
    }
    c.closePath();
    c.fill();
  };
  c.strokeStyle = OUT;
  c.lineWidth = Math.max(1, S * 0.05);
  star(r, '#2c5a2e', 0);
  c.stroke();
  star(r * 0.7, '#3d7638', r * 0.12);
  star(r * 0.42, '#5a9646', r * 0.22);
}

export function birch(c: Ctx, S: number, px: number, py: number, r: number): void {
  shadowEll(c, px + r * 0.35, py + r * 0.45, r * 0.95, r * 0.7);
  c.strokeStyle = OUT;
  c.lineWidth = Math.max(1, S * 0.05);
  c.fillStyle = '#6fa046';
  c.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    c.arc(px + Math.cos(a) * r * 0.45, py + Math.sin(a) * r * 0.45, r * 0.55, 0, 7);
  }
  c.fill();
  c.beginPath();
  c.arc(px, py, r, 0, 7);
  c.stroke();
  c.fillStyle = '#6fa046';
  c.beginPath();
  c.arc(px, py, r * 0.98, 0, 7);
  c.fill();
  c.fillStyle = '#93c25a';
  c.beginPath();
  c.arc(px - r * 0.25, py - r * 0.3, r * 0.5, 0, 7);
  c.fill();
}

// ------------------------------------------------------------------ buildings

export interface BuildingOpt {
  walls: string;
  roof: string;
  /** wall height in tiles */
  wall?: number;
  /** terrace level the building stands on */
  lv?: number;
  /** the window index that is a door */
  door?: number;
  windows?: boolean;
  flat?: boolean;
  /** chimney at a tile point */
  chimney?: [number, number];
}

/** a box in Höyry's 3/4 lean: the roof on top, the front wall below it; (x, y) is the footprint's corner */
export function building(v: View, x: number, y: number, w: number, d: number, o: BuildingOpt): void {
  const { c, S } = v;
  const wall = o.wall ?? 0.8;
  const lv = o.lv ?? 0;
  const X = v.x(x);
  const Y = v.y(y, lv);
  const Wd = w * S;
  const Dd = d * S;
  const Hh = wall * S;
  const lw = Math.max(1, S * 0.06);
  c.fillStyle = 'rgba(20,30,10,.3)';
  c.fillRect(X + S * 0.25, Y - Hh + S * 0.35, Wd, Dd + Hh * 0.6);
  c.fillStyle = o.walls;
  c.fillRect(X, Y + Dd - Hh, Wd, Hh);
  c.strokeStyle = OUT;
  c.lineWidth = lw;
  c.strokeRect(X, Y + Dd - Hh, Wd, Hh);
  if (o.windows !== false) {
    const n = Math.max(1, Math.floor(w / 0.9));
    for (let i = 0; i < n; i++) {
      const wx = X + ((i + 0.5) / n) * Wd - S * 0.13;
      if (o.door === i) {
        c.fillStyle = '#4a2f20';
        c.fillRect(wx, Y + Dd - Hh * 0.75, S * 0.26, Hh * 0.75);
        c.strokeRect(wx, Y + Dd - Hh * 0.75, S * 0.26, Hh * 0.75);
        continue;
      }
      c.fillStyle = '#f2ead8';
      c.fillRect(wx - S * 0.03, Y + Dd - Hh * 0.72, S * 0.32, Hh * 0.45);
      c.fillStyle = '#3b5468';
      c.fillRect(wx, Y + Dd - Hh * 0.68, S * 0.26, Hh * 0.37);
    }
  }
  const ry = Y - Hh;
  if (o.flat) {
    c.fillStyle = o.roof;
    c.fillRect(X, ry, Wd, Dd);
  } else if (w >= d) {
    c.fillStyle = shade(o.roof, 1.18);
    c.fillRect(X, ry, Wd, Dd / 2);
    c.fillStyle = o.roof;
    c.fillRect(X, ry + Dd / 2, Wd, Dd / 2);
    c.strokeStyle = shade(o.roof, 0.7);
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(X, ry + Dd / 2);
    c.lineTo(X + Wd, ry + Dd / 2);
    c.stroke();
  } else {
    c.fillStyle = shade(o.roof, 1.18);
    c.fillRect(X, ry, Wd / 2, Dd);
    c.fillStyle = o.roof;
    c.fillRect(X + Wd / 2, ry, Wd / 2, Dd);
    c.strokeStyle = shade(o.roof, 0.7);
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(X + Wd / 2, ry);
    c.lineTo(X + Wd / 2, ry + Dd);
    c.stroke();
  }
  c.strokeStyle = OUT;
  c.lineWidth = lw;
  c.strokeRect(X, ry, Wd, Dd);
  if (o.chimney) {
    const [cx, cy] = o.chimney;
    c.fillStyle = '#5a4a40';
    c.fillRect(v.x(cx) - S * 0.15, v.y(cy, lv) - Hh - S * 0.35, S * 0.3, S * 0.45);
    c.strokeRect(v.x(cx) - S * 0.15, v.y(cy, lv) - Hh - S * 0.35, S * 0.3, S * 0.45);
  }
}

/** a church: the nave 3 by 2 tiles at (x, y) and a tower with a spire to its east */
export function church(v: View, x: number, y: number, lv: number): void {
  const { c, S } = v;
  building(v, x, y, 3, 2, { walls: '#f0e8d6', roof: '#3d3a3a', wall: 1.0, door: 1, lv });
  const X = v.x(x + 3);
  const Y = v.y(y + 0.2, lv);
  const Hh = 1.8 * S;
  const lw = Math.max(1, S * 0.06);
  c.fillStyle = '#e8dfca';
  c.fillRect(X, Y + S * 1.4 - Hh, S * 1.2, Hh);
  c.strokeStyle = OUT;
  c.lineWidth = lw;
  c.strokeRect(X, Y + S * 1.4 - Hh, S * 1.2, Hh);
  const ty = Y + S * 0.2 - Hh;
  const mid = [X + S * 0.6, ty + S * 0.6];
  const cols = ['#5a5656', '#3d3a3a', '#2d2b2b', '#4a4747'];
  const corners = [[X, ty], [X + S * 1.2, ty], [X + S * 1.2, ty + S * 1.2], [X, ty + S * 1.2]];
  for (let i = 0; i < 4; i++) {
    c.fillStyle = cols[i];
    c.beginPath();
    c.moveTo(corners[i][0], corners[i][1]);
    c.lineTo(corners[(i + 1) % 4][0], corners[(i + 1) % 4][1]);
    c.lineTo(mid[0], mid[1] - S * 0.35);
    c.closePath();
    c.fill();
    c.stroke();
  }
}

/** a market square: a paved plaza of w by d tiles at (x, y) with a well in the middle and three stalls with striped awnings */
export function marketSquare(v: View, x: number, y: number, w: number, d: number, lv: number): void {
  const { c, S } = v;
  const X = v.x(x);
  const Y = v.y(y, lv);
  const lw = Math.max(1, S * 0.05);
  c.fillStyle = '#cdbf9f';
  c.fillRect(X, Y, w * S, d * S);
  c.strokeStyle = 'rgba(22,18,14,.22)';
  c.lineWidth = Math.max(1, S * 0.03);
  for (let i = 1; i < w * 2; i++) {
    c.beginPath();
    c.moveTo(X + i * S * 0.5, Y);
    c.lineTo(X + i * S * 0.5, Y + d * S);
    c.stroke();
  }
  c.strokeStyle = OUT;
  c.lineWidth = lw;
  c.strokeRect(X, Y, w * S, d * S);
  // the well
  c.fillStyle = '#8a8070';
  c.beginPath();
  c.ellipse(X + w * S * 0.5, Y + d * S * 0.55, S * 0.32, S * 0.2, 0, 0, 7);
  c.fill();
  c.stroke();
  c.fillStyle = '#3b5468';
  c.beginPath();
  c.ellipse(X + w * S * 0.5, Y + d * S * 0.55, S * 0.2, S * 0.11, 0, 0, 7);
  c.fill();
  // three stalls along the back: a counter, a striped awning over it
  const sw = (w * S) / 3;
  const awn = ['#b5382c', '#2f6f8a', '#c98d3a'];
  for (let i = 0; i < 3; i++) {
    const sx = X + i * sw + sw * 0.14;
    const bw = sw * 0.72;
    const top = Y + S * 0.18;
    c.fillStyle = '#7a5a3a';
    c.fillRect(sx, top + S * 0.3, bw, S * 0.28);
    c.strokeRect(sx, top + S * 0.3, bw, S * 0.28);
    c.fillStyle = awn[i];
    c.fillRect(sx - S * 0.04, top, bw + S * 0.08, S * 0.3);
    c.fillStyle = '#f0e8d6';
    for (let k = 0; k < 4; k += 2) c.fillRect(sx - S * 0.04 + ((bw + S * 0.08) / 4) * k, top, (bw + S * 0.08) / 4, S * 0.3);
    c.strokeRect(sx - S * 0.04, top, bw + S * 0.08, S * 0.3);
    c.fillStyle = '#e9c547';
    c.fillRect(sx + bw * 0.2, top + S * 0.2, S * 0.14, S * 0.1);
  }
}

/** a stone town hall: a grey block of w by d tiles at (x, y) with a clock tower on its roof */
export function townHall(v: View, x: number, y: number, w: number, d: number, lv: number): void {
  const { c, S } = v;
  building(v, x, y, w, d, { walls: '#c7c0b0', roof: '#4a5a5e', wall: 1.15, door: 1, lv });
  const lw = Math.max(1, S * 0.05);
  const Hh = 1.15 * S;
  const tx = v.x(x + w / 2) - S * 0.3;
  const ty = v.y(y, lv) - Hh - S * 0.2;
  c.strokeStyle = OUT;
  c.lineWidth = lw;
  c.fillStyle = '#d6d0c0';
  c.fillRect(tx, ty - S * 0.4, S * 0.6, S * 0.7);
  c.strokeRect(tx, ty - S * 0.4, S * 0.6, S * 0.7);
  // the clock
  c.fillStyle = '#f6f0e0';
  c.beginPath();
  c.arc(tx + S * 0.3, ty - S * 0.12, S * 0.16, 0, 7);
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(tx + S * 0.3, ty - S * 0.12);
  c.lineTo(tx + S * 0.3, ty - S * 0.22);
  c.moveTo(tx + S * 0.3, ty - S * 0.12);
  c.lineTo(tx + S * 0.38, ty - S * 0.12);
  c.stroke();
  c.fillStyle = '#3d4a4e';
  c.beginPath();
  c.moveTo(tx - S * 0.05, ty - S * 0.4);
  c.lineTo(tx + S * 0.65, ty - S * 0.4);
  c.lineTo(tx + S * 0.3, ty - S * 0.95);
  c.closePath();
  c.fill();
  c.stroke();
}

/** the windmill's tower and cap; its sails are drawn live by `sails` */
export function windmillBody(v: View, x: number, y: number, lv: number): void {
  const { c, S } = v;
  const X = v.x(x);
  const Y = v.y(y, lv);
  const lw = Math.max(1, S * 0.06);
  shadowEll(c, X + S * 0.6, Y + S * 0.6, S * 1.4, S * 0.7);
  c.fillStyle = '#7a6a5a';
  c.fillRect(X - S * 0.7, Y - S * 0.4, S * 1.4, S * 0.9);
  c.strokeStyle = OUT;
  c.lineWidth = lw;
  c.strokeRect(X - S * 0.7, Y - S * 0.4, S * 1.4, S * 0.9);
  c.fillStyle = '#4e4038';
  c.beginPath();
  c.arc(X, Y - S * 0.9, S * 0.75, 0, 7);
  c.fill();
  c.stroke();
}

/** the four sails turning at the windmill's hub, a pixel position */
export function sails(c: Ctx, S: number, X: number, Y: number, angle: number): void {
  c.save();
  c.translate(X, Y);
  c.rotate(angle);
  c.lineWidth = Math.max(1, S * 0.06);
  for (let i = 0; i < 4; i++) {
    c.rotate(Math.PI / 2);
    c.fillStyle = '#efe6cf';
    c.strokeStyle = OUT;
    c.fillRect(S * 0.15, -S * 0.18, S * 1.6, S * 0.36);
    c.strokeRect(S * 0.15, -S * 0.18, S * 1.6, S * 0.36);
    c.strokeStyle = 'rgba(22,18,14,.5)';
    for (let k = 1; k < 5; k++) {
      c.beginPath();
      c.moveTo(S * (0.15 + k * 0.32), -S * 0.18);
      c.lineTo(S * (0.15 + k * 0.32), S * 0.18);
      c.stroke();
    }
  }
  c.restore();
  c.fillStyle = '#2a2a2a';
  c.beginPath();
  c.arc(X, Y, S * 0.16, 0, 7);
  c.fill();
}

// ------------------------------------------------------------------ piles and platforms

/** a pile of logs lying east to west, `m` logs in layers of 4, 3 and 2; (x, y) is the top left */
export function logPile(v: View, x: number, y: number, m: number, lv: number): void {
  if (m <= 0) return;
  const { c, S } = v;
  const lw = Math.max(1, S * 0.05);
  const layers = [Math.min(4, m), Math.min(3, Math.max(0, m - 4)), Math.min(2, Math.max(0, m - 7))];
  const Wd = S * 1.7;
  const Dd = S * 0.24;
  c.fillStyle = 'rgba(20,30,10,.3)';
  c.fillRect(v.x(x) + S * 0.15, v.y(y, lv) + S * 0.15, Wd, layers[0] * Dd + S * 0.2);
  for (let l = 0; l < 3; l++) {
    const off = l * 0.13;
    for (let i = 0; i < layers[l]; i++) {
      const X = v.x(x + off);
      const Y = v.y(y + i * 0.24 + off * 0.5, lv) - l * S * 0.2;
      c.fillStyle = (i + l) % 2 ? '#8a5a2b' : '#7a4f26';
      c.strokeStyle = OUT;
      c.lineWidth = lw;
      c.beginPath();
      c.roundRect(X, Y, Wd, Dd, Dd / 2);
      c.fill();
      c.stroke();
      c.strokeStyle = 'rgba(255,220,160,.35)';
      c.beginPath();
      c.moveTo(X + Dd / 2, Y + Dd * 0.3);
      c.lineTo(X + Wd - Dd / 2, Y + Dd * 0.3);
      c.stroke();
      c.fillStyle = '#e0bf86';
      c.strokeStyle = OUT;
      c.beginPath();
      c.arc(X + Wd - Dd * 0.5, Y + Dd * 0.5, Dd * 0.48, 0, 7);
      c.fill();
      c.stroke();
      c.strokeStyle = '#a07a46';
      c.beginPath();
      c.arc(X + Wd - Dd * 0.5, Y + Dd * 0.5, Dd * 0.22, 0, 7);
      c.stroke();
    }
  }
}

/** a stack of boards, `layers` high; (x, y) is the top left of the footprint */
export function boardStack(v: View, x: number, y: number, layers: number, lv: number): void {
  if (layers <= 0) return;
  const { c, S } = v;
  const X = v.x(x);
  const Y = v.y(y, lv);
  const Wd = S * 1.5;
  const Dd = S * 0.9;
  const step = S * 0.14;
  const lw = Math.max(1, S * 0.05);
  c.fillStyle = 'rgba(20,30,10,.3)';
  c.fillRect(X + S * 0.15, Y + S * 0.15 - layers * step, Wd, Dd + layers * step);
  for (let l = 0; l < layers; l++) {
    const yy = Y - l * step;
    c.fillStyle = l % 2 ? '#d9bd84' : '#c9a86a';
    c.fillRect(X, yy + Dd - step, Wd, step);
    c.strokeStyle = 'rgba(22,18,14,.5)';
    c.lineWidth = Math.max(0.6, S * 0.02);
    c.strokeRect(X, yy + Dd - step, Wd, step);
  }
  const ty = Y - layers * step;
  c.fillStyle = '#ead4a0';
  c.fillRect(X, ty, Wd, Dd);
  c.strokeStyle = 'rgba(130,100,50,.6)';
  c.lineWidth = Math.max(0.7, S * 0.03);
  for (let k = 1; k < 5; k++) {
    c.beginPath();
    c.moveTo(X, ty + (Dd * k) / 5);
    c.lineTo(X + Wd, ty + (Dd * k) / 5);
    c.stroke();
  }
  c.strokeStyle = OUT;
  c.lineWidth = lw;
  c.strokeRect(X, ty, Wd, Dd + layers * step);
}

/** sacks in rows of `cols` */
export function sacks(v: View, x: number, y: number, n: number, col: string, lv: number, cols = 3): void {
  const { c, S } = v;
  const lw = Math.max(1, S * 0.05);
  for (let i = 0; i < n; i++) {
    const X = v.x(x + (i % cols) * 0.42);
    const Y = v.y(y + Math.floor(i / cols) * 0.36, lv);
    shadowEll(c, X + S * 0.25, Y + S * 0.2, S * 0.22, S * 0.14);
    c.fillStyle = col;
    c.strokeStyle = OUT;
    c.lineWidth = lw;
    c.beginPath();
    c.ellipse(X + S * 0.18, Y, S * 0.2, S * 0.16, 0, 0, 7);
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.beginPath();
    c.ellipse(X + S * 0.13, Y - S * 0.05, S * 0.08, S * 0.05, 0, 0, 7);
    c.fill();
  }
}

/** the stone platform beside the station track: top left corner and length in tiles, 0.55 deep */
export function platform(v: View, x: number, y: number, len: number, lv: number): void {
  const { c, S } = v;
  const X = v.x(x);
  const Y = v.y(y, lv);
  const Wd = len * S;
  const Dd = S * 0.5;
  c.fillStyle = '#b8ae9a';
  c.fillRect(X, Y, Wd, Dd);
  c.fillStyle = '#efe6cf';
  c.fillRect(X, Y + Dd - S * 0.07, Wd, S * 0.07);
  c.fillStyle = '#8a8070';
  c.fillRect(X, Y + Dd, Wd, S * 0.1);
  c.strokeStyle = OUT;
  c.lineWidth = Math.max(1, S * 0.05);
  c.strokeRect(X, Y, Wd, Dd + S * 0.1);
  c.strokeStyle = 'rgba(22,18,14,.15)';
  for (let k = 1; k < len * 2; k++) {
    c.beginPath();
    c.moveTo(X + (k * S) / 2, Y);
    c.lineTo(X + (k * S) / 2, Y + Dd);
    c.stroke();
  }
}

/** the red buffer stop at a dead end: a bar across the track at a pixel point, the track running at `ang` */
export function bufferStop(c: Ctx, S: number, X: number, Y: number, ang: number): void {
  c.save();
  c.translate(X, Y);
  c.rotate(ang);
  c.fillStyle = '#b5382c';
  c.strokeStyle = OUT;
  c.lineWidth = Math.max(1, S * 0.05);
  c.fillRect(-S * 0.06, -S * 0.38, S * 0.12, S * 0.76);
  c.strokeRect(-S * 0.06, -S * 0.38, S * 0.12, S * 0.76);
  c.fillStyle = '#efe6cf';
  c.fillRect(-S * 0.06, -S * 0.1, S * 0.12, S * 0.2);
  c.restore();
}

// ------------------------------------------------------------------ track and bridges

export type Spoke = [number, number];

/**
 * One cell's track. With two links it is one curve through the cell's centre; with one or three
 * or more, a straight spoke from the edge or corner of each link to the centre. `la` and `lb` are
 * the heights in terraces at the two ends, `lm` at the centre, so a grade runs on without a step
 * between cells. A bridge has no ballast: the deck is drawn under it.
 */
export function trackCell(v: View, x: number, y: number, links: Spoke[], las: number[], lm: number, bridge: boolean): void {
  const { c, S } = v;
  const cxp = v.x(x + 0.5);
  const cyp = v.y(y + 0.5, lm);
  const end = (d: Spoke, l: number): [number, number] => [cxp + (d[0] * S) / 2, v.y(y + 0.5 + d[1] / 2, l)];
  if (links.length === 2) trackPiece(c, S, end(links[0], las[0]), end(links[1], las[1]), [cxp, cyp], true, bridge);
  else for (let i = 0; i < links.length; i++) trackPiece(c, S, end(links[i], las[i]), [cxp, cyp], [cxp, cyp], false, bridge);
}

function trackPiece(c: Ctx, S: number, a0: [number, number], b0: [number, number], mid: [number, number], curve: boolean, bridge: boolean): void {
  // each end runs a little past the cell's edge so neighbours at different heights overlap, no notch
  const past = (p: [number, number], from: [number, number]): [number, number] => {
    const dx = p[0] - from[0];
    const dy = p[1] - from[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / l) * S * 0.08, p[1] + (dy / l) * S * 0.08];
  };
  const a = past(a0, mid);
  const b = curve ? past(b0, mid) : b0;
  const N = curve ? 10 : 4;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    pts.push(curve ? [(1 - u) ** 2 * a[0] + 2 * (1 - u) * u * mid[0] + u * u * b[0], (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * mid[1] + u * u * b[1]] : [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  strokeTrack(c, S, pts, bridge);
}

/** a track along a list of pixel points: ballast, sleepers and the two rails, the end points square */
export function trackLine(c: Ctx, S: number, pts: [number, number][]): void {
  strokeTrack(c, S, pts, false);
}

function strokeTrack(c: Ctx, S: number, pts: [number, number][], bridge: boolean): void {
  const N = pts.length - 1;
  const norm = (i: number): [number, number] => {
    const p = pts[Math.max(0, i - 1)];
    const r = pts[Math.min(N, i + 1)];
    const dx = r[0] - p[0];
    const dy = r[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const line = (off: number, w: number, col: string) => {
    c.strokeStyle = col;
    c.lineWidth = w;
    c.beginPath();
    pts.forEach((p, i) => {
      const n = norm(i);
      const X = p[0] + n[0] * off;
      const Y = p[1] + n[1] * off;
      if (i) c.lineTo(X, Y);
      else c.moveTo(X, Y);
    });
    c.stroke();
  };
  c.lineCap = 'butt';
  if (!bridge) line(0, S * 0.82, '#9b927f');
  c.strokeStyle = '#5c3f26';
  c.lineWidth = Math.max(1.2, S * 0.11);
  let len = 0;
  for (let i = 1; i <= N; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const nS = Math.max(2, Math.round(len / (S * 0.26)));
  for (let k = 0; k < nS; k++) {
    const i = Math.min(N, Math.round(((k + 0.5) / nS) * N));
    const p = pts[i];
    const n = norm(i);
    c.beginPath();
    c.moveTo(p[0] - n[0] * S * 0.3, p[1] - n[1] * S * 0.3);
    c.lineTo(p[0] + n[0] * S * 0.3, p[1] + n[1] * S * 0.3);
    c.stroke();
  }
  for (const o of [-0.17, 0.17]) {
    line(o * S, Math.max(1.2, S * 0.075), '#34343a');
    line(o * S - S * 0.015, Math.max(0.6, S * 0.025), '#c8c8cc');
  }
  c.lineCap = 'round';
}

/** the timber deck of a bridge over the water cell (x, y), along `ang`, at deck height `lv` over water at `lw` */
export function bridgeDeck(v: View, x: number, y: number, ang: number, lv: number, lw: number): void {
  const { c, S } = v;
  const X = v.x(x + 0.5);
  const Y = v.y(y + 0.5, lv);
  const Yw = v.y(y + 0.5, lw);
  const lin = Math.max(1, S * 0.05);
  // the piers stand in the water below the deck, always straight down the screen
  c.fillStyle = 'rgba(10,30,50,.35)';
  c.fillRect(X - S * 0.45, Yw + S * 0.15, S * 0.9, S * 0.25);
  c.fillStyle = '#5a4030';
  c.strokeStyle = OUT;
  c.lineWidth = lin;
  for (const px of [-0.4, 0.25]) {
    c.fillRect(X + S * px, Y + S * 0.3, S * 0.15, Yw - Y + S * 0.1);
    c.strokeRect(X + S * px, Y + S * 0.3, S * 0.15, Yw - Y + S * 0.1);
  }
  c.save();
  c.translate(X, Y);
  c.rotate(ang);
  const diag = Math.abs(Math.sin(2 * ang)) > 0.5;
  const L = S * (diag ? 1.42 : 1.02);
  c.fillStyle = '#7a5838';
  c.fillRect(-L / 2, -S * 0.42, L, S * 0.84);
  c.fillStyle = '#5a3f26';
  c.fillRect(-L / 2, S * 0.42, L, S * 0.14);
  c.strokeStyle = OUT;
  c.beginPath();
  c.moveTo(-L / 2, -S * 0.42);
  c.lineTo(L / 2, -S * 0.42);
  c.moveTo(-L / 2, S * 0.56);
  c.lineTo(L / 2, S * 0.56);
  c.stroke();
  c.restore();
}

/** the rails of a bridge go over the deck; the handrails go over the rails */
export function bridgeRails(v: View, x: number, y: number, ang: number, lv: number): void {
  const { c, S } = v;
  const X = v.x(x + 0.5);
  const Y = v.y(y + 0.5, lv);
  c.save();
  c.translate(X, Y);
  c.rotate(ang);
  const diag = Math.abs(Math.sin(2 * ang)) > 0.5;
  const L = S * (diag ? 1.42 : 1.02);
  c.strokeStyle = '#3e2c1c';
  c.lineWidth = Math.max(1, S * 0.06);
  c.beginPath();
  c.moveTo(-L / 2, -S * 0.4);
  c.lineTo(L / 2, -S * 0.4);
  c.moveTo(-L / 2, S * 0.4);
  c.lineTo(L / 2, S * 0.4);
  c.stroke();
  c.restore();
}

// ------------------------------------------------------------------ trains

/** the engine, drawn with its centre at the origin, facing +x; L and s in pixels */
export function drawEngine(c: Ctx, L: number, s: number, id: EngineId): void {
  const h = L / 2;
  const big = id === 'jyry';
  c.lineWidth = Math.max(1, s * 0.05);
  c.strokeStyle = OUT;
  c.fillStyle = '#2b2b30';
  c.beginPath();
  c.roundRect(-h, -s * 0.3, L, s * 0.6, s * 0.08);
  c.fill();
  c.stroke();
  // the cab
  c.fillStyle = '#6e1a13';
  c.fillRect(-h + s * 0.62, -s * 0.33, s * 0.5, s * 0.66);
  c.strokeRect(-h + s * 0.62, -s * 0.33, s * 0.5, s * 0.66);
  c.fillStyle = '#3a3a3e';
  c.fillRect(-h + s * 0.58, -s * 0.36, s * 0.58, s * 0.72);
  c.strokeRect(-h + s * 0.58, -s * 0.36, s * 0.58, s * 0.72);
  // the tender with its wood
  c.fillStyle = '#4a3a2a';
  c.fillRect(-h + s * 0.05, -s * 0.25, s * 0.48, s * 0.5);
  c.fillStyle = '#7a5230';
  for (let k = 0; k < 3; k++) {
    c.beginPath();
    c.roundRect(-h + s * 0.08, -s * 0.21 + k * s * 0.15, s * 0.42, s * 0.12, s * 0.05);
    c.fill();
  }
  // the boiler, the bands, the dome and the chimney
  const bx = -h + s * 1.16;
  const bl = L - s * 1.3;
  const bw = big ? 0.25 : 0.22;
  c.fillStyle = big ? '#1d1d21' : '#1f3a2a';
  c.beginPath();
  c.roundRect(bx, -s * bw, bl, s * bw * 2, s * 0.2);
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,.22)';
  c.fillRect(bx + s * 0.05, -s * (bw - 0.08), bl - s * 0.1, s * 0.07);
  c.strokeStyle = '#c99a3a';
  c.lineWidth = Math.max(1, s * 0.04);
  for (const u of [0.3, 0.65]) {
    c.beginPath();
    c.moveTo(bx + bl * u, -s * bw);
    c.lineTo(bx + bl * u, s * bw);
    c.stroke();
  }
  c.strokeStyle = OUT;
  c.lineWidth = Math.max(1, s * 0.05);
  c.fillStyle = '#d8a63a';
  c.beginPath();
  c.arc(bx + bl * 0.48, 0, s * 0.13, 0, 7);
  c.fill();
  c.stroke();
  c.fillStyle = '#111';
  c.beginPath();
  c.arc(h - s * 0.32, 0, s * (big ? 0.17 : 0.14), 0, 7);
  c.fill();
  c.stroke();
  c.fillStyle = '#b5382c';
  c.fillRect(h - s * 0.08, -s * 0.32, s * 0.1, s * 0.64);
  c.strokeRect(h - s * 0.08, -s * 0.32, s * 0.1, s * 0.64);
  c.fillStyle = '#ffe9a8';
  c.beginPath();
  c.arc(h - s * 0.05, 0, s * 0.06, 0, 7);
  c.fill();
}

/** a wagon, drawn with its centre at the origin; `fill` is the share of the load aboard, in thirds from 0 to 1 */
export function drawWagon(c: Ctx, L: number, s: number, type: WagonType, good: Good | null, fill: number): void {
  const h = L / 2;
  c.lineWidth = Math.max(1, s * 0.05);
  c.strokeStyle = OUT;
  const hasLoad = fill > 0.05;
  const thirds = Math.round(fill * 3);
  if (type === 'flat') {
    c.fillStyle = '#4a3624';
    c.fillRect(-h + s * 0.04, -s * 0.31, L - s * 0.08, s * 0.62);
    c.strokeRect(-h + s * 0.04, -s * 0.31, L - s * 0.08, s * 0.62);
    c.fillStyle = '#6a4a30';
    c.fillRect(-h + s * 0.08, -s * 0.26, L - s * 0.16, s * 0.52);
    c.strokeStyle = 'rgba(22,18,14,.35)';
    for (let k = 1; k < 6; k++) {
      c.beginPath();
      c.moveTo(-h + (L * k) / 6, -s * 0.26);
      c.lineTo(-h + (L * k) / 6, s * 0.26);
      c.stroke();
    }
    c.strokeStyle = OUT;
    c.fillStyle = '#2a2018';
    for (const a of [-1, 1]) for (const b of [-1, 1]) c.fillRect(a * (h - s * 0.12) - s * 0.04, b * s * 0.29 - s * 0.04, s * 0.08, s * 0.08);
    for (let k = 0; k < thirds; k++) {
      const yy = -s * 0.2 + k * s * 0.135;
      c.fillStyle = k % 2 ? '#8a5a2b' : '#7a4f26';
      c.beginPath();
      c.roundRect(-h + s * 0.1, yy, L - s * 0.2, s * 0.13, s * 0.06);
      c.fill();
      c.stroke();
      c.fillStyle = '#e0bf86';
      c.beginPath();
      c.arc(h - s * 0.15, yy + s * 0.065, s * 0.055, 0, 7);
      c.fill();
    }
    return;
  }
  if (type === 'box') {
    // an open box wagon: the sides, the dark floor inside, and the boards or sacks showing over the rim
    c.fillStyle = '#8f3b2e';
    c.fillRect(-h + s * 0.04, -s * 0.31, L - s * 0.08, s * 0.62);
    c.strokeRect(-h + s * 0.04, -s * 0.31, L - s * 0.08, s * 0.62);
    c.fillStyle = '#4a2018';
    c.fillRect(-h + s * 0.12, -s * 0.22, L - s * 0.24, s * 0.44);
    if (hasLoad && good === 'flour') {
      const cols = 4;
      const shown = Math.ceil(fill * 2 * cols);
      for (let i = 0; i < cols; i++)
        for (const [j, r] of [-1, 1].entries()) {
          if (i * 2 + j >= shown) continue;
          const X = -h + s * 0.3 + ((L - s * 0.6) * (i + 0.5)) / cols;
          c.fillStyle = '#f4f0e4';
          c.beginPath();
          c.ellipse(X, r * s * 0.11, s * 0.17, s * 0.1, 0, 0, 7);
          c.fill();
          c.stroke();
        }
    } else if (hasLoad) {
      for (let k = 0; k < thirds; k++) {
        c.fillStyle = k % 2 ? '#e6cf98' : '#d9bd84';
        const w = L - s * 0.3 - k * s * 0.08;
        c.fillRect(-w / 2, -s * 0.2 + k * s * 0.03, w, s * 0.4 - k * s * 0.06);
        c.strokeRect(-w / 2, -s * 0.2 + k * s * 0.03, w, s * 0.4 - k * s * 0.06);
      }
      c.strokeStyle = 'rgba(130,100,50,.5)';
      for (let j = 1; j < 4; j++) {
        c.beginPath();
        c.moveTo(-L / 2 + s * 0.2, -s * 0.2 + (j * s * 0.4) / 4);
        c.lineTo(L / 2 - s * 0.2, -s * 0.2 + (j * s * 0.4) / 4);
        c.stroke();
      }
      c.strokeStyle = OUT;
    }
    c.strokeRect(-h + s * 0.12, -s * 0.22, L - s * 0.24, s * 0.44);
    return;
  }
  // a hopper: grey sides, a rim, a heap of grain
  c.fillStyle = '#6f6a5a';
  c.fillRect(-h + s * 0.04, -s * 0.31, L - s * 0.08, s * 0.62);
  c.strokeRect(-h + s * 0.04, -s * 0.31, L - s * 0.08, s * 0.62);
  c.fillStyle = '#3f3b30';
  c.fillRect(-h + s * 0.14, -s * 0.22, L - s * 0.28, s * 0.44);
  if (hasLoad) {
    c.fillStyle = '#e2c04a';
    c.beginPath();
    const m = 0.4 + 0.6 * fill;
    c.ellipse(0, 0, ((L - s * 0.34) / 2) * m, s * 0.21 * m, 0, 0, 7);
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,245,200,.45)';
    c.beginPath();
    c.ellipse(-L * 0.08, -s * 0.06, L * 0.2, s * 0.07, 0, 0, 7);
    c.fill();
  }
  c.strokeRect(-h + s * 0.14, -s * 0.22, L - s * 0.28, s * 0.44);
}

/** a straight length of track between two pixel points: the spur from a dead end to its buffer stop */
export function trackSpur(c: Ctx, S: number, a: [number, number], b: [number, number]): void {
  trackPiece(c, S, a, b, a, false, false);
}

/** the loading crew by the platform: two workers in caps and a handcart, at tile (x, y) on the platform's top */
export function crew(v: View, x: number, y: number, lv: number): void {
  const { c, S } = v;
  c.lineWidth = Math.max(1, S * 0.04);
  c.strokeStyle = OUT;
  const worker = (wx: number, tabard: string) => {
    const X = v.x(wx);
    const Y = v.y(y, lv);
    shadowEll(c, X + S * 0.05, Y + S * 0.12, S * 0.14, S * 0.06);
    c.fillStyle = tabard;
    c.beginPath();
    c.roundRect(X - S * 0.09, Y - S * 0.12, S * 0.18, S * 0.24, S * 0.05);
    c.fill();
    c.stroke();
    c.fillStyle = '#e8c39a';
    c.beginPath();
    c.arc(X, Y - S * 0.2, S * 0.085, 0, 7);
    c.fill();
    c.stroke();
    c.fillStyle = '#2f3f66';
    c.beginPath();
    c.arc(X, Y - S * 0.23, S * 0.085, Math.PI, 0);
    c.fill();
    c.stroke();
  };
  worker(x, '#d98a2b');
  worker(x + 0.5, '#3f7a52');
  // the handcart
  const X = v.x(x + 1.2);
  const Y = v.y(y, lv);
  c.fillStyle = '#7a5230';
  c.beginPath();
  c.roundRect(X - S * 0.22, Y - S * 0.08, S * 0.44, S * 0.2, S * 0.03);
  c.fill();
  c.stroke();
  c.fillStyle = '#2a2018';
  for (const d of [-0.12, 0.12]) {
    c.beginPath();
    c.arc(X + S * d, Y + S * 0.14, S * 0.06, 0, 7);
    c.fill();
  }
}
