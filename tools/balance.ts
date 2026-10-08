/**
 * npm run balance: the bot plays a scenario (SCENARIO=harju, sawmill by default; GREEDY=1 plays
 * the greedy plan) and prints the builds, then a table of the money year by year. Read it after
 * touching content/economy.ts.
 */
import { createState } from '../src/game/state';
import { SCENARIO_BY_ID } from '../src/game/content/scenarios';
import { step, DT, netWorth, sidingSpans } from '../src/game/sim';
import { Bot } from './bot';
import { YEAR_SECONDS } from '../src/game/content/economy';
import { CARGOS } from '../src/game/types';

declare const process: { env: Record<string, string | undefined> };
const sc = SCENARIO_BY_ID[process.env.SCENARIO ?? 'sawmill'];
const s = createState(sc);
const bot = Bot.for(s, process.env.GREEDY === '1', process.env.PLAN);
// SKIP=crane,siding leaves those buys out of the plan, to see what they add
const skip = (process.env.SKIP ?? '').split(',');
bot.plan = { steps: bot.plan.steps.filter((x) => !skip.includes(x.kind)) };
const limit = (sc.goal.beforeYear - sc.startYear) * YEAR_SECONDS + 10;
for (let t = 0; t < limit && !s.result; t += DT) {
  bot.act(s);
  step(s);
}
if (process.env.QUIET !== '1') for (const l of bot.log) console.log(l);
console.log(`first pay ${s.firstPayAt?.toFixed(0)} s; result ${s.result ? `${s.result.won ? 'won' : 'lost'} ${s.result.year} (${s.result.reason}) cash ${s.result.cash} worth ${s.result.worth} stars ${s.result.stars}` : 'none'} at ${s.time.toFixed(0)} s`);
console.log(`contracts: offered ${bot.years.filter((y) => y.offered).length}, taken ${bot.years.filter((y) => y.took).length}, done ${bot.contractsDone}, lost ${bot.contractsLost}, still held ${bot.held.length}; sidings ${s.lines.filter((l) => l.siding).length}, cranes ${s.stations.filter((x) => x.crane).length}`);
console.log(`sites: ${s.sites.map((x) => `${x.id} delivered ${x.delivered} size ${x.size} stock ${x.stock.toFixed(1)}`).join('; ')}`);
console.log(`waiting: ${s.sites.filter((x) => x.kind === 'town').map((x) => `${x.id} pax ${Object.entries(x.pax).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')} mail ${Object.entries(x.mail).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')} arrived ${x.arrived} growth ${x.growth.toFixed(2)}`).join('; ')}`);
const pad = (x: number | string, n = 7) => String(x).padStart(n);
console.log(['year', 'gross', 'pax', 'mail', 'running', 'engine', 'track', 'interest', 'cash', 'loan', 'worth', 'trains', 'run%'].map((h) => pad(h)).join(''));
for (const y of bot.years) {
  const gross = CARGOS.reduce((a, g) => a + y.income[g], 0);
  console.log([y.year, gross, y.income.pax, y.income.mail, y.running, y.engine, y.track, y.interest, y.cash, y.loan, y.worth, y.trains, `${Math.round((100 * y.upkeep) / Math.max(1, gross))}`].map((x) => pad(x)).join(''));
}
console.log(`running costs over the game: ${Math.round((100 * bot.years.reduce((a, y) => a + y.upkeep, 0)) / Math.max(1, bot.years.reduce((a, y) => a + CARGOS.reduce((b, g) => b + y.income[g], 0), 0)))} % of gross`);
console.log(`(end: cash ${Math.round(s.cash)} loan ${s.loan} worth ${Math.round(netWorth(s))} trains ${s.trains.length}, parked ${s.trains.filter((t) => t.parked).length})`);
if (process.env.TRAINS === '1')
  for (const t of s.trains) console.log(`train ${t.id} line ${t.lineId} ${t.state} at ${t.at} s ${t.s.toFixed(1)} dir ${t.dir} queued ${t.queued} claimed ${t.claimed} parked ${t.parked} slot ${t.slot} cargo ${t.cargo}`);
if (process.env.TRAINS === '1') for (const t of s.trains) console.log(`train ${t.id} earned ${Math.round(t.earned)} line ${t.lineId} odometer ${Math.round(t.odometer)}`);
if (process.env.LINES === '1') {
  const name = (id: number) => { const st = s.stations.find((x) => x.id === id)!; return st.siteId; };
  for (const a of s.lines) for (const b of s.lines) if (a.id < b.id) { let n = 0; for (const c of a.legs.flatMap((l) => [...l.block])) if (b.legs.some((l) => l.block.has(c))) n++; if (n) console.log(`share ${name(a.stops[0])}-${name(a.stops[1])} with ${name(b.stops[0])}-${name(b.stops[1])}: ${n} cells`); }
  for (const l of s.lines) console.log(`line ${name(l.stops[0])}-${name(l.stops[1])} ${l.path.length} cells, siding spans ${sidingSpans(s, l).filter((x, i, a) => a.findIndex((y) => y.d0 === x.d0 && y.d1 === x.d1) === i).map((x) => `${x.d0.toFixed(0)}-${x.d1.toFixed(0)}`).join(' ') || 'none'}${l.siding ? ` (siding ${l.siding.s0.toFixed(0)}-${l.siding.s1.toFixed(0)})` : ''}`);
}
