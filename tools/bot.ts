/**
 * The bot: a player with no thumb. Each scenario has a plan, a list of
 * steps taken in order as the cash allows: a line between two sites with
 * the cheap or the short route, a train on a line with its engine, an
 * extra wagon. At a pick it takes the upgrade it ranks higher. sim-check
 * and balance run it headless. The bot proves the rules hold; the
 * human-like playthrough (scripts/human.mjs) proves the game is fun.
 */
import type { EngineId, PerkId, SimState } from '../src/game/types';
import type { RouteMode } from '../src/game/grid';
import { build, buyTrain, plan, nextTrainPrice, addWagon, takePick, netWorth } from '../src/game/sim';
import { WAGON_PRICE } from '../src/game/content/economy';
import { idx } from '../src/game/grid';
import { siteById } from '../src/game/state';

export type Step =
  /** a drag from one site's station to another */
  | { kind: 'line'; from: string; to: string; mode: RouteMode }
  /** a train on the line between two sites */
  | { kind: 'train'; line: [string, string]; engine?: EngineId; wagons?: number }
  /** one more wagon on the newest train of a line */
  | { kind: 'wagon'; line: [string, string] };

export interface BotPlan {
  steps: Step[];
  /** the upgrades the bot prefers at a pick, best first */
  perks: PerkId[];
}

const PERKS: PerkId[] = ['train', 'output', 'wagon', 'speed', 'fair', 'track', 'loading', 'cash'];

export const PLANS: Record<string, BotPlan> = {
  sawmill: {
    steps: [
      { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['forest', 'sawmill'] },
      { kind: 'line', from: 'sawmill', to: 'town', mode: 'cheap' },
      { kind: 'train', line: ['sawmill', 'town'] },
      { kind: 'wagon', line: ['forest', 'sawmill'] },
      { kind: 'wagon', line: ['sawmill', 'town'] },
      { kind: 'train', line: ['sawmill', 'town'] },
    ],
    perks: PERKS,
  },
  // both chains to Lahti (already size 2) and Hämeenlinna
  harju: {
    steps: [
      { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['forest', 'sawmill'] },
      { kind: 'line', from: 'sawmill', to: 'hameenlinna', mode: 'cheap' },
      { kind: 'train', line: ['sawmill', 'hameenlinna'] },
      { kind: 'line', from: 'farm', to: 'mill', mode: 'cheap' },
      { kind: 'train', line: ['farm', 'mill'] },
      { kind: 'line', from: 'mill', to: 'hameenlinna', mode: 'cheap' },
      { kind: 'train', line: ['mill', 'hameenlinna'] },
      { kind: 'line', from: 'mill', to: 'lahti', mode: 'cheap' },
      { kind: 'train', line: ['mill', 'lahti'] },
      { kind: 'line', from: 'sawmill', to: 'lahti', mode: 'cheap' },
      { kind: 'train', line: ['sawmill', 'lahti'] },
      { kind: 'wagon', line: ['forest', 'sawmill'] },
      { kind: 'wagon', line: ['farm', 'mill'] },
      { kind: 'train', line: ['forest', 'sawmill'] },
      { kind: 'train', line: ['farm', 'mill'] },
      { kind: 'wagon', line: ['sawmill', 'lahti'] },
      { kind: 'wagon', line: ['mill', 'lahti'] },
    ],
    perks: PERKS,
  },
};

const cellOf = (s: SimState, id: string): number => {
  const x = siteById(s, id);
  return idx(s, x.cx, x.cy);
};

/** the line between two sites, either way round */
export function lineBetween(s: SimState, a: string, b: string) {
  const st = (id: string) => s.stations.find((o) => o.siteId === id)?.id;
  const x = st(a);
  const y = st(b);
  return s.lines.find((l) => l.stops.includes(x ?? -1) && l.stops.includes(y ?? -1)) ?? null;
}

export class Bot {
  plan: BotPlan;
  next = 0;
  log: string[] = [];
  constructor(plan: BotPlan) {
    this.plan = plan;
  }
  static for(s: SimState): Bot {
    return new Bot(PLANS[s.scenario.id]);
  }
  private say(s: SimState, text: string): void {
    this.log.push(`${s.time.toFixed(1).padStart(6)} s ${s.year} cash ${Math.round(s.cash)}: ${text}`);
  }
  act(s: SimState): void {
    if (s.result) return;
    if (s.pick) {
      const [a, b] = s.pick.options;
      const rank = (p: PerkId) => this.plan.perks.indexOf(p);
      const c = rank(a) <= rank(b) ? 0 : 1;
      this.say(s, `pick ${s.pick.options[c]} over ${s.pick.options[1 - c]}`);
      takePick(s, c);
      return;
    }
    const st = this.plan.steps[this.next];
    if (!st) return;
    if (st.kind === 'line') {
      const opts = plan(s, cellOf(s, st.from), cellOf(s, st.to));
      if (!opts.length) {
        this.say(s, `no route ${st.from} to ${st.to}, skipped`);
        this.next++;
        return;
      }
      const r = opts.find((o) => o.mode === st.mode) ?? opts[0];
      if (s.cash < r.cost) return;
      build(s, r);
      this.say(s, `line ${st.from} to ${st.to} (${r.mode}) for ${r.cost}, ${r.length.toFixed(0)} tiles`);
      this.next++;
    } else if (st.kind === 'train') {
      const line = lineBetween(s, st.line[0], st.line[1]);
      if (!line) {
        this.next++;
        return;
      }
      const price = nextTrainPrice(s, st.engine, st.wagons);
      if (s.cash < price) return;
      buyTrain(s, line.id, st.engine, st.wagons);
      this.say(s, `train on ${st.line.join(' to ')} for ${price}`);
      this.next++;
    } else {
      const line = lineBetween(s, st.line[0], st.line[1]);
      const t = line && [...s.trains].reverse().find((o) => o.lineId === line.id);
      if (!t) {
        this.next++;
        return;
      }
      if (s.cash < WAGON_PRICE) return;
      if (addWagon(s, t.id)) this.say(s, `wagon on ${st.line.join(' to ')}`);
      this.next++;
    }
  }
}

export const worthOf = (s: SimState): number => Math.round(netWorth(s));
