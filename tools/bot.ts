/**
 * The bot: a player with no thumb. Each scenario has a plan, a list of
 * steps taken in order as the cash allows: a line between two sites with
 * the cheap or the short route, a train on a line with its wagons and
 * engine, an extra wagon, an engine swap, the full-load switch. The year
 * end choices in order. sim-check and balance run it headless; the hand
 * in tools/hand.ts makes the same moves by touch.
 */
import type { Contract, EngineId, Good, SimState, WagonType } from '../src/game/types';
import type { Route, RouteMode } from '../src/game/grid';
import { removeWagon, build, buyTrain, trainSpot, closeYearEnd, plan, trainPrice, addWagon, setEngine, setFullLoad, moveTrain, setStop, buyCrew, buyCrane, buyPlatform, buySiding, defaultConsist, platformPrice, borrow, repay, loanCeiling, netWorth, visited, extendable, freeSide, canExtend } from '../src/game/sim';
import { advice, type Advice } from '../src/game/advice';
import { wagonFor, WAGONS_DEFAULT, CRANE_PRICE, CREW_PRICE, SIDING_PRICE, MAKES, ENGINES, RESALE, WAGON_PRICE } from '../src/game/content/economy';
import type { YearEnd } from '../src/game/types';
import { idx } from '../src/game/grid';
import { stationAt } from '../src/game/state';
import { siteById } from '../src/game/state';

/** a step waits until a site has taken this many loads: a boards line is no use before the timber has come */
export interface Gate {
  site: string;
  delivered?: number;
  /** or until the town has grown to this size: the passenger line waits for towns that want travellers */
  size?: number;
}

export type Step =
  /** a drag from one site's station to another; with `extend` (the sites of the line, in order) the drag lengthens that line, which ends at `from`, instead of starting a new one */
  | { kind: 'line'; from: string; to: string; mode: RouteMode; after?: Gate; extend?: string[] }
  /** a train on the line through these sites in order (two to four); `wagons` is one type (the default count) or the consist wagon by wagon */
  | { kind: 'train'; line: string[]; wagons: WagonType | WagonType[]; engine?: EngineId; fullLoad?: boolean; after?: Gate; /** buy it even when it can only park: the greedy plan's trains */ anyway?: boolean }
  /** one more wagon on a train, of a type (the last wagon's when none is given). The train is named by its line (its stops as they are at that moment), and by `nth` when the line has several (0 is the first bought), so a train bought off the plan does not shift it */
  | { kind: 'wagon'; line: string[]; nth?: number; type?: WagonType }
  /** the train gives up its last wagon of a type (half the price comes back) */
  | { kind: 'drop'; line: string[]; nth?: number; type: WagonType }
  | { kind: 'engine'; line: string[]; nth?: number; engine: EngineId }
  /** the train, by its place in the list of trains, goes to another line while it stands at a station both serve */
  | { kind: 'move'; train: number; line: string[] }
  /** the train's order for a middle station of its line: pass it through, or with `stop` stop there again */
  | { kind: 'pass'; line: string[]; nth?: number; site: string; stop?: boolean }
  /** the loading crew at a site's station */
  | { kind: 'crew'; site: string }
  /** one more platform at a site's station */
  | { kind: 'platform'; site: string }
  /** the passing siding of a line, in the middle of its longest straight */
  | { kind: 'siding'; line: string[] }
  /** the crane at a site's station, which has the loading crew */
  | { kind: 'crane'; site: string; after?: Gate };

export interface BotPlan {
  steps: Step[];
}

