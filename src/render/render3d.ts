/**
 * The map in three.js (ADR 0002): a low-poly valley drawn from the sim's
 * state. The land is the scenario's height function, cut and filled along
 * every built line so an embankment or a cutting is in the ground itself;
 * water is a plane at height zero; the forest is instanced pines; each
 * site is a few boxes with its stock as a pile beside the track; a line is
 * ballast, sleepers and two rails, a deck on piers over water, and a short
 * siding past each station for the wagons of a standing train; a train is
 * an engine and wagons that show what they carry.
 *
 * The camera is orthographic and tilted, so the view reads as isometric.
 * It fits the whole map at the start; a pinch zooms, a twist turns it, and
 * `follow` keeps it on a train. World units: a cell is CELL units across,
 * a metre of height is VS units up.
 *
 * Text and chips are HTML in the overlay div, placed each frame by
 * projecting world points, so they stay crisp and readable at any zoom.
 */
import * as THREE from 'three';
import type { EngineId, Good, Line, SimState, Site, Train, WagonType } from '../game/types';
import type { Route } from '../game/grid';
import { cx, cy, idx, gradeOf, stepLen } from '../game/grid';
import { along, lineOf, railAlong, trainLength, price, demand } from '../game/sim';
import { ENGINE_LEN, WAGON_LEN, MAKES, TAKES, RAW_CAP, BASE_PRICE } from '../game/content/economy';
import { t as tt } from '../i18n';

export const CELL = 12;
/** world units per metre of height */
export const VS = 0.7;
/** the ballast's half width in cells */
const BED = 0.26;
/** metres of wall per cell of distance from the bed: the slope of a cutting or an embankment */
const WALL_M_PER_CELL = 16;
/** the siding past a station, in cells */
export const SIDING = 1.8;
export const OPTION_COLOUR = ['rgba(239,230,207,0.95)', 'rgba(70,150,230,0.95)'];

const GRADE_HEX = (g: number) => (g < 1.5 ? 0x3d9a48 : g < 3 ? 0xe0a52b : 0xd0392b);

