/**
 * The hand: a thumb on a phone, not the bot. It follows the bot's plan for
 * the scenario (tools/bot.ts) but makes every move as a touch: a drag from
 * the station to the site at a thumb's speed with a reaction delay and a
 * little jitter, a tap on the route it wants when the lift offers two, taps
 * on the cards' buttons for trains, wagons, engines and the full-load
 * switch. scripts/playthrough.mjs builds this file, injects it into the
 * page and turns what it asks for into touch events. It asks in screen
 * coordinates, so the same hand plays portrait and landscape.
 */
import { PLANS, planServes, countOf, type Step } from './bot';
import { PLATFORM_PRICE, CREW_PRICE, CRANE_PRICE, SIDING_PRICE, ENGINES, RESALE, WAGON_PRICE, WAGONS_DEFAULT } from '../src/game/content/economy';

export { PLANS };

export interface HandView {
  cash: number;
  /** the lines on the map, each as its site ids in order of the stops */
  lines: string[][];
  /** the trains, in order, each with its line and its wagons front to back */
  trains: { id: number; line: string[]; stopped?: boolean; wagons: string[] }[];
  yearEnd: boolean;
  result: boolean;
  card: 'line' | 'train' | 'site' | 'choice' | 'yearEnd' | 'result' | 'money' | 'none';
  /** which line's card, or which train's, is open */
  cardLine: string[] | null;
  /** the wagons the open buy card would put on a train, front to back */
  consist: string[] | null;
  cardTrain: number | null;
  /** which site's card is open, and the sites whose station has the loading crew */
  cardSite: string | null;
  crews: string[];
  /** the platforms each site's station has */
  platforms: Record<string, number>;
  /** the lines that have a passing siding, each as its two site ids, and the sites whose station has the crane */
  sidings: string[][];
  cranes: string[];
  /** the contract on the year-end card, and the good each site makes (null for a town), to tell whether the plan serves it */
  offer: { site: string; good: string } | null;
  makes: Record<string, string | null>;
  /** the next line's cost by mode, when the next step is a line: what the thumb would read off the glass */
  nextCost: { cheap: number; short: number | null } | null;
  /** what is owed, and the most the bank lends now */
  loan: number;
  ceiling: number;
  /** loads each site has taken, for the steps that wait for the timber to come */
  delivered: Record<string, number>;
  /** whether a train bought now for the next train step's line would stand on a platform (and not park) */
  spotFree: boolean;
  /** the sim clock in seconds */
  time: number;
  /** pick mode is on: the banner says to tap where the track goes */
  picking: boolean;
  /** the tip row under the HUD, as read off the screen: its kind, its words, and the first and second site its words name */
  tip: { kind: string; text: string; from: string | null; to: string | null; /** the sites of the line the tip means to lengthen; null for a new line */ lengthen: string[] | null } | null;
  /** what the line the tip names costs at the cheapest, from the sites' cells; null when no route can be laid */
  tipCost: number | null;
}

export type HandAction =
  | { kind: 'drag'; from: string; to: string }
  /** the lift's card: the way (cheap or short) in the group that lengthens `extend` (the sites of that line), or in the new-line group when `extend` is null */
  | { kind: 'route'; mode: 'cheap' | 'short'; extend: string[] | null }
  | { kind: 'openLine'; line: string[] }
  /** the buy card: take wagon `remove` (counted from the front) off the consist, or add one of type `add`, or buy the train */
  | { kind: 'consist'; remove?: number; add?: string }
  | { kind: 'buy'; engine: string }
  | { kind: 'openTrain'; train: number }
  | { kind: 'openSite'; site: string }
  | { kind: 'crew' }
  | { kind: 'platform' }
  /** the line card's siding Buy, then the pick mode's Best place */
  | { kind: 'siding' }
  | { kind: 'crane' }
  | { kind: 'act'; what: string; /** for a wagon: the type added */ type?: string }
  | { kind: 'close' }
  | { kind: 'openMoney' }
  | { kind: 'borrow' }
  | { kind: 'repay' }
  /** the year-end card: Take the contract, or Skip it (and Continue when none is offered) */
  | { kind: 'choose'; take: boolean }
  /** a tap on the tip row under the HUD: the map pans to its site and the site card opens */
  | { kind: 'tapTip' }
  /** the site card's "Lay track from here" */
  | { kind: 'lay' }
  /** in pick mode: a tap on the site the tip named */
  | { kind: 'pickTarget'; site: string }
  | { kind: 'wait' }
  | { kind: 'done' };

