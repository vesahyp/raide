/**
 * The bot: a player with no thumb, for the headless checks and the balance.
 * A plan is a list of steps taken in order as the cash allows: link two sites
 * (a station spot by each, the track between, the stations), buy a train on
 * a route of linked sites, issue a bond. The careful plan and the careless
 * plan for a scenario must end apart: one wins, one loses (ADR 0007).
 */
import type { Cargo, LocoId, SimState, Site, StationSize } from '../src/game/types';
import { idx, cx, cy, routeOptions, type RouteMode } from '../src/game/grid';
import { buildTrack, buildStation, buyTrain, autoCars, issueBond, stationBlock, money, covered } from '../src/game/sim';
import { STATIONS, LOCOS } from '../src/game/content/economy';
import { siteById, stationAt } from '../src/game/state';

export type Step =
  | { kind: 'link'; a: string; b: string; mode?: RouteMode; size?: StationSize; via?: [number, number][] }
  | { kind: 'train'; loco: LocoId; stops: string[]; cars?: Cargo[][]; full?: boolean[] }
  | { kind: 'bond'; n: number };

export interface Plan {
  steps: Step[];
  /** borrow to take the next step when the cash is short */
  borrow: boolean;
  /** cash the plan keeps back for the running costs */
  reserve?: number;
}

/** the station the bot keeps by each site, by site id */
type Spots = Map<string, number>;

export class Bot {
  log: string[] = [];
  private k = 0;
  private spots: Spots = new Map();
  private wait = 0;
  constructor(private plan: Plan) {}

  done(): boolean {
    return this.k >= this.plan.steps.length;
  }

  act(s: SimState): void {
    if (s.result || this.done()) return;
    if (s.time < this.wait) return;
    this.wait = s.time + 0.5;
    const st = this.plan.steps[this.k];
    const r = this.tryStep(s, st);
    if (r === 'done') {
      this.k++;
      this.wait = 0;
    } else if (r === 'skip') {
      this.log.push(`${s.year} skip ${JSON.stringify(st)}`);
      this.k++;
    } else if (r === 'cash' && this.plan.borrow && issueBond(s)) this.log.push(`${s.year} bond, cash ${money(s.cash)}`);
  }

  /** a station spot by a site: an open cell near it, nearest the given point */
  spot(s: SimState, site: Site, toward: [number, number]): number[] {
    const out: { i: number; d: number }[] = [];
    const R = site.kind === 'town' ? 3 : 3;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = site.cx + dx;
        const y = site.cy + dy;
        if (x < 1 || y < 1 || x >= s.w - 1 || y >= s.h - 1) continue;
        const i = idx(s, x, y);
        if (s.blocked[i] || s.water[i] || s.track[i]) continue;
        if (!covered(s, i, 0).some((o) => o.site === site && (site.kind !== 'town' || o.homes >= 4))) continue;
        out.push({ i, d: Math.hypot(x - toward[0], y - toward[1]) });
      }
    return out.sort((a, b) => a.d - b.d).slice(0, 6).map((o) => o.i);
  }

  private tryStep(s: SimState, st: Step): 'done' | 'cash' | 'skip' | 'wait' {
    if (st.kind === 'bond') {
      for (let n = 0; n < st.n; n++) issueBond(s);
      this.log.push(`${s.year} ${st.n} bonds, cash ${money(s.cash)}`);
      return 'done';
    }
    if (st.kind === 'link') {
      const A = siteById(s, st.a);
      const B = siteById(s, st.b);
      const size = st.size ?? 0;
      const fromHave = this.spots.get(st.a);
      const toHave = this.spots.get(st.b);
      const starts = fromHave !== undefined ? [fromHave] : this.spot(s, A, [B.cx, B.cy]);
      const ends = toHave !== undefined ? [toHave] : this.spot(s, B, [A.cx, A.cy]);
      let best: { r: ReturnType<typeof routeOptions>[number]; a: number; b: number } | null = null;
      for (const a of starts.slice(0, 3))
        for (const b of ends.slice(0, 3)) {
          const opts = routeOptions(s, a, b, (st.via ?? []).map(([x, y]) => idx(s, x, y)));
          const r = opts.find((o) => o.mode === (st.mode ?? 'cheap')) ?? opts[0];
          if (r && (!best || r.cost < best.r.cost)) best = { r, a, b };
        }
      if (!best) return 'skip';
      const need = best.r.cost + (fromHave === undefined ? STATIONS[size].price : 0) + (toHave === undefined ? STATIONS[size].price : 0);
      if (need + (this.plan.reserve ?? 0) > s.cash) return 'cash';
      buildTrack(s, best.r);
      for (const [id, cell, have] of [[st.a, best.a, fromHave], [st.b, best.b, toHave]] as const) {
        if (have !== undefined) continue;
        if (stationBlock(s, cell)) {
          this.log.push(`${s.year} no station at ${cx(s, cell)},${cy(s, cell)}: ${stationBlock(s, cell)}`);
          continue;
        }
        buildStation(s, cell, size);
        this.spots.set(id, cell);
      }
      this.log.push(`${s.year}.${s.month} link ${st.a}-${st.b} ${best.r.mode} ${best.r.length.toFixed(0)} tiles worst ${best.r.worst}% cost ${money(best.r.cost)} cash ${money(s.cash)}`);
      return 'done';
    }
    const stations = st.stops.map((id) => stationAt(s, this.spots.get(id) ?? -1));
    if (stations.some((o) => !o)) return 'skip';
    if (LOCOS[st.loco].price + (this.plan.reserve ?? 0) > s.cash) return 'cash';
    const cars = st.cars ?? autoCars(s, stations as NonNullable<(typeof stations)[number]>[]);
    const t = buyTrain(s, st.loco, stations.map((o, k) => ({ station: o!.id, cars: cars[k] ?? [], waitFull: st.full?.[k] ?? false })));
    if (!t) return 'skip';
    this.log.push(`${s.year}.${s.month} train ${st.loco} ${st.stops.join('>')} cars ${cars.map((c) => c.join('+') || '-').join(' | ')} cash ${money(s.cash)}`);
    return 'done';
  }
}