const hash = (a: number, b: number, k = 0): number => {
  let h = (a * 374761393 + b * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface Hint {
  from: number;
  to: number;
}

export interface DragView {
  route: Route | null;
  from: number;
  sx: number;
  sy: number;
  ok: boolean;
  loose: boolean;
}

interface Vehicle {
  group: THREE.Group;
  len: number;
  load: THREE.Object3D[];
}

interface TrainView {
  id: number;
  group: THREE.Group;
  vehicles: Vehicle[];
  wagons: number;
  wagonType: WagonType;
  engine: EngineId;
  puffs: { m: THREE.Mesh; age: number; x: number; y: number; z: number }[];
  lastPuff: number;
}

const mat = (color: number | string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...extra });
const MATS = {
  trunk: mat('#5a3d26'),
  crown: mat('#ffffff'),
  ballast: mat('#9a8f7f'),
  sleeper: mat('#4b3a28'),
  rail: new THREE.MeshStandardMaterial({ color: '#6b6560', roughness: 0.45, metalness: 0.6 }),
  deck: mat('#8a6a44'),
  pier: mat('#7d7468'),
  platform: mat('#b4a888'),
  log: mat('#9a6633'),
  log2: mat('#8a5a2b'),
  board: mat('#e8d2a0'),
  board2: mat('#dcc48c'),
  grain: mat('#e2c04a'),
  flour: mat('#f2efe6'),
  water: new THREE.MeshStandardMaterial({ color: '#5f9ec4', roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.92 }),
  smoke: new THREE.MeshStandardMaterial({ color: '#f1efe8', transparent: true, opacity: 0.55, flatShading: true }),
  redWall: mat('#b5382c'),
  ochreWall: mat('#d4a64c'),
  roof: mat('#4a2f24'),
  roofDark: mat('#3a3530'),
  shed: mat('#8d6a3d'),
  white: mat('#efe6cf'),
  stone: mat('#6e665c'),
  sail: mat('#e8e0cc'),
  field: mat('#d9c25a'),
  field2: mat('#c4ab45'),
  engine: mat('#1f1d1a'),
  engineGreen: mat('#1f3a2a'),
  brass: mat('#d8a63a', { metalness: 0.5, roughness: 0.4 }),
  red: mat('#b5382c'),
  wheel: mat('#8a1f14', { metalness: 0.2 }),
  flat: mat('#5a3d26'),
  box: mat('#8f3b2e'),
  hopper: mat('#6f6a5a'),
  stake: mat('#3a2a1a'),
};

export class Renderer3D {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  private sun: THREE.DirectionalLight;
  private ray = new THREE.Raycaster();
  private ground: THREE.Mesh | null = null;
  private trees: THREE.Object3D[] = [];
  private trackGroup = new THREE.Group();
  private siteGroup = new THREE.Group();
  private stockGroups = new Map<string, THREE.Group>();
  private stockKeys = new Map<string, string>();
  private stationCells = new Set<number>();
  private trainViews = new Map<number, TrainView>();
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private pendingGroup: THREE.Group | null = null;
  private pendingKey = '';
  private trackKey = '';
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** the camera: where it looks (world x, z), its turn, and the half height of its frustum */
  cam = { tx: 0, tz: 0, az: 0, el: THREE.MathUtils.degToRad(40), half: 100, min: 24, max: 400 };
  private followId: number | null = null;
  private time = 0;
  private labels = new Map<string, HTMLElement>();
  private floatEls = new Map<object, HTMLElement>();
  private hintEl: HTMLElement | null = null;
  private plateEl: HTMLElement | null = null;
  private labelTick = 0;
  private sails: THREE.Object3D[] = [];
  private wheel: THREE.Object3D | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLElement,
    private s: SimState,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.gl.setPixelRatio(this.dpr);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    const sky = new THREE.Color('#a9cde0');
    this.scene.background = sky;
    this.scene.add(new THREE.HemisphereLight('#dfeaf2', '#4a5a3a', 1.1));
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    this.sun.position.set(-160, 150, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const ext = Math.max(s.w, s.h) * CELL * 0.62;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 900 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.target.position.set((s.w * CELL) / 2, 0, (s.h * CELL) / 2);
    this.sun.position.add(this.sun.target.position);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.trackGroup, this.siteGroup);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(s.w * CELL * 3, s.h * CELL * 3), MATS.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set((s.w * CELL) / 2, -0.05, (s.h * CELL) / 2);
    water.receiveShadow = true;
    this.scene.add(water);
    this.rebuildLand();
    this.buildSites();
    this.resize();
    this.fit();
  }

  dispose(): void {
    this.gl.dispose();
    this.overlay.innerHTML = '';
  }

  // ------------------------------------------------------------------ the land
  /** the land's height in metres at a point in cells, with every line's cutting and fill in it */
  groundAt(x: number, y: number): number {
    return this.carve(x, y).h;
  }

  /** the land at a point, and whether a line's cutting or fill shaped it there */
  private carve(x: number, y: number): { h: number; earth: 'cut' | 'fill' | null } {
    let h = this.s.scenario.terrain(x, y);
    let earth: 'cut' | 'fill' | null = null;
    // the sites stand on a flat patch
    for (const site of this.s.sites) {
      const d = Math.max(Math.abs(x - site.cx - 0.5), Math.abs(y - site.cy - 0.5));
      if (d < 1.1) {
        const flat = Math.max(1, this.s.height[idx(this.s, site.cx, site.cy)]);
        const t = Math.max(0, Math.min(1, (d - 0.6) / 0.5));
        h = flat + (h - flat) * t * t * (3 - 2 * t);
      }
    }
    const near = this.nearestRail(x, y);
    if (near && near.d < 3.5) {
      const cut = near.rail + Math.max(0, near.d - BED) * WALL_M_PER_CELL;
      if (h > cut + 0.3) earth = 'cut';
      if (h > cut) h = cut;
      if (!near.water && h > -0.5) {
        const fill = near.rail - Math.max(0, near.d - BED) * WALL_M_PER_CELL;
        if (h < fill - 0.3) earth = 'fill';
        if (h < fill) h = fill;
      }
    }
    return { h, earth };
  }

  /** the nearest point on any line's rail to a point in cells: its distance, its rail height, whether it is a bridge */
  private nearestRail(x: number, y: number): { d: number; rail: number; water: boolean } | null {
    let best: { d: number; rail: number; water: boolean } | null = null;
    const s = this.s;
    for (const l of s.lines) {
      for (let k = 1; k < l.path.length; k++) {
        const a = l.path[k - 1];
        const b = l.path[k];
        const ax = cx(s, a) + 0.5;
        const ay = cy(s, a) + 0.5;
        const bx = cx(s, b) + 0.5;
        const by = cy(s, b) + 0.5;
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
        const px = ax + vx * t;
        const py = ay + vy * t;
        const d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) best = { d, rail: l.rail[k - 1] + (l.rail[k] - l.rail[k - 1]) * t, water: !!(s.water[a] && s.water[b]) || (t < 0.5 ? !!s.water[a] : !!s.water[b]) };
      }
    }
    return best;
  }

  private rebuildLand(): void {
    const s = this.s;
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
    }
    for (const t of this.trees) this.scene.remove(t);
    this.trees = [];
    const SUB = 4;
    const APRON = 10;
    const nx = (s.w + 2 * APRON) * SUB;
    const ny = (s.h + 2 * APRON) * SUB;
    const H = new Float32Array((nx + 1) * (ny + 1));
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) H[j * (nx + 1) + i] = this.groundAt(i / SUB - APRON, j / SUB - APRON);
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const GRASS = new THREE.Color('#7fa557');
    const GRASS2 = new THREE.Color('#5f8a44');
    const DRY = new THREE.Color('#a9a85c');
    const ROCK = new THREE.Color('#8a8070');
    const ROCK2 = new THREE.Color('#6f665a');
    const SAND = new THREE.Color('#c9bb86');
    const BEDC = new THREE.Color('#5c6a52');
    const v = (i: number, j: number) => [(i / SUB - APRON) * CELL, H[j * (nx + 1) + i] * VS, (j / SUB - APRON) * CELL];
    const face = (a: number[], b: number[], d: number[]) => {
      pos.push(...a, ...b, ...d);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
      const nX = uy * wz - uz * wy, nY = uz * wx - ux * wz, nZ = ux * wy - uy * wx;
      const nl = Math.hypot(nX, nY, nZ) || 1;
      const up = Math.abs(nY / nl);
      const hm = (a[1] + b[1] + d[1]) / 3 / VS;
      const mx = (a[0] + b[0] + d[0]) / 3 / CELL;
      const mz = (a[2] + b[2] + d[2]) / 3 / CELL;
      const noise = (Math.sin(mx * 5.1) * Math.cos(mz * 4.3) + Math.sin(mx * 1.7 + mz * 2.3)) * 0.22;
      const earth = up < 0.97 ? this.carve(mx, mz).earth : null;
      if (hm < -1.5) c.copy(BEDC);
      else if (hm < 0.4) c.copy(SAND);
      else if (earth === 'cut') c.copy(ROCK).lerp(ROCK2, 0.5 + noise);
      else if (earth === 'fill') c.copy(DRY).lerp(SAND, 0.4 + noise);
      else if (up < 0.5) c.copy(ROCK).lerp(DRY, 0.4 + noise);
      else if (up < 0.7) c.copy(GRASS2).lerp(DRY, 0.35 + noise);
      else {
        c.copy(GRASS).lerp(GRASS2, 0.5 + noise * 1.5);
        // the high ground dries out and the tops go to rock
        if (hm > 18) c.lerp(DRY, Math.min(1, (hm - 18) / 16));
        if (hm > 34) c.lerp(ROCK, Math.min(1, (hm - 34) / 14));
      }
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    };
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = v(i, j), b = v(i + 1, j), d = v(i, j + 1), e = v(i + 1, j + 1);
        if ((i + j) % 2) {
          face(a, d, b);
          face(b, d, e);
        } else {
          face(a, d, e);
          face(a, e, b);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }));
    this.ground.receiveShadow = true;
    this.ground.castShadow = true;
    this.scene.add(this.ground);
    // the apron: land beyond the map's edge, so the view never shows the void
    this.buildTrees();
  }

  private buildTrees(): void {
    const s = this.s;
    const spots: { x: number; y: number; h: number; sc: number; r: number }[] = [];
    for (let cyy = -10; cyy < s.h + 10; cyy++)
      for (let cxx = -10; cxx < s.w + 10; cxx++) {
        const off = !(cxx >= 0 && cyy >= 0 && cxx < s.w && cyy < s.h);
        for (let k = 0; k < 4; k++) {
          const x = cxx + hash(cxx + 7, cyy + 7, k * 3 + 1);
          const y = cyy + hash(cxx + 7, cyy + 7, k * 3 + 2);
          const h = this.groundAt(x, y);
          if (h < 0.8) continue;
          let p = off ? 0.5 : 0.16;
          for (const site of s.sites) {
            const d = Math.hypot(x - site.cx - 0.5, y - site.cy - 0.5);
            if (d < 1.25) p = -1;
            else if (site.kind === 'forest' && d < 3.2) p += 0.7 * (1 - d / 3.2);
            else if (d < 2) p -= 0.1;
          }
          if (p <= 0) continue;
          const near = this.nearestRail(x, y);
          if (near && near.d < BED + 0.3 + Math.abs(near.rail - h) / WALL_M_PER_CELL) continue;
          if (this.stationCells.size && [...this.stationCells].some((c) => Math.hypot(x - cx(s, c) - 0.5, y - cy(s, c) - 0.5) < 1.3)) continue;
          if (hash(cxx + 7, cyy + 7, k * 3 + 3) > p) continue;
          spots.push({ x, y, h, sc: 0.7 + hash(cxx, cyy, k + 11) * 0.6, r: hash(cxx, cyy, k + 17) });
        }
      }
    const cone = new THREE.ConeGeometry(2.2, 7, 6);
    cone.translate(0, 3.5 + 1.1, 0);
    const trunk = new THREE.CylinderGeometry(0.35, 0.45, 1.5, 5);
    trunk.translate(0, 0.75, 0);
    const crowns = new THREE.InstancedMesh(cone, MATS.crown, spots.length);
    const trunks = new THREE.InstancedMesh(trunk, MATS.trunk, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c1 = new THREE.Color('#2f6a3a');
    const c2 = new THREE.Color('#4f8a3f');
    const c = new THREE.Color();
    spots.forEach((o, i) => {
      q.setFromAxisAngle(up, o.r * 6.28);
      m.compose(v.set(o.x * CELL, o.h * VS - 0.2, o.y * CELL), q, sc.set(o.sc, o.sc, o.sc));
      crowns.setMatrixAt(i, m);
      trunks.setMatrixAt(i, m);
      crowns.setColorAt(i, c.copy(c1).lerp(c2, o.r));
    });
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    trunks.castShadow = true;
    this.scene.add(crowns, trunks);
    this.trees = [crowns, trunks];
  }

  // ------------------------------------------------------------------ the sites
  private box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }

  private gable(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - 0.35, 0);
    shape.lineTo(w / 2 + 0.35, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d + 0.5, bevelEnabled: false });
    g.translate(0, 0, -(d + 0.5) / 2);
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.castShadow = true;
    parent.add(o);
    return o;
  }

  private house(parent: THREE.Object3D, x: number, z: number, w: number, d: number, h: number, wall: THREE.Material, roof: THREE.Material, ry = 0): void {
    this.box(parent, w, h, d, wall, x, h / 2, z, ry);
    this.gable(parent, w, h * 0.65, d, roof, x, h, z, ry);
  }

  /** the world position of a site's centre, on the land */
  private siteWorld(site: Site): THREE.Vector3 {
    const x = site.cx + 0.5;
    const y = site.cy + 0.5;
    return new THREE.Vector3(x * CELL, this.groundAt(x, y) * VS, y * CELL);
  }

  private buildSites(): void {
    this.siteGroup.clear();
    this.sails = [];
    for (const site of this.s.sites) {
      const g = new THREE.Group();
      const p = this.siteWorld(site);
      g.position.copy(p);
      // the buildings stand to one side of the cell's centre, the side no line leaves by; the track and the station take the centre
      const [bx, bz] = this.siteOffset(site);
      if (site.kind === 'forest') {
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05 + 0.3;
          const r = CELL * (0.55 + (i % 2) * 0.2);
          const tree = new THREE.Mesh(new THREE.ConeGeometry(2.8, 9, 6), mat('#2f6a3a'));
          tree.position.set(Math.cos(a) * r, 4.5 + 1, Math.sin(a) * r);
          tree.castShadow = true;
          g.add(tree);
        }
        this.house(g, bx, bz, 4, 3.2, 2.6, MATS.shed, MATS.roof, 0.3);
      } else if (site.kind === 'sawmill') {
        this.house(g, bx, bz, 10, 5.5, 4, MATS.shed, MATS.roof, 0);
        this.box(g, 1.6, 6.5, 1.6, MATS.roofDark, bx + 4, 4.5, bz - 1.5);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1, 10), mat('#6b4a2a'));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(bx - 6.2, 2.2, bz);
        wheel.castShadow = true;
        g.add(wheel);
        this.wheel = wheel;
      } else if (site.kind === 'farm') {
        this.house(g, bx, bz, 6, 4.5, 3.4, MATS.redWall, MATS.roof, 0.1);
        for (let i = 0; i < 4; i++) this.box(g, 9, 0.35, 1.6, i % 2 ? MATS.field : MATS.field2, bx + 2, 0.2, bz - 5 - i * 2.1, 0.05);
      } else if (site.kind === 'mill') {
        this.box(g, 3.6, 7, 3.6, MATS.stone, bx, 3.5, bz);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2, 6), MATS.roof);
        cone.position.set(bx, 8, bz);
        g.add(cone);
        const sails = new THREE.Group();
        sails.position.set(bx, 6.5, bz + 2);
        for (let i = 0; i < 4; i++) {
          const s = this.box(sails, 0.5, 7, 0.2, MATS.sail, 0, 0, 0);
          s.rotation.z = (i * Math.PI) / 2;
          s.position.set(Math.sin(s.rotation.z) * -3.5, Math.cos(s.rotation.z) * 3.5, 0);
        }
        g.add(sails);
        this.sails.push(sails);
      } else if (site.kind === 'town') {
        this.townHouses(g, site.size);
      }
      g.userData.site = site.id;
      this.siteGroup.add(g);
      const stock = new THREE.Group();
      stock.position.copy(p);
      this.siteGroup.add(stock);
      this.stockGroups.set(site.id, stock);
      this.stockKeys.set(site.id, '');
    }
    this.buildStations();
  }

  /** the corner of a site's cell that is farthest from every line that leaves its station, in world units */
  private siteOffset(site: Site): [number, number] {
    const s = this.s;
    const cell = idx(s, site.cx, site.cy);
    const dirs: [number, number][] = [];
    for (const l of s.lines) {
      if (l.path[0] === cell) dirs.push([cx(s, l.path[1]) - site.cx, cy(s, l.path[1]) - site.cy]);
      if (l.path[l.path.length - 1] === cell) dirs.push([cx(s, l.path[l.path.length - 2]) - site.cx, cy(s, l.path[l.path.length - 2]) - site.cy]);
    }
    const corners: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    let best = corners[0];
    let bd = -Infinity;
    for (const c of corners) {
      let d = Infinity;
      for (const [dx, dy] of dirs) {
        const l = Math.hypot(dx, dy) || 1;
        d = Math.min(d, Math.hypot(c[0] / Math.SQRT2 - dx / l, c[1] / Math.SQRT2 - dy / l));
      }
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    return [best[0] * CELL * 0.55, best[1] * CELL * 0.5];
  }

  private townHouses(g: THREE.Group, size: number): void {
    const spots: [number, number][] = [[-7, -7], [-2, -9], [4, -8], [9, -4], [-9, -1], [-4, 2], [8, 2], [-9, 5], [3, 7], [-3, 8], [9, 7], [-7, 10], [6, 11], [0, 12], [12, -9], [12, 10]];
    const n = Math.min(spots.length, 3 + (size - 1) * 3);
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[i];
      const wall = i % 4 === 0 ? MATS.ochreWall : MATS.redWall;
      this.house(g, x - CELL * 0.1, z - CELL * 0.15, 3.6 + (i % 3) * 0.6, 3.2 + (i % 2), 2.6 + (i % 3) * 0.4, wall, i % 3 ? MATS.roof : MATS.roofDark, (i * 0.7) % 1.2);
    }
    if (size >= 2) {
      const x = -CELL * 0.6;
      const z = -CELL * 0.62;
      this.box(g, 4, 5.5, 6, MATS.white, x, 2.75, z, 0.2);
      this.gable(g, 4, 2.4, 6, MATS.roof, x, 5.5, z, 0.2);
      this.box(g, 2, 8, 2, MATS.white, x, 4, z + 3.6, 0.2);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4, 4), MATS.roof);
      spire.position.set(x, 10, z + 3.6);
      spire.rotation.y = Math.PI / 4;
      spire.castShadow = true;
      g.add(spire);
    }
  }

  /** the station platforms: a plate beside the track on every station cell */
  private buildStations(): void {
    const s = this.s;
    for (const child of [...this.siteGroup.children]) if (child.userData.station) this.siteGroup.remove(child);
    this.stationCells = new Set(s.stations.map((st) => st.cell));
    for (const st of s.stations) {
      const g = new THREE.Group();
      g.userData.station = true;
      const x = cx(s, st.cell) + 0.5;
      const y = cy(s, st.cell) + 0.5;
      const h = this.groundAt(x, y);
      g.position.set(x * CELL, h * VS, y * CELL);
      // the platform lies along the first line's direction out of the cell, or east to west
      const line = s.lines.find((l) => l.path[0] === st.cell || l.path[l.path.length - 1] === st.cell);
      let ang = 0;
      if (line) {
        const k = line.path[0] === st.cell ? 1 : line.path.length - 2;
        ang = Math.atan2(cx(s, line.path[k]) - cx(s, st.cell), cy(s, line.path[k]) - cy(s, st.cell));
      }
      const plate = this.box(g, 2.4, 0.8, CELL * 1.1, MATS.platform, 0, 0.3, 0, ang);
      plate.position.set(Math.cos(ang) * 3.2, 0.3, -Math.sin(ang) * 3.2);
      this.house(g, Math.cos(ang) * 5.6, -Math.sin(ang) * 5.6, 3.2, 2.6, 2.4, MATS.redWall, MATS.roof, ang);
      this.siteGroup.add(g);
    }
  }

  /** the pile beside the track: what the site holds, one piece per load */
  private updateStock(site: Site): void {
    const good = MAKES[site.kind];
    const n = Math.min(RAW_CAP + 6, Math.floor(site.stock));
    const key = `${good}:${n}:${site.size}`;
    if (this.stockKeys.get(site.id) === key) return;
    this.stockKeys.set(site.id, key);
    const g = this.stockGroups.get(site.id)!;
    g.clear();
    if (site.kind === 'town') {
      // a town rebuilds its houses when it grows
      const sg = this.siteGroup.children.find((c) => c.userData.site === site.id) as THREE.Group | undefined;
      if (sg) {
        sg.clear();
        this.townHouses(sg, site.size);
      }
      return;
    }
    if (!good) return;
    // the pile stands across the centre from the buildings, clear of the track
    const [bx, bz] = this.siteOffset(site);
    const ox = -bx * 0.9;
    const oz = -bz * 0.9;
    if (good === 'timber') {
      let k = 0;
      for (let r = 0; r < 3 && k < n; r++)
        for (let i = 0; i < 4 - r && k < n; i++, k++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 6, 7), r % 2 ? MATS.log : MATS.log2);
          log.rotation.z = Math.PI / 2;
          log.position.set(ox, 0.55 + r * 0.95, oz + (i - (3 - r) / 2) * 1.12);
          log.castShadow = true;
          g.add(log);
        }
    } else if (good === 'boards') {
      for (let k = 0; k < n; k++) this.box(g, 5, 0.4, 2.2, k % 2 ? MATS.board : MATS.board2, ox + (k % 2) * 0.1, 0.2 + Math.floor(k / 2) * 0.45, oz + (k % 2 ? 1.3 : -1.3));
    } else if (good === 'grain') {
      for (let k = 0; k < n; k++) {
        const sack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.4, 6), MATS.grain);
        sack.position.set(ox + (k % 3) * 1.6 - 1.6, 0.7 + Math.floor(k / 3) * 1.1, oz + Math.floor(k / 3) * 0.2);
        sack.castShadow = true;
        g.add(sack);
      }
    } else if (good === 'flour') {
      for (let k = 0; k < n; k++) {
        const sack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.4, 6), MATS.flour);
        sack.position.set(ox + (k % 3) * 1.6 - 1.6, 0.7 + Math.floor(k / 3) * 1.1, oz + Math.floor(k / 3) * 0.2);
        sack.castShadow = true;
        g.add(sack);
      }
    }
  }

  // ------------------------------------------------------------------ the track
  /** a point on a line, extended past its ends along the end segments for the siding */
  private lineWorld(line: Line, d: number): { x: number; y: number; z: number; dx: number; dz: number } {
    const s = this.s;
    const end = line.dist[line.dist.length - 1];
    const p = along(line, Math.max(0, Math.min(end, d)), s.w);
    let x = p.x;
    let y = p.y;
    let h = railAlong(line, d);
    if (d < 0) {
      x += p.dx * d;
      y += p.dy * d;
    } else if (d > end) {
      x += p.dx * (d - end);
      y += p.dy * (d - end);
    }
    return { x: x * CELL, y: h * VS, z: y * CELL, dx: p.dx, dz: p.dy };
  }

  private rebuildTrack(): void {
    const s = this.s;
    this.trackGroup.clear();
    for (const line of s.lines) {
      const n = line.path.length;
      const end = line.dist[n - 1];
      // samples along the line, the siding included
      const pts: { x: number; y: number; z: number; dx: number; dz: number; d: number }[] = [];
      const step = 0.1;
      for (let d = -SIDING; d <= end + SIDING + 1e-6; d += step) pts.push({ ...this.lineWorld(line, d), d });
      this.ribbon(this.trackGroup, pts, 1.9, 3.1, 0.35, 0.75, MATS.ballast);
      // sleepers
      const count = Math.floor(((end + 2 * SIDING) * CELL) / 0.85);
      const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.18, 0.42), MATS.sleeper, count);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < count; i++) {
        const d = -SIDING + ((i + 0.5) * 0.85) / CELL;
        const p = this.lineWorld(line, d);
        q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz));
        m.compose(v.set(p.x, p.y - 0.28, p.z), q, sc);
        sleepers.setMatrixAt(i, m);
      }
      sleepers.castShadow = true;
      sleepers.receiveShadow = true;
      this.trackGroup.add(sleepers);
      // rails
      for (const side of [-1, 1]) {
        const rp = pts.filter((_, i) => i % 2 === 0).map((p) => new THREE.Vector3(p.x - p.dz * side * 0.76, p.y - 0.1, p.z + p.dx * side * 0.76));
        const rc = new THREE.CatmullRomCurve3(rp);
        const rail = new THREE.Mesh(new THREE.TubeGeometry(rc, Math.max(8, rp.length * 2), 0.09, 5, false), MATS.rail);
        rail.castShadow = true;
        this.trackGroup.add(rail);
      }
      // bridges: a deck on piers over every run of water cells
      let k = 1;
      while (k < n) {
        if (!s.water[line.path[k]]) {
          k++;
          continue;
        }
        let j = k;
        while (j < n && s.water[line.path[j]]) j++;
        const d0 = line.dist[k - 1] + (line.dist[k] - line.dist[k - 1]) * 0.35;
        const d1 = line.dist[Math.min(n - 1, j)] - (line.dist[Math.min(n - 1, j)] - line.dist[j - 1]) * 0.35;
        const a = this.lineWorld(line, d0);
        const b = this.lineWorld(line, d1);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ang = Math.atan2(b.x - a.x, b.z - a.z);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const deck = this.box(this.trackGroup, 4.6, 1.1, len, MATS.deck, mid.x, mid.y - 1.1, mid.z, ang);
        deck.rotation.x = Math.atan2(a.y - b.y, len);
        for (const side of [-1, 1]) this.box(this.trackGroup, 0.5, 2.2, len, MATS.deck, mid.x + side * 2.3 * Math.cos(ang), mid.y + 0.3, mid.z - side * 2.3 * Math.sin(ang), ang);
        const piers = Math.max(1, Math.round(len / 9));
        for (let i = 1; i <= piers; i++) {
          const u = i / (piers + 1);
          const px = a.x + (b.x - a.x) * u;
          const pz = a.z + (b.z - a.z) * u;
          const py = a.y + (b.y - a.y) * u;
          const floor = Math.min(-1, this.s.scenario.terrain(px / CELL, pz / CELL)) * VS;
          const hgt = py - 1.6 - floor + 1;
          this.box(this.trackGroup, 3, hgt, 2.2, MATS.pier, px, floor - 1 + hgt / 2, pz, ang);
        }
        k = j;
      }
    }
  }

  /** a ribbon of quads along sampled points, a trapezoid in section: a top width, a foot width, their drops */
  private ribbon(parent: THREE.Object3D, pts: { x: number; y: number; z: number; dx: number; dz: number }[], top: number, foot: number, dropTop: number, dropFoot: number, m: THREE.Material, colours?: number[]): THREE.Mesh {
    const pos: number[] = [];
    const idxs: number[] = [];
    const col: number[] = [];
    pts.forEach((p, i) => {
      const nx = -p.dz;
      const nz = p.dx;
      pos.push(p.x + nx * foot, p.y - dropFoot, p.z + nz * foot, p.x + nx * top, p.y - dropTop, p.z + nz * top, p.x - nx * top, p.y - dropTop, p.z - nz * top, p.x - nx * foot, p.y - dropFoot, p.z - nz * foot);
      if (colours) {
        const c = new THREE.Color(colours[i]);
        for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      }
      if (i < pts.length - 1) {
        const a = i * 4;
        const b = a + 4;
        for (let k = 0; k < 3; k++) idxs.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (colours) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idxs);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** a route that is not built: a ribbon over the land coloured by its grade, blue over water */
  private routeRibbon(r: Route, strong: boolean, tint: number | null): THREE.Group {
    const s = this.s;
    const g = new THREE.Group();
    const pts: { x: number; y: number; z: number; dx: number; dz: number }[] = [];
    const colours: number[] = [];
    for (let k = 0; k < r.cells.length; k++) {
      const c = r.cells[k];
      const x = cx(s, c) + 0.5;
      const y = cy(s, c) + 0.5;
      const prev = k > 0 ? r.cells[k - 1] : c;
      const next = k < r.cells.length - 1 ? r.cells[k + 1] : c;
      let dx = cx(s, next) - cx(s, prev);
      let dz = cy(s, next) - cy(s, prev);
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const grade = k > 0 ? Math.abs(gradeOf(r.rail[k] - r.rail[k - 1], stepLen(cx(s, c) - cx(s, prev), cy(s, c) - cy(s, prev)))) : 0;
      const colour = tint ?? (s.water[c] ? 0x3a7fb5 : GRADE_HEX(grade));
      // two samples per cell so a colour change lands between cells
      if (k > 0) {
        const p = r.cells[k - 1];
        const px = cx(s, p) + 0.5;
        const py = cy(s, p) + 0.5;
        const mx = (px + x) / 2;
        const my = (py + y) / 2;
        const mh = (r.rail[k - 1] + r.rail[k]) / 2;
        pts.push({ x: mx * CELL, y: Math.max(mh, this.groundAt(mx, my)) * VS + 0.6, z: my * CELL, dx, dz });
        colours.push(colour);
      }
      pts.push({ x: x * CELL, y: Math.max(r.rail[k], this.groundAt(x, y)) * VS + 0.6, z: y * CELL, dx, dz });
      colours.push(colour);
    }
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true, transparent: true, opacity: strong ? 0.95 : 0.7 });
    this.ribbon(g, pts, strong ? 2.2 : 1.6, strong ? 3.0 : 2.2, 0, 0.5, m, colours);
    return g;
  }

  // ------------------------------------------------------------------ trains
  private vehicle(kind: 'engine' | WagonType, engine: EngineId): Vehicle {
    const group = new THREE.Group();
    const load: THREE.Object3D[] = [];
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.rotation.x = rx;
      o.rotation.z = rz;
      o.castShadow = true;
      group.add(o);
      return o;
    };
    if (kind === 'engine') {
      const L = ENGINE_LEN * CELL * 0.72;
      const big = engine === 'jyry';
      const body = big ? MATS.engine : MATS.engineGreen;
      add(new THREE.BoxGeometry(2.6, 0.5, L), MATS.engine, 0, 0.9, 0);
      add(new THREE.CylinderGeometry(big ? 1.25 : 1.05, big ? 1.25 : 1.05, L * 0.58, 10), body, 0, big ? 2.4 : 2.2, L * 0.14, Math.PI / 2);
      add(new THREE.BoxGeometry(2.7, big ? 3 : 2.7, L * 0.26), body, 0, big ? 2.6 : 2.5, -L * 0.3);
      add(new THREE.BoxGeometry(3, 0.3, L * 0.3), MATS.engine, 0, big ? 4.2 : 3.95, -L * 0.3);
      add(new THREE.CylinderGeometry(0.42, 0.55, 1.7, 8), MATS.engine, 0, big ? 4.2 : 3.9, L * 0.36);
      add(new THREE.SphereGeometry(0.62, 10, 8), MATS.brass, 0, big ? 3.5 : 3.2, L * 0.05);
      add(new THREE.BoxGeometry(2.4, 1.3, 0.4), MATS.red, 0, 1.5, L / 2 - 0.1);
      const wheels = big ? [-L * 0.34, -L * 0.12, L * 0.1, L * 0.32] : [-L * 0.3, 0, L * 0.3];
      for (const z of wheels) for (const x of [-1.35, 1.35]) add(new THREE.CylinderGeometry(0.72, 0.72, 0.3, 10), MATS.wheel, x, 0.72, z, 0, Math.PI / 2);
      return { group, len: ENGINE_LEN, load };
    }
    const L = WAGON_LEN * CELL * 0.72;
    for (const z of [-L * 0.32, L * 0.32]) for (const x of [-1.35, 1.35]) add(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 10), MATS.engine, x, 0.55, z, 0, Math.PI / 2);
    if (kind === 'flat') {
      add(new THREE.BoxGeometry(2.6, 0.5, L), MATS.flat, 0, 0.9, 0);
      for (const z of [-L * 0.4, 0, L * 0.4]) for (const x of [-1.4, 1.4]) add(new THREE.BoxGeometry(0.22, 2.2, 0.22), MATS.stake, x, 2.2, z);
      let k = 0;
      for (let r = 0; r < 2; r++)
        for (let i = 0; i < 3 - r; i++, k++) {
          const log = add(new THREE.CylinderGeometry(0.42, 0.42, L - 0.8, 7), r % 2 ? MATS.log2 : MATS.log, (i - (2 - r) / 2) * 0.86, 1.58 + r * 0.74, 0, Math.PI / 2);
          load.push(log);
        }
    } else if (kind === 'hopper') {
      add(new THREE.BoxGeometry(2.6, 2.0, L), MATS.hopper, 0, 1.7, 0);
      load.push(add(new THREE.BoxGeometry(2.2, 0.6, L - 0.6), MATS.grain, 0, 2.9, 0));
    } else {
      // a box wagon with an open top: the boards or the flour sacks show over the rim
      add(new THREE.BoxGeometry(2.6, 1.8, L), MATS.box, 0, 1.6, 0);
      for (let i = 0; i < 3; i++) load.push(add(new THREE.BoxGeometry(2.3, 0.36, L - 1), i % 2 ? MATS.board : MATS.board2, 0, 2.3 + i * 0.4, 0));
    }
    return { group, len: WAGON_LEN, load };
  }

  private trainView(t: Train): TrainView {
    let v = this.trainViews.get(t.id);
    if (v && (v.wagons !== t.nWagons || v.wagonType !== t.wagons || v.engine !== t.engine)) {
      this.scene.remove(v.group);
      this.trainViews.delete(t.id);
      v = undefined;
    }
    if (!v) {
      const group = new THREE.Group();
      const vehicles = [this.vehicle('engine', t.engine)];
      for (let i = 0; i < t.nWagons; i++) vehicles.push(this.vehicle(t.wagons, t.engine));
      for (const o of vehicles) group.add(o.group);
      const puffs = [];
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), MATS.smoke);
        m.visible = false;
        group.add(m);
        puffs.push({ m, age: 9, x: 0, y: 0, z: 0 });
      }
      v = { id: t.id, group, vehicles, wagons: t.nWagons, wagonType: t.wagons, engine: t.engine, puffs, lastPuff: 0 };
      this.scene.add(group);
      this.trainViews.set(t.id, v);
    }
    return v;
  }

  private placeTrains(dt: number): void {
    const s = this.s;
    const seen = new Set<number>();
    for (const t of s.trains) {
      seen.add(t.id);
      const v = this.trainView(t);
      const line = lineOf(s, t);
      let d = t.s;
      // the vehicles are drawn at their map scale; the side slot keeps two standing trains apart
      const side = t.slot * 3.2;
      v.vehicles.forEach((veh, i) => {
        const len = veh.len * CELL * 0.72;
        const front = d;
        const back = d - (t.dir * len) / CELL;
        const a = this.lineWorld(line, front);
        const b = this.lineWorld(line, back);
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        const my = (a.y + b.y) / 2;
        const ang = Math.atan2(a.x - b.x, a.z - b.z);
        const pitch = Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z) || 1);
        veh.group.position.set(mx + Math.cos(ang) * side, my, mz - Math.sin(ang) * side);
        veh.group.rotation.set(0, ang, 0);
        veh.group.rotateX(-pitch);
        if (i > 0) {
          const loaded = i - 1 < t.cargo;
          for (const o of veh.load) o.visible = loaded;
          if (loaded && t.good) {
            const m = t.good === 'flour' ? MATS.flour : t.good === 'boards' ? MATS.board : t.good === 'grain' ? MATS.grain : MATS.log;
            for (const o of veh.load) if (t.wagons !== 'flat') (o as THREE.Mesh).material = m;
          }
        }
        d = back - (t.dir * 0.08 * CELL) / CELL;
      });
      // smoke from the chimney while the train runs
      const eng = v.vehicles[0];
      const a = this.lineWorld(line, t.s);
      if (t.state === 'run' && this.time - v.lastPuff > 0.22) {
        v.lastPuff = this.time;
        const p = v.puffs.reduce((o, q) => (q.age > o.age ? q : o));
        p.age = 0;
        p.x = a.x;
        p.y = a.y + 4.2;
        p.z = a.z;
      }
      for (const p of v.puffs) {
        p.age += dt;
        if (p.age > 2.2) {
          p.m.visible = false;
          continue;
        }
        p.m.visible = true;
        p.y += dt * 2.2;
        p.x += -eng.group.getWorldDirection(new THREE.Vector3()).x * dt * 0.5;
        const r = 0.5 + p.age * 1.1;
        p.m.scale.set(r, r, r);
        p.m.position.set(p.x, p.y, p.z);
        (p.m.material as THREE.MeshStandardMaterial).opacity = 0.55 * (1 - p.age / 2.2);
      }
    }
    for (const [id, v] of this.trainViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      this.trainViews.delete(id);
    }
  }

  /** the engine's world position, for the camera that follows */
  private enginePos(t: Train): THREE.Vector3 {
    const p = this.lineWorld(lineOf(this.s, t), t.s);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  // ------------------------------------------------------------------ the camera
  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h) return;
    const first = this.w === 1;
    this.w = w;
    this.h = h;
    this.gl.setSize(w, h, false);
    if (!first) this.fit();
    this.updateCamera();
  }

  /** the whole map in view, turned so its long side runs along the screen's long side */
  fit(): void {
    const s = this.s;
    const w = this.w;
    const h = this.h;
    const landscape = w > h;
    this.cam.az = landscape ? Math.PI / 2 : 0;
    this.cam.tx = (s.w * CELL) / 2;
    this.cam.tz = (s.h * CELL) / 2;
    const insetTop = landscape ? 12 : 68;
    const insetLeft = landscape ? 164 : 8;
    const aw = w - insetLeft - 8;
    const ah = h - insetTop - 8;
    const corners: THREE.Vector3[] = [];
    for (const [x, z] of [[0, 0], [s.w, 0], [0, s.h], [s.w, s.h]] as [number, number][]) corners.push(new THREE.Vector3(x * CELL, 0, z * CELL), new THREE.Vector3(x * CELL, 24 * VS, z * CELL));
    const box = () => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        const p = this.projectWorld(c);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      return { minX, maxX, minY, maxY };
    };
    this.cam.half = 100;
    this.updateCamera();
    let b = box();
    this.cam.half *= Math.max((b.maxY - b.minY) / ah, (b.maxX - b.minX) / aw) * 1.01;
    this.cam.max = this.cam.half * 1.3;
    this.updateCamera();
    b = box();
    const followWas = this.followId;
    this.pan(insetLeft + aw / 2 - (b.minX + b.maxX) / 2, insetTop + ah / 2 - (b.minY + b.maxY) / 2);
    this.followId = followWas;
  }

  private updateCamera(): void {
    const c = this.cam;
    const aspect = this.w / this.h;
    this.camera.left = -c.half * aspect;
    this.camera.right = c.half * aspect;
    this.camera.top = c.half;
    this.camera.bottom = -c.half;
    const R = 700;
    const target = new THREE.Vector3(c.tx, 0, c.tz);
    this.camera.position.set(target.x + R * Math.cos(c.el) * Math.sin(c.az), target.y + R * Math.sin(c.el), target.z + R * Math.cos(c.el) * Math.cos(c.az));
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.scene.fog = null;
  }

  /** move the view by a screen delta in CSS pixels */
  pan(dx: number, dy: number): void {
    this.followId = null;
    const c = this.cam;
    const upp = (2 * c.half) / this.h;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const fwd = new THREE.Vector3(-Math.sin(c.az), 0, -Math.cos(c.az));
    c.tx -= right.x * dx * upp - fwd.x * (dy * upp) / Math.sin(c.el);
    c.tz -= right.z * dx * upp - fwd.z * (dy * upp) / Math.sin(c.el);
    this.clampTarget();
    this.updateCamera();
  }

  /** zoom by a factor about a screen point, and turn by an angle in radians */
  pinch(scale: number, rotate: number, sx: number, sy: number): void {
    const c = this.cam;
    const before = this.pick(sx, sy);
    c.half = Math.max(c.min, Math.min(c.max, c.half / scale));
    c.az += rotate;
    this.updateCamera();
    const after = this.pick(sx, sy);
    if (before && after) {
      c.tx += (before.x - after.x) * CELL;
      c.tz += (before.y - after.y) * CELL;
    }
    this.clampTarget();
    this.updateCamera();
  }

  private clampTarget(): void {
    const c = this.cam;
    c.tx = Math.max(-CELL * 6, Math.min((this.s.w + 6) * CELL, c.tx));
    c.tz = Math.max(-CELL * 6, Math.min((this.s.h + 6) * CELL, c.tz));
  }

  /** keep the view on a train, zoomed in; null lets go */
  follow(train: Train | null): void {
    this.followId = train ? train.id : null;
  }

  get following(): number | null {
    return this.followId;
  }

  /** world point in cells under a screen point, on the land or the water */
  pick(sx: number, sy: number): { x: number; y: number } | null {
    if (!this.ground) return null;
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObject(this.ground, false)[0];
    if (hit) return { x: hit.point.x / CELL, y: hit.point.z / CELL };
    // off the land: the water plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(plane, p)) return { x: p.x / CELL, y: p.z / CELL };
    return null;
  }

  /** a point in cells to screen pixels, on the land */
  project(x: number, y: number, lift = 0): { x: number; y: number } {
    const v = new THREE.Vector3(x * CELL, this.groundAt(x, y) * VS + lift, y * CELL).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  private projectWorld(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  /** the train under a screen point, by its engine and wagons */
  trainAt(sx: number, sy: number): Train | null {
    const reach = 30;
    for (const t of this.s.trains) {
      const v = this.trainViews.get(t.id);
      if (!v) continue;
      for (const veh of v.vehicles) {
        const p = this.projectWorld(veh.group.position);
        if (Math.hypot(p.x - sx, p.y - sy) < reach) return t;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ the overlay
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

  private goodIcon(g: Good): string {
    return `<svg class="gi"><use href="#g-${g}"/></svg>`;
  }

  /** a site's name and its chips: what it has (count and stock bar), what it pays (price and demand bar) */
  private siteLabel(site: Site): void {
    const s = this.s;
    const el = this.label(`site:${site.id}`, 'tag site-tag');
    const makes = MAKES[site.kind];
    const takes = TAKES[site.kind].filter((g) => s.sites.some((o) => MAKES[o.kind] === g));
    let html = `<div class="name">${tt(site.name)}${site.kind === 'town' ? ` <small>${site.size}</small>` : ''}</div><div class="chips">`;
    if (makes) {
      const n = Math.floor(site.stock);
      html += `<span class="chip has">${this.goodIcon(makes)}<b>${n}</b><i style="width:${Math.min(100, (100 * site.stock) / RAW_CAP)}%"></i></span>`;
    }
    for (const g of takes) {
      const dm = demand(site.taken[g]);
      const p = price(s, g, site.id, 0);
      html += `<span class="chip wants${dm < 0.55 ? ' low' : ''}">${this.goodIcon(g)}<b>${p}</b><i style="width:${Math.round(100 * (p / Math.max(1, BASE_PRICE[g])))}%"></i></span>`;
    }
    html += '</div>';
    if (el.innerHTML !== html) el.innerHTML = html;
    const p = this.project(site.cx + 0.5, site.cy + 0.5, 1);
    this.place(el, { x: p.x, y: p.y + Math.max(14, 18 * (60 / this.cam.half)) });
  }

  /** the plate on a route under the finger: cost, length, worst grade, bridge or cutting */
  private routePlate(drag: DragView | null, pending: Route[] | null): void {
    const r = drag?.route ?? null;
    if (!r || drag?.loose || pending) {
      if (this.plateEl) this.plateEl.style.display = 'none';
      return;
    }
    if (!this.plateEl) {
      this.plateEl = document.createElement('div');
      this.plateEl.className = 'tag plate';
      this.overlay.appendChild(this.plateEl);
    }
    const km = (r.length * 0.2).toFixed(1);
    const earth = r.bridge.length ? `<span class="bridge">${r.bridge.length} ${r.bridge.length === 1 ? 'bridge' : 'bridge'}</span>` : r.cutting.length ? '<span class="cut">cutting</span>' : r.fill.length ? '<span class="fill">embankment</span>' : '';
    const html = `<b class="${drag!.ok ? '' : 'red'}">${r.cost}</b><span>${km} km</span><span class="g" style="color:#${GRADE_HEX(r.worst).toString(16).padStart(6, '0')}">${r.worst < 1 ? 'flat' : `${r.worst.toFixed(0)} %`}</span>${earth}`;
    if (this.plateEl.innerHTML !== html) this.plateEl.innerHTML = html;
    this.plateEl.style.display = '';
    this.plateEl.style.transform = `translate(${drag!.sx.toFixed(0)}px, ${(drag!.sy - 64).toFixed(0)}px)`;
  }

  // ------------------------------------------------------------------ the frame
  draw(dt: number, drag: DragView | null, hint: Hint | null, pending: Route[] | null = null): void {
    const s = this.s;
    this.time += dt;
    this.resize();
    // the land and the track follow the lines; the stations follow the stations
    const key = s.lines.map((l) => l.id).join(',') + '|' + s.stations.map((st) => st.id).join(',');
    if (key !== this.trackKey) {
      this.trackKey = key;
      this.rebuildLand();
      this.rebuildTrack();
      this.buildSites();
      for (const k of this.stockKeys.keys()) this.stockKeys.set(k, '');
    }
    for (const site of s.sites) this.updateStock(site);
    this.placeTrains(dt);
    for (const sails of this.sails) sails.rotation.z += dt * 0.6;
    if (this.wheel) this.wheel.rotation.x += dt * 1.2;
    // the route under the finger, and the two on offer after a lift
    const gkey = drag?.route ? drag.route.cells.join(',') + (drag.ok ? 'k' : 'x') + (drag.loose ? 'l' : 's') : '';
    if (gkey !== this.ghostKey) {
      this.ghostKey = gkey;
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = drag?.route ? this.routeRibbon(drag.route, !drag.loose, drag.loose ? 0xffffff : null) : null;
      if (this.ghost) this.scene.add(this.ghost);
    }
    const pkey = pending ? pending.map((r) => r.cells.join(',')).join('|') : '';
    if (pkey !== this.pendingKey) {
      this.pendingKey = pkey;
      if (this.pendingGroup) this.scene.remove(this.pendingGroup);
      this.pendingGroup = null;
      if (pending) {
        this.pendingGroup = new THREE.Group();
        pending.forEach((r, i) => this.pendingGroup!.add(this.routeRibbon(r, true, i === 0 ? null : 0x4a9ae6)));
        this.scene.add(this.pendingGroup);
      }
    }
    if (this.ghost) this.ghost.visible = !pending;
    // the camera follows its train
    if (this.followId !== null) {
      const t = s.trains.find((o) => o.id === this.followId);
      if (!t) this.followId = null;
      else {
        const p = this.enginePos(t);
        const c = this.cam;
        const k = Math.min(1, dt * 4);
        c.tx += (p.x - c.tx) * k;
        c.tz += (p.z - c.tz) * k;
        c.half += (46 - c.half) * k;
        this.updateCamera();
      }
    }
    this.gl.render(this.scene, this.camera);
    // the overlay: names and chips, floats, the hint, the plate
    this.labelTick++;
    for (const site of s.sites) this.siteLabel(site);
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
  }

  /** the drag's end as a world point, for the input's cancel button */
  trainLengthCells(t: Train): number {
    return trainLength(t);
  }
}
