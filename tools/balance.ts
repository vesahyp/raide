/**
 * npm run balance: the bot plays a scenario (SCENARIO=harju, sawmill by default) and prints
 * the year by year numbers, the builds and when the goal fell. Read it after touching
 * content/economy.ts.
 */
import { createState } from '../src/game/state';
import { SCENARIO_BY_ID } from '../src/game/content/scenarios';
import { step, DT } from '../src/game/sim';
import { Bot } from './bot';
import { YEAR_SECONDS } from '../src/game/content/economy';

declare const process: { env: Record<string, string | undefined> };
const sc = SCENARIO_BY_ID[process.env.SCENARIO ?? 'sawmill'];
const s = createState(sc);
const bot = Bot.for(s);
const limit = (sc.goal.beforeYear - sc.startYear) * YEAR_SECONDS + 10;
for (let t = 0; t < limit && !s.result; t += DT) {
  bot.act(s);
  step(s);
}
for (const l of bot.log) console.log(l);
console.log(`first pay ${s.firstPayAt?.toFixed(0)} s; result ${s.result ? `${s.result.won ? 'won' : 'lost'} ${s.result.year} cash ${s.result.cash} stars ${s.result.stars}` : 'none'} at ${s.time.toFixed(0)} s`);
console.log(`sites: ${s.sites.map((x) => `${x.id} stock ${x.stock.toFixed(1)} delivered ${x.delivered} size ${x.size}`).join('; ')}`);
