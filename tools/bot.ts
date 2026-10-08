/**
 * The bot: a player with no thumb. Each scenario has a plan, a list of
 * steps taken in order as the cash allows: a line between two sites with
 * the cheap or the short route, a train on a line with its wagons and
 * engine, an extra wagon, an engine swap, the full-load switch. The year
 * end choices in order. sim-check and balance run it headless; the hand
 * in tools/hand.ts makes the same moves by touch.
 */
import type { EngineId, SimState, WagonType, YearEndChoice } from '../src/game/types';
import type { Route, RouteMode } from '../src/game/grid';
import { build, buyTrain, trainSpot, closeYearEnd, plan, trainPrice, addWagon, setEngine, setFullLoad, moveTrain, buyCrew, buyPlatform, platformPrice, borrow, repay, loanCeiling, netWorth } from '../src/game/sim';
import { CREW_PRICE, ENGINES, RESALE, WAGON_PRICE } from '../src/game/content/economy';
import type { YearEnd } from '../src/game/types';
import { idx } from '../src/game/grid';
import { stationAt } from '../src/game/state';
import { siteById } from '../src/game/state';

/** a step waits until a site has taken this many loads: a boards line is no use before the timber has come */
export interface Gate {
  site: string;
  delivered: number;
}

export type Step =
  | { kind: 'line'; from: string; to: string; mode: RouteMode; after?: Gate }
  | { kind: 'train'; line: [string, string]; wagons: WagonType; engine?: EngineId; fullLoad?: boolean; after?: Gate; /** buy it even when it can only park: the greedy plan's trains */ anyway?: boolean }
  | { kind: 'wagon'; train: number }
  | { kind: 'engine'; train: number; engine: EngineId }
  /** the train, by its place in the list of trains, goes to another line while it stands at a station both serve */
  | { kind: 'move'; train: number; line: [string, string] }
  /** the loading crew at a site's station */
  | { kind: 'crew'; site: string }
  /** one more platform at a site's station */
  | { kind: 'platform'; site: string };

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
      { kind: 'line', from: 'sawmill', to: 'town', mode: 'cheap', after: { site: 'sawmill', delivered: 4 } },
      { kind: 'train', line: ['sawmill', 'town'], wagons: 'box' },
      { kind: 'wagon', train: 1 },
      { kind: 'wagon', train: 0 },
      { kind: 'crew', site: 'forest' },
      { kind: 'crew', site: 'sawmill' },
      { kind: 'wagon', train: 1 },
      { kind: 'wagon', train: 0 },
      { kind: 'crew', site: 'town' },
    ],
    perks: ['wagon', 'speed', 'forest'],
  },
  // the boards chain to both towns first, then the mill by the lake and the grain from behind
  // the ridge (the way round through the saddle, with the strong engine), then flour to both
  harju: {
    steps: [
      { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat' },
      { kind: 'crew', site: 'forest' },
      { kind: 'line', from: 'sawmill', to: 'hameenlinna', mode: 'cheap', after: { site: 'sawmill', delivered: 6 } },
      { kind: 'train', line: ['sawmill', 'hameenlinna'], wagons: 'box' },
      { kind: 'line', from: 'hameenlinna', to: 'mill', mode: 'short' },
      { kind: 'line', from: 'mill', to: 'farm', mode: 'short' },
      { kind: 'train', line: ['mill', 'farm'], wagons: 'hopper', engine: 'jyry', fullLoad: true },
      { kind: 'train', line: ['hameenlinna', 'mill'], wagons: 'box' },
      { kind: 'line', from: 'sawmill', to: 'tampere', mode: 'cheap' },
      { kind: 'train', line: ['sawmill', 'tampere'], wagons: 'box' },
      { kind: 'line', from: 'tampere', to: 'mill', mode: 'short' },
      { kind: 'train', line: ['tampere', 'mill'], wagons: 'box' },
      { kind: 'platform', site: 'sawmill' },
      { kind: 'wagon', train: 3 },
      { kind: 'wagon', train: 3 },
      { kind: 'wagon', train: 1 },
      { kind: 'wagon', train: 2 },
      { kind: 'wagon', train: 0 },
      // then the money goes into what moves more flour: the second farm, crews at the busy stations, longer trains
      { kind: 'line', from: 'niittyla', to: 'mill', mode: 'cheap' },
      { kind: 'train', line: ['niittyla', 'mill'], wagons: 'hopper' },
      { kind: 'crew', site: 'mill' },
      { kind: 'wagon', train: 4 },
      { kind: 'wagon', train: 5 },
      { kind: 'crew', site: 'sawmill' },
      { kind: 'wagon', train: 6 },
      { kind: 'wagon', train: 6 },
      { kind: 'crew', site: 'farm' },
      { kind: 'wagon', train: 1 },
      { kind: 'wagon', train: 2 },
      { kind: 'crew', site: 'tampere' },
      { kind: 'crew', site: 'hameenlinna' },
      { kind: 'wagon', train: 4 },
      { kind: 'wagon', train: 5 },
      { kind: 'wagon', train: 0 },
    ],
    perks: ['forest', 'wagon', 'speed'],
  },
};