export const PLANS: Record<string, { careful: Plan; careless: Plan }> = {
  sawmill: {
    careful: {
      borrow: false,
      steps: [
        { kind: 'link', a: 'kuusikko', b: 'saha' },
        { kind: 'link', a: 'saha', b: 'hameenlinna' },
        { kind: 'train', loco: 'jyry', stops: ['kuusikko', 'saha', 'hameenlinna'] },
        { kind: 'train', loco: 'hilma', stops: ['saha', 'hameenlinna'] },
        { kind: 'train', loco: 'jyry', stops: ['kuusikko', 'saha'] },
      ],
    },
    careless: {
      borrow: true,
      steps: [
        { kind: 'link', a: 'peltola', b: 'saha', mode: 'level' },
        { kind: 'train', loco: 'hilma', stops: ['peltola', 'saha'], cars: [['grain', 'grain', 'grain', 'grain'], ['grain', 'grain', 'grain', 'grain']] },
        { kind: 'link', a: 'kuusikko', b: 'hameenlinna', mode: 'level' },
        { kind: 'train', loco: 'hilma', stops: ['kuusikko', 'hameenlinna'], cars: [['logs', 'logs', 'logs', 'logs', 'logs', 'logs'], ['logs', 'logs']] },
        { kind: 'train', loco: 'hilma', stops: ['hameenlinna', 'kuusikko'] },
      ],
    },
  },
  harju: {
    careful: {
      borrow: false,
      reserve: 25,
      steps: [
        { kind: 'link', a: 'kuusikko', b: 'koskensaha' },
        { kind: 'link', a: 'koskensaha', b: 'hameenlinna' },
        { kind: 'train', loco: 'jyry', stops: ['kuusikko', 'koskensaha', 'hameenlinna'] },
        { kind: 'link', a: 'korpi', b: 'valkeakoski' },
        { kind: 'link', a: 'valkeakoski', b: 'tampere' },
        { kind: 'train', loco: 'jyry', stops: ['korpi', 'valkeakoski', 'tampere'] },
        { kind: 'link', a: 'hameenlinna', b: 'tampere' },
        { kind: 'train', loco: 'hilma', stops: ['tampere', 'hameenlinna'] },
        { kind: 'link', a: 'peltola', b: 'lahti' },
        { kind: 'link', a: 'hollola', b: 'lahti' },
        { kind: 'link', a: 'lahti', b: 'myllykyla' },
        { kind: 'train', loco: 'jyry', stops: ['peltola', 'lahti', 'myllykyla'] },
        { kind: 'link', a: 'myllykyla', b: 'helsinki' },
        { kind: 'train', loco: 'jyry', stops: ['myllykyla', 'helsinki'], cars: [['food', 'food', 'food', 'food'], []] },
        { kind: 'link', a: 'riihimaki', b: 'helsinki' },
        { kind: 'link', a: 'hameenlinna', b: 'riihimaki' },
        { kind: 'train', loco: 'ukko', stops: ['hameenlinna', 'riihimaki', 'helsinki'] },
        { kind: 'train', loco: 'ukko', stops: ['tampere', 'hameenlinna', 'helsinki'] },
        { kind: 'train', loco: 'jyry', stops: ['kuusikko', 'koskensaha'] },
      ],
    },
    careless: {
      borrow: true,
      steps: [
        { kind: 'bond', n: 3 },
        { kind: 'link', a: 'salo', b: 'koskensaha', mode: 'level' },
        { kind: 'train', loco: 'hilma', stops: ['salo', 'koskensaha'], cars: [['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs'], ['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs']] },
        { kind: 'train', loco: 'hilma', stops: ['salo', 'koskensaha'], cars: [['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs'], ['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs']] },
        { kind: 'link', a: 'koskensaha', b: 'lahti', mode: 'level' },
        { kind: 'train', loco: 'hilma', stops: ['koskensaha', 'lahti'] },
        { kind: 'train', loco: 'hilma', stops: ['salo', 'koskensaha'], cars: [['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs'], ['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs']] },
      ],
    },
  },
};
