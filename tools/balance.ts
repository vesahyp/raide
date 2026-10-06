/**
 * npm run balance: the bot plays the sawmill scenario and prints the year by year numbers,
 * and the months each build took. Read it after touching content/economy.ts.
 */
import { createState } from '../src/game/state';
import { SAWMILL } from '../src/game/content/scenarios';
import { step, DT } from '../src/game/sim';
import { Bot } from './bot';
import { YEAR_SECONDS } from '../src/game/content/economy';

const s = createState(SAWMILL);
const bot = new Bot();
const limit = (SAWMILL.goal.beforeYear - SAWMILL.startYear) * YEAR_SECONDS + 10;
let goalAt = -1;
const marks: string[] = [];
let lastCount = 0;
for (let t = 0; t < limit && !s.result; t += DT) {
  bot.act(s);
  step(s);
  if (s.goalCount !== lastCount) {
    lastCount = s.goalCount;
    if (lastCount === 1 || lastCount % 5 === 0) marks.push(`${lastCount} boards at ${s.time.toFixed(0)} s (${s.year}, month ${s.month + 1})`);
  }
  if (goalAt < 0 && s.result) goalAt = s.time;
}
for (const l of bot.log) console.log(l);
for (const m of marks) console.log(m);
console.log(`first pay ${s.firstPayAt?.toFixed(0)} s; result ${s.result ? `${s.result.won ? 'won' : 'lost'} ${s.result.year} cash ${s.result.cash} stars ${s.result.stars}` : 'none'} at ${goalAt.toFixed(0)} s`);
console.log(`sites: ${s.sites.map((x) => `${x.id} stock ${x.stock.toFixed(1)} taken ${x.taken.toFixed(1)} delivered ${x.delivered} rate ${x.rate.toFixed(2)}`).join('; ')}`);