/** cash the bot keeps in hand after a buy, so running costs do not push it below zero: a quarter of the price */
const reserveFor = (price: number): number => Math.max(10, Math.round(price / 4));
/** the bot never borrows past this share of the ceiling: the last of it is for the days running costs take the cash below zero */
const BORROW_SHARE = 0.85;

export interface YearRecord extends YearEnd {
  trains: number;
  /** what the bot's next step costs at the year end (0 when the plan is done), and the loan ceiling then */
  next: number;
  ceiling: number;
}

/**
 * The greedy plan: every coin into trains on the first line, then wagons on them. It floods one
 * forest and one sawmill and builds nothing else; sim-check holds it under the planned network.
 */
export const GREEDY: Record<string, BotPlan> = {
  sawmill: { steps: [{ kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' }, ...Array.from({ length: 8 }, () => ({ kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat', anyway: true }) as Step)], perks: ['wagon', 'speed', 'forest'] },
  harju: { steps: [{ kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' }, ...Array.from({ length: 8 }, () => ({ kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat', anyway: true }) as Step)], perks: ['forest', 'wagon', 'speed'] },
};

export class Bot {
  done = 0;
  log: string[] = [];
  /** one record per year end, for balance and sim-check */
  years: YearRecord[] = [];
  maxLoan = 0;
  /** the routes of the line step being waited on: a search is too dear to repeat every frame */
  private routes: { step: number; lines: number; options: Route[] } | null = null;
  constructor(
    public plan: BotPlan,
    public borrows = true,
  ) {}

  static for(s: SimState, greedy = false): Bot {
    return new Bot(greedy ? GREEDY[s.scenario.id] : PLANS[s.scenario.id]);
  }

  lineBetween(s: SimState, a: string, b: string) {
    const ca = idx(s, siteById(s, a).cx, siteById(s, a).cy);
    const cb = idx(s, siteById(s, b).cx, siteById(s, b).cy);
    return s.lines.find((l) => (l.path[0] === ca && l.path[l.path.length - 1] === cb) || (l.path[0] === cb && l.path[l.path.length - 1] === ca));
  }

  /** the route a line step builds, searched once per state of the map */
  private route(s: SimState, step: Extract<Step, { kind: 'line' }>): Route {
    const a = siteById(s, step.from);
    const b = siteById(s, step.to);
    if (!this.routes || this.routes.step !== this.done || this.routes.lines !== s.lines.length) this.routes = { step: this.done, lines: s.lines.length, options: plan(s, idx(s, a.cx, a.cy), idx(s, b.cx, b.cy)) };
    const options = this.routes.options;
    if (!options.length) throw new Error(`no route ${step.from} -> ${step.to}`);
    return options.find((o) => o.mode === step.mode) ?? options[0];
  }

  /** what a step costs now, and whether it is a buy worth borrowing for */
  private need(s: SimState, step: Step): { price: number; productive: boolean } {
    if (step.kind === 'line') {
      // keep enough for the train that follows
      const next = this.plan.steps[this.done + 1];
      return { price: this.route(s, step).cost + (next?.kind === 'train' ? trainPrice(next.engine) : 0), productive: true };
    }
    if (step.kind === 'train') {
      // the bot waits for a platform and a clear block, as a player would, rather than park a train it paid for
      const line = this.lineBetween(s, step.line[0], step.line[1]);
      const spot = line ? trainSpot(s, line, 2) : null;
      return { price: trainPrice(step.engine), productive: !!spot && (!spot.parked || !!step.anyway) };
    }
    if (step.kind === 'wagon') return { price: WAGON_PRICE, productive: true };
    if (step.kind === 'crew') return { price: CREW_PRICE, productive: true };
    if (step.kind === 'platform') {
      const st = stationAt(s, idx(s, siteById(s, step.site).cx, siteById(s, step.site).cy));
      return { price: (st && platformPrice(s, st.id)) || 0, productive: true };
    }
    if (step.kind === 'engine') {
      const tr = s.trains[step.train];
      return { price: tr ? ENGINES[step.engine].price - Math.round(ENGINES[tr.engine].price * RESALE) : 0, productive: true };
    }
    return { price: 0, productive: false };
  }

  /** the price of the next step, for the check that cash does not pile up */
  nextBuy(s: SimState): number {
    const step = this.plan.steps[this.done];
    return step ? this.need(s, step).price : 0;
  }

