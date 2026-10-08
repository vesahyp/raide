/**
 * The words for the sim's advice, and the goal chip that names its towns. The sim says what is
 * wrong as data (src/game/advice.ts); this file says it in the player's language.
 */
import type { Good, SimState, Site } from '../game/types';
import type { Advice } from '../game/advice';
import { goalTowns, townLacks } from '../game/advice';
import { siteById } from '../game/state';
import { MONTHS } from '../game/content/economy';
import { tr, t as tt, num } from '../i18n';
import { GoodIcon, NONE_OF } from './Wagons';

const name = (s: SimState, id: string) => tt(siteById(s, id).name);
/** a good after a number: "20 flour", "20 jauhoa" */
const some = (g: Good) => tr(NONE_OF[g][0], NONE_OF[g][1]);

/** the one line under the HUD for a piece of advice */
export function tipText(s: SimState, a: Advice): string {
  const here = name(s, a.site);
  const there = a.to ? name(s, a.to) : '';
  const g = a.good;
  switch (a.kind) {
    case 'first':
      return tr(`Vedä rata: ${here} → ${there}${a.cost ? ` (${a.cost})` : ''}`, `Lay track from ${here} to ${there}${a.cost ? `: it costs ${a.cost}` : ''}`);
    case 'stuck':
      return tr(`${here}: ${a.amount} ${some(g!)} odottaa eikä rataa ole. Vedä rata: ${there}`, `${here} has ${a.amount} ${some(g!)} and no way out: lay track to ${there}`);
    case 'starved':
      return tr(`${here} tarvitsee ${some(g!)} kasvuun: tuo niitä paikasta ${there}`, `${here} needs ${some(g!)} to grow: bring it from ${there}`);
    case 'platform':
      return tr(`${here} tarvitsee toisen laiturin toista junaa varten`, `${here} needs a second platform for the second train`);
    case 'cash':
      return tr(`Rahaa ${num(a.amount ?? 0)}: rata ${here} → ${there} maksaa ${a.cost}`, `You have ${num(a.amount ?? 0)}: a line ${here} → ${there} costs ${a.cost}`);
    case 'contract':
      return tr(`Sopimus: ${a.amount} ${some(g!)} vielä kohteeseen ${here} ennen vuoden ${a.deadline} loppua`, `Contract: ${a.amount} more ${some(g!)} to ${here} before the end of ${a.deadline}`);
  }
}

/** a goal town, as the chip and the goal card show it */
export interface GoalTown {
  id: string;
  size: number;
  growth: number;
  lacks: Good[];
}

export function readGoalTowns(s: SimState): GoalTown[] {
  return goalTowns(s).map((x: Site) => ({ id: x.id, size: x.size, growth: x.growth, lacks: x.kind === 'town' ? townLacks(s, x) : [] }));
}

/** the chip's body for a towns goal: each chosen town with its size against the goal and a tiny icon per good it lacks */
export function GoalTowns({ s, towns, size }: { s: SimState; towns: GoalTown[]; size: number }) {
  return (
    <div className="goal-towns">
      <div className="gts">
        {towns.map((t) => (
          <div key={t.id} className={`gt${t.size >= size ? ' done' : ''}`} data-goal-town={t.id}>
            <span className="gn">{name(s, t.id)}</span>
            <small className="sz">{t.size >= size ? '✓' : t.size}</small>
            <small className="sz2">{t.size >= size ? '✓' : `${t.size}→${size}`}</small>
            {t.size < size && t.lacks.map((g) => <GoodIcon key={g} good={g} />)}
          </div>
        ))}
      </div>
      <b className="gto">→{size}</b>
    </div>
  );
}

/** the year limit as a plain sentence */
export const untilText = (year: number, now: number, month: number): string => {
  const left = (year - now) * MONTHS - month;
  return tr(`Aikaa ennen vuotta ${year}: ${left} kk`, `${left} months before ${year}`);
};