/** the tip the thumb is following, and how far it has got */
interface TipRun {
  kind: string;
  text: string;
  from: string;
  to: string | null;
  /** the line the tip means to lengthen (its sites in order); null when it means a new line */
  lengthen: string[] | null;
  since: number;
  taps: number;
  /** the second platform count the site had when the thumb began */
  platforms0: number;
  /** the trains on the line that joins the two sites, counted when that line first shows (null before it does) */
  trains0: number | null;
}

/** sim seconds the hand's own step may stand still before the thumb reads the tip */
const STALL_SECONDS = 20;
/** sim seconds one tip may take, and the taps it may use, before the thumb gives it up */
const TIP_SECONDS = 150;
const TIP_TAPS = 40;
/** sim seconds the thumb leaves a tip alone after giving it up */
const TIP_REST = 60;

export interface Pt {
  x: number;
  y: number;
}

/** the part of the glass the thumb works in: the map's free area, and the px a tile is drawn at */
export interface Glass {
  l: number;
  t: number;
  w: number;
  h: number;
  scale: number;
}

/** one move to bring points into view, made by a real touch */
export type Framing = { kind: 'ok' } | { kind: 'zoom' } | { kind: 'pan'; dx: number; dy: number };

/** a margin the thumb keeps from the edges of the glass, in px: more than the edge scroll's reach, so a drag that ends here stands still; the bottom one clears the zoom buttons */
const MARGIN = 72;
const BOTTOM = 90;
/** at or under this many px a tile the thumb cannot zoom out further without the whole-map look */
const ROUTE_SCALE = 16;

/** the same line: the same sites in the same order, or in the reverse order */
const same = (a: string[], b: string[]) => a.length === b.length && (a.every((x, i) => x === b[i]) || a.every((x, i) => x === b[b.length - 1 - i]));

/** whether a line serves these sites: it has all of them among its stops (a lengthened line serves the sites of every leg) */
const serves = (line: string[], sites: string[]) => sites.every((id) => line.includes(id));

/** whether a line step is done: the line it makes is on the map (a lengthened line has the new site at the end or at the front) */
const lineMade = (lines: string[][], step: Extract<Step, { kind: 'line' }>): boolean => {
  // a tip may have joined the two sites by lengthening a line: that line serves them too
  if (!step.extend) return lines.some((l) => serves(l, [step.from, step.to]));
  const grown = [...step.extend, step.to];
  const front = [step.to, ...step.extend];
  return lines.some((l) => same(l, grown) || same(l, front));
};

/** the consist a train step asks for: the wagons as given, or the default count of one type */
const wantedConsist = (w: string | string[]): string[] => (Array.isArray(w) ? w : Array(WAGONS_DEFAULT).fill(w));

export class Hand {
  done = 0;
  /** why the hand last chose to wait, for the playthrough's log */
  why = '';
  /** lines for the playthrough to print: each tip followed, given up or finished */
  log: string[] = [];
  /** how many tips were followed to the end */
  tipsDone = 0;
  tipRun: TipRun | null = null;
  private tipRestUntil = 0;
  /** the last sign of progress (a line, a train, a step, a platform) and the sim time it was seen */
  private mark = '';
  private markAt = 0;
  /** the wagon step the thumb has just tapped for, and how many wagons the train had */
  private wagonAt: { step: number; count: number } | null = null;
  /** seconds the thumb takes to react to what it sees */
  reaction = 0.35;
  /** px per second the thumb moves across the glass */
  speed = 700;
  /** px of wobble on the way */
  jitter = 6;
  steps: Step[];

