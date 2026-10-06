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
import { PLANS, type Step } from './bot';

export { PLANS };

export interface HandView {
  cash: number;
  /** the lines on the map, each as its two site ids */
  lines: [string, string][];
  /** the trains, in order, each with its line */
  trains: { id: number; line: [string, string] }[];
  yearEnd: boolean;
  result: boolean;
  card: 'line' | 'train' | 'site' | 'choice' | 'yearEnd' | 'result' | 'none';
  /** which line's card, or which train's, is open */
  cardLine: [string, string] | null;
  cardTrain: number | null;
  /** the next line's cost by mode, when the next step is a line: what the thumb would read off the glass */
  nextCost: { cheap: number; short: number | null } | null;
  trainPrice: { hilma: number; jyry: number };
}

export type HandAction =
  | { kind: 'drag'; from: string; to: string }
  | { kind: 'route'; mode: 'cheap' | 'short' }
  | { kind: 'openLine'; line: [string, string] }
  | { kind: 'buy'; wagons: string; engine: string }
  | { kind: 'openTrain'; train: number }
  | { kind: 'act'; what: string }
  | { kind: 'close' }
  | { kind: 'choose' }
  | { kind: 'wait' }
  | { kind: 'done' };

const same = (a: [string, string], b: [string, string]) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

export class Hand {
  done = 0;
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

  /** what to do next, given what the thumb sees on the screen */
  next(v: HandView): HandAction {
    if (v.result) return { kind: 'done' };
    if (v.yearEnd || v.card === 'yearEnd') return { kind: 'choose' };
    const step = this.steps[this.done];
    if (!step) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
    if (step.kind === 'line') {
      if (v.lines.some((l) => same(l, [step.from, step.to]))) {
        this.done++;
        return { kind: 'wait' };
      }
      if (v.card === 'choice') return { kind: 'route', mode: step.mode };
      if (v.card !== 'none') return { kind: 'close' };
      const next = this.steps[this.done + 1];
      const reserve = next?.kind === 'train' ? v.trainPrice[next.engine ?? 'hilma'] : 0;
      const cost = v.nextCost ? (step.mode === 'short' && v.nextCost.short !== null ? v.nextCost.short : v.nextCost.cheap) : Infinity;
      if (v.cash < cost + reserve) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      return { kind: 'drag', from: step.from, to: step.to };
    }
    if (step.kind === 'train') {
      const have = v.trains.filter((t) => same(t.line, step.line)).length;
      const want = this.steps.slice(0, this.done + 1).filter((o) => o.kind === 'train' && same(o.line, step.line)).length;
      if (have >= want) {
        this.done++;
        if (step.fullLoad) {
          const t = v.trains.filter((o) => same(o.line, step.line)).pop()!;
          this.steps.splice(this.done, 0, { kind: 'fullload', train: t.id } as unknown as Step);
        }
        return { kind: 'wait' };
      }
      if (v.cash < v.trainPrice[step.engine ?? 'hilma']) return v.card === 'line' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'line' && v.cardLine && same(v.cardLine, step.line)) return { kind: 'buy', wagons: step.wagons, engine: step.engine ?? 'hilma' };
      if (v.card !== 'none') return { kind: 'close' };
      return { kind: 'openLine', line: step.line };
    }
    if (step.kind === 'wagon' || step.kind === 'engine' || (step as { kind: string }).kind === 'fullload') {
      const idx = (step as { train: number }).train;
      const id = step.kind === 'wagon' || step.kind === 'engine' ? v.trains[idx]?.id : idx;
      if (id === undefined) {
        this.done++;
        return { kind: 'wait' };
      }
      const need = step.kind === 'wagon' ? 10 : step.kind === 'engine' ? 65 : 0;
      if (v.cash < need) return v.card !== 'none' ? { kind: 'close' } : { kind: 'wait' };
      if (v.card === 'train' && v.cardTrain === id) {
        this.done++;
        return { kind: 'act', what: step.kind === 'wagon' ? 'wagon' : step.kind === 'engine' ? `engine-${step.engine}` : 'fullload' };
      }
      if (v.card !== 'none') return { kind: 'close' };
      return { kind: 'openTrain', train: id };
    }
    return { kind: 'wait' };
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
