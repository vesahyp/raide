/**
 * The camera: the whole map fitted to the screen, so the slice needs no pan
 * or zoom. In portrait the map stands as drawn; in landscape it is turned a
 * quarter so the same map fills the wider screen. World units are cells.
 */
export interface Camera {
  /** CSS pixels per cell */
  scale: number;
  /** whether the map is turned a quarter (landscape) */
  turned: boolean;
  /** the affine transform world -> screen, as setTransform takes it */
  m: [number, number, number, number, number, number];
  inv: [number, number, number, number, number, number];
  /** the screen rectangle the map covers */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function fitCamera(w: number, h: number, mapW: number, mapH: number, insets: Insets): Camera {
  const aw = Math.max(1, w - insets.left - insets.right);
  const ah = Math.max(1, h - insets.top - insets.bottom);
  const turned = aw > ah;
  const mw = turned ? mapH : mapW;
  const mh = turned ? mapW : mapH;
  const scale = Math.min(aw / mw, ah / mh);
  const width = mw * scale;
  const height = mh * scale;
  const left = insets.left + (aw - width) / 2;
  const top = insets.top + (ah - height) / 2;
  // portrait: sx = left + x*scale, sy = top + y*scale
  // turned: the map's top edge becomes the left edge: sx = left + y*scale, sy = top + (mapW - x)*scale
  const m: Camera['m'] = turned ? [0, -scale, scale, 0, left, top + mapW * scale] : [scale, 0, 0, scale, left, top];
  const det = m[0] * m[3] - m[1] * m[2];
  const inv: Camera['inv'] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  return { scale, turned, m, inv, left, top, width, height };
}

export function toScreen(c: Camera, x: number, y: number): { x: number; y: number } {
  const [a, b, cc, d, e, f] = c.m;
  return { x: a * x + cc * y + e, y: b * x + d * y + f };
}

export function toWorld(c: Camera, sx: number, sy: number): { x: number; y: number } {
  const [a, b, cc, d, e, f] = c.inv;
  return { x: a * sx + cc * sy + e, y: b * sx + d * sy + f };
}