  constructor(
    scenario: string,
    public skill = 0.6,
  ) {
    this.steps = PLANS[scenario].steps;
    this.reaction = 0.6 - 0.4 * skill;
    this.speed = 450 + 500 * skill;
    this.jitter = 12 - 10 * skill;
  }

  /** the price of the next step, the way the thumb reads it off the glass; the bot's reserve is a quarter of it */
  private priceOf(step: Step, v: HandView): number {
    if (step.kind === 'line') {
      const next = this.steps[this.done + 1];
      const reserve = next?.kind === 'train' ? ENGINES[next.engine ?? 'hilma'].price + countOf(next.wagons) * WAGON_PRICE : 0;
      return (v.nextCost ? (step.mode === 'short' && v.nextCost.short !== null ? v.nextCost.short : v.nextCost.cheap) : Infinity) + reserve;
    }
    if (step.kind === 'train') return ENGINES[step.engine ?? 'hilma'].price + countOf(step.wagons) * WAGON_PRICE;
    if (step.kind === 'crew') return CREW_PRICE;
    if (step.kind === 'platform') return PLATFORM_PRICE[0];
    if (step.kind === 'siding') return SIDING_PRICE;
    if (step.kind === 'crane') return CRANE_PRICE;
    if (step.kind === 'wagon') return WAGON_PRICE;
    if (step.kind === 'engine') return ENGINES[step.engine].price - Math.round(ENGINES.hilma.price * RESALE);
    return 0;
  }

  /**
   * The loan, as the thumb handles it: when the next buy is out of reach and the bank lends, open the
   * money card and borrow a hundred at a time; when the cash runs a hundred past the next buy and its
   * reserve, pay a hundred back. Null when there is nothing to do with money now.
   */
  private money(step: Step | undefined, v: HandView): HandAction | null {
    const need = step ? this.priceOf(step, v) : 0;
    const reserve = Math.max(10, Math.round(need / 4));
    const open = v.card === 'money';
    const buyable = !!step && Number.isFinite(need) && need > 0 && (step.kind !== 'train' || v.spotFree) && !((step as { after?: { site: string; delivered: number } }).after && v.delivered[(step as { after: { site: string } }).after.site] < (step as { after: { delivered: number } }).after.delivered);
    if (buyable && v.cash < need + reserve && v.loan + 100 <= v.ceiling) return open ? { kind: 'borrow' } : v.card !== 'none' ? { kind: 'close' } : { kind: 'openMoney' };
    if (v.loan >= 100 && v.cash > need + reserve + 100 + (open ? 0 : 100)) return open ? { kind: 'repay' } : v.card !== 'none' ? { kind: 'close' } : { kind: 'openMoney' };
    if (open) return { kind: 'close' };
    return null;
  }

  /**
   * What to do next. The plan's own step comes first. When it has not moved for 20 sim seconds
   * the thumb reads the tip under the HUD and does what it says by touch.
   */
  next(v: HandView): HandAction {
    if (v.result) return { kind: 'done' };
    const mark = `${v.lines.length}/${v.trains.length}/${this.done}/${Object.values(v.platforms).join(',')}/${v.card === 'yearEnd' || v.yearEnd ? 'y' : ''}`;
    if (mark !== this.mark) {
      this.mark = mark;
      this.markAt = v.time;
    }
    if (!this.tipRun && !v.yearEnd && v.card !== 'yearEnd' && v.time - this.markAt >= STALL_SECONDS && v.time >= this.tipRestUntil) this.beginTip(v);
    if (this.tipRun) return this.followTip(v);
    return this.own(v);
  }

  /** start following the tip on the screen, when it names something the cash can pay for */
  private beginTip(v: HandView): void {
    const t = v.tip;
    if (!t || !t.from) return;
    const line = t.kind === 'first' || t.kind === 'stuck' || t.kind === 'starved' || t.kind === 'cash';
    if (!line && t.kind !== 'platform') return;
    if (line && (!t.to || v.tipCost === null || v.cash < v.tipCost)) return;
    if (t.kind === 'platform' && v.cash < PLATFORM_PRICE[0]) return;
    this.tipRun = { kind: t.kind, text: t.text, from: t.from, to: line ? t.to : null, lengthen: line ? t.lengthen : null, since: v.time, taps: 0, platforms0: v.platforms[t.from] ?? 1, trains0: null };
    this.log.push(`tip followed at ${Math.round(v.time)} s: [${t.kind}] ${t.text}`);
  }