export const PLANS: Record<string, BotPlan> = {
  // the tutorial: one line forest to sawmill with a train of flat wagons, then the line to the town
  // with a train of box wagons
  sawmill: {
    steps: [
      { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat' },
      { kind: 'line', from: 'sawmill', to: 'town', mode: 'cheap', after: { site: 'sawmill', delivered: 3 } },
      { kind: 'train', line: ['sawmill', 'town'], wagons: 'box' },
      { kind: 'crew', site: 'sawmill' },
      { kind: 'crew', site: 'forest' },
      { kind: 'crew', site: 'town' },
      // the cranes wait for the boards to flow
      { kind: 'crane', site: 'sawmill', after: { site: 'town', delivered: 11 } },
      { kind: 'crane', site: 'forest', after: { site: 'town', delivered: 30 } },
    ],
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
      { kind: 'wagon', line: ['sawmill', 'hameenlinna'] },
      { kind: 'line', from: 'hameenlinna', to: 'mill', mode: 'short' },
      { kind: 'line', from: 'mill', to: 'farm', mode: 'cheap' },
      { kind: 'train', line: ['mill', 'farm'], wagons: 'hopper', fullLoad: true },
      { kind: 'wagon', line: ['mill', 'farm'] },
      { kind: 'train', line: ['hameenlinna', 'mill'], wagons: 'box' },
      { kind: 'platform', site: 'mill' },
      // Tampere: boards from the sawmill, then the line between the two towns with two coaches and a mail van
      // (the towns want travellers from size 2), then flour from the mill
      { kind: 'line', from: 'sawmill', to: 'tampere', mode: 'cheap' },
      { kind: 'train', line: ['sawmill', 'tampere'], wagons: 'box' },
      { kind: 'wagon', line: ['sawmill', 'tampere'] },
      { kind: 'line', from: 'tampere', to: 'hameenlinna', mode: 'short' },
      { kind: 'train', line: ['tampere', 'hameenlinna'], wagons: ['coach', 'coach', 'mailvan'] },
      { kind: 'line', from: 'tampere', to: 'mill', mode: 'short' },
      { kind: 'train', line: ['tampere', 'mill'], wagons: 'box' },
      { kind: 'wagon', line: ['tampere', 'mill'] },
      { kind: 'wagon', line: ['forest', 'sawmill'] },
      { kind: 'wagon', line: ['hameenlinna', 'mill'] },
      // the mill's flour line to Hämeenlinna is long: a second platform at each end, a second train and the passing siding
      { kind: 'platform', site: 'mill' },
      { kind: 'platform', site: 'hameenlinna' },
      { kind: 'wagon', line: ['sawmill', 'tampere'] },
      { kind: 'train', line: ['hameenlinna', 'mill'], wagons: 'box' },
      { kind: 'crew', site: 'sawmill' },
      { kind: 'siding', line: ['hameenlinna', 'mill'] },
      { kind: 'platform', site: 'tampere' },
      // the crews where the wagons are many, and the cranes last: they pay only on the busy platforms
      { kind: 'crew', site: 'mill' },
      { kind: 'crew', site: 'tampere' },
      { kind: 'crew', site: 'hameenlinna' },
      { kind: 'crew', site: 'farm' },
      { kind: 'crane', site: 'forest' },
      { kind: 'crane', site: 'sawmill' },
      { kind: 'crane', site: 'mill' },
      { kind: 'crane', site: 'farm' },
    ],
  },
};

/**
 * Three ways to win Harju, so that no choice is the one right answer.
 *   A (PLANS.harju): Kuusikko and Peltola, then Hämeenlinna and Tampere. Near and poor forest, rich farm.
 *   B: Korpela and Niittylä, then Tampere and Lahti. Rich forest, poor farm, the far town.
 *   C: Kuusikko and Peltola, then Tampere and Lahti. A's sources with B's towns.
 * sim-check holds all three to a win between 1869 and 1871 with two stars, and to a net worth within
 * 20 % of each other, and it holds B and C to the money checks A keeps. B and C were found by a
 * search over the order of the buys with the bot playing each game headless, then pruned of every
 * buy that changed nothing, so the order is a fact about this map and these numbers and not a rule:
 * run the search again after a change to a site's rate or cap. Nothing in them spends on the forest
 * or the farm a plan does not run. A 3-stop line (tampere, mill, lahti) carries the flour to both towns
 * and the travellers between them on one block, which beats a line to each.
 */
