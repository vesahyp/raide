/**
 * The bot: a player with no thumb. It builds the forest line and buys a
 * timber train at once, builds the town line and a boards train when the
 * cash is there, adds a third train when it can, and takes the extra wagon
 * at the first year end. sim-check and balance run it headless; the
 * playthrough's hand makes the same moves by touch.
 */
import type { SimState, WagonType, YearEndChoice } from '../src/game/types';
import { build, buyTrain, closeYearEnd, plan, trainPrice } from '../src/game/sim';
import { idx } from '../src/game/grid';

export interface BotPlan {
  /** the lines to build, in order, as site ids from a station to a site */
  lines: [string, string][];
  /** the trains to buy, in order: which line (by index above) and what wagons */
  trains: { line: number; wagons: WagonType }[];
  /** the year-end choices in order; the last repeats */
  perks: YearEndChoice[];
}

export const SAWMILL_PLAN: BotPlan = {
  lines: [
    ['forest', 'sawmill'],
    ['sawmill', 'town'],
  ],
  trains: [
    { line: 0, wagons: 'flat' },
    { line: 1, wagons: 'box' },
    { line: 1, wagons: 'box' },
  ],
  perks: ['wagon', 'speed', 'forest'],
};

export class Bot {
  built = 0;
  bought = 0;
  lineIds: number[] = [];
  log: string[] = [];
  constructor(public plan: BotPlan = SAWMILL_PLAN) {}

  /** one look at the state: do the next thing the plan allows */
  act(s: SimState): void {
    if (s.result) return;
    if (s.yearEnd) {
      const choice = this.plan.perks.find((p) => !s.perks.includes(p)) ?? this.plan.perks[this.plan.perks.length - 1];
      this.log.push(`${s.yearEnd.year}: profit ${s.yearEnd.profit}, cash ${s.yearEnd.cash}, choice ${choice}`);
      closeYearEnd(s, choice);
      return;
    }
    // a train for the newest line comes before the next line, so the first delivery is early
    const nextTrain = this.plan.trains[this.bought];
    if (nextTrain && nextTrain.line < this.built) {
      if (s.cash >= trainPrice()) {
        const t = buyTrain(s, this.lineIds[nextTrain.line], nextTrain.wagons);
        if (t) {
          this.bought++;
          this.log.push(`t=${s.time.toFixed(0)}: train ${t.id} (${nextTrain.wagons}) on line ${t.lineId}, cash ${s.cash}`);
        }
      }
      return;
    }
    const nextLine = this.plan.lines[this.built];
    if (nextLine) {
      const a = s.sites.find((x) => x.id === nextLine[0])!;
      const b = s.sites.find((x) => x.id === nextLine[1])!;
      const r = plan(s, idx(s, a.cx, a.cy), idx(s, b.cx, b.cy));
      if (!r) throw new Error(`no route ${nextLine[0]} -> ${nextLine[1]}`);
      // keep enough for the train that follows
      if (s.cash >= r.cost + trainPrice()) {
        const line = build(s, r);
        if (!line) throw new Error('build refused with the cash there');
        this.lineIds.push(line.id);
        this.built++;
        this.log.push(`t=${s.time.toFixed(0)}: line ${line.id} ${nextLine[0]} -> ${nextLine[1]}, ${r.cells.length} cells, ${r.bridge.length} bridge, cost ${r.cost}, cash ${s.cash}`);
      }
    }
  }
}
