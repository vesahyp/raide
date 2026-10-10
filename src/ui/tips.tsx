/**
 * The words for the sim's advice, and the goal chip that names its towns. The sim says what is
 * wrong as data (src/game/advice.ts); this file says it in the player's language.
 */
import type { Good, Line, SimState, Site } from '../game/types';
import type { Advice } from '../game/advice';
import { goalTowns, townLacks } from '../game/advice';
import { siteById } from '../game/state';
import { stopSite, growthOutlook, supplyState, growFrac } from '../game/sim';
import { MONTHS } from '../game/content/economy';
import { tr, t as tt, num } from '../i18n';
import { GoodIcon, NONE_OF } from './Wagons';


const name = (s: SimState, id: string) => tt(siteById(s, id).name);
/** a good after a number: "20 flour", "20 jauhoa" */
const some = (g: Good) => tr(NONE_OF[g][0], NONE_OF[g][1]);

/** the name of a line, its stops in order: "Kuusikko–Koskensaha" */
export function lineName(s: SimState, line: Line): string {
  return line.stops.map((_, i) => tt(stopSite(s, line, i).name)).join('–');
}

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
      return tr(`${here} kasvaa nopeammin, kun saa myös ${some(g!)}: vedä rata paikasta ${there}`, `${here} grows faster with ${some(g!)} too: lay track from ${there}`);
    case 'more':
      return tr(`${here}: ${a.amount} ${some(g!)} odottaa: osta linjalle toinen juna`, `${here} has ${a.amount} ${some(g!)} waiting: buy another train for its line`);
    case 'cash':
      return tr(`Rahaa ${num(a.amount ?? 0)}: rata ${here} → ${there} maksaa ${a.cost}`, `You have ${num(a.amount ?? 0)}: a line ${here} → ${there} costs ${a.cost}`);
    case 'expand':
      return tr(`Junat odottavat kuormaa paikassa ${here}: laajenna se (${a.cost})`, `Trains wait for loads at ${here}: expand it for ${a.cost}`);
    case 'idle-line': {
      const line = s.lines.find((l) => l.id === a.onLine);
      const nm = line ? lineName(s, line) : '';
      return tr(`Rata ${nm} on ilman junaa: napauta ja osta juna`, `The ${nm} line has no train: tap to buy one`);
    }
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
  return goalTowns(s).map((x: Site) => ({ id: x.id, size: x.size, growth: growFrac(x), lacks: x.kind === 'town' ? townLacks(s, x) : [] }));
}

/** a pip row for a size against the goal size: filled up to the size, empty up to the goal */
function Pips({ size, goal }: { size: number; goal: number }) {
  return (
    <span className="pips" aria-label={`${size}/${goal}`}>
      {Array.from({ length: goal }, (_, i) => <i key={i} className={i < size ? 'on' : ''} />)}
    </span>
  );
}

/** what a goal town is doing now, in two or three words, and whether it is good news, a wait or a stop */
function townState(s: SimState, site: Site, goalSize: number): { text: string; tone: 'ok' | 'wait' | 'stop' } {
  if (site.size >= goalSize) return { text: tr('valmis', 'done'), tone: 'ok' };
  if (!s.stations.some((st) => st.siteId === site.id)) return { text: tr('ei asemaa', 'no station'), tone: 'stop' };
  const o = growthOutlook(s, site);
  if (o.perMinute <= 0) return { text: tr('ei rataa', 'no line'), tone: 'stop' };
  if (o.missing) return { text: tr(`kasvaa, ${NONE_OF[o.missing][0]} puuttuu`, `growing, no ${NONE_OF[o.missing][1]}`), tone: 'wait' };
  return { text: tr('kasvaa', 'growing'), tone: 'ok' };
}

/**
 * The goal strip under the HUD, always on the screen: for a towns goal one row per goal town with its
 * size as pips against the goal size, its growth meter as a bar and a tiny state; for a deliver goal one
 * row with the count and what the line to the town is doing. A tap opens the goal card.
 */
export function GoalStrip({ s, onOpen }: { s: SimState; onOpen: () => void }) {
  const goal = s.scenario.goal;
  const label = tr('Tavoite', 'Goal');
  if (goal.kind === 'deliver') {
    const site = siteById(s, goal.site);
    const station = s.stations.some((st) => st.siteId === site.id);
    const sup = supplyState(s, site, goal.good);
    const state = !station ? { text: tr('ei asemaa', 'no station'), tone: 'stop' } : sup === 'none' ? { text: tr('ei rataa', 'no line'), tone: 'stop' } : sup === 'short' ? { text: tr(`odottaa ${NONE_OF[goal.good][0]}`, `waiting for ${NONE_OF[goal.good][1]}`), tone: 'wait' } : { text: tr('toimitus käy', 'delivering'), tone: 'ok' };
    return (
      <button className="hud-goal goal-strip" data-act="goal" aria-label={label} onClick={onOpen}>
        <div className="gs-row count" data-goal-town={site.id}>
          <span className="gn"><GoodIcon good={goal.good} />{tr(NONE_OF[goal.good][0], NONE_OF[goal.good][1])} <b className="num">{s.goalCount}/{goal.count}</b></span>
          <span className="gm"><i style={{ width: `${Math.min(100, (100 * s.goalCount) / goal.count)}%` }} /></span>
          <span className={`gst ${state.tone}`}>{state.text}</span>
        </div>
      </button>
    );
  }
  return (
    <button className="hud-goal goal-strip" data-act="goal" aria-label={label} onClick={onOpen}>
      {goalTowns(s).map((x) => {
        const st = townState(s, x, goal.size);
        const done = x.size >= goal.size;
        return (
          <div key={x.id} className={`gs-row${done ? ' done' : ''}`} data-goal-town={x.id}>
            <span className="gn">{name(s, x.id)}</span>
            <Pips size={x.size} goal={goal.size} />
            <span className="gm"><i style={{ width: `${Math.round(100 * (done ? 1 : growFrac(x)))}%` }} /></span>
            <span className={`gst ${st.tone}`}>{st.text}</span>
          </div>
        );
      })}
    </button>
  );
}

/** the year limit as a plain sentence */
export const untilText = (year: number, now: number, month: number): string => {
  const left = (year - now) * MONTHS - month;
  return tr(`Aikaa ennen vuotta ${year}: ${left} kk`, `${left} months before ${year}`);
};