export const HARJU_PLANS: Record<string, BotPlan> = {
  A: PLANS.harju,
  B: {
    steps: [
      { kind: 'line', from: 'korpela', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['korpela', 'sawmill'], wagons: ['flat', 'flat', 'flat'] },
      { kind: 'line', from: 'sawmill', to: 'tampere', mode: 'cheap', after: { site: 'sawmill', delivered: 6 } },
      { kind: 'line', from: 'tampere', to: 'mill', mode: 'cheap' },
      { kind: 'crew', site: 'korpela' },
      { kind: 'line', from: 'mill', to: 'niittyla', mode: 'short' },
      { kind: 'platform', site: 'mill' },
      { kind: 'train', line: ['mill', 'niittyla'], wagons: ['hopper', 'hopper', 'hopper'], fullLoad: true },
      { kind: 'platform', site: 'korpela' },
      { kind: 'crew', site: 'niittyla' },
      { kind: 'train', line: ['sawmill', 'tampere'], wagons: 'box' },
      { kind: 'platform', site: 'tampere' },
      { kind: 'train', line: ['tampere', 'mill'], wagons: 'box' },
      { kind: 'line', from: 'mill', to: 'lahti', mode: 'short', extend: ['tampere', 'mill'] },
      { kind: 'wagon', line: ['sawmill', 'tampere'] },
      { kind: 'crew', site: 'sawmill' },
      { kind: 'engine', line: ['sawmill', 'tampere'], engine: 'jyry' },
      { kind: 'line', from: 'sawmill', to: 'lahti', mode: 'short' },
      { kind: 'train', line: ['sawmill', 'lahti'], wagons: ['box', 'box', 'box'] },
      { kind: 'wagon', line: ['sawmill', 'tampere'] },
      { kind: 'wagon', line: ['tampere', 'mill', 'lahti'] },
      { kind: 'platform', site: 'tampere' },
      { kind: 'engine', line: ['korpela', 'sawmill'], engine: 'jyry' },
      { kind: 'crew', site: 'tampere' },
      { kind: 'crew', site: 'lahti' },
      { kind: 'platform', site: 'lahti' },
      { kind: 'wagon', line: ['sawmill', 'lahti'] },
      { kind: 'platform', site: 'sawmill' },
      { kind: 'wagon', line: ['tampere', 'mill', 'lahti'], type: 'coach' },
      { kind: 'train', line: ['sawmill', 'lahti'], wagons: ['box', 'box', 'box', 'box'] },
      { kind: 'crane', site: 'niittyla' },
      { kind: 'engine', line: ['sawmill', 'lahti'], engine: 'jyry' },
      { kind: 'crew', site: 'sawmill' },
    ],
  },
  C: {
    steps: [
      { kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' },
      { kind: 'train', line: ['forest', 'sawmill'], wagons: ['flat', 'flat', 'flat'] },
      { kind: 'crew', site: 'forest' },
      { kind: 'wagon', line: ['forest', 'sawmill'] },
      { kind: 'line', from: 'sawmill', to: 'tampere', mode: 'cheap', after: { site: 'sawmill', delivered: 6 } },
      { kind: 'line', from: 'tampere', to: 'mill', mode: 'cheap' },
      { kind: 'platform', site: 'forest' },
      { kind: 'line', from: 'mill', to: 'farm', mode: 'cheap' },
      { kind: 'platform', site: 'mill' },
      { kind: 'train', line: ['mill', 'farm'], wagons: ['hopper', 'hopper', 'hopper'], fullLoad: true },
      { kind: 'train', line: ['sawmill', 'tampere'], wagons: 'box' },
      { kind: 'train', line: ['tampere', 'mill'], wagons: 'box' },
      { kind: 'platform', site: 'tampere' },
      { kind: 'wagon', line: ['mill', 'farm'] },
      { kind: 'line', from: 'mill', to: 'lahti', mode: 'short', extend: ['tampere', 'mill'] },
      { kind: 'line', from: 'sawmill', to: 'lahti', mode: 'short' },
      { kind: 'crew', site: 'farm' },
      { kind: 'crew', site: 'sawmill' },
      { kind: 'wagon', line: ['tampere', 'mill', 'lahti'], type: 'coach' },
      { kind: 'crew', site: 'mill' },
      { kind: 'wagon', line: ['sawmill', 'tampere'] },
      { kind: 'train', line: ['sawmill', 'lahti'], wagons: ['box', 'box', 'box'] },
      { kind: 'crew', site: 'lahti' },
      { kind: 'platform', site: 'lahti' },
      { kind: 'wagon', line: ['sawmill', 'tampere'] },
      { kind: 'wagon', line: ['sawmill', 'lahti'] },
      { kind: 'wagon', line: ['tampere', 'mill', 'lahti'], type: 'coach' },
      { kind: 'crew', site: 'tampere' },
      { kind: 'platform', site: 'sawmill' },
      { kind: 'platform', site: 'farm' },
      { kind: 'train', line: ['tampere', 'mill', 'lahti'], wagons: ['box', 'box', 'box', 'box'] },
      // the orders, tried and put back at once: the train passes the mill through and then stops there again
      { kind: 'pass', line: ['tampere', 'mill', 'lahti'], nth: 1, site: 'mill' },
      { kind: 'pass', line: ['tampere', 'mill', 'lahti'], nth: 1, site: 'mill', stop: true },
      { kind: 'platform', site: 'farm' },
      { kind: 'crane', site: 'sawmill' },
      { kind: 'platform', site: 'sawmill' },
      { kind: 'wagon', line: ['mill', 'farm'] },
    ],
  },
};

/**
 * Whether a plan serves a contract: one of its lines joins the site to another that makes the good.
 * The bot and the hand take only what their network will carry anyway.
 */
export function planServes(steps: Step[], c: { site: string; good: Good }, makes: (site: string) => Good | null): boolean {
  return steps.some((st) => {
    if (st.kind !== 'line') return false;
    const other = st.from === c.site ? st.to : st.to === c.site ? st.from : null;
    return !!other && makes(other) === c.good;
  });
}

/** how many wagons a train step buys */
export const countOf = (w: WagonType | WagonType[]): number => (Array.isArray(w) ? w.length : WAGONS_DEFAULT);

/** cash the bot keeps in hand after a buy, so running costs do not push it below zero: a quarter of the price */
const reserveFor = (price: number): number => Math.max(10, Math.round(price / 4));
/** the bot never borrows past this share of the ceiling: the last of it is for the days running costs take the cash below zero */
const BORROW_SHARE = 0.85;

export interface YearRecord extends YearEnd {
  /** the contract on offer at the year end, and whether the bot took it */
  offered: Contract | null;
  took: boolean;
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
  sawmill: { steps: [{ kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' }, ...Array.from({ length: 8 }, () => ({ kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat', anyway: true }) as Step)] },
  harju: { steps: [{ kind: 'line', from: 'forest', to: 'sawmill', mode: 'cheap' }, ...Array.from({ length: 8 }, () => ({ kind: 'train', line: ['forest', 'sawmill'], wagons: 'flat', anyway: true }) as Step)] },
};