  private endTip(v: HandView, ok: boolean, why: string): HandAction {
    const r = this.tipRun!;
    this.tipRun = null;
    this.markAt = v.time;
    if (ok) this.tipsDone++;
    else this.tipRestUntil = v.time + TIP_REST;
    this.log.push(`tip ${ok ? 'done' : 'given up'} after ${Math.round(v.time - r.since)} s (${r.taps} taps): ${why}`);
    return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
  }

  /** one touch toward the tip: open its site, lay the track (or buy the platform), then a train on the new line */
  private followTip(v: HandView): HandAction {
    const r = this.tipRun!;
    if (v.time - r.since > TIP_SECONDS) return this.endTip(v, false, 'too slow');
    if (r.taps > TIP_TAPS) return this.endTip(v, false, 'too many taps');
    const a = this.tipMove(v, r);
    // every move counts, a close as much as a tap: a tip that keeps the thumb busy and gets nowhere is dropped
    if (a.kind !== 'wait') r.taps++;
    return a;
  }

  private tipMove(v: HandView, r: TipRun): HandAction {
    const tap = <T extends HandAction>(a: T): T => a;
    if (r.kind === 'platform') {
      if ((v.platforms[r.from] ?? 1) > r.platforms0) return this.endTip(v, true, `platform bought at ${r.from}`);
      if (v.card === 'site' && v.cardSite === r.from) return tap({ kind: 'platform' });
      if (v.card !== 'none') return { kind: 'close' };
      return tap({ kind: 'tapTip' });
    }
    // the line that joins the two sites: a new one, or the line the new track lengthened
    const pair = [r.from, r.to!];
    const line = v.lines.find((l) => pair.every((id) => l.includes(id)));
    if (!line) {
      if (v.picking) return tap({ kind: 'pickTarget', site: r.to! });
      // the card's group is the kind of link the tip meant: lengthen its line, or a new line
      if (v.card === 'choice') return tap({ kind: 'route', mode: 'cheap', extend: r.lengthen });
      if (v.card === 'site' && v.cardSite === r.from) return tap({ kind: 'lay' });
      if (v.card !== 'none') return { kind: 'close' };
      return tap({ kind: 'tapTip' });
    }
    const on = (t: { line: string[] }) => pair.every((id) => t.line.includes(id));
    r.trains0 ??= v.trains.filter(on).length;
    if (v.trains.filter(on).length > r.trains0) return this.endTip(v, true, `line ${r.from} to ${r.to} laid and a train bought`);
    // the new line is on the map: the default consist from its card
    if (v.cash < ENGINES.hilma.price + WAGONS_DEFAULT * WAGON_PRICE) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
    if (v.card === 'line' && v.cardLine && same(v.cardLine, line)) return tap({ kind: 'buy', engine: '' });
    if (v.card !== 'none') return { kind: 'close' };
    return tap({ kind: 'openLine', line });
  }

