/**
 * npm run balance: the bot plays a scenario (SCENARIO=harju, PLAN=careful or careless) and prints
 * its moves, each train's money, and the company year by year.
 */
import { createState } from '../src/game/state';
import { SCENARIO_BY_ID } from '../src/game/content/scenarios';
import { step, worth, money, debt, ageOf } from '../src/game/sim';
import { Bot, PLANS } from '../src/game/bot';
import { YEAR_SECONDS } from '../src/game/content/economy';

declare const process: { env: Record<string, string | undefined> };
const sc = SCENARIO_BY_ID[process.env.SCENARIO ?? 'harju'];
const which = (process.env.PLAN ?? 'careful') as 'careful' | 'careless';
const s = createState(sc);
const bot = new Bot(PLANS[sc.id][which]);
const limit = (sc.goal.byYear - sc.startYear + 1.1) * YEAR_SECONDS;
while (s.time < limit && !s.result) {
  bot.act(s);
  step(s);
}
for (const l of bot.log) console.log(l);
const pad = (x: number | string, n = 9) => String(typeof x === 'number' ? Math.round(x) : x).padStart(n);
console.log(['year', 'revenue', 'fuel', 'upkeep', 'repairs', 'interest', 'profit', 'build', 'cash', 'debt', 'worth'].map((h) => pad(h)).join(''));
for (const y of s.history) console.log([y.year, y.revenue, y.fuel, y.upkeep, y.repairs, y.interest, y.profit, y.build, y.cash, y.debt, y.worth].map((x) => pad(x)).join(''));
for (const t of s.trains) console.log(`train ${t.name} ${t.loco} age ${ageOf(s, t).toFixed(1)} last year +${money(t.earnedLast)} -${money(t.costLast)} all ${money(t.profitAll)} breakdowns ${t.breakdowns} ${t.state}`);
for (const site of s.sites) if (site.kind === 'town') console.log(`${site.id} houses ${site.homes.length} delivered ${site.delivered}`);
console.log(`hauled ${JSON.stringify(s.hauled)}`);
console.log(`result ${s.result ? `${s.result.won ? 'WON' : 'LOST'} tier ${s.result.tier} ${s.result.reason} ${s.result.year} worth ${money(s.result.worth)}` : 'none'}; cash ${money(s.cash)} debt ${money(debt(s))} worth ${money(worth(s))}`);
