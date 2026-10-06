/**
 * The bot: a player with no thumb. Each scenario has a plan, a list of
 * steps taken in order as the cash allows: a line between two sites with
 * the cheap or the short route, a train on a line with its wagons and
 * engine, an extra wagon, an engine swap, the full-load switch. The year
 * end choices in order. sim-check and balance run it headless; the hand
 * in tools/hand.ts makes the same moves by touch.
 */
import type { EngineId, SimState, WagonType, YearEndChoice } from '../src/game/types';
import type { RouteMode } from '../src/game/grid';
import { build, buyTrain, closeYearEnd, plan, trainPrice, addWagon, setEngine, setFullLoad } from '../src/game/sim';
import { idx } from '../src/game/grid';
import { siteById } from '../src/game/state';

export type Step =
  | { kind: 'line'; from: string; to: string; mode: RouteMode }
  | { kind: 'train'; line: [string, string]; wagons: WagonType; engine?: EngineId; fullLoad?: boolean }
  | { kind: 'wagon'; train: number }
  | { kind: 'engine'; train: number; engine: EngineId };

export interface BotPlan {
  steps: Step[];
  /** the year-end choices in order; the last repeats */
  perks: YearEndChoice[];
}

export const PLANS: Record<string, BotPlan> = {
  sawmill: {
    steps: [
      { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat' },
      { kind: 'line', from: 'sawmill', to: 'town', mode: 'cheap' },
      { kind: 'train', line: ['sawmill', 'town'], wagons: 'box' },
      { kind: 'train', line: ['sawmill', 'town'], wagons: 'box' },
    ],
    perks: ['wagon', 'speed', 'forest'],
  },
  // the boards chain to the near town first, then the flour chain through the cutting with the
  // strong engine, then the far town over the bridge, then both chains to both towns
  harju: {
    steps: [
      { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat' },
      { kind: 'line', from: 'sawmill', to: 'hameenlinna', mode: 'cheap' },
      { kind: 'train', line: ['sawmill', 'hameenlinna'], wagons: 'box' },
      { kind: 'line', from: 'sawmill', to: 'tampere', mode: 'short' },
      { kind: 'train', line: ['sawmill', 'tampere'], wagons: 'box' },
      { kind: 'line', from: 'sawmill', to: 'farm', mode: 'short' },
      { kind: 'line', from: 'farm', to: 'mill', mode: 'short' },
      { kind: 'train', line: ['farm', 'mill'], wagons: 'hopper', engine: 'jyry', fullLoad: true },
      { kind: 'line', from: 'mill', to: 'tampere', mode: 'short' },
      { kind: 'train', line: ['mill', 'tampere'], wagons: 'box' },
      { kind: 'line', from: 'mill', to: 'hameenlinna', mode: 'short' },
      { kind: 'train', line: ['mill', 'hameenlinna'], wagons: 'box' },
      { kind: 'wagon', train: 0 },
      { kind: 'wagon', train: 1 },
      { kind: 'wagon', train: 2 },
    ],
    perks: ['forest', 'wagon', 'speed'],
  },
};

export class Bot {
  done = 0;
  log: string[] = [];
  constructor(public plan: BotPlan) {}

  static for(s: SimState): Bot {
    return new Bot(PLANS[s.scenario.id]);
  }

  lineBetween(s: SimState, a: string, b: string) {
    const ca = idx(s, siteById(s, a).cx, siteById(s, a).cy);
    const cb = idx(s, siteById(s, b).cx, siteById(s, b).cy);
    return s.lines.find((l) => (l.path[0] === ca && l.path[l.path.length - 1] === cb) || (l.path[0] === cb && l.path[l.path.length - 1] === ca));
  }

  /** one look at the state: do the next step the cash allows */
  act(s: SimState): void {
    if (s.result) return;
    if (s.yearEnd) {
      const choice = this.plan.perks.find((p) => !s.perks.includes(p)) ?? this.plan.perks[this.plan.perks.length - 1];
      this.log.push(`${s.yearEnd.year}: profit ${s.yearEnd.profit}, cash ${s.yearEnd.cash}, grew ${s.yearEnd.grew.join(' ') || '-'}, choice ${choice}`);
      closeYearEnd(s, choice);
      return;
    }
    const step = this.plan.steps[this.done];
    if (!step) return;
    const t = `t=${s.time.toFixed(0)}`;
    if (step.kind === 'line') {
      const a = siteById(s, step.from);
      const b = siteById(s, step.to);
      const options = plan(s, idx(s, a.cx, a.cy), idx(s, b.cx, b.cy));
      if (!options.length) throw new Error(`no route ${step.from} -> ${step.to}`);
      const r = options.find((o) => o.mode === step.mode) ?? options[0];
      // keep enough for the train that follows
      const next = this.plan.steps[this.done + 1];
      const reserve = next?.kind === 'train' ? trainPrice(next.engine) : 0;
      if (s.cash < r.cost + reserve) return;
      const line = build(s, r);
      if (!line) throw new Error('build refused with the cash there');
      this.done++;
      this.log.push(`${t}: line ${step.from} -> ${step.to} ${r.mode}, ${r.cells.length} cells, bridge ${r.bridge.length}, cutting ${r.cutting.length}, cost ${r.cost}, cash ${s.cash}`);
    } else if (step.kind === 'train') {
      const line = this.lineBetween(s, step.line[0], step.line[1]);
      if (!line) throw new Error(`no line ${step.line.join('-')}`);
      if (s.cash < trainPrice(step.engine)) return;
      const tr = buyTrain(s, line.id, step.wagons, step.engine);
      if (!tr) return;
      if (step.fullLoad) setFullLoad(s, tr.id, true);
      this.done++;
      this.log.push(`${t}: train ${tr.id} ${step.engine ?? 'hilma'} ${step.wagons} on ${step.line.join('-')}, cash ${s.cash}`);
    } else if (step.kind === 'wagon') {
      const tr = s.trains[step.train];
      if (!tr) {
        this.done++;
        return;
      }
      if (!addWagon(s, tr.id)) return;
      this.done++;
      this.log.push(`${t}: wagon on train ${tr.id}, cash ${s.cash}`);
    } else if (step.kind === 'engine') {
      const tr = s.trains[step.train];
      if (!tr || !setEngine(s, tr.id, step.engine)) return;
      this.done++;
      this.log.push(`${t}: engine ${step.engine} on train ${tr.id}, cash ${s.cash}`);
    }
  }
}
