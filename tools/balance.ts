/**
 * npm run balance: the bot plays a scenario (SCENARIO=harju, sawmill by default) and prints its
 * moves, then the towns and the money year by year. Read it after touching content/economy.ts.
 */
import { createState } from '../src/game/state';
import { SCENARIO_BY_ID } from '../src/game/content/scenarios';
import { step, DT, netWorth, growFrac } from '../src/game/sim';
import { Bot } from './bot';
import { YEAR_SECONDS } from '../src/game/content/economy';
import { CARGOS } from '../src/game/types';

declare const process: { env: Record<string, string | undefined> };
const sc = SCENARIO_BY_ID[process.env.SCENARIO ?? 'sawmill'];
const s = createState(sc);
const bot = Bot.for(s);
const limit = (sc.goal.beforeYear - sc.startYear) * YEAR_SECONDS + 10;
const towns = s.sites.filter((x) => x.kind === 'town');
const grew: string[] = [];
const sizes = new Map(towns.map((t) => [t.id, t.size]));
let lastLog = 0;
for (let t = 0; t < limit * 1.2 && !s.result; t += DT) {
  bot.act(s);
  step(s);
  for (const x of towns) if (x.size !== sizes.get(x.id)) {
    grew.push(`${s.time.toFixed(0)} s ${x.id} to ${x.size}`);
    sizes.set(x.id, x.size);
  }
  if (process.env.TRACE === '1' && s.time - lastLog >= 30) {
    lastLog = s.time;
    console.log(`${s.time.toFixed(0)} s cash ${Math.round(s.cash)} ${towns.map((x) => `${x.id} ${x.size}+${growFrac(x).toFixed(2)}`).join(' ')} trains ${s.trains.length}`);
  }
}
if (process.env.QUIET !== '1') for (const l of bot.log) console.log(l);
console.log(`first pay ${s.firstPayAt?.toFixed(0)} s; result ${s.result ? `${s.result.won ? 'won' : 'lost'} ${s.result.year} (${s.result.reason}) at ${s.result.time.toFixed(0)} s, cash ${s.result.cash} worth ${s.result.worth} stars ${s.result.stars}` : 'none'}`);
console.log(`grew: ${grew.join('; ') || 'none'}`);
console.log(`towns: ${towns.map((x) => `${x.id} size ${x.size} +${growFrac(x).toFixed(2)} got ${x.delivered}`).join('; ')}`);
console.log(`trains: ${s.trains.map((t) => `${t.lineId}:${t.trips} trips`).join(', ')}; picks ${s.picks}`);
const pad = (x: number | string, n = 8) => String(x).padStart(n);
console.log(['year', 'gross', 'running', 'engine', 'track', 'profit', 'cash', 'worth'].map((h) => pad(h)).join(''));
for (const y of s.history) {
  const h = s.history.indexOf(y);
  void h;
  console.log([y.year, '', '', '', '', y.profit, y.cash, y.worth].map((x) => pad(x)).join(''));
}
console.log(`end: cash ${Math.round(s.cash)} worth ${Math.round(netWorth(s))} income so far ${CARGOS.map((g) => `${g} ${Math.round(s.income[g])}`).join(' ')}`);
