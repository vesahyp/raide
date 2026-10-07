/**
 * Cloud cover for the zoomed out map. A few soft white clouds drift over the land in a light wind,
 * all the same way, each with its shadow on the ground. They are invisible at play zoom, fade in
 * between FADE_FROM px a tile and the whole map, and never get more opaque than MAX_CLOUD, so
 * lines, trains and badges read through them. Each cloud's shape is drawn once into an offscreen
 * canvas at a quantised scale; a frame only blits those.
 */
import { hash } from './draw2d';

/** px a tile where the first clouds appear */
const FADE_FROM = 15;
const MAX_CLOUD = 0.55;
const MAX_SHADOW = 0.18;
/** tiles a second, along WIND */
const SPEED = 1;
const WIND = { x: 0.95, y: 0.31 };
/** how far the sun's shadow falls from a cloud, as a share of the cloud's width: down and right, the sun is in the north west */
const SHADOW = { x: 0.12, y: 0.2 };
/** a cloud is wrapped this far beyond the map's edge, so it is fully gone before it comes round again */
const WRAP_PAD = 20;
const BODY = '#f6f4ee';
const UNDERSIDE = '#e8e5da';
const GROUND = 'rgb(20,40,20)';

interface Cloud {
  /** start position in tiles, size across in tiles, circles as [x, y, r] in units of the width */
  x0: number;
  y0: number;
  w: number;
  h: number;
  circles: [number, number, number][];
  body: HTMLCanvasElement | null;
  shadow: HTMLCanvasElement | null;
}

export class Clouds {
  private list: Cloud[] = [];
  private q = 0;
  /** 1 normally, 0.5 while the player drags or picks, eased */
  private calm = 1;

  constructor(private mapW: number, private mapH: number, seed: string) {
    let sd = 7;
    for (let i = 0; i < seed.length; i++) sd = (Math.imul(sd, 31) + seed.charCodeAt(i)) | 0;
    const n = 8 + Math.floor(hash(sd, 1) * 5);
    const pw = mapW + 2 * WRAP_PAD;
    const ph = mapH + 2 * WRAP_PAD;
    for (let i = 0; i < n; i++) {
      const w = 8 + hash(sd, 10 + i) * 12;
      const count = 5 + Math.floor(hash(sd, 40 + i) * 5);
      const circles: [number, number, number][] = [];
      for (let k = 0; k < count; k++) {
        const u = count === 1 ? 0.5 : k / (count - 1);
        // big circles in the middle, small ones at the ends, all resting on one flat underside
        const bump = Math.sin(u * Math.PI);
        const r = (0.10 + 0.14 * bump) * (0.85 + 0.3 * hash(sd, 100 + i * 16 + k));
        const x = 0.14 + u * 0.72;
        const y = 0.56 - r - 0.04 * hash(sd, 200 + i * 16 + k);
        circles.push([x, y, r]);
      }
      this.list.push({
        x0: hash(sd, 300 + i) * pw - WRAP_PAD,
        y0: hash(sd, 400 + i) * ph - WRAP_PAD,
        w,
        h: w * 0.6,
        circles,
        body: null,
        shadow: null,
      });
    }
  }

  /** how visible the sky is at this scale, 0 to 1 */
  static fade(s: number, whole: number): number {
    if (s >= FADE_FROM) return 0;
    const u = Math.min(1, (FADE_FROM - s) / Math.max(1, FADE_FROM - whole));
    return u * u * (3 - 2 * u);
  }

  /** draw shadows, then clouds. `sx` and `sy` map world tiles to screen px */
  draw(
    c: CanvasRenderingContext2D,
    dpr: number,
    time: number,
    dt: number,
    s: number,
    whole: number,
    calmer: boolean,
    sx: (x: number) => number,
    sy: (y: number) => number,
    view: { w: number; h: number },
  ): void {
    this.calm += ((calmer ? 0.5 : 1) - this.calm) * Math.min(1, dt * 6);
    const f = Clouds.fade(s, whole) * this.calm;
    if (f < 0.01) return;
    // the sprite scale: half octaves, so a zoom rebuilds the shapes a few times, not every frame
    const q = Math.pow(2, Math.round(Math.log2(s) * 2) / 2);
    if (q !== this.q) {
      this.q = q;
      for (const cl of this.list) {
        cl.body = null;
        cl.shadow = null;
      }
    }
    const pw = this.mapW + 2 * WRAP_PAD;
    const ph = this.mapH + 2 * WRAP_PAD;
    c.save();
    // clouds stay over the map, they do not float over the dark margin
    c.beginPath();
    c.rect(sx(0), sy(0), this.mapW * s, this.mapH * s);
    c.clip();
    for (const pass of [0, 1]) {
      c.globalAlpha = pass ? MAX_CLOUD * f : MAX_SHADOW * f;
      for (const cl of this.list) {
        const x = ((((cl.x0 + WIND.x * SPEED * time + WRAP_PAD) % pw) + pw) % pw) - WRAP_PAD;
        const y = ((((cl.y0 + WIND.y * SPEED * time + WRAP_PAD) % ph) + ph) % ph) - WRAP_PAD;
        const ox = pass ? 0 : SHADOW.x * cl.w;
        const oy = pass ? 0 : SHADOW.y * cl.w;
        const X = sx(x + ox);
        const Y = sy(y + oy);
        if (X > view.w || Y > view.h || X + cl.w * s < 0 || Y + cl.h * s < 0) continue;
        const img = pass ? (cl.body ??= this.build(cl, dpr, false)) : (cl.shadow ??= this.build(cl, dpr, true));
        c.drawImage(img, X, Y, cl.w * s, cl.h * s);
      }
    }
    c.restore();
  }

  /** one cloud's shape at the sprite scale: opaque, so the alpha applies once to the whole cloud */
  private build(cl: Cloud, dpr: number, shadow: boolean): HTMLCanvasElement {
    const k = this.q * dpr;
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.ceil(cl.w * k));
    cv.height = Math.max(2, Math.ceil(cl.h * k));
    const g = cv.getContext('2d')!;
    const W = cv.width;
    const blob = (dy: number, grow: number): void => {
      g.beginPath();
      for (const [x, y, r] of cl.circles) {
        const cx = x * W;
        const cy = (y + dy) * W;
        g.moveTo(cx + r * W + grow, cy);
        g.arc(cx, cy, r * W + grow, 0, Math.PI * 2);
      }
      g.fill();
    };
    if (shadow) {
      g.fillStyle = GROUND;
      blob(0, 0);
    } else {
      // the underside first, the body lifted off it, so a darker band shows along the bottom
      g.fillStyle = UNDERSIDE;
      blob(0, 0);
      g.fillStyle = BODY;
      g.translate(0, -0.035 * W);
      blob(0, -0.004 * W);
    }
    return cv;
  }
}
