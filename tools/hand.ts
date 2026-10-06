/**
 * The hand: a thumb on a phone, not the bot. It has the bot's plan (build
 * the forest line, buy a timber train, the town line when the cash is there,
 * a boards train, a third train, the extra wagon at the year end) but makes
 * every move as a touch: a drag from the station to the site at a thumb's
 * speed with a reaction delay and a little jitter, a tap on the card's
 * buttons. scripts/playthrough.mjs builds this file, injects it into the
 * page and turns what it asks for into touch events. It asks in screen
 * coordinates, so the same hand plays portrait and landscape.
 */
export interface HandView {
  cash: number;
  lines: number;
  trains: number;
  yearEnd: boolean;
  result: boolean;
  card: 'train' | 'yearEnd' | 'result' | 'none';
  /** the plan's next line's cost with a train on top, or null when nothing is left to build */
  nextLineCost: number | null;
  trainCost: number;
}

export type HandAction =
  | { kind: 'drag'; from: string; to: string }
  | { kind: 'buy'; wagons: 'flat' | 'box'; onLine: [string, string] }
  | { kind: 'choose' }
  | { kind: 'wait' }
  | { kind: 'done' };

export const PLAN = {
  lines: [
    ['forest', 'sawmill'],
    ['sawmill', 'town'],
  ] as [string, string][],
  trains: [
    { line: 0, wagons: 'flat' as const },
    { line: 1, wagons: 'box' as const },
    { line: 1, wagons: 'box' as const },
  ],
};

export class Hand {
  built = 0;
  bought = 0;
  /** seconds the thumb takes to react to what it sees */
  reaction = 0.35;
  /** px per second the thumb moves across the glass */
  speed = 700;
  /** px of wobble on the way */
  jitter = 6;

  constructor(public skill = 0.6) {
    this.reaction = 0.6 - 0.4 * skill;
    this.speed = 450 + 500 * skill;
    this.jitter = 12 - 10 * skill;
  }

  /** what to do next, given what the thumb sees on the screen */
  next(v: HandView): HandAction {
    if (v.result) return { kind: 'done' };
    if (v.yearEnd || v.card === 'yearEnd') return { kind: 'choose' };
    // the card is open after a build: buy the train it offers
    const t = PLAN.trains[this.bought];
    if (t && t.line < this.built) {
      if (v.cash >= v.trainCost) return { kind: 'buy', wagons: t.wagons, onLine: PLAN.lines[t.line] };
      return { kind: 'wait' };
    }
    const l = PLAN.lines[this.built];
    if (l && v.nextLineCost !== null && v.cash >= v.nextLineCost) return { kind: 'drag', from: l[0], to: l[1] };
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