  /** one look at the state: do the next step the cash allows */
  act(s: SimState): void {
    if (s.result) return;
    if (s.yearEnd) {
      const choice = this.plan.perks.find((p) => !s.perks.includes(p)) ?? this.plan.perks[this.plan.perks.length - 1];
      this.years.push({ ...s.yearEnd, trains: s.trains.length, next: this.nextBuy(s), ceiling: loanCeiling(s) });
      this.log.push(`${s.yearEnd.year}: profit ${s.yearEnd.profit}, cash ${s.yearEnd.cash}, loan ${s.yearEnd.loan}, worth ${s.yearEnd.worth}, grew ${s.yearEnd.grew.join(' ') || '-'}, choice ${choice}`);
      closeYearEnd(s, choice);
      return;
    }
    const step = this.plan.steps[this.done];
    // a gated step waits for its loads, and so does the borrowing for it
    if (step && 'after' in step && step.after && siteById(s, step.after.site).delivered < step.after.delivered) return;
    // what is left over once the next buy is covered pays the loan down
    const want = step ? this.need(s, step).price : 0;
    if (s.loan > 0 && s.cash > want + 2 * reserveFor(want)) repay(s, Math.min(s.loan, Math.floor(s.cash - want - reserveFor(want))));
    if (!step) return;
    const t = `t=${s.time.toFixed(0)}`;
    const { price, productive } = this.need(s, step);
    // borrow the gap, in whole tens, when the buy pays better than the interest does and can be made now
    if (this.borrows && productive && price > 0 && s.cash < price + reserveFor(price)) {
      const gap = Math.ceil((price + reserveFor(price) - s.cash) / 10) * 10;
      if (s.loan + gap <= loanCeiling(s) * BORROW_SHARE) {
        borrow(s, gap);
        this.maxLoan = Math.max(this.maxLoan, s.loan);
        this.log.push(`${t}: borrow ${gap}, loan ${s.loan}`);
      }
    }
    if (step.kind === 'line') {
      const r = this.route(s, step);
      if (s.cash < price + (productive ? 0 : 0)) return;
      const line = build(s, r);
      if (!line) throw new Error('build refused with the cash there');
      this.done++;
      this.log.push(`${t}: line ${step.from} -> ${step.to} ${r.mode}, ${r.cells.length} cells, bridge ${r.bridge.length}, cutting ${r.cutting.length}, cost ${r.cost}, shared ${r.cells.length - r.added.length - 1}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'train') {
      const line = this.lineBetween(s, step.line[0], step.line[1]);
      if (!line) throw new Error(`no line ${step.line.join('-')}`);
      if (s.cash < price || !productive) return;
      const tr = buyTrain(s, line.id, step.wagons, step.engine);
      if (!tr) return;
      if (step.fullLoad) setFullLoad(s, tr.id, true);
      this.done++;
      this.log.push(`${t}: train ${tr.id} ${step.engine ?? 'hilma'} ${step.wagons} on ${step.line.join('-')}${tr.parked ? ' (parked)' : ''}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'wagon') {
      const tr = s.trains[step.train];
      if (!tr) {
        this.done++;
        return;
      }
      if (!addWagon(s, tr.id)) return;
      this.done++;
      this.log.push(`${t}: wagon on train ${tr.id}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'crew') {
      const site = siteById(s, step.site);
      const st = stationAt(s, idx(s, site.cx, site.cy));
      if (!st || !buyCrew(s, st.id)) return;
      this.done++;
      this.log.push(`${t}: loading crew at ${step.site}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'platform') {
      const site = siteById(s, step.site);
      const st = stationAt(s, idx(s, site.cx, site.cy));
      if (!st || !buyPlatform(s, st.id)) return;
      this.done++;
      this.log.push(`${t}: platform at ${step.site}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'move') {
      const tr = s.trains[step.train];
      const line = this.lineBetween(s, step.line[0], step.line[1]);
      if (!tr || !line) throw new Error(`cannot move train ${step.train} to ${step.line.join('-')}`);
      if (!moveTrain(s, tr.id, line.id)) return;
      this.done++;
      this.log.push(`${t}: train ${tr.id} to ${step.line.join('-')}`);
    } else if (step.kind === 'engine') {
      const tr = s.trains[step.train];
      if (!tr || !setEngine(s, tr.id, step.engine)) return;
      this.done++;
      this.log.push(`${t}: engine ${step.engine} on train ${tr.id}, cash ${s.cash.toFixed(0)}`);
    }
  }
}

/** the worth of the bot's game so far, for the greedy comparison */
export const worthOf = (s: SimState): number => Math.round(netWorth(s));