export class Bot {
  done = 0;
  log: string[] = [];
  /** one record per year end, for balance and sim-check */
  years: YearRecord[] = [];
  maxLoan = 0;
  /** the contracts the bot holds, and how many it finished and lost */
  held: Contract[] = [];
  contractsDone = 0;
  contractsLost = 0;
  /** the routes of the line step being waited on: a search is too dear to repeat every frame */
  private routes: { step: number; lines: number; options: Route[] } | null = null;
  constructor(
    public plan: BotPlan,
    public borrows = true,
  ) {}

  static for(s: SimState, greedy = false, variant?: string): Bot {
    if (variant === 'D') return new TipBot();
    if (variant && s.scenario.id === 'harju') return new Bot(HARJU_PLANS[variant]);
    return new Bot(greedy ? GREEDY[s.scenario.id] : PLANS[s.scenario.id]);
  }

  /**
   * Whether the bot's plan serves the contract's site with the good: a line of the plan joins the
   * site to one that makes the good. The bot takes only what its network will carry anyway.
   */
  serves(s: SimState, c: Contract): boolean {
    return planServes(this.plan.steps, c, (id) => MAKES[siteById(s, id).kind]);
  }


  /** the line that runs through these sites in order, or in the reverse order */
  lineFor(s: SimState, sites: string[]) {
    const ids = sites.map((id) => stationAt(s, idx(s, siteById(s, id).cx, siteById(s, id).cy))?.id);
    const same = (a: (number | undefined)[], b: (number | undefined)[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    return s.lines.find((l) => same(l.stops, ids) || same(l.stops, ids.slice().reverse()));
  }

  /** the train on the line through these sites, the nth one bought (the first when no nth is given) */
  trainOn(s: SimState, sites: string[], nth = 0) {
    const line = this.lineFor(s, sites);
    return line ? s.trains.filter((t) => t.lineId === line.id)[nth] : undefined;
  }

  lineBetween(s: SimState, a: string, b: string) {
    return this.lineFor(s, [a, b]);
  }

  /** the line a line step with `extend` lengthens: the one that has the step's first site as an end */
  private extending(s: SimState, step: Extract<Step, { kind: 'line' }>) {
    if (!step.extend) return null;
    const line = this.lineFor(s, step.extend);
    return line && extendable(s, idx(s, siteById(s, step.from).cx, siteById(s, step.from).cy)).includes(line) ? line : null;
  }

  /** the route a line step builds, searched once per state of the map */
  private route(s: SimState, step: Extract<Step, { kind: 'line' }>): Route {
    const a = siteById(s, step.from);
    const b = siteById(s, step.to);
    const ext = this.extending(s, step);
    if (step.extend && !ext) throw new Error(`no line to extend from ${step.from}`);
    const side = ext ? freeSide(s, ext, idx(s, a.cx, a.cy)) : undefined;
    if (!this.routes || this.routes.step !== this.done || this.routes.lines !== s.lines.length) this.routes = { step: this.done, lines: s.lines.length, options: plan(s, idx(s, a.cx, a.cy), idx(s, b.cx, b.cy), side).filter((r) => !ext || canExtend(s, r, ext.id)) };
    const options = this.routes.options;
    if (!options.length) throw new Error(`no route ${step.from} -> ${step.to}`);
    return options.find((o) => o.mode === step.mode) ?? options[0];
  }

  /** what a step costs now, and whether it is a buy worth borrowing for */
  private need(s: SimState, step: Step): { price: number; productive: boolean } {
    if (step.kind === 'line') {
      // keep enough for the train that follows
      const next = this.plan.steps[this.done + 1];
      return { price: this.route(s, step).cost + (next?.kind === 'train' ? trainPrice(next.engine, countOf(next.wagons)) : 0), productive: true };
    }
    if (step.kind === 'train') {
      // the bot waits for a platform and a clear block, as a player would, rather than park a train it paid for
      const line = this.lineFor(s, step.line);
      const spot = line ? trainSpot(s, line, countOf(step.wagons)) : null;
      return { price: trainPrice(step.engine, countOf(step.wagons)), productive: !!spot && (!spot.parked || !!step.anyway) };
    }
    if (step.kind === 'wagon') return { price: WAGON_PRICE, productive: true };
    if (step.kind === 'drop') return { price: 0, productive: false };
    if (step.kind === 'crew') return { price: CREW_PRICE, productive: true };
    if (step.kind === 'siding') return { price: SIDING_PRICE, productive: true };
    if (step.kind === 'crane') return { price: CRANE_PRICE, productive: true };
    if (step.kind === 'platform') {
      const st = stationAt(s, idx(s, siteById(s, step.site).cx, siteById(s, step.site).cy));
      return { price: (st && platformPrice(s, st.id)) || 0, productive: true };
    }
    if (step.kind === 'engine') {
      const tr = this.trainOn(s, step.line, step.nth);
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
      const offer = s.offer;
      const take = !!offer && this.serves(s, offer);
      this.years.push({ ...s.yearEnd, trains: s.trains.length, next: this.nextBuy(s), ceiling: loanCeiling(s), offered: offer, took: take });
      this.log.push(`${s.yearEnd.year}: goal ${s.goalCount}, profit ${s.yearEnd.profit}, cash ${s.yearEnd.cash}, loan ${s.yearEnd.loan}, worth ${s.yearEnd.worth}, grew ${s.yearEnd.grew.join(' ') || '-'}, contract ${offer ? `${offer.count} ${offer.good} to ${offer.site} for ${offer.reward}, ${take ? 'taken' : 'skipped'}` : 'none'}`);
      closeYearEnd(s, take);
      if (take && offer) this.held.push(offer);
      return;
    }
    // a contract the bot holds is done when it leaves the list full, lost when it leaves short
    for (const c of this.held.filter((o) => !s.contracts.includes(o))) {
      this.held = this.held.filter((o) => o !== c);
      if (c.got >= c.count) this.contractsDone++;
      else this.contractsLost++;
    }
    const step = this.plan.steps[this.done];
    // a gated step waits for its loads, and so does the borrowing for it
    if (step && 'after' in step && step.after && (siteById(s, step.after.site).delivered < (step.after.delivered ?? 0) || siteById(s, step.after.site).size < (step.after.size ?? 0))) return;
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
      const line = build(s, r, this.extending(s, step)?.id);
      if (!line) throw new Error(`build refused with the cash there: ${step.from}->${step.to} extend ${step.extend?.join()} ext ${this.extending(s, step)?.id} cells ${r.cells.slice(0, 3).join()} cost ${r.cost} cash ${s.cash}`);
      this.done++;
      this.log.push(`${t}: ${step.extend ? 'extend to' : 'line'} ${step.from} -> ${step.to} ${r.mode}, ${r.cells.length} cells, bridge ${r.bridge.length}, cutting ${r.cutting.length}, cost ${r.cost}, shared ${r.cells.length - r.added.length - 1}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'train') {
      const line = this.lineFor(s, step.line);
      if (!line) throw new Error(`no line ${step.line.join('-')}`);
      if (s.cash < price || !productive) return;
      const tr = buyTrain(s, line.id, step.wagons, step.engine);
      if (!tr) return;
      if (step.fullLoad) setFullLoad(s, tr.id, true);
      this.done++;
      this.log.push(`${t}: train ${tr.id} ${step.engine ?? 'hilma'} ${[step.wagons].flat().join('+')} on ${step.line.join('-')}${tr.parked ? ' (parked)' : ''}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'wagon') {
      const tr = this.trainOn(s, step.line, step.nth);
      if (!tr) {
        this.done++;
        return;
      }
      if (!addWagon(s, tr.id, step.type)) return;
      this.done++;
      this.log.push(`${t}: wagon on train ${tr.id}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'drop') {
      const tr = this.trainOn(s, step.line, step.nth);
      const at = tr ? tr.wagons.lastIndexOf(step.type) : -1;
      if (!tr || at < 0 || !removeWagon(s, tr.id, at)) {
        this.done++;
        return;
      }
      this.done++;
      this.log.push(`${t}: ${step.type} wagon off train ${tr.id}, cash ${s.cash.toFixed(0)}`);
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
    } else if (step.kind === 'siding') {
      const line = this.lineFor(s, step.line);
      if (!line) throw new Error(`no line ${step.line.join('-')}`);
      if (!buySiding(s, line.id)) return;
      this.done++;
      this.log.push(`${t}: passing siding on ${step.line.join('-')}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'crane') {
      const site = siteById(s, step.site);
      const st = stationAt(s, idx(s, site.cx, site.cy));
      if (!st || !buyCrane(s, st.id)) return;
      this.done++;
      this.log.push(`${t}: crane at ${step.site}, cash ${s.cash.toFixed(0)}`);
    } else if (step.kind === 'move') {
      const tr = s.trains[step.train];
      const line = this.lineFor(s, step.line);
      if (!tr || !line) throw new Error(`cannot move train ${step.train} to ${step.line.join('-')}`);
      if (!moveTrain(s, tr.id, line.id)) return;
      this.done++;
      this.log.push(`${t}: train ${tr.id} to ${step.line.join('-')}`);
    } else if (step.kind === 'pass') {
      const tr = this.trainOn(s, step.line, step.nth);
      const st = stationAt(s, idx(s, siteById(s, step.site).cx, siteById(s, step.site).cy));
      // a train that is not there, or a station that is no middle stop, leaves the step done: nothing to order
      if (tr && st) setStop(s, tr.id, st.id, !!step.stop);
      this.done++;
      this.log.push(`${t}: train ${tr?.id} ${step.stop ? 'stops at' : 'passes'} ${step.site}`);
    } else if (step.kind === 'engine') {
      const tr = this.trainOn(s, step.line, step.nth);
      if (!tr || !setEngine(s, tr.id, step.engine)) return;
      this.done++;
      this.log.push(`${t}: engine ${step.engine} on train ${tr.id}, cash ${s.cash.toFixed(0)}`);
    }
  }
}

/**
 * Plan D, the sensible player: a hand that does what the tip under the HUD says and nothing more
 * (src/game/advice.ts). It lays the track a tip names when the cash pays for the track and a train,
 * on the cheapest route, and lengthens the line when the tip says so. It buys one train for every
 * new line with the consist the buy card offers, never borrows, buys no siding, crane, crew or
 * platform, takes no contract, and passes tips that ask for those. A coach tip adds a coach where
 * there is room, or buys a train of coaches and a mail van. If it cannot act on a tip it waits.
 */
declare const process: { env: Record<string, string | undefined> };
export class TipBot extends Bot {
  /** the train owed to a line that was just laid: the consist and the line's id */
  private owed: { line: number; wagons?: WagonType[] } | null = null;
  private restUntil = 0;
  /** a train owed for this long and not placed is given up: the platform tip comes instead */
  private owedUntil = 0;
  /** the tips acted on, for the log */
  tips = 0;
  constructor() {
    super({ steps: [] }, false);
  }

  /** the tip a player would follow: the top one that asks for track or a coach (the others ask for extras this player does not buy) */
  private tip(s: SimState): Advice | undefined {
    return advice(s).find((a) => a.kind === 'first' || a.kind === 'stuck' || a.kind === 'starved' || a.kind === 'cash' || a.kind === 'more' || a.kind === 'platform' || a.kind === 'people');
  }

  act(s: SimState): void {
    if (s.result) return;
    if (s.yearEnd) {
      this.years.push({ ...s.yearEnd, trains: s.trains.length, next: 0, ceiling: loanCeiling(s), offered: s.offer, took: false });
      this.log.push(`${s.yearEnd.year}: goal ${s.goalCount}, profit ${s.yearEnd.profit}, cash ${s.yearEnd.cash}, worth ${s.yearEnd.worth}, grew ${s.yearEnd.grew.join(' ') || '-'}`);
      if (process.env.TIPS === '1') this.log.push(`   advice: ${advice(s).map((a) => `${a.kind} ${a.site}>${a.to ?? ''} ${a.good ?? ''} cost ${a.cost ?? ''}`).join(' | ') || 'none'}; towns ${s.sites.filter((x) => x.kind === 'town').map((x) => `${x.id} ${x.size} vis ${visited(s, x)} g${x.growth.toFixed(2)} store ${Object.entries(x.store).map(([k, v]) => `${k[0]}${v.toFixed(1)}`).join(',')}`).join('; ')}`);
      closeYearEnd(s, false);
      return;
    }
    // the player looks once a second
    if (Math.round(s.time * 60) % 60 !== 0) return;
    const t = `t=${s.time.toFixed(0)}`;
    if (this.owed && s.time > this.owedUntil) this.owed = null;
    if (this.owed) {
      const line = s.lines.find((l) => l.id === this.owed!.line);
      const wagons = this.owed.wagons ?? (line ? defaultConsist(s, line) : []);
      if (!line) this.owed = null;
      else if (s.cash >= trainPrice('hilma', wagons.length) && trainSpot(s, line, wagons.length) && !trainSpot(s, line, wagons.length)!.parked) {
        const tr = buyTrain(s, line.id, wagons);
        if (tr) {
          this.log.push(`${t}: train ${tr.id} ${wagons.join('+')} on line ${line.id}, cash ${s.cash.toFixed(0)}`);
          this.owed = null;
        }
      }
      return;
    }
    if (s.time < this.restUntil) return;
    const a = this.tip(s);
    if (a?.kind === 'platform') {
      const st = s.stations.find((x) => x.siteId === a.site);
      if (st && s.cash >= (a.cost ?? Infinity) && buyPlatform(s, st.id)) {
        this.tips++;
        this.log.push(`${t}: tip platform at ${a.site}, cash ${s.cash.toFixed(0)}`);
      }
      return;
    }
    if (!a || !a.to) return;
    const train = trainPrice('hilma', WAGONS_DEFAULT);
    if (a.kind === 'more' && a.onLine !== undefined && a.good) {
      // a wagon of the good's type where a train of the line has room, otherwise one more train with the consist the card offers
      const line = s.lines.find((l) => l.id === a.onLine);
      const type = wagonFor(a.good);
      const own = s.trains.find((o) => o.lineId === a.onLine && o.nWagons < 4 && o.wagons.includes(type));
      if (own && s.cash >= WAGON_PRICE) {
        if (addWagon(s, own.id, type)) {
          this.tips++;
          this.restUntil = s.time + 60;
          this.log.push(`${t}: tip ${a.kind} ${a.site}>${a.to}: ${type} wagon on train ${own.id}, cash ${s.cash.toFixed(0)}`);
        }
      } else if (!own && line && s.cash >= train) {
        this.tips++;
        this.restUntil = s.time + 60;
        this.owed = { line: line.id };
        this.owedUntil = s.time + 120;
      }
      return;
    }
    if (a.kind === 'people' && a.onLine !== undefined) {
      const line = s.lines.find((l) => l.id === a.onLine);
      const own = s.trains.find((o) => o.lineId === a.onLine && o.nWagons < 4);
      if (own && s.cash >= WAGON_PRICE) {
        if (addWagon(s, own.id, 'coach')) {
          this.tips++;
          this.log.push(`${t}: tip ${a.kind} ${a.site}>${a.to}: coach on train ${own.id}, cash ${s.cash.toFixed(0)}`);
        }
      } else if (line && !own && s.cash >= trainPrice('hilma', 3)) {
        this.tips++;
        this.owed = { line: line.id, wagons: ['coach', 'coach', 'mailvan'] };
        this.owedUntil = s.time + 120;
      }
      return;
    }
    const from = stationAt(s, idx(s, siteById(s, a.site).cx, siteById(s, a.site).cy)) ? siteById(s, a.site) : siteById(s, a.to);
    const to = from.id === a.site ? siteById(s, a.to) : siteById(s, a.site);
    const start = idx(s, from.cx, from.cy);
    const ext = a.lengthen !== undefined ? s.lines.find((l) => l.id === a.lengthen) : undefined;
    const options = plan(s, start, idx(s, to.cx, to.cy), ext ? freeSide(s, ext, start) : undefined).filter((r) => !ext || canExtend(s, r, ext.id));
    const r = options.find((o) => o.mode === 'cheap') ?? options[0];
    if (!r) {
      this.restUntil = s.time + 60;
      return;
    }
    // the track, and a train to run on it when the line is new
    if (s.cash < r.cost + (ext ? 0 : train)) return;
    const line = build(s, r, ext?.id);
    if (!line) {
      this.restUntil = s.time + 60;
      return;
    }
    this.tips++;
    this.log.push(`${t}: tip ${a.kind} ${a.site}>${a.to} ${ext ? 'lengthens line ' + ext.id : 'new line'}, ${r.mode}, cost ${r.cost}, cash ${s.cash.toFixed(0)}`);
    if (!ext) {
      this.owed = { line: line.id, wagons: a.kind === 'people' ? ['coach', 'coach', 'mailvan'] : undefined };
      this.owedUntil = s.time + 120;
    }
  }
}

/** the worth of the bot's game so far, for the greedy comparison */
export const worthOf = (s: SimState): number => Math.round(netWorth(s));