  /** what the plan's own step asks for next, given what the thumb sees on the screen */
  private own(v: HandView): HandAction {
    if (v.yearEnd || v.card === 'yearEnd') return { kind: 'choose', take: !!v.offer && planServes(this.steps, { site: v.offer.site, good: v.offer.good as never }, (id) => (v.makes[id] ?? null) as never) };
    const step = this.steps[this.done];
    const m = this.money(step, v);
    if (m) return m;
    const gate = step && (step as { after?: { site: string; delivered: number } }).after;
    if (gate && v.delivered[gate.site] < gate.delivered) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
    if (!step) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
    if (step.kind === 'line') {
      if (lineMade(v.lines, step)) {
        this.done++;
        return { kind: 'wait' };
      }
      if (v.card === 'choice') return { kind: 'route', mode: step.mode, extend: step.extend ?? null };
      if (v.card !== 'none') return { kind: 'close' };
      const next = this.steps[this.done + 1];
      const reserve = next?.kind === 'train' ? ENGINES[next.engine ?? 'hilma'].price + countOf(next.wagons) * WAGON_PRICE : 0;
      const cost = v.nextCost ? (step.mode === 'short' && v.nextCost.short !== null ? v.nextCost.short : v.nextCost.cheap) : Infinity;
      if (v.cash < cost + reserve) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      return { kind: 'drag', from: step.from, to: step.to };
    }
    if (step.kind === 'train') {
      // a train counts for the step when its line serves the step's sites, and a step counts toward the wanted trains when one line serves both its sites and this step's
      const serving = v.lines.filter((l) => serves(l, step.line));
      const have = v.trains.filter((t) => serves(t.line, step.line)).length;
      const want = this.steps.slice(0, this.done + 1).filter((o) => o.kind === 'train' && (same(o.line, step.line) || serving.some((l) => serves(l, o.line)))).length;
      const actual = serving.find((l) => same(l, step.line)) ?? serving[0] ?? step.line;
      if (have >= want) {
        this.done++;
        if (step.fullLoad) {
          const t = v.trains.filter((o) => same(o.line, step.line)).pop()!;
          this.steps.splice(this.done, 0, { kind: 'fullload', train: t.id } as unknown as Step);
        }
        return { kind: 'wait' };
      }
      if (v.cash < ENGINES[step.engine ?? 'hilma'].price + countOf(step.wagons) * WAGON_PRICE || !v.spotFree) return v.card === 'line' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'line' && v.cardLine && same(v.cardLine, actual)) {
        // build the consist wagon by wagon: take off the first wagon that is not the one wanted, then add what is missing
        const want = wantedConsist(step.wagons);
        const have = v.consist ?? [];
        const wrong = have.findIndex((t, i) => i < want.length && t !== want[i]);
        if (wrong >= 0) return { kind: 'consist', remove: wrong };
        if (have.length > want.length) return { kind: 'consist', remove: have.length - 1 };
        if (have.length < want.length) return { kind: 'consist', add: want[have.length] };
        return { kind: 'buy', engine: step.engine ?? 'hilma' };
      }
      if (v.card !== 'none') return { kind: 'close' };
      return { kind: 'openLine', line: actual };
    }
    if (step.kind === 'crew') {
      if (v.crews.includes(step.site)) {
        this.done++;
        return { kind: 'wait' };
      }
      if (v.cash < CREW_PRICE) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'site' && v.cardSite === step.site) return { kind: 'crew' };
      if (v.card !== 'none') return { kind: 'close' };
      return { kind: 'openSite', site: step.site };
    }
    if (step.kind === 'platform') {
      if ((v.platforms[step.site] ?? 1) >= 2) {
        this.done++;
        return { kind: 'wait' };
      }
      if (v.cash < PLATFORM_PRICE[0]) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'site' && v.cardSite === step.site) return { kind: 'platform' };
      if (v.card !== 'none') return { kind: 'close' };
      return { kind: 'openSite', site: step.site };
    }
    if (step.kind === 'siding') {
      if (v.sidings.some((l) => same(l, step.line))) {
        this.done++;
        return { kind: 'wait' };
      }
      if (v.cash < SIDING_PRICE) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'line' && v.cardLine && same(v.cardLine, step.line)) return { kind: 'siding' };
      if (v.card !== 'none') return { kind: 'close' };
      // a train running over the place keeps the siding from being laid: the thumb tries again
      return { kind: 'openLine', line: step.line };
    }
    if (step.kind === 'crane') {
      if (v.cranes.includes(step.site)) {
        this.done++;
        return { kind: 'wait' };
      }
      if (v.cash < CRANE_PRICE || !v.crews.includes(step.site)) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'site' && v.cardSite === step.site) return { kind: 'crane' };
      if (v.card !== 'none') return { kind: 'close' };
      return { kind: 'openSite', site: step.site };
    }
    if (step.kind === 'wagon' || step.kind === 'drop' || step.kind === 'engine' || (step as { kind: string }).kind === 'fullload') {
      const idx = (step as { train: number }).train;
      const id = step.kind === 'wagon' || step.kind === 'drop' || step.kind === 'engine' ? v.trains[idx]?.id : idx;
      const wagonType = step.kind === 'wagon' || step.kind === 'drop' ? step.type ?? v.trains[idx]?.wagons[v.trains[idx].wagons.length - 1] : undefined;
      if (id === undefined) {
        this.done++;
        return { kind: 'wait' };
      }
      // a wagon counts when it is on the train: a tap on a button the cash no longer paid for is tried again
      if (step.kind === 'wagon' && this.wagonAt) {
        const was = this.wagonAt;
        this.wagonAt = null;
        if (was.step === this.done && (v.trains[idx]?.wagons.length ?? 0) > was.count) {
          this.done++;
          return { kind: 'wait' };
        }
      }
      const need = step.kind === 'wagon' ? WAGON_PRICE : step.kind === 'engine' ? 80 : 0;
      if (v.cash < need) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'train' && v.cardTrain === id) {
        if (step.kind === 'wagon') this.wagonAt = { step: this.done, count: v.trains[idx].wagons.length };
        else this.done++;
        return { kind: 'act', what: step.kind === 'wagon' ? 'wagon' : step.kind === 'drop' ? 'drop' : step.kind === 'engine' ? `engine-${step.engine}` : 'fullload', type: wagonType };
      }
      if (v.card !== 'none') return { kind: 'close' };
      // a train on the move is hard to hit: the thumb waits for it to stand at a platform
      if (v.trains.find((t) => t.id === id)?.stopped === false) {
        this.why = `train ${id} is not at a platform`;
        return { kind: 'wait' };
      }
      return { kind: 'openTrain', train: id };
    }
    return { kind: 'wait' };
  }

  /**
   * What a thumb does to see these points: nothing when they are all on the glass, a tap on the
   * zoom-out button when they would fit one level wider, or a one-finger pan that centres them (the
   * first point alone when they cannot fit, so the drag can scroll on from there).
   */
  frame(pts: Pt[], g: Glass): Framing {
    const x0 = g.l + MARGIN;
    const x1 = g.l + g.w - MARGIN;
    const y0 = g.t + MARGIN;
    const y1 = g.t + g.h - BOTTOM;
    if (pts.every((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) return { kind: 'ok' };
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    // one level out is about 1.5 times smaller: would the spread fit then?
    const fits = (k: number) => (maxX - minX) * k <= x1 - x0 && (maxY - minY) * k <= y1 - y0;
    if (!fits(1) && g.scale > ROUTE_SCALE && fits(g.scale > 30 ? 0.42 : 0.65)) return { kind: 'zoom' };
    const c = fits(1) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : pts[0];
    const dx = (x0 + x1) / 2 - c.x;
    const dy = (y0 + y1) / 2 - c.y;
    // a nudge of a few px is not worth a stroke: the drag scrolls the rest by itself
    if (!fits(1) && Math.hypot(dx, dy) < 40) return { kind: 'ok' };
    return { kind: 'pan', dx, dy };
  }

  /** whether a point is inside the part of the glass the thumb works in */
  seen(p: Pt, g: Glass): boolean {
    return p.x >= g.l + MARGIN && p.x <= g.l + g.w - MARGIN && p.y >= g.t + MARGIN && p.y <= g.t + g.h - BOTTOM;
  }

  /** the points of a drag from a to b, as the thumb would make them: eased, with wobble, in ms */
  path(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; at: number }[] {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const ms = Math.max(250, (1000 * d) / this.speed);
    const n = Math.max(8, Math.round(ms / 30));
    const pts: { x: number; y: number; at: number }[] = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const w = Math.sin(t * Math.PI) * this.jitter;
      pts.push({ x: a.x + (b.x - a.x) * e + w * 0.7, y: a.y + (b.y - a.y) * e - w * 0.5, at: Math.round(ms * t) });
    }
    return pts;
  }
}
